/** Same-recipient re-delivery of one whole request's frames (delivery protocol 1).
 *
 * A provider that advertises `deliveryProtocol: 1` answers each admission question and each admitted
 * request at once with `reploid:request-received`. Without that answer within `ackTimeoutMs`, the
 * requester sends the same frame again, to the same computer on the same connection, at most
 * `maxResends` times per stage. It never chooses another recipient; that still needs an explicit Retry.
 * The provider deduplicates by request ID, so a repeated frame is not executed or charged again.
 * An acknowledgement proves only that the frame arrived on the authenticated channel. */
export const DELIVERY_PROTOCOL = 1;
export const DELIVERY_STAGES = Object.freeze(['admit', 'request']);
const MAX_ATTEMPTS = 16;

/** The delivery fields of a received frame, or null for a frame from a requester that predates them. */
export function readDelivery(payload) {
  const delivery = payload?.delivery;
  if (!delivery || delivery.protocol !== DELIVERY_PROTOCOL || !Number.isSafeInteger(delivery.attempt)
    || delivery.attempt < 1 || delivery.attempt > MAX_ATTEMPTS) return null;
  return { protocol: DELIVERY_PROTOCOL, attempt: delivery.attempt };
}

export function createRequestDelivery({ ackTimeoutMs, maxResends, resend, now = () => Date.now() }) {
  if (!Number.isSafeInteger(ackTimeoutMs) || ackTimeoutMs <= 0) throw new TypeError('Delivery acknowledgement timeout must be a positive integer');
  if (!Number.isSafeInteger(maxResends) || maxResends < 0 || maxResends >= MAX_ATTEMPTS) throw new TypeError('Delivery re-send limit is out of range');
  const origin = now(), timeline = [], stages = new Map();
  let stopped = false;
  const record = (event, stage, attempt) => { if (timeline.length < 4 * MAX_ATTEMPTS) timeline.push({ event, stage, attempt, at: now() - origin }); };
  const arm = (stage, state) => {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = null;
      if (stopped || state.acknowledged || state.attempt > maxResends) return;
      const attempt = state.attempt + 1;
      let sent = false;
      try { sent = resend(stage, attempt) === true; } catch { sent = false; }
      // A frame that could not be handed to the same connection is not retried elsewhere.
      if (!sent) return;
      state.attempt = attempt;
      record('resent', stage, attempt);
      arm(stage, state);
    }, ackTimeoutMs);
  };
  return Object.freeze({
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
    attempt: stage => stages.get(stage)?.attempt ?? 0,
    stop() {
      stopped = true;
      for (const state of stages.values()) { clearTimeout(state.timer); state.timer = null; }
    },
    /** What this requester observed, in milliseconds from the first frame. */
    snapshot: () => ({ protocol: DELIVERY_PROTOCOL, timeline: timeline.map(entry => ({ ...entry })) })
  });
}
