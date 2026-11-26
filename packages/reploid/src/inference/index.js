/**
 * `reploid/inference`: the one requester-side inference API for the browser, the CLI and the SDK.
 *
 *   const { capabilities } = await inference.listCapabilities({ model, constraints });   // advisory, takes no prompt
 *   const plan = await inference.prepare({ model, generation, execution }, { signal });  // takes no prompt, places no charge
 *   const run = await inference.run({ planId: plan.id, requestId, input: { messages } }, { signal });
 *   for await (const event of run.events) { ... }   // admitted, output.delta, then completed | cancelled | failed
 *   const result = await run.result;                 // { requestId, attemptId, status, output, usage, settlement, executionReceipt }
 *
 * The host supplies two ports. `resolveRoute` describes the route a request would take, without sending
 * anything. `execute(job, controls)` runs it through the existing peer binding and must call
 * `controls.requestApproval(preview)` with the execution binding before any remote disclosure.
 * `requesterDevices({ signal, context })` lists the device identities bound to this requester; a split with
 * `edges: 'requester-devices'` is refused unless both edge stages are among them.
 */
import { hashJson } from '../artifacts/signatures.js';
import { protectedEvidence, PROTECTED_PROTOCOL } from './protected.js';
import { secretSharedEvidence, SECRET_SHARED_EXECUTION_KIND } from './secret-shared.js';
import { PROTECTION_GATE_REASONS } from './protections.js';
import { PROTECTIONS, PROTECTION_ROUTES, EDGES_BACKEND, EXECUTION_METADATA, EXECUTION_ERROR_CODES } from '../chat/execution-policy.js';
import {
  executionError, freezeDeep, validatePrepareRequest, validateRunRequest, describeRoute, validateModelPin, isoTime, ISO_TIME, chargeWithin,
  routeDisclosure, assertDisclosureComplete, routeKindOf, assertLeakageAllowed, assertRouteWithinRequirements, admitRoute, admitLocalRoute,
  readExecutorResult, executionReceipt, deliveryTimeline
} from './contract.js';

export * from './contract.js';
export * from './protections.js';
export { PROTECTIONS, ROUTE_KINDS, EXECUTION_ROUTES, PROTECTION_ROUTES, AUTO_ROUTES } from '../chat/execution-policy.js';
export { createProtectedExecution, PROTECTED_EXECUTION_STATUS, protectedDisclosure } from './protected.js';
export { createSecretSharedExecution, SECRET_SHARED_STATUS, secretSharedDisclosure } from './secret-shared.js';

