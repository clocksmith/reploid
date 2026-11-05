import defaults from './introduction-policy.json' with { type: 'json' };
import { boundedSnapshot, verifyContact } from './introduction-records.js';

/** Host-owned entry points, tried in retained-contact order, then configured order. */
export async function bootstrapIntroductions({ introductions, routes, store, signal, isConnected,
  policy = defaults, onState = () => {} }) {
  if (!Array.isArray(routes) || routes.length > policy.maxBootstrapRoutes
    || new Set(routes.map(route => route.id)).size !== routes.length
    || routes.some(route => typeof route.id !== 'string' || !route.id || typeof route.open !== 'function')) {
    throw new Error('Explicit bounded introduction routes required');
  }
  const local = introductions.exportContact(), roomId = local.body.roomId;
  signal?.throwIfAborted();
  const loadSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(policy.messageTtlMs)]) : AbortSignal.timeout(policy.messageTtlMs);
  const loaded = store ? await new Promise((resolve, reject) => {
    const aborted = () => reject(loadSignal.reason);
    loadSignal.addEventListener('abort', aborted, { once: true });
    Promise.resolve().then(() => store.load()).then(resolve, reject)
      .finally(() => loadSignal.removeEventListener('abort', aborted));
  }) : [];
  const saved = boundedSnapshot(loaded, policy.maxMessageBytes);
  if (!Array.isArray(saved) || saved.length > policy.maxBootstrapRoutes) throw new Error('Invalid retained introduction routes');
  const retained = new Map();
  for (const entry of saved) {
    if (!routes.some(route => route.id === entry.routeId)) continue;
    try { retained.set(entry.routeId, await verifyContact(entry.contact, { roomId, policy })); }
    catch { /* Expired/corrupt records grant no authority. Reopen only configured routes. */ }
  }
  const ordered = [...routes].sort((a, b) => Number(retained.has(b.id)) - Number(retained.has(a.id)));
  const failures = [];
  for (const route of ordered) {
    signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(policy.messageTtlMs);
    const lifetime = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let session, remotePeerId, expired = false;
    onState({ state: 'connecting', routeId: route.id });
    const abortable = operation => new Promise((resolve, reject) => {
      const aborted = () => { expired = true; reject(lifetime.reason); };
      if (lifetime.aborted) { aborted(); return; }
      lifetime.addEventListener('abort', aborted, { once: true });
      Promise.resolve(operation).then(resolve, reject).finally(() => lifetime.removeEventListener('abort', aborted));
    });
    try {
      session = await abortable(Promise.resolve(route.open({ contact: local, retainedContact: retained.get(route.id) || null,
        signal: lifetime, receive: packet => introductions.receive(null, 'reploid:introduction-signal', packet,
          answer => { if (!session || lifetime.aborted) throw new Error('Bootstrap route closed'); return session.publish(answer); })
      })).then(opened => { if (expired || lifetime.aborted) { opened?.close(); throw new Error('Stale bootstrap opening'); } return opened; }));
      if (!session || typeof session.publish !== 'function' || typeof session.close !== 'function') throw new Error('Invalid bootstrap session');
      const remote = await abortable(verifyContact(session.contact, { roomId, policy }));
      remotePeerId = remote.body.peerId;
      if (retained.has(route.id) && retained.get(route.id).body.participantId !== remote.body.participantId) throw new Error('Bootstrap participant changed');
      await abortable(introductions.connect(remote, packet => {
        lifetime.throwIfAborted(); return session.publish(packet);
      }, lifetime));
      while (!isConnected(remote.body.peerId)) {
        await abortable(new Promise(resolve => {
          const finish = () => { clearTimeout(timer); lifetime.removeEventListener('abort', finish); resolve(); };
          const timer = setTimeout(finish, 25);
          lifetime.addEventListener('abort', finish, { once: true });
        }));
      }
      lifetime.throwIfAborted();
      // Store public verified contact records, never keys, prompts or credentials.
      retained.set(route.id, remote);
      if (store) await abortable(store.save([...retained].slice(-policy.maxBootstrapRoutes)
        .map(([routeId, contact]) => ({ routeId, contact }))));
      onState({ state: 'connected', routeId: route.id, peerId: remote.body.peerId });
      return { routeId: route.id, peerId: remote.body.peerId, failures };
    } catch (error) {
      signal?.throwIfAborted();
      failures.push({ routeId: route.id, message: error.message });
      onState({ state: 'unavailable', routeId: route.id, message: error.message });
    } finally { expired = true; if (remotePeerId && !isConnected(remotePeerId)) introductions.cancelPending?.(remotePeerId); session?.close(); }
  }
  const error = new Error('No introduction route connected; supply a current invitation or reachable participant');
  error.failures = failures;
  throw error;
}

/** A participant-operated endpoint speaks contact/signal JSON; admission stays at endpoints. */
export function createWebSocketIntroductionRoute({ id, url, expectedParticipantId, maxMessageBytes = defaults.maxMessageBytes,
  WebSocket: Socket = globalThis.WebSocket }) {
  const parsed = new URL(url);
  if (!['wss:', 'ws:'].includes(parsed.protocol) || parsed.username || parsed.password
    || parsed.protocol === 'ws:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
    throw new Error('Introduction endpoint requires WSS or loopback WS');
  }
  if (typeof expectedParticipantId !== 'string' || !expectedParticipantId.startsWith('peer:')) throw new Error('Pinned bootstrap participant required');
  return Object.freeze({ id, open({ contact, receive, signal }) {
    return new Promise((resolve, reject) => {
      signal.throwIfAborted();
      const socket = new Socket(url);
      let admitted = false, closed = false;
      const close = () => { if (closed) return; closed = true; signal.removeEventListener('abort', aborted); socket.close(); };
      const failed = error => { close(); reject(error); };
      const aborted = () => failed(signal.reason);
      signal.addEventListener('abort', aborted, { once: true });
      const publish = record => {
        signal.throwIfAborted();
        if (closed || socket.readyState !== Socket.OPEN || socket.bufferedAmount > maxMessageBytes) throw new Error('Bootstrap endpoint unavailable');
        socket.send(JSON.stringify(boundedSnapshot(record, maxMessageBytes))); return true;
      };
      socket.onopen = () => { try { publish({ type: 'contact', contact }); } catch (error) { failed(error); } };
      socket.onerror = () => failed(new Error('Bootstrap endpoint connection failed'));
      socket.onclose = () => failed(new Error('Bootstrap endpoint closed'));
      socket.onmessage = event => {
        try {
          if (closed || typeof event.data !== 'string' || new TextEncoder().encode(event.data).length > maxMessageBytes) throw new Error('Invalid bootstrap record size');
          const message = JSON.parse(event.data);
          if (!admitted) {
            if (message.type !== 'contact' || message.contact?.body?.participantId !== expectedParticipantId) throw new Error('Bootstrap endpoint identity mismatch');
            admitted = true;
            resolve({ contact: message.contact, publish: record => publish({ type: 'signal', envelope: record }), close });
          } else if (message.type === 'signal') Promise.resolve(receive(message.envelope)).catch(failed);
          else throw new Error('Unexpected bootstrap record');
        } catch (error) { failed(error); }
      };
    });
  } });
}
