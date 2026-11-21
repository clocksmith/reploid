import { createFairLaneScheduler } from '../fleet/fair-lane-scheduler.js';

const fields = ['inviteId', 'requestId', 'modelIdentity', 'maxOutputTokens', 'conversationId'];
const REVOCATION_POLICIES = new Set(['finish', 'stop']);
const positive = value => Number.isSafeInteger(value) && value > 0;
const nonNegative = value => Number.isSafeInteger(value) && value >= 0;
const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });

export function formatHostDisclosure({ hostPeerId, hostLabel = hostPeerId }) {
  const label = typeof hostLabel === 'string' && hostLabel.trim() ? hostLabel.trim() : hostPeerId;
  return Object.freeze({
    hostPeerId,
    hostLabel: label,
    readableBy: `Readable by: ${label}`,
    notice: `This runs on ${label}. Its operator can read your prompt.`
  });
}

/** Reserve one whole-model host before the requester sends a prompt. */
export function createCircleAdmission({
  hostPeerId,
  hostLabel = hostPeerId,
  modelIdentity,
  isReady,
  invites,
  isOwner = () => false,
  maxQueuedRequests,
  maxQueuedPerGuest,
  maxWaitMs,
  estimatedTurnMs = 0,
  maxExpectedWaitMs = 20_000,
  onRevokeInFlight = 'finish',
  now = Date.now
}) {
  if (!identity(hostPeerId) || !/^sha256:[a-f0-9]{64}$/.test(modelIdentity) || typeof isReady !== 'function'
    || typeof isOwner !== 'function' || !['lookup', 'admit', 'subscribe'].every(name => typeof invites?.[name] === 'function')
    || ![maxQueuedRequests, maxQueuedPerGuest, maxWaitMs].every(positive)
    || maxQueuedPerGuest > maxQueuedRequests || maxWaitMs > 2147483647
    || !nonNegative(estimatedTurnMs) || !positive(maxExpectedWaitMs)
    || !REVOCATION_POLICIES.has(onRevokeInFlight)) {
    throw fail('CIRCLE_CONFIGURATION', 'An exact host, model, invite store, and bounded queue are required');
  }

  const label = typeof hostLabel === 'string' && hostLabel.trim() ? hostLabel.trim() : hostPeerId;
  const disclosure = formatHostDisclosure({ hostPeerId, hostLabel: label });
  const route = Object.freeze({ hostPeerId, modelIdentity });
  const pending = new Map();
  const activeLeases = new Map();
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
    for (const active of activeLeases.values()) {
      if (active.inviteId !== inviteId) continue;
      if (!active.disclosed) {
        active.streamAbort.abort(fail('CIRCLE_REVOKED', 'Invite access was revoked'));
        active.release?.();
        continue;
      }
      active.revokedWhileStreaming = true;
      if (onRevokeInFlight === 'stop') {
        active.streamAbort.abort(fail('CIRCLE_REVOKED', 'Invite access was revoked during streaming'));
      }
    }
  });

  let closed = false;

  function expectedWaitForNewRequest() {
    if (estimatedTurnMs <= 0) return 0;
    return (activeLeases.size + scheduler.queuedCount()) * estimatedTurnMs;
  }

  function getAvailability() {
    const readyNow = !closed && isReady();
    const queued = scheduler.queuedCount();
    const active = activeLeases.size;
    const expectedWaitMs = expectedWaitForNewRequest();
    let status = 'ready';
    if (!readyNow) status = 'offline';
    else if (queued >= maxQueuedRequests || (estimatedTurnMs > 0 && expectedWaitMs > maxExpectedWaitMs)) status = 'full';
    else if (active > 0 || queued > 0) status = 'queued';
    return Object.freeze({
      status,
      ready: readyNow,
      active,
      queued,
      maxQueuedRequests,
      expectedWaitMs,
      maxExpectedWaitMs,
      hostPeerId,
      hostLabel: label,
      modelIdentity,
      onRevokeInFlight,
      disclosure,
      fallback: status === 'full' || status === 'offline' ? ['replay', 'host-your-own'] : []
    });
  }

  return Object.freeze({
    /** The caller obtains authenticatedPeerId from the verified transport, never the request body. */
    async acquire(request, { authenticatedPeerId, signal, deferDisclosure = false, onAdmission = () => {} }) {
      if (closed) throw fail('CIRCLE_CLOSED', 'This computer has stopped serving', { state: 'offline', fallback: ['replay', 'host-your-own'] });
      signal?.throwIfAborted();
      if (!request || !Object.keys(request).every(key => fields.includes(key)) || !identity(authenticatedPeerId)
        || !identity(request.requestId) || request.modelIdentity !== modelIdentity || !positive(request.maxOutputTokens)
        || (request.conversationId !== undefined && !identity(request.conversationId))) {
        throw fail('CIRCLE_REQUEST', 'A prompt-free request for the exact model is required');
      }
      const { inviteId, requestId, maxOutputTokens, conversationId = null } = request;
      const owner = inviteId === undefined && isOwner(authenticatedPeerId) === true;
      const binding = { inviteId, guestPeerId: authenticatedPeerId, hostPeerId };
      const grant = !owner && identity(inviteId) ? invites.lookup(binding) : null;
      if ((!owner && !grant) || (grant && (grant.maxOutputTokens < maxOutputTokens || grant.usedRequests >= grant.maxRequests))) {
        throw fail('CIRCLE_INVITE', 'No usable invite for this computer and request', { fallback: ['replay', 'host-your-own'] });
      }
      if (!isReady()) {
        throw fail('CIRCLE_OFFLINE', 'The invited computer is unavailable', { state: 'offline', fallback: ['replay', 'host-your-own'] });
      }

      const expectedWaitMs = expectedWaitForNewRequest();
      if (!owner && estimatedTurnMs > 0 && expectedWaitMs > maxExpectedWaitMs) {
        throw fail('CIRCLE_WAIT_EXCEEDED', 'Expected wait exceeds the queue threshold; watch the replay or host your own', {
          state: 'full',
          expectedWaitMs,
          maxExpectedWaitMs,
          fallback: ['replay', 'host-your-own']
        });
      }

      const role = owner ? 'owner' : 'guest';
      const laneKey = owner ? `owner:${authenticatedPeerId}` : `guest:${authenticatedPeerId}:${inviteId}`;
      const attemptId = JSON.stringify([role, authenticatedPeerId, requestId]);
      if (pending.has(attemptId) || activeLeases.has(attemptId)) {
        throw fail('CIRCLE_DUPLICATE', 'Request is already in the queue');
      }
      const abort = new AbortController();
      const waitingSignal = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
      const expiresIn = grant ? grant.expiresAt - now() : Infinity;
      if (expiresIn <= 0) throw fail('CIRCLE_EXPIRED', 'Invite expired before admission', { fallback: ['replay', 'host-your-own'] });
      const expiry = expiresIn <= maxWaitMs
        ? setTimeout(() => abort.abort(fail('CIRCLE_EXPIRED', 'Invite expired before admission')), expiresIn)
        : null;
      const entry = { inviteId, abort, queued: false };
      pending.set(attemptId, entry);
      let slot;
      try {
        slot = await scheduler.acquire({
          attemptId,
          threadId: laneKey,
          requestedModel: modelIdentity,
          signal: waitingSignal,
          onAdmission: status => {
            entry.queued = status.status === 'queued';
            if (status.status === 'queued') {
              const projectedWaitMs = estimatedTurnMs > 0 ? status.queuePosition * estimatedTurnMs : 0;
              void Promise.resolve().then(() => onAdmission({
                ...status,
                hostState: 'queued',
                expectedWaitMs: projectedWaitMs
              })).catch(() => {});
            }
          }
        });
        waitingSignal.throwIfAborted();
        if (!isReady()) throw fail('CIRCLE_OFFLINE', 'The invited computer is unavailable', { state: 'offline', fallback: ['replay', 'host-your-own'] });
        if (owner && isOwner(authenticatedPeerId) !== true) throw fail('CIRCLE_OWNER', 'Owner access was withdrawn');
        // The single resident slot serializes releases. Re-read the invitation
        // after waiting so no two releases promise its last request allowance.
        const releaseGrant = !owner ? invites.lookup(binding) : null;
        if (!owner && (!releaseGrant || releaseGrant.expiresAt <= now()
          || releaseGrant.maxOutputTokens < maxOutputTokens || releaseGrant.usedRequests >= releaseGrant.maxRequests)) {
          throw fail('CIRCLE_INVITE', 'Invite access changed while waiting for the computer');
        }
        const streamAbort = new AbortController();
        const activeRecord = {
          attemptId,
          role,
          inviteId: owner ? null : inviteId,
          authenticatedPeerId,
          conversationId,
          requestId,
          streamAbort,
          revokedWhileStreaming: false,
          settledReceipt: null,
          released: false,
          disclosed: false
        };
        activeRecord.release = release;
        activeLeases.set(attemptId, activeRecord);

        let admittedGrant = null;
        function beginDisclosure() {
          if (closed || activeRecord.released || activeRecord.disclosed || !isReady()) {
            throw fail('CIRCLE_CLOSED', 'Disclosure lease is no longer available');
          }
          signal?.throwIfAborted();
          if (owner && isOwner(authenticatedPeerId) !== true) throw fail('CIRCLE_OWNER', 'Owner access was withdrawn');
          if (!owner) {
            const admitted = invites.admit({ ...binding, requestId, maxOutputTokens });
            if (admitted?.status !== 'admitted') throw fail('CIRCLE_INVITE', 'Invite access was exhausted, expired, withdrawn, or already used');
            admittedGrant = admitted.grant;
          }
          slot.markDisclosed(hostPeerId);
          activeRecord.disclosed = true;
        }
        if (!deferDisclosure) {
          try { beginDisclosure(); } catch (error) { release(); throw error; }
        }

        function buildReceipt({ outcome, outputTokens = 0, modelWeightBytes = 0, settledAt = now() }) {
          return Object.freeze({
            schema: 'reploid.circle-receipt/v1',
            requestId,
            conversationId,
            role,
            inviteId: activeRecord.inviteId,
            requesterPeerId: authenticatedPeerId,
            hostPeerId,
            hostLabel: label,
            modelIdentity,
            outcome,
            outputTokens,
            modelWeightBytes,
            revokedWhileStreaming: activeRecord.revokedWhileStreaming,
            settledAt
          });
        }

        function settle({ outcome = 'completed', outputTokens = 0, modelWeightBytes = 0 } = {}) {
          if (!activeRecord.disclosed) throw fail('CIRCLE_SETTLE', 'An undisclosed lease cannot settle');
          if (activeRecord.settledReceipt) {
            return { settled: false, alreadySettled: true, receipt: activeRecord.settledReceipt };
          }
          if (!owner && typeof invites.settle === 'function') {
            const result = invites.settle({
              inviteId,
              guestPeerId: authenticatedPeerId,
              hostPeerId,
              requestId,
              outcome,
              outputTokens,
              modelWeightBytes
            });
            if (!result) throw fail('CIRCLE_SETTLE', 'Unable to settle guest request');
            const receipt = buildReceipt({
              outcome: result.record.outcome,
              outputTokens: result.record.outputTokens,
              modelWeightBytes: result.record.modelWeightBytes,
              settledAt: result.record.settledAt
            });
            activeRecord.settledReceipt = receipt;
            return { settled: result.settled, alreadySettled: result.alreadySettled, receipt };
          }
          const receipt = buildReceipt({ outcome, outputTokens, modelWeightBytes });
          activeRecord.settledReceipt = receipt;
          return { settled: true, alreadySettled: false, receipt };
        }

        function release() {
          if (activeRecord.released) return;
          activeRecord.released = true;
          activeLeases.delete(attemptId);
          slot.release();
        }

        return Object.freeze({
          route,
          role,
          inviteId: activeRecord.inviteId,
          conversationId,
          get grant() { return admittedGrant; },
          expiresAt: releaseGrant?.expiresAt ?? null,
          beginDisclosure,
          disclosure,
          queuedMs: slot.queuedMs,
          onRevokeInFlight,
          streamSignal: streamAbort.signal,
          isRevoked: () => activeRecord.revokedWhileStreaming,
          settle,
          release
        });
      } catch (error) {
        slot?.release();
        throw error;
      } finally {
        clearTimeout(expiry);
        pending.delete(attemptId);
      }
    },
    getState: () => ({ ready: !closed && isReady(), queued: scheduler.queuedCount() }),
    getAvailability,
    getQueuedCount: inviteId => identity(inviteId)
      ? [...pending.values()].filter(entry => entry.inviteId === inviteId && entry.queued).length : 0,
    getActiveCount: inviteId => identity(inviteId)
      ? [...activeLeases.values()].filter(entry => entry.inviteId === inviteId).length : 0,
    close() {
      if (closed) return;
      closed = true;
      unsubscribe();
      for (const entry of pending.values()) entry.abort.abort(fail('CIRCLE_CLOSED', 'This computer has stopped serving'));
      for (const active of activeLeases.values()) {
        active.streamAbort.abort(fail('CIRCLE_CLOSED', 'This computer has stopped serving'));
      }
      activeLeases.clear();
      scheduler.close();
    }
  });
}
