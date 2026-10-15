/**
 * Requester spending around partition attempts, through an earning client.
 *
 * Before dispatch every attempt needs an accepted quote: a new quote for a new
 * send or, for an explicit retry of an attempt that failed under a still-open
 * acceptance, that same acceptance. The host's spending port accepts or
 * declines the disclosed terms; the conversation's one-time remote permission
 * stays separate and is never asked again here. After the conversation's own
 * disclosure check, and before any input leaves this device, the attempt binds
 * to the reservation with the exact route recipients; a refused binding sends
 * nothing. The route's own records become the attempt report, stored before it
 * is sent; the service's declared rules decide outcome and charge.
 *
 * When the accepted terms offer evidence settlement, this device signs the
 * attempt's charge binding before dispatch and acknowledges each output whose
 * final-stage receipt commits to exactly the deltas it received; the report
 * carries the latest acknowledgment with its receipt.
 */
import { openOutputAcknowledgments } from '../../vendor/reploid/mesh/partitions/partition-attempt-evidence.js';

const REPORT_SCHEMA = 'reploid.attempt-report/v1';
// The outcome rules read ordered route records; other partition paths are not charged through them.
const ORDERED_SELECTION = 'reploid.partition-selection/v2';
const SUMMARY_KEYS = ['schema', 'identity', 'activationBytes', 'stopReason', 'settlement', 'stepSummary'];
const stateKey = threadId => `attempts:${threadId}`;
const defaultTimer = (callback, ms) => { const timer = setTimeout(callback, Math.max(0, ms)); return () => clearTimeout(timer); };

export class SpendingDeclinedError extends Error {
  constructor(message, code) { super(message); this.name = 'SpendingDeclinedError'; this.code = code; }
}

/**
 * @param {object} options
 * @param {object} options.client createEarningClient(...) result
 * @param {Function} options.quoteRequest (request) -> the service request a quote names; never terms or prices
 * @param {Function} options.authorizeSpending ({ quote }) -> true to accept the disclosed terms
 * @param {Function} [options.now] clock in ms, the quote deadline's clock
 * @param {Function} [options.setTimer] (callback, ms) -> cancel
 */
