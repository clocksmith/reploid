/**
 * `reploid/inference`: the one requester-side inference API for the browser, the CLI and the SDK.
 *
 *   const plan = await inference.prepare({ model, generation, execution }, { signal });
 *   const run = await inference.run({ planId: plan.id, requestId, input: { messages } }, { signal });
 *   for await (const event of run.events) { ... }   // admitted, output.delta, then completed | cancelled | failed
 *   const result = await run.result;                 // { requestId, attemptId, status, output, usage, settlement, executionReceipt }
 *
 * The host supplies two ports. `resolveRoute` describes the route a request would take, without sending
 * anything. `execute(job, controls)` runs it through the existing peer binding and must call
 * `controls.requestApproval(preview)` with the execution binding before any remote disclosure.
 */
import { hashJson } from '../artifacts/signatures.js';
import { protectedEvidence, PROTECTED_PROTOCOL } from './protected.js';
import { attestedEvidence, ATTESTED_PROTOCOL } from './attested/execution.js';
import {
  executionError, freezeDeep, validatePrepareRequest, validateRunRequest, describeRoute,
  routeDisclosures, assertLeakageAllowed, assertRouteWithinRequirements, admitRoute, admitLocalRoute,
  readExecutorResult, executionReceipt, deliveryTimeline
} from './contract.js';

export * from './contract.js';
export { createProtectedExecution, PROTECTED_EXECUTION_STATUS, protectedDisclosures } from './protected.js';
export { createAttestedExecution, ATTESTED_EXECUTION_STATUS, attestedDisclosures, ATTESTED_TRUST_BOUNDARY } from './attested/execution.js';
export { connectWebSocketFrames } from './attested/websocket-channel.js';

const DEFAULT_PLAN_TTL_MS = 120000;
const MAX_PLANS = 64;
const MAX_RUNS = 256;

function eventChannel() {
  const queue = [];
  let waiting = null, ended = false;
  return {
    push(event) {
      if (ended) return;
      if (waiting) { const resolve = waiting; waiting = null; resolve({ value: event, done: false }); }
      else queue.push(event);
    },
    end() {
      ended = true;
      if (waiting) { const resolve = waiting; waiting = null; resolve({ value: undefined, done: true }); }
    },
    events: {
      [Symbol.asyncIterator]() {
        return {
          next: () => queue.length ? Promise.resolve({ value: queue.shift(), done: false })
            : ended ? Promise.resolve({ value: undefined, done: true }) : new Promise(resolve => { waiting = resolve; }),
          return: () => { queue.length = 0; return Promise.resolve({ value: undefined, done: true }); }
        };
      }
    }
  };
}

// An executor's own error keeps its code when it has one; only the inference API's refusals use the stable codes.
const errorRecord = error => ({ code: typeof error?.code === 'string' ? error.code : null,
  message: String(error?.message || error || 'Execution failed').slice(0, 1024) });

/**
 * `protectedExecution` (from createProtectedExecution) is used only together with `unreviewedProtectedExecution:
 * true`. Both are off by default; without them requester-only is CONFIDENTIAL_EXECUTION_UNAVAILABLE, unchanged.
 * `attestedExecution` (from createAttestedExecution, itself built with `unreviewedAttestedExecution: true`) likewise
 * needs `unreviewedAttestedExecution: true` here; otherwise attested-execution is ATTESTED_EXECUTION_UNAVAILABLE.
 */
