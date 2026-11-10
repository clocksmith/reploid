/** A paired native host owns the private room, keys, placement and credit ledger.
 * Browser history remains here. Pairing is explicit and limited to this tab. */
const KEY = 'reploid.private-computers:v1';
const assert = (ok, message) => { if (!ok) throw Error(message); };
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
      assert(!snapshot || value.poolIdentity === snapshot.poolIdentity, 'Private enrollment changed. Disconnect and reconnect to review it.');
      if (version === epoch) { snapshot = value; error = ''; }
    } catch (cause) { if (version === epoch) error = cause.message; }
    finally { if (version === epoch) { busy = false; onChange(); } }
  };
  const models = () => (snapshot?.models || []).map(model => ({ ...model,
    selectionId: `private:${snapshot.requester.participantId}:${model.id}`, source: undefined,
    fleet: { poolIdentity: snapshot.poolIdentity, requester: snapshot.requester },
    networkAvailability: state().connected ? model.availability : 'unavailable', availability: state().connected ? model.availability : 'unavailable',
    localReady: false, localCached: false, providerIds: [] }));
  const timer = setInterval(() => void refresh(), 5000); timer.unref?.();
  try { const saved = JSON.parse(storage?.getItem(KEY) || 'null'); if (saved) { connection = validate(saved.url, saved.token); void refresh(); } } catch { /* An invalid saved pairing grants nothing. */ }
  return { state, models, refresh,
    async connect(url, token) { assert(!active.size, 'Stop active private requests before reconnecting'); epoch++; connection = validate(url, token); snapshot = null; error = ''; busy = false;
      await refresh(); if (error) { connection = null; throw Error(error); }
      storage?.setItem(KEY, JSON.stringify({ url: connection.url, token: connection.token })); onChange(); },
    async disconnect() { epoch++; for (const controller of active.values()) controller.abort(); connection = null; snapshot = null; busy = false; error = '';
      storage?.removeItem(KEY); onChange(); },
    async receipt(id) { return (await call('/receipt', { id })).json(); },
    async accounts() { return (await call('/accounts')).json(); },
    async recover(input, signal = AbortSignal.timeout(30000)) { return (await call('/recover', input, signal)).json(); },
    async execute(request, controls) {
      const target = connection, selected = models().find(model => model.selectionId === request.model.selectionId && model.identity === request.model.identity);
      assert(state().connected && selected && request.model.fleet.poolIdentity === snapshot.poolIdentity, 'This private pool is unavailable or has changed');
      assert(request.permissions?.sharingScope !== 'local' && request.permissions?.executionLocation !== 'local', 'This request permits only local execution');
      const { threadId, attemptId, model } = request;
      const controller = new AbortController(), signal = AbortSignal.any([controls.signal, controller.signal]);
      const publicNames = Object.fromEntries(snapshot.computers.flatMap(row => row.participantIds.map(id => [id, row.name])));
      // The user pairs their own requester and delegates exact-model service to its
      // reviewed private enrollment. Native per-stage disclosure and credit admission
      // remain mandatory; the saved result names actual executors separately.
      const approved = await controls.requestApproval({ id: crypto.randomUUID(), threadId, attemptId,
        peerId: snapshot.requester.participantId, recipientIdentity: snapshot.requester.participantId,
        operation: 'generate', disclosure: 'public', modelId: model.id, modelIdentity: model.identity, adapterIdentities: [],
        expiresAt: Date.now() + 30000, input: { messages: request.messages },
        privateDelegation: { poolIdentity: snapshot.poolIdentity, computers: publicNames } });
      assert(approved === true, 'Private execution was not allowed'); signal.throwIfAborted();
      active.set(attemptId, controller);
      let placement = {
        privateDelegation: { poolIdentity: snapshot.poolIdentity, computers: publicNames }, serviceCredit: { status: 'pending' } };
      controls.onState({ threadId, attemptId, status: 'queued', execution: placement });
      const cancel = () => { void call('/cancel', { attemptId }, AbortSignal.timeout(10000), target).catch(() => {}); };
      signal.addEventListener('abort', cancel, { once: true });
      let reader;
      try {
        const response = await call('/generate', { model: { id: model.id, identity: model.identity }, poolIdentity: snapshot.poolIdentity, threadId, attemptId, messages: request.messages }, signal, target);
        reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '', sequence = 0, result = null;
        for (;;) {
          const chunk = await reader.read(); buffer += decoder.decode(chunk.value, { stream: !chunk.done });
          assert(buffer.length <= 8 * 1024 * 1024, 'Private response record exceeds limit');
          let end;
          while ((end = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (!line) continue;
            const event = JSON.parse(line);
            if (event.execution) {
              placement = { ...placement, ...event.execution };
              controls.onState({ threadId, attemptId, status: event.status || 'queued', execution: placement });
            }
            if (event.error) { const error = Error(event.error); error.serviceCredit = event.serviceCredit; throw error; }
            if (event.delta !== undefined) { const text = typeof event.delta === 'string' ? event.delta : event.delta.text;
              assert(typeof text === 'string', 'Invalid private output'); controls.onDelta({ threadId, attemptId, sequence: sequence++, text }); }
            if (event.result) { assert(!result, 'Duplicate private completion'); result = event.result; }
          }
          if (chunk.done) break;
        }
        assert(result && !buffer.trim(), 'Connection interrupted; outcome unknown. Check service credits before retrying.');
        assert(result.modelIdentity === model.identity && (result.modelId ?? result.model) === model.id, 'Private response model changed');
        return { ...result, threadId, attemptId, modelId: model.id, adapterIdentities: result.adapterIdentities || [],
          execution: { ...result.execution, provider: 'peer', peerId: result.execution?.providerIdentity || result.execution?.peerId,
            stopReason: result.execution?.stopReason ?? result.execution?.completion?.stopReason,
            ...(result.execution?.admission || placement.admission ? { admission: result.execution?.admission ?? placement.admission } : {}),
            privateDelegation: placement.privateDelegation, serviceCredit: result.serviceCredit } };
      } catch (error) {
        controls.onState({ threadId, attemptId, status: 'executing', execution: { ...placement, serviceCredit: error.serviceCredit || placement.serviceCredit } });
        throw error;
      } finally { reader?.releaseLock(); signal.removeEventListener('abort', cancel); active.delete(attemptId); void refresh(); }
    },
    close() { closed = true; epoch++; clearInterval(timer); for (const controller of active.values()) controller.abort(); }
  };
}
