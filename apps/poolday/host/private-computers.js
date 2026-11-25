/** A paired native host owns the private room, keys, placement and credit ledger.
 * Browser history remains here. Pairing is explicit and limited to this tab. */
import { requestExecutionPolicy, assertAvailableExecutionPolicy, bindExecutionRoute, executionError } from '../../../shared/vendor/reploid/chat/index.js';
import { abortable } from '../../../shared/vendor/reploid/cancellation.js';

const KEY = 'reploid.private-computers:v2';
const ROUTE_PROTOCOL = 'reploid.paired-route/v3';
const assert = (ok, message) => { if (!ok) throw Error(message); };
/** The first enrolled, complete paired route that binds under the request's policy, in the host's order. */
async function firstPairedBinding(input, selected, binding) {
  const { model } = input;
  for (const { route, selection } of selected.executionRoutes || []) {
    try {
      const enrolled = new Set([binding.requester.participantId, ...binding.computers.flatMap(row => row.participantIds)]);
      const expected = new Set([binding.requester.participantId, ...(selection.partition?.schema === 'reploid.partition-selection/v2'
        ? selection.partition.route.stages.map(stage => stage.participantId)
        : [route.route?.providerIdentity])]);
      assert([...expected].every(id => typeof id === 'string' && enrolled.has(id))
        && route.hops.length === expected.size
        && new Set(route.hops.map(hop => hop.recipient)).size === expected.size
        && route.hops.every(hop => hop.placement === 'remote' && expected.has(hop.recipient)), 'Paired route recipient set is incomplete or changed');
      assert(selection.id === model.id && selection.identity === model.identity, 'Paired route substituted the selected model');
      return await bindExecutionRoute({ ...input, model: selection }, route);
    } catch { /* This candidate does not meet the request requirements. */ }
  }
  return null;
}
export function createPrivateComputers({ storage = globalThis.sessionStorage, fetchImpl = globalThis.fetch, onChange = () => {} } = {}) {
  let connection = null, snapshot = null, error = '', busy = false, closed = false, epoch = 0;
  const active = new Map();
  const validate = (url, token) => {
    const target = new URL(url);
    const cleanPath = target.pathname.replace(/\/+$/, '');
    const loopback = target.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname);
    const httpsBridge = target.protocol === 'https:' && Boolean(target.hostname);
    assert((loopback || httpsBridge) && !target.username && !target.password && !target.search && !target.hash
      && (cleanPath === '' || (/^\/[A-Za-z0-9/_-]+$/.test(cleanPath) && !cleanPath.includes('//')
        && !cleanPath.split('/').some(part => part === '.' || part === '..'))),
    'Use the HTTPS or local address from your native Reploid host');
    assert(typeof token === 'string' && token.length >= 32 && token.length <= 256, 'Enter the pairing secret from your native host');
    return { url: target.origin + cleanPath, token, loopback };
  };
  const call = async (route, body = {}, signal = AbortSignal.timeout(10000), target = connection) => {
    assert(target, 'Connect your private computers first');
    const response = await fetchImpl(target.url + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${target.token}` },
      body: JSON.stringify(body), signal, credentials: 'omit', redirect: 'error',
      ...(target.loopback ? { targetAddressSpace: 'loopback' } : {}) });
    if (!response.ok) throw Error((await response.json()).error || 'Private host did not respond');
    return response;
  };
  const state = () => ({ connected: !!connection && !!snapshot && !error, connecting: busy, error, ...snapshot });
  const refresh = async () => {
    if (!connection || busy || closed) return;
    const version = epoch; busy = true;
    try {
      const value = await (await call('/state')).json();
      assert(value.schema === 'reploid.fleet-browser/v1' && value.poolIdentity && Array.isArray(value.models) && Array.isArray(value.computers), 'Invalid private host state');
      assert(value.privacyProtocol === ROUTE_PROTOCOL, 'Paired execution requires current exact-route preflight. Update the native host.');
      assert(!snapshot || value.poolIdentity === snapshot.poolIdentity, 'Private enrollment changed. Disconnect and reconnect to review it.');
      if (version === epoch) { snapshot = value; error = ''; }
    } catch (cause) { if (version === epoch) error = cause.message; }
    finally { if (version === epoch) { busy = false; onChange(); } }
  };
  const models = () => (snapshot?.models || []).map(model => ({ ...model,
    selectionId: `private:${snapshot.requester.participantId}:${model.id}`, source: undefined,
    fleet: { poolIdentity: snapshot.poolIdentity, requester: snapshot.requester },
    networkAvailability: state().connected && snapshot?.privacyProtocol === ROUTE_PROTOCOL && model.executionRoutes?.length ? model.availability : 'unavailable',
    availability: state().connected && snapshot?.privacyProtocol === ROUTE_PROTOCOL && model.executionRoutes?.length ? model.availability : 'unavailable',
    localReady: false, localCached: false, providerIds: [] }));
  const timer = setInterval(() => void refresh(), 5000); timer.unref?.();
  try { const saved = JSON.parse(storage?.getItem(KEY) || 'null'); if (saved) { connection = validate(saved.url, saved.token); void refresh(); } } catch { /* An invalid saved pairing grants nothing. */ }
  return { state, models, refresh,
    async connect(url, token) {
      assert(!closed, 'Private computers are closed');
      assert(!active.size, 'Stop active private requests before reconnecting');
      const version = ++epoch, target = validate(url, token);
      connection = target; snapshot = null; error = ''; busy = false;
      await refresh();
      assert(!closed && version === epoch && connection === target, 'Private pairing changed while connecting');
      if (error) { connection = null; throw Error(error); }
      storage?.setItem(KEY, JSON.stringify({ url: target.url, token: target.token })); onChange();
    },
    async disconnect() { epoch++; for (const controller of active.values()) controller.abort(); connection = null; snapshot = null; busy = false; error = '';
      storage?.removeItem(KEY); onChange(); },
    async receipt(id) { return (await call('/receipt', { id })).json(); },
    async accounts() { return (await call('/accounts')).json(); },
    /** This requester's own account statement, checkable offline with server/fleet/credit-statement.js. */
    async statement() { return (await call('/statement')).json(); },
    async recover(input, signal = AbortSignal.timeout(30000)) {
      const target = connection, version = epoch, stateAtSend = snapshot;
      assert(state().connected && stateAtSend.privacyProtocol === ROUTE_PROTOCOL, 'Current paired route required for recovery');
      const original = structuredClone(input);
      const binding = original.privacyBinding;
      const route = binding?.route;
      assert(route?.hops?.some(hop => hop.placement === 'remote' && hop.recipient === stateAtSend.requester.participantId),
        'Original recovery binding must cover this coordinator');
      const model = { id: route.modelId, identity: route.modelIdentity, adapters: route.adapterIdentities.map(identity => ({ identity })) };
      const checked = await bindExecutionRoute({ model, privacy: binding.policy }, route);
      assert(binding.policyId === checked.policyId && binding.routeId === checked.routeId && binding.schema === checked.schema,
        'Original recovery binding is not current');
      signal.throwIfAborted();
      assert(version === epoch && target === connection && stateAtSend.poolIdentity === snapshot?.poolIdentity
        && stateAtSend.requester.participantId === snapshot?.requester?.participantId, 'Pairing changed before recovery');
      return (await call('/recover', { ...original, privacyBinding: checked, poolIdentity: stateAtSend.poolIdentity }, signal, target)).json();
    },
    /** The paired route `execute` would bind, described for an inference plan. Sends nothing to the host. */
    async describeRoute(request) {
      const input = structuredClone(request);
      const selected = models().find(model => model.selectionId === input.model.selectionId && model.identity === input.model.identity);
      if (!state().connected || !selected || input.model.fleet?.poolIdentity !== snapshot.poolIdentity || snapshot.privacyProtocol !== ROUTE_PROTOCOL) {
        throw executionError('EXECUTION_ROUTE_UNAVAILABLE', 'This private pool is unavailable or has changed. Nothing was sent.');
      }
      input.privacy = assertAvailableExecutionPolicy(requestExecutionPolicy(input));
      const bound = await firstPairedBinding(input, selected, snapshot);
      if (!bound) throw executionError('EXECUTION_ROUTE_UNAVAILABLE', 'No paired route satisfies this execution policy. Nothing was sent.');
      return { shape: bound.route.backend === 'doppler-partition-plaintext/v1' ? 'split' : 'remote', backend: bound.route.backend,
        participants: bound.route.hops.map(hop => hop.recipient), selection: 'all', maxCharge: selected.creditCap ?? null };
    },
    async execute(request, controls) {
      assert(!closed, 'Private computers are closed');
      const input = structuredClone(request), target = connection, version = epoch;
      const selected = models().find(model => model.selectionId === input.model.selectionId && model.identity === input.model.identity);
      assert(state().connected && selected && input.model.fleet.poolIdentity === snapshot.poolIdentity, 'This private pool is unavailable or has changed');
      assert(input.permissions?.sharingScope !== 'local' && input.permissions?.executionLocation !== 'local', 'This request permits only local execution');
      input.privacy = assertAvailableExecutionPolicy(requestExecutionPolicy(input));
      const binding = structuredClone(snapshot), { threadId, attemptId, model, messages } = input;
      assert(!active.has(attemptId), 'Private attempt is already active');
      const controller = new AbortController(), signal = AbortSignal.any([controls.signal, controller.signal]);
      const assertCurrent = () => {
        signal.throwIfAborted();
        assert(!closed && version === epoch && connection === target
          && snapshot?.poolIdentity === binding.poolIdentity
          && snapshot?.requester?.participantId === binding.requester.participantId,
        'Private pairing changed. Retry starts a new authorized attempt.');
      };
      assert(binding.privacyProtocol === ROUTE_PROTOCOL, 'Paired execution requires current exact-route preflight');
      const privacyBinding = await firstPairedBinding(input, selected, binding);
      assert(privacyBinding, 'No paired route satisfies this execution policy; nothing was sent');
      const recipients = privacyBinding.route.hops.map(hop => hop.recipient);
      const publicNames = Object.fromEntries(binding.computers.flatMap(row => row.participantIds.map(id => [id, row.name])));
      let placement = { privateDelegation: { poolIdentity: binding.poolIdentity, computers: publicNames }, serviceCredit: { status: 'pending' } };
      let reader, dispatched = false;
      const cancel = () => {
        if (dispatched) void call('/cancel', { attemptId }, AbortSignal.timeout(10000), target).catch(() => {});
      };
      // Pending authorization belongs to this pairing too. Stop/close must cancel it
      // before a late approval can disclose anything to the captured host.
      active.set(attemptId, controller);
      signal.addEventListener('abort', cancel, { once: true });
      try {
        const approved = await abortable(() => controls.requestApproval({ id: crypto.randomUUID(), threadId, attemptId,
          peerId: binding.requester.participantId, recipientIdentity: binding.requester.participantId,
          operation: 'generate', disclosure: 'public', modelId: model.id, modelIdentity: model.identity, adapterIdentities: [],
          expiresAt: Date.now() + 30000, input: { messages: structuredClone(messages) },
          privateDelegation: structuredClone(placement.privateDelegation), privacyBinding,
          inputRecipients: recipients }), signal);
        assert(approved === true, 'Private execution was not allowed');
        assertCurrent();
        // Approval can take time. Re-read metadata, never prompt content, before leaving
        // the browser. The receiving bridge checks the same route again before dispatch.
        const current = await (await call('/state', {}, signal, target)).json();
        assert(current.privacyProtocol === ROUTE_PROTOCOL && current.poolIdentity === binding.poolIdentity
          && current.requester?.participantId === binding.requester.participantId, 'Paired execution route changed; nothing was sent');
        const ready = current.models?.find(candidate => candidate.id === model.id && candidate.identity === model.identity
          && ['ready', 'busy'].includes(candidate.availability));
        let unchanged = false;
        for (const { selection, route } of ready?.executionRoutes || []) {
          try {
            const checked = await bindExecutionRoute({ ...input, model: selection }, route);
            if (checked.routeId === privacyBinding.routeId) { unchanged = true; break; }
          } catch { /* The candidate does not satisfy the original policy. */ }
        }
        assert(unchanged, 'Paired execution route changed; nothing was sent');
        assertCurrent();
        controls.onState({ threadId, attemptId, status: 'queued', execution: structuredClone(placement) });
        assertCurrent();
        dispatched = true;
        const response = await call('/generate', { privacy: input.privacy, privacyBinding, model: { id: model.id, identity: model.identity }, poolIdentity: binding.poolIdentity, threadId, attemptId, messages }, signal, target);
        assertCurrent();
        reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '', sequence = 0, result = null;
        for (;;) {
          const chunk = await reader.read();
          assertCurrent();
          buffer += decoder.decode(chunk.value, { stream: !chunk.done });
          assert(buffer.length <= 8 * 1024 * 1024, 'Private response record exceeds limit');
          let end;
          while ((end = buffer.indexOf('\n')) >= 0) {
            assertCurrent();
            const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (!line) continue;
            const event = JSON.parse(line);
            if (event.execution) {
              placement = { ...placement, ...event.execution };
              controls.onState({ threadId, attemptId, status: event.status || 'queued', execution: structuredClone(placement) });
            }
            if (event.error) {
              const error = Error(event.error), outcome = event.disconnect;
              // A request the host refused before dispatch (for example too few credits) left nothing to settle;
              // say so rather than leaving its credit record pending.
              error.serviceCredit = event.serviceCredit || (outcome?.dispatched === false && outcome.finished
                ? { id: outcome.reservationId, status: outcome.finished.status, charge: 0, outputTokens: 0, settledAt: outcome.finished.settledAt }
                : undefined);
              // An unsettled dispatched request keeps its hold; the host's outcome record says how much.
              if (error.serviceCredit && typeof error.serviceCredit.settledAt !== 'number' && Number.isSafeInteger(outcome?.unknown?.heldCredits)) {
                error.serviceCredit = { ...error.serviceCredit, heldCredits: outcome.unknown.heldCredits };
              }
              throw error;
            }
            if (event.delta !== undefined) {
              assertCurrent();
              const text = typeof event.delta === 'string' ? event.delta : event.delta.text;
              assert(typeof text === 'string', 'Invalid private output');
              controls.onDelta({ threadId, attemptId, sequence: sequence++, text });
            }
            if (event.result) { assert(!result, 'Duplicate private completion'); result = event.result; }
          }
          if (chunk.done) break;
        }
        assertCurrent();
        assert(result && !buffer.trim(), 'Connection interrupted; outcome unknown. Check service credits before retrying.');
        assert(result.modelIdentity === model.identity && (result.modelId ?? result.model) === model.id, 'Private response model changed');
        return { ...result, threadId, attemptId, modelId: model.id, adapterIdentities: result.adapterIdentities || [],
          execution: { ...result.execution, provider: 'peer', peerId: result.execution?.providerIdentity || result.execution?.peerId,
            stopReason: result.execution?.stopReason ?? result.execution?.completion?.stopReason,
            ...(result.execution?.admission || placement.admission ? { admission: result.execution?.admission ?? placement.admission } : {}),
            privateDelegation: placement.privateDelegation, serviceCredit: result.serviceCredit } };
      } catch (error) {
        if (dispatched && !closed && version === epoch) controls.onState({ threadId, attemptId, status: 'executing', execution: {
          ...placement, serviceCredit: error.serviceCredit || placement.serviceCredit } });
        throw error;
      } finally {
        reader?.releaseLock(); signal.removeEventListener('abort', cancel); active.delete(attemptId); void refresh();
      }
    },
    close() { closed = true; epoch++; clearInterval(timer); for (const controller of active.values()) controller.abort(); }
  };
}