export function createInference({ resolveRoute, execute, now = Date.now, planTtlMs = DEFAULT_PLAN_TTL_MS,
  randomId = () => globalThis.crypto.randomUUID(), protectedExecution = null, unreviewedProtectedExecution = false,
  attestedExecution = null, unreviewedAttestedExecution = false }) {
  if (typeof resolveRoute !== 'function' || typeof execute !== 'function') throw new Error('Inference requires resolveRoute and execute ports');
  const protectedPort = unreviewedProtectedExecution === true && protectedExecution?.kind === 'reploid.protected-execution/v1'
    ? protectedExecution : null;
  const attestedPort = unreviewedAttestedExecution === true && attestedExecution?.kind === 'reploid.attested-execution/v1'
    ? attestedExecution : null;
  if (!Number.isSafeInteger(planTtlMs) || planTtlMs <= 0) throw new Error('Inference plan lifetime must be a positive integer');
  const plans = new Map(), runs = new Map();
  const prune = () => {
    for (const [id, entry] of plans) if (entry.plan.expiresAt <= now()) plans.delete(id);
    while (plans.size >= MAX_PLANS) plans.delete(plans.keys().next().value);
    while (runs.size >= MAX_RUNS) runs.delete(runs.keys().next().value);
  };

  async function resolve(request, signal, context) {
    signal?.throwIfAborted();
    if (request.protected || request.attested) {
      const resolved = await (request.attested ? attestedPort : protectedPort).resolve(request, { signal });
      assertRouteWithinRequirements(resolved.route, request.execution);
      assertLeakageAllowed(resolved.disclosures, request.execution.allowMetadata);
      return resolved;
    }
    const candidate = await resolveRoute({ model: request.model, generation: request.generation, execution: request.execution,
      policy: request.policy }, { signal, context });
    signal?.throwIfAborted();
    const { route, maxCharge } = await describeRoute(candidate, request.model);
    assertRouteWithinRequirements(route, request.execution);
    const disclosures = routeDisclosures(route, request.execution);
    assertLeakageAllowed(disclosures, request.execution.allowMetadata);
    return { route, maxCharge, disclosures };
  }

  /** Describe and pin the route. Takes no content, places no credit hold and sends nothing. */
  async function prepare(input, { signal, context } = {}) {
    const request = validatePrepareRequest(input, { protectedProtocol: protectedPort ? PROTECTED_PROTOCOL : null,
      attested: attestedPort ? { protocol: ATTESTED_PROTOCOL, attestation: await attestedPort.policyDigest() } : null });
    const { route, maxCharge, disclosures, pinned = null } = await resolve(request, signal, context);
    prune();
    const plan = freezeDeep({ id: 'plan_' + randomId().replaceAll('-', ''), expiresAt: now() + planTtlMs, route, maxCharge, disclosures });
    plans.set(plan.id, { plan, request, context, policyId: await hashJson(request.policy), consumed: false, pinned });
    return plan;
  }

  /** Run a prepared plan once. A repeated requestId for the same plan returns the same run. */
  async function run(input, { signal, approve = null, context, attemptId: hostAttemptId } = {}) {
    const { planId, requestId, messages } = validateRunRequest(input);
    const previous = runs.get(requestId);
    if (previous) {
      if (previous.planId !== planId) throw executionError('EXECUTION_REQUEST_INVALID', 'This requestId already ran a different plan');
      return previous.handle;
    }
    const entry = plans.get(planId);
    if (!entry || entry.consumed || entry.plan.expiresAt <= now()) {
      plans.delete(planId);
      throw executionError('EXECUTION_PLAN_EXPIRED', 'The execution plan expired or was already used. Prepare again; nothing was sent.');
    }
    entry.consumed = true;
    const runContext = context ?? entry.context;
    // Recheck the pinned route, limits and charge before anything sensitive leaves this process.
    const current = await resolve(entry.request, signal, runContext);
    if (current.route.id !== entry.plan.route.id) throw executionError('EXECUTION_PLAN_CHANGED', 'The route changed after it was prepared. Nothing was sent.');
    if (entry.plan.maxCharge && (!current.maxCharge || current.maxCharge.unit !== entry.plan.maxCharge.unit
      || current.maxCharge.maximum > entry.plan.maxCharge.maximum)) {
      throw executionError('EXECUTION_PLAN_CHANGED', 'The charge ceiling rose after the plan was prepared. Nothing was sent.');
    }
    if (entry.plan.expiresAt <= now()) throw executionError('EXECUTION_PLAN_EXPIRED', 'The execution plan expired. Prepare again; nothing was sent.');
    const plan = { ...entry.plan, execution: entry.request.execution, generation: entry.request.generation, policyId: entry.policyId };
    if (hostAttemptId !== undefined && (typeof hostAttemptId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(hostAttemptId))) {
      throw executionError('EXECUTION_REQUEST_INVALID', 'Invalid attempt identity');
    }
    // A host that already numbers its attempts (a conversation, an HTTP request) keeps its own identity in the receipt.
    const attemptId = hostAttemptId ?? 'attempt_' + randomId().replaceAll('-', '');
    const channel = eventChannel();
    const controller = new AbortController();
    const runSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let admitted = null, refusal = null, streamed = null, sequence = 0;
    const emit = event => channel.push(freezeDeep(event));
    const admit = route => { if (!admitted) { admitted = route; emit({ type: 'admitted', requestId, attemptId, route }); } };
    if (entry.request.protected || entry.request.attested) {
      if (!entry.pinned) throw executionError('EXECUTION_PLAN_CHANGED', `The ${entry.request.attested ? 'attested' : 'protected'} route lost its pinned backend. Nothing was sent.`);
      const result = (entry.request.attested ? runAttested : runProtected)({ entry, plan, requestId, attemptId, messages, runSignal, emit, admit,
        admittedRoute: () => admitted, delta: text => emit({ type: 'output.delta', requestId, attemptId, sequence: sequence++, text }),
        finish: () => { channel.end(); plans.delete(planId); } });
      const handle = Object.freeze({ requestId, attemptId, planId, events: channel.events, result,
        cancel: reason => controller.abort(reason ?? new Error('Cancelled by the caller')) });
      prune();
      runs.set(requestId, { planId, handle });
      return handle;
    }
    const passthrough = runContext?.controls || {};
    const controls = {
      ...passthrough,
      signal: runSignal,
      async requestApproval(preview) {
        let route;
        try {
          route = admitRoute(plan, entry.request.policy, preview?.privacyBinding);
          if (admitted && admitted.id !== route.id) throw executionError('EXECUTION_PLAN_CHANGED', 'The route changed after approval. Nothing more was sent.');
        } catch (error) { refusal ??= error; controller.abort(error); return false; }
        const decision = approve ? await approve(preview, route) : true;
        runSignal.throwIfAborted();
        if (decision === true) admit(route);
        return decision;
      },
      onDelta(envelope) {
        if (!admitted) {
          const error = executionError('RESULT_UNVERIFIED', 'Output arrived before route admission');
          refusal ??= error; controller.abort(error); throw error;
        }
        if (typeof envelope?.text !== 'string') throw executionError('RESULT_UNVERIFIED', 'Invalid output delta');
        streamed = (streamed ?? '') + envelope.text;
        emit({ type: 'output.delta', requestId, attemptId, sequence: sequence++, text: envelope.text });
        return passthrough.onDelta?.(envelope);
      }
    };
    const job = freezeDeep({ plan, policy: entry.request.policy, request: { requestId, attemptId, messages, generation: entry.request.generation } });
    const result = (async () => {
      try {
        if (plan.route.shape === 'local') admit(admitLocalRoute(plan));
        const raw = await execute(job, controls, runContext);
        runSignal.throwIfAborted();
        if (refusal) throw refusal;
        if (!admitted) throw executionError('RESULT_UNVERIFIED', 'The executor answered without admitting a route');
        const read = readExecutorResult(plan, raw, streamed);
        const value = freezeDeep({ requestId, attemptId, status: 'completed', output: read.output, usage: read.usage,
          settlement: structuredClone(read.settlement), executionReceipt: await executionReceipt({ plan, requestId, attemptId,
            status: 'completed', admitted, read }) });
        emit({ type: 'completed', result: value });
        return value;
      } catch (cause) {
        const error = refusal ?? cause;
        const status = !refusal && runSignal.aborted ? 'cancelled' : 'failed';
        // Partial text is never a successful result: it is dropped from the result.
        const value = freezeDeep({ requestId, attemptId, status, output: null, usage: null,
          settlement: structuredClone(error?.serviceCredit ?? null), error: errorRecord(error),
          executionReceipt: await executionReceipt({ plan, requestId, attemptId, status, admitted,
            timeline: deliveryTimeline(cause?.delivery) }) });
        emit({ type: status, result: value });
        return value;
      } finally { channel.end(); plans.delete(planId); }
    })();
    const handle = Object.freeze({ requestId, attemptId, planId, events: channel.events, result,
      cancel: reason => controller.abort(reason ?? new Error('Cancelled by the caller')) });
    prune();
    runs.set(requestId, { planId, handle });
    return handle;
  }

  /** A protected run: no executor port, no approval callback, no readable fallback. Partial text is never a result. */
  function runProtected({ entry, plan, requestId, attemptId, messages, runSignal, emit, admit, admittedRoute, delta, finish }) {
    let text = '', evidence = null;
    return (async () => {
      try {
        evidence = (await protectedPort.execute({ plan, pinned: entry.pinned, requestId, messages, signal: runSignal,
          onAdmitted: ({ bindingDigest }) => admit(freezeDeep({ id: bindingDigest, planRouteId: plan.route.id, policyId: plan.policyId,
            shape: 'remote', participants: [...plan.route.participants], backend: plan.route.backend, protocol: plan.route.protocol })),
          onToken: symbol => { text += symbol; delta(symbol); } })).evidence;
        runSignal.throwIfAborted();
        const value = freezeDeep({ requestId, attemptId, status: 'completed',
          output: { text, finishReason: 'length', stopReason: 'max-tokens' },
          usage: { inputTokens: [...messages[0].content].length, outputTokens: [...text].length }, settlement: null,
          executionReceipt: await protectedReceipt({ plan, requestId, attemptId, status: 'completed', admitted: admittedRoute(), evidence }) });
        emit({ type: 'completed', result: value });
        return value;
      } catch (error) {
        const status = runSignal.aborted ? 'cancelled' : 'failed';
        const value = freezeDeep({ requestId, attemptId, status, output: null, usage: null, settlement: null, error: errorRecord(error),
          executionReceipt: await protectedReceipt({ plan, requestId, attemptId, status, admitted: admittedRoute(), error }) });
        emit({ type: status, result: value });
        return value;
      } finally { finish(); }
    })();
  }

  /** An attested run: verify before sealing, no executor port, no approval callback, no readable fallback. */
  function runAttested({ entry, plan, requestId, attemptId, messages, runSignal, emit, admit, admittedRoute, delta, finish }) {
    let streamed = '', outcome = null;
    return (async () => {
      try {
        outcome = await attestedPort.execute({ plan, pinned: entry.pinned, requestId, messages, signal: runSignal,
          onAdmitted: ({ bindingDigest }) => admit(freezeDeep({ id: bindingDigest, planRouteId: plan.route.id, policyId: plan.policyId,
            shape: 'remote', participants: [...plan.route.participants], backend: plan.route.backend, protocol: plan.route.protocol })),
          onToken: text => { streamed += text; delta(text); } });
        runSignal.throwIfAborted();
        if (!admittedRoute()) throw executionError('RESULT_UNVERIFIED', 'The executor answered without an attested admission');
        if (streamed && streamed !== outcome.output.text) throw executionError('RESULT_UNVERIFIED', 'The final answer differs from its streamed text');
        const value = freezeDeep({ requestId, attemptId, status: 'completed', output: structuredClone(outcome.output), usage: structuredClone(outcome.usage),
          settlement: structuredClone(outcome.settlement), executionReceipt: await attestedReceipt({ plan, requestId, attemptId, status: 'completed',
            admitted: admittedRoute(), evidence: outcome.evidence }) });
        emit({ type: 'completed', result: value });
        return value;
      } catch (error) {
        const status = runSignal.aborted ? 'cancelled' : 'failed';
        const value = freezeDeep({ requestId, attemptId, status, output: null, usage: null, settlement: null, error: errorRecord(error),
          executionReceipt: await attestedReceipt({ plan, requestId, attemptId, status, admitted: admittedRoute(), evidence: null }) });
        emit({ type: status, result: value });
        return value;
      } finally { finish(); }
    })();
  }

  async function attestedReceipt({ plan, requestId, attemptId, status, admitted, evidence }) {
    const base = await executionReceipt({ plan, requestId, attemptId, status, admitted });
    return freezeDeep({ ...structuredClone(base), route: base.route && { ...structuredClone(base.route), attested: structuredClone(plan.route.attested) },
      evidence: attestedEvidence({ plan, admitted, evidence }) });
  }

  async function protectedReceipt({ plan, requestId, attemptId, status, admitted, evidence = null, error = null }) {
    const base = await executionReceipt({ plan, requestId, attemptId, status, admitted });
    return freezeDeep({ ...structuredClone(base), route: base.route && { ...structuredClone(base.route), protected: structuredClone(plan.route.protected) },
      evidence: protectedEvidence({ plan, admitted, evidence, error }) });
  }

  return Object.freeze({ prepare, run });
}
