/** Same-recipient re-delivery of one whole request's frames (delivery protocols 1 and 2).
 *
 * A provider that advertises `deliveryProtocol: 1` answers each admission question and each admitted
 * request at once with `reploid:request-received`. Without that answer within `ackTimeoutMs`, the
 * requester sends the same frame again, to the same computer on the same connection, at most
 * `maxResends` times per stage. It never chooses another recipient; that still needs an explicit Retry.
 * The provider deduplicates by request ID, so a repeated frame is not executed or charged again.
 * An acknowledgement proves only that the frame arrived on the authenticated channel.
 *
 * Protocol 2 (advertised as `deliveryProtocols: [1, 2]`) changes only the path a re-send takes, never its
 * recipient: the first re-send goes on a fresh data channel of the same connection (its own SCTP stream,
 * so it is not queued behind the stalled one), and an ICE restart of that same connection follows when
 * ICE reports trouble or the fresh channel stalls too. The provider answers on the path a frame arrived on.
 * A fresh stream still shares the connection's SCTP association and its congestion state; only the ICE
 * restart finds a new network path. */
export const DELIVERY_PROTOCOL = 1;
export const PATH_DELIVERY_PROTOCOL = 2;
export const DELIVERY_PROTOCOLS = Object.freeze([DELIVERY_PROTOCOL, PATH_DELIVERY_PROTOCOL]);
export const DELIVERY_STAGES = Object.freeze(['admit', 'request']);
const MAX_ATTEMPTS = 16;

/** The delivery fields of a received frame, or null for a frame from a requester that predates them. */
export function readDelivery(payload) {
  const delivery = payload?.delivery;
  if (!delivery || !DELIVERY_PROTOCOLS.includes(delivery.protocol) || !Number.isSafeInteger(delivery.attempt)
    || delivery.attempt < 1 || delivery.attempt > MAX_ATTEMPTS) return null;
  return { protocol: delivery.protocol, attempt: delivery.attempt };
}

/** The highest delivery protocol both sides speak, from a provider's advertisement. */
export function advertisedDeliveryProtocol(advertisement) {
  if (Array.isArray(advertisement?.deliveryProtocols) && advertisement.deliveryProtocols.includes(PATH_DELIVERY_PROTOCOL)
    && advertisement.deliveryProtocol === DELIVERY_PROTOCOL) return PATH_DELIVERY_PROTOCOL;
  return advertisement?.deliveryProtocol === DELIVERY_PROTOCOL ? DELIVERY_PROTOCOL : null;
}

/** `resend(stage, attempt)` returns true once the frame was handed to the same connection, false if it
 * could not be, or a promise for `{ path }` (protocol 2) when the frame waits for a fresh path. */