const DEFAULT_PLAN_TTL_MS = 120000;
const MAX_PLANS = 64;
const MAX_RUNS = 256;
// Request ids that ran, kept well beyond the run handles: a repeated id is never dispatched or charged again.
const MAX_RAN = 4096;

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
 * true`. Both are off by default; without them homomorphic is CONFIDENTIAL_EXECUTION_UNAVAILABLE, unchanged.
 * `attested` is always refused. `latencyEstimate({ protection, model, route })` may return a measured estimate
 * ({ milliseconds, measuredAt, source }) for listCapabilities; with none, no latency is shown.
 */
export function createInference({ resolveRoute, execute, now = Date.now, planTtlMs = DEFAULT_PLAN_TTL_MS,
  randomId = () => globalThis.crypto.randomUUID(), protectedExecution = null, unreviewedProtectedExecution = false,
  secretSharedExecution = null, unreviewedSecretSharedExecution = false, requesterDevices = null, latencyEstimate = null }) {
  if (typeof resolveRoute !== 'function' || typeof execute !== 'function') throw new Error('Inference requires resolveRoute and execute ports');
  const protectedPort = unreviewedProtectedExecution === true && protectedExecution?.kind === 'reploid.protected-execution/v1'
    ? protectedExecution : null;
  // Off by default like the protected route: both the port and the explicit unreviewed flag are required.
  const secretSharedPort = unreviewedSecretSharedExecution === true && secretSharedExecution?.kind === SECRET_SHARED_EXECUTION_KIND
    ? secretSharedExecution : null;
  if (!Number.isSafeInteger(planTtlMs) || planTtlMs <= 0) throw new Error('Inference plan lifetime must be a positive integer');
  const plans = new Map(), runs = new Map(), ran = new Set();
  const prune = () => {
    for (const [id, entry] of plans) if (entry.expiresAtMs <= now()) plans.delete(id);
    while (plans.size >= MAX_PLANS) plans.delete(plans.keys().next().value);
    while (runs.size >= MAX_RUNS) runs.delete(runs.keys().next().value);
    while (ran.size >= MAX_RAN) ran.delete(ran.values().next().value);
  };
  const gates = () => ({ protectedProtocol: protectedPort ? PROTECTED_PROTOCOL : null, secretShared: Boolean(secretSharedPort) });

  /** A requester-held edge must be a device bound to this requester. When that cannot be established, refuse. */
  async function assertEdgesBound(route, signal, context) {
    if (route.backend !== EDGES_BACKEND) return;
    let bound = null;
    try { bound = typeof requesterDevices === 'function' ? await requesterDevices({ signal, context }) : null; } catch { bound = null; }
    signal?.throwIfAborted();
    if (!Array.isArray(bound) || !route.edgeParticipants.every(id => bound.includes(id))) {
      throw executionError('EXECUTION_ROUTE_UNAVAILABLE', 'Reploid cannot establish that both edge devices are bound to this requester. Nothing was sent.');
    }
  }

  async function resolve(request, signal, context) {
    signal?.throwIfAborted();
    const port = request.secretShared ? secretSharedPort : request.protected ? protectedPort : null;
    let resolved;
    if (port) resolved = await port.resolve(request, { signal });
    else {
      const candidate = await resolveRoute({ model: request.model, generation: request.generation, execution: request.execution,
        policy: request.policy }, { signal, context });
      signal?.throwIfAborted();
      const { route, maxCharge } = await describeRoute(candidate, request.model);
      resolved = { route, maxCharge, disclosure: null };
    }
    assertRouteWithinRequirements(resolved.route, request.execution);
    await assertEdgesBound(resolved.route, signal, context);
    const disclosure = assertDisclosureComplete(resolved.disclosure ?? routeDisclosure(resolved.route, request.execution));
    assertLeakageAllowed(disclosure, request.execution.allowMetadata);
    return { ...resolved, disclosure };
  }

  /**
   * Which protections this host can run now, for this model and constraints. Takes no prompt and sends none. Each is
   * available, unavailable or unknown, with the reason, what was checked and when. Advisory, never permission to send.
   */
  async function listCapabilities(input = {}, { signal, context } = {}) {
    if (input === null || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['model', 'constraints'].includes(key))) {
      throw executionError('EXECUTION_REQUEST_INVALID', 'listCapabilities takes { model?, constraints? } and no prompt');
    }
    const model = input.model === undefined ? null : validateModelPin(input.model);
    const constraints = input.constraints ?? {};
    const checkedAt = isoTime(now());
    const capabilities = [];
    for (const protection of PROTECTIONS) {
      const enabled = protection === 'plaintext' || (protection === 'secret-sharing' && secretSharedPort) || (protection === 'homomorphic' && protectedPort);
      const routes = [];
      for (const route of PROTECTION_ROUTES[protection]) {
        if (!enabled) {
          routes.push({ route, status: 'unavailable', reason: PROTECTION_GATE_REASONS[protection], code: 'CONFIDENTIAL_EXECUTION_UNAVAILABLE', checked: ['host-configuration'], checkedAt });
          continue;
        }
        if (!model) {
          routes.push({ route, status: 'unknown', reason: 'no model was given, so no route was resolved', code: null, checked: ['host-configuration'], checkedAt });
          continue;
        }
        const allowMetadata = constraints.allowMetadata ?? [...EXECUTION_METADATA];
        const execution = route === 'local' ? { protection, route, allowMetadata }
          : { protection, route, participants: constraints.participants ?? { kind: 'open' }, allowMetadata };
        const checked = ['host-configuration', 'requirements'];
        try {
          const request = validatePrepareRequest({ model, execution }, gates());
          checked.push('route-resolution');
          const resolved = await resolve(request, signal, context);
          checked.push('disclosure', 'charge-ceiling');
          const latency = typeof latencyEstimate === 'function' ? await latencyEstimate({ protection, model, route: resolved.route }) : null;
          routes.push({ route, status: 'available', reason: `a ${routeKindOf(resolved.route)} route resolved for this model and these constraints`, code: null,
            checked, checkedAt, ...(latency && Number.isFinite(latency.milliseconds) && typeof latency.source === 'string'
              && typeof latency.measuredAt === 'string' && ISO_TIME.test(latency.measuredAt)
              ? { latency: { milliseconds: latency.milliseconds, measuredAt: latency.measuredAt, source: latency.source } } : {}) });
        } catch (error) {
          signal?.throwIfAborted();
          const known = typeof error?.code === 'string' && Object.hasOwn(EXECUTION_ERROR_CODES, error.code);
          routes.push({ route, status: known ? 'unavailable' : 'unknown', reason: String(error?.reason ?? error?.message ?? 'route resolution failed').slice(0, 512),
            code: known ? error.code : null, checked, checkedAt });
        }
      }
      const best = routes.find(row => row.status === 'available') ?? routes.find(row => row.status === 'unknown') ?? routes[0];
      capabilities.push({ protection, status: best.status, reason: best.reason, code: best.code, checked: best.checked, checkedAt, routes });
    }
    return freezeDeep({ advisory: true, checkedAt, capabilities });
  }

  /** Describe and pin the route. Takes no content, places no credit hold and sends nothing. */
  async function prepare(input, { signal, context } = {}) {
    const request = validatePrepareRequest(input, gates());
    const { route, maxCharge, disclosure, pinned = null } = await resolve(request, signal, context);
    prune();
    const expiresAtMs = now() + planTtlMs;
    const plan = freezeDeep({ id: 'plan_' + randomId().replaceAll('-', ''), expiresAt: isoTime(expiresAtMs),
      protection: request.execution.protection, routeKind: routeKindOf(route), route, maxCharge, disclosure });
    plans.set(plan.id, { plan, expiresAtMs, request, context, policyId: await hashJson(request.policy), consumed: false, pinned });
    return plan;
  }

  /**
   * Run a prepared plan once. A repeated requestId for the same plan returns the same run, and a requestId that already
   * ran is never dispatched or charged again. A run refused before anything was sent frees its requestId.
   */
  function run(input, options = {}) {
    let validated;
    try { validated = validateRunRequest(input); } catch (error) { return Promise.reject(error); }
    const { planId, requestId } = validated;
    const previous = runs.get(requestId);
    if (previous) {
      if (previous.planId !== planId) return Promise.reject(executionError('EXECUTION_REQUEST_INVALID', 'This requestId already ran a different plan. Nothing was sent.'));
      return previous.handle;
    }
    if (ran.has(requestId)) {
      return Promise.reject(executionError('EXECUTION_REQUEST_INVALID', 'This requestId already ran. It is not dispatched or charged again.'));
    }
    prune();
    const handle = start(validated, options);
    runs.set(requestId, { planId, handle });
    ran.add(requestId);
    handle.catch(() => { runs.delete(requestId); ran.delete(requestId); });
    return handle;
  }

  async function start({ planId, requestId, messages }, { signal, approve = null, context, attemptId: hostAttemptId } = {}) {
    const entry = plans.get(planId);
    if (!entry || entry.consumed || entry.expiresAtMs <= now()) {
      plans.delete(planId);
      throw executionError('EXECUTION_PLAN_EXPIRED', 'The execution plan expired or was already used. Prepare again; nothing was sent.');
    }
    entry.consumed = true;
    const runContext = context ?? entry.context;
    // Recheck the pinned route, limits and charge before anything sensitive leaves this process.
    const current = await resolve(entry.request, signal, runContext);
    if (current.route.id !== entry.plan.route.id) throw executionError('EXECUTION_PLAN_CHANGED', 'The route changed after it was prepared. Nothing was sent.');
    if (!chargeWithin(current.maxCharge, entry.plan.maxCharge)) {
      throw executionError('EXECUTION_PLAN_CHANGED', 'The charge ceiling rose after the plan was prepared. Nothing was sent.');
    }
    if (entry.expiresAtMs <= now()) throw executionError('EXECUTION_PLAN_EXPIRED', 'The execution plan expired. Prepare again; nothing was sent.');
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
    if (entry.request.secretShared) {
      const result = runSecretShared({ entry, plan, requestId, attemptId, messages, runSignal, emit, admit,
        admittedRoute: () => admitted, delta: text => emit({ type: 'output.delta', requestId, attemptId, sequence: sequence++, text }),
        finish: () => { channel.end(); plans.delete(planId); } });
      return Object.freeze({ requestId, attemptId, planId, events: channel.events, result,
        cancel: reason => controller.abort(reason ?? new Error('Cancelled by the caller')) });
    }
    if (entry.request.protected) {
      if (!entry.pinned) throw executionError('EXECUTION_PLAN_CHANGED', 'The protected route lost its pinned backend. Nothing was sent.');
      const result = runProtected({ entry, plan, requestId, attemptId, messages, runSignal, emit, admit,
        admittedRoute: () => admitted, delta: text => emit({ type: 'output.delta', requestId, attemptId, sequence: sequence++, text }),
        finish: () => { channel.end(); plans.delete(planId); } });
      return Object.freeze({ requestId, attemptId, planId, events: channel.events, result,
        cancel: reason => controller.abort(reason ?? new Error('Cancelled by the caller')) });
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
      // Once the executor has resolved, the answer is finished and whatever it settled is settled: the signal is not
      // read again (a stop that arrives now cannot undo a charge), and a result refused below still states that charge.
      let resolved = false, settled = null;
      try {
        if (plan.route.shape === 'local') admit(admitLocalRoute(plan));
        const raw = await execute(job, controls, runContext);
        resolved = true;
        settled = raw?.serviceCredit ?? raw?.execution?.serviceCredit ?? null;
        if (refusal) throw refusal;
        if (!admitted) throw executionError('RESULT_UNVERIFIED', 'The executor answered without admitting a route');
        const read = readExecutorResult(plan, raw, streamed);
        const value = freezeDeep({ requestId, attemptId, status: 'completed', output: read.output, usage: read.usage,
          settlement: structuredClone(read.settlement), executionReceipt: await executionReceipt({ plan, requestId, attemptId,
            status: 'completed', admitted, read, at: now() }) });
        emit({ type: 'completed', result: value });
        return value;
      } catch (cause) {
        const error = refusal ?? cause;
        const status = !refusal && !resolved && runSignal.aborted ? 'cancelled' : 'failed';
        const charged = error?.serviceCredit ?? settled;
        // Partial text is never a successful result: it is dropped from the result.
        const value = freezeDeep({ requestId, attemptId, status, output: null, usage: null,
          settlement: structuredClone(charged), error: errorRecord(error),
          executionReceipt: await executionReceipt({ plan, requestId, attemptId, status, admitted,
            timeline: deliveryTimeline(cause?.delivery), settlement: charged, at: now() }) });
        emit({ type: status, result: value });
        return value;
      } finally { channel.end(); plans.delete(planId); }
    })();
    return Object.freeze({ requestId, attemptId, planId, events: channel.events, result,
      cancel: reason => controller.abort(reason ?? new Error('Cancelled by the caller')) });
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

  /**
   * A secret-shared run: the host port shares, dispatches and reconstructs; this API admits the pinned route, streams
   * the text and writes the receipt. A stopped answer keeps its partial text and is `cancelled`; a failure keeps none.
   */
  function runSecretShared({ entry, plan, requestId, attemptId, messages, runSignal, emit, admit, admittedRoute, delta, finish }) {
    let text = '';
    return (async () => {
      let outcome = null;
      try {
        outcome = await secretSharedPort.execute({ plan, pinned: entry.pinned, requestId, attemptId, messages, generation: entry.request.generation,
          signal: runSignal,
          onAdmitted: ({ bindingDigest }) => admit(freezeDeep({ id: bindingDigest, planRouteId: plan.route.id, policyId: plan.policyId,
            shape: 'split', participants: [...plan.route.participants].sort(), backend: plan.route.backend, protocol: plan.route.protocol })),
          onDelta: piece => { if (!admittedRoute()) throw executionError('RESULT_UNVERIFIED', 'Output arrived before route admission'); text += piece; delta(piece); } });
        if (!admittedRoute()) throw executionError('RESULT_UNVERIFIED', 'The secret-shared port answered without admitting its route');
        if (typeof outcome?.text !== 'string' || outcome.text !== text) throw executionError('RESULT_UNVERIFIED', 'The final answer differs from its streamed text');
        const stopped = outcome.stopReason === 'requester-stop';
        const limit = plan.generation.maxOutputTokens;
        if (limit !== null && outcome.usage?.outputTokens > limit) throw executionError('RESULT_UNVERIFIED', 'The answer exceeds the output limit');
        const value = freezeDeep({ requestId, attemptId, status: stopped ? 'cancelled' : 'completed',
          output: { text, stopReason: outcome.stopReason ?? null, finishReason: stopped ? 'stop'
            : ['length', 'max-tokens'].includes(outcome.stopReason) ? 'length' : outcome.stopReason ? 'stop' : 'unknown' },
          usage: outcome.usage ?? null, settlement: structuredClone(outcome.settlement ?? null),
          executionReceipt: await secretSharedReceipt({ plan, requestId, attemptId, status: stopped ? 'cancelled' : 'completed', admitted: admittedRoute(),
            evidence: outcome.evidence ?? null, settlement: outcome.settlement ?? null }) });
        emit({ type: value.status, result: value });
        return value;
      } catch (error) {
        const status = runSignal.aborted ? 'cancelled' : 'failed';
        const value = freezeDeep({ requestId, attemptId, status, output: null, usage: null, settlement: structuredClone(error?.serviceCredit ?? null),
          error: errorRecord(error), executionReceipt: await secretSharedReceipt({ plan, requestId, attemptId, status, admitted: admittedRoute(), error,
            settlement: error?.serviceCredit ?? null }) });
        emit({ type: status, result: value });
        return value;
      } finally { finish(); }
    })();
  }

  async function secretSharedReceipt({ plan, requestId, attemptId, status, admitted, evidence = null, error = null, settlement = null }) {
    const { privacy, integrity } = secretSharedEvidence({ plan, admitted, evidence, error });
    return executionReceipt({ plan, requestId, attemptId, status, admitted, settlement, privacy, integrity, at: now(),
      routeExtensions: { secretSharing: { stages: plan.route.secretShared.stages } } });
  }

  async function protectedReceipt({ plan, requestId, attemptId, status, admitted, evidence = null, error = null }) {
    const { privacy, integrity } = protectedEvidence({ plan, admitted, evidence, error });
    return executionReceipt({ plan, requestId, attemptId, status, admitted, privacy, integrity, at: now(),
      routeExtensions: { homomorphic: plan.route.protected } });
  }

  return Object.freeze({ listCapabilities, prepare, run });
}
