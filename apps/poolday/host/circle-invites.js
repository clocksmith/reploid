const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const validHost = value => typeof value === 'string' && value.length > 0 && value.length <= 256;

export function createCircleInviteUrl({ token, hostPeerId }, baseUrl = globalThis.location.href) {
  if (!tokenPattern.test(token) || !validHost(hostPeerId)) throw Error('Invalid host invitation');
  const url = new URL('/', baseUrl);
  url.hash = new URLSearchParams({ circle: token, host: hostPeerId }).toString();
  return url.href;
}

export function parseCircleInviteUrl(value = globalThis.location.href) {
  const url = new URL(value);
  const fragment = new URLSearchParams(url.hash.slice(1));
  if (fragment.getAll('circle').length !== 1 || fragment.getAll('host').length !== 1) return null;
  const token = fragment.get('circle'), hostPeerId = fragment.get('host');
  return tokenPattern.test(token) && validHost(hostPeerId) ? { token, hostPeerId } : null;
}

/** request() is the current paired desktop's authenticated owner command port. */
export function createCircleInviteOwner({ request, baseUrl }) {
  return Object.freeze({
    list: () => request({ op: 'circle-invites.list' }),
    async issue({ expiresAt, maxRequests, maxOutputTokens }) {
      const created = await request({ op: 'circle-invites.issue', expiresAt, maxRequests, maxOutputTokens });
      return { inviteId: created.inviteId, link: createCircleInviteUrl(created, baseUrl) };
    },
    revoke: inviteId => request({ op: 'circle-invites.revoke', inviteId })
  });
}