export function createEarningAttempts({ client, quoteRequest, authorizeSpending, now = Date.now, setTimer = defaultTimer } = {}) {
  if (!client || typeof client.send !== 'function') throw new TypeError('Earning attempts require an enabled earning client');
  if (typeof quoteRequest !== 'function' || typeof authorizeSpending !== 'function') {
    throw new TypeError('Earning attempts require a quote request and a spending decision port');
  }
  const { storage } = client;
  const readThread = async threadId => (await storage.get(stateKey(threadId))) ?? null;
  const writeThread = (threadId, value) => storage.set(stateKey(threadId), value);

  /** A new accepted reservation for this attempt, after the host accepts its disclosed terms. */
  async function acceptNew(request) {
    const quote = await client.send({ opId: `quote:${request.threadId}:${request.attemptId}`, path: '/quotes',
      body: { request: quoteRequest(request) }, durable: false });
    if (await authorizeSpending({ quote: structuredClone(quote) }) !== true) {
      throw new SpendingDeclinedError('The quoted terms were not accepted; nothing was sent', 'spending_declined');
    }
    // An acceptance no attempt binds expires and releases under the quote's own terms.
    const accepted = await client.send({ opId: `accept:${quote.quoteId}`, path: `/quotes/${encodeURIComponent(quote.quoteId)}/accept`,
      body: { quoteHash: quote.quoteHash }, durable: false });
    return { threadId: request.threadId, reservationId: accepted.reservationId, quoteId: quote.quoteId, authorizedMax: accepted.authorizedMax,
      deadline: quote.service.deadline, firstOutputDeadline: quote.service.firstOutputDeadline ?? null,
      maxAttempts: quote.terms.execution.maxAttempts, evidence: quote.terms.evidence !== undefined,
      attempts: [], lastAttemptId: null, status: 'open', retryable: false };
  }

  /** The route summary fields the outcome rules read; selection and provider details stay here. */
  const summaryOf = execution => Object.fromEntries(SUMMARY_KEYS.filter(key => execution?.[key] !== undefined).map(key => [key, execution[key]]));

  // The report's key names its thread, so reconcile() can update that thread after a restart.
  const reportOp = (threadId, reservationId, attemptId) => `report:${threadId}|${reservationId}|${attemptId ?? 'none'}`;
  async function report(thread, attemptId, body) {
    const opId = reportOp(thread.threadId, thread.reservationId, attemptId);
    try {
      const answer = await client.send({ opId, path: `/reservations/${encodeURIComponent(thread.reservationId)}/reports`, body: { report: body } });
      return { delivered: true, answer };
    } catch (error) {
      // Pending reports stay stored for reconcile(); a definite refusal is final.
      return { delivered: false, pending: error.pending === true, code: error.code };
    }
  }

  async function settleThread(threadId, thread, attemptId, outcome) {
    const answer = outcome.answer;
    const attempts = thread.attempts.map(row => row.attemptId === attemptId ? { ...row, reported: outcome.delivered, code: outcome.code ?? null } : row);
    // A final report under evidence terms may wait for the evidence window before its decision.
    const status = answer?.evidence?.awaitingUntil ? 'awaiting_evidence' : answer?.reservationStatus;
    const next = { ...thread, attempts, status: status ?? (outcome.pending ? 'reporting' : thread.status),
      retryable: answer ? answer.reservationStatus === 'open' && answer.closed === true && attempts.length < thread.maxAttempts : false };
    await writeThread(threadId, next);
    return next;
  }

  /**
   * Run one partition attempt under an accepted quote. `execute(request,
   * controls)` is the host's partition generate port.
   */
  async function run(request, controls, execute) {
    const { threadId, attemptId } = request;
    if (request.model?.partition?.schema !== ORDERED_SELECTION) {
      throw new SpendingDeclinedError('Charged attempts need an ordered partition route; nothing was sent', 'route_unsupported');
    }
    const prior = await readThread(threadId);
    const retry = request.retryOf && prior?.retryable === true && prior.lastAttemptId === request.retryOf;
    const thread = { ...(retry ? prior : await acceptNew(request)), lastAttemptId: attemptId, retryable: false };
    await writeThread(threadId, thread);
    let bound = false, identity = null, activity = null, previewRoute = null, acknowledgments = null;
    const deadline = new AbortController();
    const cancelTimer = setTimer(() => deadline.abort(Object.assign(new Error('The quoted deadline passed'), { code: 'QUOTE_DEADLINE' })),
      Date.parse(thread.deadline) - now());
    // A quote may also promise the first output by a time; no output by then stops the attempt at that quoted deadline.
    let cancelFirstOutput = thread.firstOutputDeadline ? setTimer(() => deadline.abort(Object.assign(new Error('The quoted first-output deadline passed'),
      { code: 'QUOTE_FIRST_OUTPUT_DEADLINE' })), Date.parse(thread.firstOutputDeadline) - now()) : () => {};
    const firstOutput = () => { cancelFirstOutput(); cancelFirstOutput = () => {}; };
    const signal = controls.signal ? AbortSignal.any([controls.signal, deadline.signal]) : deadline.signal;
    const wrapped = {
      ...controls,
      signal,
      async requestApproval(preview) {
        const approved = await controls.requestApproval(preview);
        if (approved !== true) return approved;
        const recipients = Array.isArray(preview?.input?.recipients) ? preview.input.recipients : null;
        if (!recipients?.length || signal.aborted) return false;
        if (thread.evidence) {
          // The charge binding is signed before binding; a route this device cannot bind sends nothing.
          try {
            acknowledgments = await openOutputAcknowledgments({ signer: client.evidenceSigner, reservationId: thread.reservationId, now,
              identity: { schema: 'reploid.partition-attempt/v2', threadId, attemptId, requesterId: client.participantId,
                placementGeneration: request.placementGeneration ?? 0, route: preview.route } });
          } catch { return false; }
        }
        try {
          await client.send({ opId: `bind:${thread.reservationId}:${attemptId}`, path: `/reservations/${encodeURIComponent(thread.reservationId)}/attempts`,
            body: { attemptId, recipients }, durable: false });
        } catch { return false; }
        bound = true; previewRoute = preview.route ?? null;
        thread.attempts.push({ attemptId, recipients, reported: false });
        await writeThread(threadId, thread);
        if (acknowledgments) {
          wrapped.charge = acknowledgments.charge;
          wrapped.onOutput = record => acknowledgments.observe(record);
        }
        return !signal.aborted;
      },
      onState(envelope) {
        if (envelope?.execution?.identity) identity = structuredClone(envelope.execution.identity);
        return controls.onState?.(envelope);
      },
      onDelta(envelope) {
        firstOutput();
        return controls.onDelta?.(envelope);
      },
      onActivity(envelope) {
        if (envelope?.schema === 'reploid.partition-activity/v1') {
          activity = { schema: envelope.schema, identity: envelope.identity, sequence: envelope.sequence, stepSummary: envelope.stepSummary };
        }
        return controls.onActivity?.(envelope);
      }
    };
    if (!controls.onActivity) delete wrapped.onActivity;
    // This device's latest acknowledgment and the receipt it acknowledged travel with its report.
    const evidenceOf = () => {
      const bundle = acknowledgments?.evidence();
      return bundle?.acknowledged ? { evidence: bundle } : {};
    };
    try {
      const result = await execute(request, wrapped);
      const execution = summaryOf(result.execution);
      const outcome = await report(thread, attemptId, { schema: REPORT_SCHEMA, result: 'completed', attemptId,
        identity: execution.identity, execution, ...evidenceOf() });
      await settleThread(threadId, thread, attemptId, outcome);
      return result;
    } catch (error) {
      if (!bound) {
        // Nothing was dispatched: a new acceptance is cancelled before dispatch; a retry keeps its acceptance for the next one.
        if (retry) await writeThread(threadId, { ...thread, retryable: true });
        else await settleThread(threadId, thread, null, await report(thread, null, { schema: REPORT_SCHEMA, result: 'cancelled', attemptId: null }));
        throw error;
      }
      identity ??= previewRoute && { schema: 'reploid.partition-attempt/v2', threadId, attemptId, requesterId: client.participantId,
        placementGeneration: request.placementGeneration ?? 0, route: previewRoute };
      const body = deadline.signal.aborted ? { result: 'cancelled', cancellation: { cause: 'deadline' }, ...(activity ? { activity } : {}) }
        : controls.signal?.aborted ? { result: 'cancelled', cancellation: { cause: 'requester' }, ...(activity ? { activity } : {}) }
          : { result: 'failed', failure: { code: typeof error?.code === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(error.code) ? error.code : 'EXECUTION_FAILED' } };
      await settleThread(threadId, thread, attemptId, await report(thread, attemptId, { schema: REPORT_SCHEMA, attemptId, identity, ...body, ...evidenceOf() }));
      throw error;
    } finally { cancelTimer(); firstOutput(); }
  }

  return Object.freeze({
    run,
    /** Wrap a partition generate port. */
    wrap: execute => (request, controls) => run(request, controls, execute),
    getThread: async threadId => structuredClone(await readThread(threadId)),
    /** Stop retrying a thread's failed attempts: its acceptance settles as provider failure. */
    async abandon(threadId) {
      const thread = await readThread(threadId);
      if (!thread?.retryable) return null;
      return settleThread(threadId, thread, null, await report(thread, null, { schema: REPORT_SCHEMA, result: 'abandoned', attemptId: null }));
    },
    /** Resend stored reports after a restart and record each delivered answer on its thread. */
    async reconcile() {
      const results = await client.reconcile();
      for (const result of results) {
        if (!result.ok || !result.opId.startsWith('report:')) continue;
        const [threadId, , attemptId] = result.opId.slice('report:'.length).split('|');
        const thread = await readThread(threadId);
        if (thread) await settleThread(threadId, thread, attemptId === 'none' ? null : attemptId, { delivered: true, answer: result.body });
      }
      return results;
    }
  });
}

export default createEarningAttempts;
