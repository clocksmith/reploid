import { randomBytes } from 'node:crypto';

const reject = (code, message) => Object.assign(new Error(message), { code, statusCode: 403 });

/** Own only admissions that have not yet reached the inference executor. */
export function createCircleHttpGrants({ invites, admission, ownerPairing, grantTtlMs, now }) {
  if (!Number.isSafeInteger(grantTtlMs) || grantTtlMs < 1 || grantTtlMs > 60_000) throw Error('Invalid circle HTTP grant lifetime');
  const unused = new Map();
  let closed = false;
  function detach(entry) {
    unused.delete(entry.token);
    clearTimeout(entry.timer);
    entry.lease.streamSignal.removeEventListener('abort', entry.onStopped);
  }
  function abandon(entry, reason = reject('CIRCLE_GRANT_EXPIRED', 'The prompt admission has ended')) {
    if (unused.get(entry.token) !== entry) return;
    detach(entry);
    entry.abort.abort(reason);
    try { entry.lease.settle({ outcome: 'stopped', outputTokens: 0, modelWeightBytes: 0 }); }
    finally { entry.lease.release(); }
  }
  function check(entry) {
    entry.abort.signal.throwIfAborted();
    let error;
    if (closed || !admission.getAvailability().ready) error = reject('CIRCLE_OFFLINE','The admitted computer is unavailable');
    else if (now() >= entry.expiresAt) error = reject('CIRCLE_GRANT_EXPIRED','The prompt admission expired');
    else if (entry.lease.role === 'owner' ? !ownerPairing.isOwner(entry.peerId) : !invites.lookup({
      inviteId:entry.lease.inviteId, guestPeerId:entry.peerId, hostPeerId:entry.lease.route.hostPeerId
    })) error = reject('CIRCLE_REVOKED','Prompt access was withdrawn');
    if (error) { abandon(entry,error); throw error; }
  }
  const endRevoked = invites.subscribe(({ inviteId, status }) => {
    if (status === 'revoked') for (const entry of unused.values()) {
      if (entry.lease.inviteId === inviteId) abandon(entry,reject('CIRCLE_REVOKED','Prompt access was withdrawn'));
    }
  });
  return {
    issue(lease, peerId, metadata) {
      const token = randomBytes(32).toString('base64url');
      const expiresAt = Math.min(now()+grantTtlMs, lease.grant?.expiresAt ?? Infinity);
      const entry = {token,lease,peerId,metadata,expiresAt,reading:false,abort:new AbortController()};
      entry.onStopped = () => abandon(entry,reject('CIRCLE_REVOKED','The prompt admission was withdrawn'));
      entry.timer = setTimeout(() => abandon(entry), Math.max(0,expiresAt-now()));
      entry.timer.unref();
      unused.set(token,entry);
      lease.streamSignal.addEventListener('abort',entry.onStopped,{once:true});
      if (lease.streamSignal.aborted) entry.onStopped();
      check(entry);
      return entry;
    },
    lookup(token, peerId, hostPeerId) {
      const entry = unused.get(token);
      if (!entry || entry.peerId !== peerId || entry.lease.route.hostPeerId !== hostPeerId) {
        throw reject('CIRCLE_GRANT_REQUIRED','A current prompt grant for this guest and host is required');
      }
      check(entry);
      return entry;
    },
    claim(entry) {
      if (entry.reading) throw reject('CIRCLE_GRANT_USED','This grant already has a submission');
      entry.reading = true;
    },
    dispatch(entry) {
      check(entry);
      if (!entry.reading || unused.get(entry.token) !== entry) throw reject('CIRCLE_GRANT_USED','This grant is no longer available');
      // The executor now owns settlement. Its configured in-flight revocation policy applies.
      detach(entry);
    },
    abandon,
    close() { closed = true; endRevoked(); for (const entry of unused.values()) abandon(entry); }
  };
}
