import { createFairLaneScheduler } from '../fleet/fair-lane-scheduler.js';

const fields = ['inviteId', 'requestId', 'modelIdentity', 'maxOutputTokens'];
const positive = value => Number.isSafeInteger(value) && value > 0;
const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const fail = (code, message) => Object.assign(new Error(message), { code });

/** Reserve one whole-model host before the requester sends a prompt. */
export function createCircleAdmission({ hostPeerId, modelIdentity, isReady, invites, isOwner = () => false,
  maxQueuedRequests, maxQueuedPerGuest, maxWaitMs, now = Date.now }) {
  if (!identity(hostPeerId) || !/^sha256:[a-f0-9]{64}$/.test(modelIdentity) || typeof isReady !== 'function'
    || typeof isOwner !== 'function' || !['lookup', 'admit', 'subscribe'].every(name => typeof invites?.[name] === 'function')
    || ![maxQueuedRequests, maxQueuedPerGuest, maxWaitMs].every(positive)
    || maxQueuedPerGuest > maxQueuedRequests || maxWaitMs > 2147483647) {
    throw fail('CIRCLE_CONFIGURATION', 'An exact host, model, invite store, and bounded queue are required');
  }

  const route = Object.freeze({ hostPeerId, modelIdentity });
  const pending = new Map();
  const scheduler = createFairLaneScheduler({
    capacityWaitMs: maxWaitMs,
    maxQueuedRequests,
    maxQueuedPerLane: maxQueuedPerGuest,
    findRoute: () => isReady() ? route : null,
    freeSlots: (_route, active, starting) => 1 - active.size - starting
  });
  const unsubscribe = invites.subscribe(({ inviteId, status }) => {
    if (status !== 'revoked') return;
    for (const entry of pending.values()) {
      if (entry.inviteId === inviteId) entry.abort.abort(fail('CIRCLE_REVOKED', 'Invite access was revoked'));
    }
  });

  let closed = false;
  return Object.freeze({
    /** The caller obtains authenticatedPeerId from the verified transport, never the request body. */
    async acquire(request, { authenticatedPeerId, signal, onAdmission = () => {} }) {
      if (closed) throw fail('CIRCLE_CLOSED', 'This computer has stopped serving');
      signal?.throwIfAborted();
      if (!request || !Object.keys(request).every(key => fields.includes(key)) || !identity(authenticatedPeerId)
        || !identity(request.requestId) || request.modelIdentity !== modelIdentity || !positive(request.maxOutputTokens)) {
        throw fail('CIRCLE_REQUEST', 'A prompt-free request for the exact model is required');
      }
      const { inviteId, requestId, maxOutputTokens } = request;
      const owner = inviteId === undefined && isOwner(authenticatedPeerId) === true;
      const binding = { inviteId, guestPeerId: authenticatedPeerId, hostPeerId };
      const grant = !owner && identity(inviteId) ? invites.lookup(binding) : null;
      if ((!owner && !grant) || (grant && (grant.maxOutputTokens < maxOutputTokens || grant.usedRequests >= grant.maxRequests))) {
        throw fail('CIRCLE_INVITE', 'No usable invite for this computer and request');
      }
      if (!isReady()) throw fail('CIRCLE_OFFLINE', 'The invited computer is unavailable');

      const attemptId = JSON.stringify([authenticatedPeerId, requestId]);
      if (pending.has(attemptId)) throw fail('CIRCLE_DUPLICATE', 'Request is already in the queue');
      const abort = new AbortController();
      const waitingSignal = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
      const expiresIn = grant ? grant.expiresAt - now() : Infinity;
      if (expiresIn <= 0) throw fail('CIRCLE_EXPIRED', 'Invite expired before admission');
      const expiry = expiresIn <= maxWaitMs
        ? setTimeout(() => abort.abort(fail('CIRCLE_EXPIRED', 'Invite expired before admission')), expiresIn)
        : null;
      const entry = { inviteId, abort, queued: false };
      pending.set(attemptId, entry);
      let slot;
      try {
        slot = await scheduler.acquire({ attemptId, threadId: authenticatedPeerId, requestedModel: modelIdentity,
          signal: waitingSignal, onAdmission: status => {
            entry.queued = status.status === 'queued';
            if (status.status === 'queued') {
              void Promise.resolve().then(() => onAdmission(status)).catch(() => {});
            }
          } });
        waitingSignal.throwIfAborted();
        if (!isReady()) throw fail('CIRCLE_OFFLINE', 'The invited computer is unavailable');
        if (owner && isOwner(authenticatedPeerId) !== true) throw fail('CIRCLE_OWNER', 'Owner access was withdrawn');
        if (!owner && invites.admit({ ...binding, requestId, maxOutputTokens })?.status !== 'admitted') {
          throw fail('CIRCLE_INVITE', 'Invite access was exhausted, expired, withdrawn, or already used');
        }
        slot.markDisclosed(hostPeerId);
        return Object.freeze({ route, queuedMs: slot.queuedMs, release: slot.release });
      } catch (error) {
        slot?.release();
        throw error;
      } finally {
        clearTimeout(expiry);
        pending.delete(attemptId);
      }
    },
    getState: () => ({ ready: !closed && isReady(), queued: scheduler.queuedCount() }),
    getQueuedCount: inviteId => identity(inviteId)
      ? [...pending.values()].filter(entry => entry.inviteId === inviteId && entry.queued).length : 0,
    close() {
      if (closed) return;
      closed = true;
      unsubscribe();
      for (const entry of pending.values()) entry.abort.abort(fail('CIRCLE_CLOSED', 'This computer has stopped serving'));
      scheduler.close();
    }
  });
}
