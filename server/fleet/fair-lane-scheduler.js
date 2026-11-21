import { assert } from './contract.js';

/** Fair round-robin admission scheduler across conversation lanes, including fast-path dispatches. */
export function createFairLaneScheduler({
  enabled = true,
  capacityWaitMs = 30000,
  maxQueuedRequests = Infinity,
  maxQueuedPerLane = Infinity,
  canDrain = () => true,
  findRoute,
  freeSlots,
  onPoll = () => {}
}) {
  const queuedEntries = new Map(), laneBuckets = new Map(), laneLastDispatched = new Map();
  const activeProvidersByAttempt = new Map();
  let startingDispatches = 0, dispatchSequence = 0, queuePollTimer = null, closed = false;

  function recordLaneDispatch(lane) {
    laneLastDispatched.set(lane, ++dispatchSequence);
    if (laneLastDispatched.size > 256) {
      for (const key of laneLastDispatched.keys()) {
        if (!laneBuckets.has(key)) {
          laneLastDispatched.delete(key);
          if (laneLastDispatched.size <= 192) break;
        }
      }
    }
  }

  function computeFairOrder() {
    const copies = new Map();
    const virtualLast = new Map();
    let virtualSeq = dispatchSequence;
    for (const [lane, items] of laneBuckets.entries()) {
      if (items?.length) {
        copies.set(lane, [...items]);
        virtualLast.set(lane, laneLastDispatched.get(lane) ?? 0);
      }
    }
    const order = [];
    while (copies.size > 0) {
      let bestLane = null, bestSeq = Infinity, bestQueuedAt = Infinity;
      for (const [lane, items] of copies.entries()) {
        const seq = virtualLast.get(lane) ?? 0, queuedAt = items[0].queuedAt;
        if (seq < bestSeq || (seq === bestSeq && queuedAt < bestQueuedAt)) {
          bestLane = lane; bestSeq = seq; bestQueuedAt = queuedAt;
        }
      }
      if (bestLane === null) break;
      const items = copies.get(bestLane);
      order.push(items.shift());
      virtualLast.set(bestLane, ++virtualSeq);
      if (items.length === 0) copies.delete(bestLane);
    }
    return order;
  }

  function notifyQueuePositions() {
    const ordered = computeFairOrder();
    const total = ordered.length;
    ordered.forEach((entry, index) => {
      const position = index + 1;
      if (entry.lastPosition !== position || entry.lastTotal !== total) {
        entry.lastPosition = position;
        entry.lastTotal = total;
        entry.onAdmission?.({ status: 'queued', queuePosition: position, queuedCount: total, queuedAt: entry.queuedAt });
      }
    });
  }

  function removeQueuedEntry(entry) {
    queuedEntries.delete(entry.attemptId);
    clearTimeout(entry.timer);
    entry.signal?.removeEventListener('abort', entry.onAbort);
    const items = laneBuckets.get(entry.lane);
    if (items) {
      const index = items.indexOf(entry);
      if (index >= 0) items.splice(index, 1);
      if (!items.length) laneBuckets.delete(entry.lane);
    }
    if (queuedEntries.size === 0 && queuePollTimer) {
      clearInterval(queuePollTimer);
      queuePollTimer = null;
    }
  }

  function drain() {
    if (closed || !canDrain() || !queuedEntries.size) return;
    let progressed = true;
    while (progressed && laneBuckets.size > 0) {
      progressed = false;
      const candidates = [...laneBuckets.entries()]
        .filter(([, items]) => items?.length > 0)
        .sort(([laneA, itemsA], [laneB, itemsB]) => {
          const seqDiff = (laneLastDispatched.get(laneA) ?? 0) - (laneLastDispatched.get(laneB) ?? 0);
          return seqDiff !== 0 ? seqDiff : itemsA[0].queuedAt - itemsB[0].queuedAt;
        });
      for (const [lane, items] of candidates) {
        const entry = items[0];
        const chosen = findRoute(entry.requestedModel, entry.allowPartitionFallback);
        if (chosen && freeSlots(chosen, activeProvidersByAttempt, startingDispatches) > 0) {
          items.shift();
          if (items.length === 0) laneBuckets.delete(lane);
          queuedEntries.delete(entry.attemptId);
          clearTimeout(entry.timer);
          entry.signal?.removeEventListener('abort', entry.onAbort);
          recordLaneDispatch(lane);
          startingDispatches += 1;
          entry.resolve({ chosen, queuedMs: Math.max(0, Date.now() - entry.queuedAt), releaseStarting: true });
          progressed = true;
          break;
        }
      }
    }
    if (queuedEntries.size === 0 && queuePollTimer) {
      clearInterval(queuePollTimer);
      queuePollTimer = null;
    }
    notifyQueuePositions();
  }

  async function acquire({ attemptId, threadId, requestedModel, allowPartitionFallback = false, signal, onAdmission }) {
    signal.throwIfAborted();
    assert(!closed, 'Admission queue is closed');
    assert(!queuedEntries.has(attemptId) && !activeProvidersByAttempt.has(attemptId), 'Attempt is already scheduled');
    if (!enabled) {
      const immediate = findRoute(requestedModel, allowPartitionFallback);
      return { chosen: immediate, queuedMs: 0, markDisclosed() {}, release() {} };
    }
    assert(Number.isSafeInteger(capacityWaitMs) && capacityWaitMs > 0, 'Explicit capacity wait bound required');
    const lane = typeof threadId === 'string' && threadId ? threadId : attemptId;
    if (queuedEntries.size === 0) {
      const immediate = findRoute(requestedModel, allowPartitionFallback);
      if (immediate && freeSlots(immediate, activeProvidersByAttempt, startingDispatches) > 0) {
        recordLaneDispatch(lane);
        startingDispatches += 1;
        let startingHeld = true;
        return {
          chosen: immediate,
          queuedMs: 0,
          markDisclosed(providerKey) {
            if (providerKey) activeProvidersByAttempt.set(attemptId, providerKey);
            if (startingHeld) { startingHeld = false; startingDispatches = Math.max(0, startingDispatches - 1); }
            drain();
          },
          release() {
            activeProvidersByAttempt.delete(attemptId);
            if (startingHeld) { startingHeld = false; startingDispatches = Math.max(0, startingDispatches - 1); }
            drain();
          }
        };
      }
    }
    assert(queuedEntries.size < maxQueuedRequests && (laneBuckets.get(lane)?.length ?? 0) < maxQueuedPerLane,
      'Admission queue is full');
    const queuedAt = Date.now();
    const acquired = await new Promise((resolve, reject) => {
      const entry = {
        attemptId, lane, requestedModel, allowPartitionFallback, signal, onAdmission, queuedAt,
        lastPosition: 0, lastTotal: 0, resolve, reject,
        timer: setTimeout(() => {
          removeQueuedEntry(entry);
          notifyQueuePositions();
          reject(Error('No ready capacity within the configured wait'));
        }, capacityWaitMs),
        onAbort: () => {
          removeQueuedEntry(entry);
          notifyQueuePositions();
          reject(signal.reason || new DOMException('Aborted', 'AbortError'));
        }
      };
      signal.addEventListener('abort', entry.onAbort, { once: true });
      let items = laneBuckets.get(lane);
      if (!items) { items = []; laneBuckets.set(lane, items); }
      items.push(entry);
      queuedEntries.set(attemptId, entry);
      if (!queuePollTimer) {
        queuePollTimer = setInterval(() => {
          void Promise.resolve(onPoll()).catch(() => {});
          drain();
        }, 500);
        queuePollTimer.unref?.();
      }
      notifyQueuePositions();
      drain();
    });
    let startingHeld = acquired.releaseStarting === true;
    onAdmission?.({ status: 'admitted', queuedMs: acquired.queuedMs });
    return {
      chosen: acquired.chosen,
      queuedMs: acquired.queuedMs,
      markDisclosed(providerKey) {
        if (providerKey) activeProvidersByAttempt.set(attemptId, providerKey);
        if (startingHeld) { startingHeld = false; startingDispatches = Math.max(0, startingDispatches - 1); }
        drain();
      },
      release() {
        activeProvidersByAttempt.delete(attemptId);
        if (startingHeld) { startingHeld = false; startingDispatches = Math.max(0, startingDispatches - 1); }
        drain();
      }
    };
  }

  return Object.freeze({
    acquire,
    drain,
    queuedCount: () => queuedEntries.size,
    close() {
      closed = true;
      for (const entry of queuedEntries.values()) {
        removeQueuedEntry(entry);
        entry.reject(Error('Admission queue is closed'));
      }
    }
  });
}