export function createRequestDelivery({ ackTimeoutMs, maxResends, resend, now = () => Date.now(), protocol = DELIVERY_PROTOCOL }) {
  if (!Number.isSafeInteger(ackTimeoutMs) || ackTimeoutMs <= 0) throw new TypeError('Delivery acknowledgement timeout must be a positive integer');
  if (!Number.isSafeInteger(maxResends) || maxResends < 0 || maxResends >= MAX_ATTEMPTS) throw new TypeError('Delivery re-send limit is out of range');
  if (!DELIVERY_PROTOCOLS.includes(protocol)) throw new TypeError('Unknown delivery protocol');
  const origin = now(), timeline = [], stages = new Map();
  let stopped = false;
  const record = (event, stage, attempt, path = undefined) => {
    if (stopped || timeline.length >= 4 * MAX_ATTEMPTS) return;
    timeline.push({ event, stage, attempt, at: now() - origin, ...(Number.isSafeInteger(path) && path >= 0 ? { path } : {}) });
  };
  const arm = (stage, state) => {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = null;
      if (stopped || state.acknowledged || state.attempt > maxResends) return;
      const attempt = state.attempt + 1;
      let outcome = false;
      try { outcome = resend(stage, attempt); } catch { outcome = false; }
      if (outcome && typeof outcome.then === 'function') {
        // The frame waits for a new path. The next bound runs from now, so a path that never opens cannot
        // hold the next re-send back; what was finally sent, and on which path, is recorded when it is.
        state.attempt = attempt;
        arm(stage, state);
        outcome.then(sent => { if (sent) record('resent', stage, attempt, sent.path); }, () => {});
        return;
      }
      // A frame that could not be handed to the same connection is not retried elsewhere.
      if (outcome !== true) return;
      state.attempt = attempt;
      record('resent', stage, attempt);
      arm(stage, state);
    }, ackTimeoutMs);
  };
  return Object.freeze({
    protocol,
    /** Attempt 1 of `stage` was handed to the transport. */
    sent(stage) {
      if (stopped || stages.has(stage) || !DELIVERY_STAGES.includes(stage)) return;
      const state = { attempt: 1, acknowledged: false, timer: null };
      stages.set(stage, state);
      record('sent', stage, 1);
      arm(stage, state);
    },
    /** The recipient answered for `stage`: an explicit acknowledgement or any later frame of the request. */
    acknowledge(stage, attempt = null) {
      const state = stages.get(stage);
      if (!state || state.acknowledged) return;
      state.acknowledged = true;
      clearTimeout(state.timer); state.timer = null;
      record('received', stage, Number.isSafeInteger(attempt) ? attempt : state.attempt);
    },
    /** True while `stage` was sent and not yet answered. */
    waiting: stage => !stopped && stages.has(stage) && !stages.get(stage).acknowledged,
    /** A path change made for `stage` (protocol 2): a fresh channel, an ICE restart, or an extra re-send. */
    note(event, stage, attempt, path = undefined) {
      if (PATH_EVENTS.includes(event) && DELIVERY_STAGES.includes(stage) && Number.isSafeInteger(attempt)) record(event, stage, attempt, path);
    },
    attempt: stage => stages.get(stage)?.attempt ?? 0,
    stop() {
      stopped = true;
      for (const state of stages.values()) { clearTimeout(state.timer); state.timer = null; }
    },
    /** What this requester observed, in milliseconds from the first frame. */
    snapshot: () => ({ protocol, timeline: timeline.map(entry => ({ ...entry })) })
  });
}

export const PATH_EVENTS = Object.freeze(['resent', 'path-opened', 'path-failed', 'ice-restart', 'ice-restarted', 'ice-restart-failed']);

/** Protocol 2 path recovery for one request to one provider, on the connection it was admitted on.
 * `send(path)` hands the frame for the current stage to that path of the same connection and returns
 * true, after checking the recipient is still the computer that was approved. `getIceState()` reads that
 * connection's ICE state. The first re-send opens one fresh channel, plus an ICE restart when ICE already
 * reports trouble; a later re-send, meaning the fresh channel stalled too, restarts ICE (once per request)
 * and sends again on the newest path. */
export function createPathRecovery({ transport, peerId, ackTimeoutMs, restartTimeoutMs, initialPath = 0, getIceState, onPath = () => {} }) {
  let path = initialPath, opened = null, restarting = null;
  const iceTrouble = () => ['disconnected', 'failed'].includes(getIceState?.() ?? null);
  const restart = (delivery, stage, attempt) => {
    if (restarting) return restarting;
    delivery.note('ice-restart', stage, attempt);
    restarting = Promise.resolve(transport.restartPath(peerId, { timeoutMs: restartTimeoutMs })).catch(() => false).then(ok => {
      delivery.note(ok ? 'ice-restarted' : 'ice-restart-failed', stage, attempt, path);
      return ok === true;
    });
    return restarting;
  };
  const openFresh = (delivery, stage, attempt) => {
    if (opened) return opened;
    opened = Promise.resolve(transport.openFreshPath(peerId, { timeoutMs: ackTimeoutMs })).catch(() => null).then(fresh => {
      if (Number.isSafeInteger(fresh) && fresh > 0) {
        path = fresh; onPath(fresh);
        delivery.note('path-opened', stage, attempt, fresh);
      } else delivery.note('path-failed', stage, attempt);
      return path;
    });
    return opened;
  };
  return Object.freeze({
    get path() { return path; },
    async recover(delivery, stage, attempt, send) {
      if (!opened) {
        const restarted = iceTrouble() ? restart(delivery, stage, attempt) : null;
        await openFresh(delivery, stage, attempt);
        const sent = delivery.waiting(stage) && send(path) ? { path } : false;
        // A restart begun with it re-sends once more when it completes and the frame is still unanswered.
        restarted?.then(ok => { if (ok && delivery.waiting(stage) && send(path)) delivery.note('resent', stage, attempt, path); });
        return sent;
      }
      // The fresh channel stalled too: the connection's network path is what is stuck.
      await opened;
      await restart(delivery, stage, attempt);
      return delivery.waiting(stage) && send(path) ? { path } : false;
    }
  });
}
