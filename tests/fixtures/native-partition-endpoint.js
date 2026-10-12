/** Owned Node inspector adapter for the existing physical resident fixture. */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

export async function connectNativeInspector(url, { Socket = WebSocket } = {}) {
  const endpoint = new URL(url);
  assert(endpoint.protocol === 'ws:' && ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname),
    'Native inspector must use an explicitly owned loopback endpoint or tunnel');
  const socket = new Socket(url), events = new EventEmitter(), pending = new Map();
  let sequence = 0, closed = false;
  const rejectPending = error => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); } pending.clear(); };
  socket.on('message', bytes => {
    let message;
    try { message = JSON.parse(bytes); } catch (error) { rejectPending(error); return; }
    if (message.id !== undefined) {
      const request = pending.get(message.id); if (!request) return;
      pending.delete(message.id); clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
    } else if (message.method) events.emit(message.method, message.params);
  });
  socket.on('close', () => { closed = true; rejectPending(new Error('Owned native inspector disconnected')); });
  socket.on('error', error => rejectPending(error));
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  return {
    on: (name, listener) => events.on(name, listener),
    send(method, params = {}) {
      assert(!closed, 'Native inspector is closed');
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Native inspector timed out: ${method}`)); },
          method === 'Runtime.evaluate' ? 1200000 : 30000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }), error => { if (error) { pending.delete(id); clearTimeout(timer); reject(error); } });
      });
    },
    async detach() {
      if (closed) return;
      return new Promise(resolve => {
        let forcedSocketClose = false;
        const timer = setTimeout(() => {
          forcedSocketClose = true; closed = true; socket.terminate(); rejectPending(new Error('Native inspector close timed out'));
          resolve({ detached: true, forcedSocketClose: true });
        }, 2000);
        socket.once('close', () => { clearTimeout(timer); resolve({ detached: true, forcedSocketClose }); });
        socket.close();
      });
    },
  };
}

export async function connectNativePartitionEndpoint(url) {
  const cdp = await connectNativeInspector(url);
  const evaluate = async (fn, argument) => {
    assert.equal(typeof fn, 'function', 'Fixture evaluation requires an explicit function');
    const result = await cdp.send('Runtime.evaluate', { expression: `(${fn.toString()})(${JSON.stringify(argument) ?? 'undefined'})`,
      awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    assert(!result.result?.unserializableValue, 'Non-JSON fixture result');
    return result.result?.value;
  };
  try {
    const identity = await evaluate(() => ({ node: process.versions.node, pid: process.pid, platform: process.platform,
      fixture: globalThis.__nativePartitionFixture?.identity }));
    assert(identity.node && identity.fixture?.schema === 'reploid.native-partition-fixture/v1',
      'Inspector is not the explicitly prepared native fixture');
    const context = { newCDPSession: () => connectNativeInspector(url), close: async () => {} };
    const page = { native: true, evaluate, context: () => context };
    context.newPage = async () => page;
    return { page, identity, native: true, newContext: async () => context, version: () => `Node ${identity.node}`,
      async open() { return evaluate(() => __nativePartitionFixture.open()); },
      async close() {
        try { return await evaluate(() => __nativePartitionFixture.close()); }
        finally { await cdp.detach(); }
      },
    };
  } catch (error) { await cdp.detach(); throw error; }
}
