const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const validHost = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const validLabel = value => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 128;

export function describeCircleHost(hostLabel, hostPeerId = '') {
  let label = 'invited computer';
  if (validLabel(hostLabel)) label = hostLabel.trim();
  else if (validHost(hostPeerId)) label = hostPeerId;
  return Object.freeze({
    hostLabel: label,
    readableBy: `Readable by: ${label}`,
    notice: `This runs on ${label}. Its operator can read your prompt.`
  });
}

export function createCircleInviteUrl({ token, hostPeerId, hostLabel }, baseUrl = globalThis.location.href) {
  if (!tokenPattern.test(token) || !validHost(hostPeerId)) throw Error('Invalid host invitation');
  const url = new URL('/', baseUrl);
  const params = new URLSearchParams({ circle: token, host: hostPeerId });
  if (validLabel(hostLabel) && hostLabel.trim() !== hostPeerId) {
    params.set('name', hostLabel.trim());
  }
  url.hash = params.toString();
  return url.href;
}

export function parseCircleInviteUrl(value = globalThis.location.href) {
  const url = new URL(value);
  const fragment = new URLSearchParams(url.hash.slice(1));
  if (fragment.getAll('circle').length !== 1 || fragment.getAll('host').length !== 1) return null;
  if (fragment.getAll('name').length > 1) return null;
  const token = fragment.get('circle'), hostPeerId = fragment.get('host');
  if (!tokenPattern.test(token) || !validHost(hostPeerId)) return null;
  const rawName = fragment.get('name');
  if (rawName !== null && !validLabel(rawName)) return null;
  return rawName ? { token, hostPeerId, hostLabel: rawName.trim() } : { token, hostPeerId };
}

/** request() is the current paired desktop's authenticated owner command port. */
export function createCircleInviteOwner({ request, baseUrl }) {
  return Object.freeze({
    list: () => request({ op: 'circle-invites.list' }),
    async issue({ expiresAt, maxRequests, maxOutputTokens }) {
      const created = await request({ op: 'circle-invites.issue', expiresAt, maxRequests, maxOutputTokens });
      return {
        inviteId: created.inviteId,
        hostLabel: created.hostLabel || created.hostPeerId,
        link: createCircleInviteUrl(created, baseUrl)
      };
    },
    revoke: inviteId => request({ op: 'circle-invites.revoke', inviteId })
  });
}

/** request() must stay on the already verified direct desktop channel, without retry or reroute. */
export function createCircleInviteGuest({ request, hostPeerId, inviteId, currentHost }) {
  const assertHost = () => {
    if (!validHost(hostPeerId) || currentHost() !== hostPeerId) throw Error('Invited computer is unavailable');
  };
  return Object.freeze({
    async generate({ requestId, modelIdentity, maxOutputTokens, conversationId, prompt, signal }) {
      signal?.throwIfAborted();
      assertHost();
      const grant = await request('/circle/admit', { hostPeerId, inviteId, requestId, modelIdentity, maxOutputTokens,
        ...(conversationId === undefined ? {} : { conversationId }) }, { signal });
      signal?.throwIfAborted();
      assertHost();
      if (!grant || grant.hostPeerId !== hostPeerId || grant.requestId !== requestId
        || typeof grant.release !== 'string' || !Number.isFinite(grant.expiresAt) || grant.expiresAt <= Date.now()) {
        throw Error('The invited computer did not grant this request');
      }
      return request('/circle/chat', { hostPeerId, requestId, release: grant.release, prompt }, { signal });
    }
  });
}
