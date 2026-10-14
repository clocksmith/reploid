// Run-7 read-only diagnostic: the stage 0 coordinator's swarm peers and partition peer capabilities,
// through the same host-session access as observe.mjs (withHost is copied here unchanged).
// Usage: node peek-coordinator.mjs <cdp endpoint> <origin>
import { chromium } from 'playwright';
import { findPage } from '../../harness.mjs';
async function withHost(page, project) {
  const c = await page.context().newCDPSession(page);
  const own = async objectId => (await c.send('Runtime.getProperties', { objectId, ownProperties: true })).result;
  async function scopeVar(functionObjectId, name) {
    const result = await c.send('Runtime.getProperties', { objectId: functionObjectId });
    const scopes = result.internalProperties?.find(item => item.name === '[[Scopes]]');
    if (!scopes) return null;
    for (const row of (await own(scopes.value.objectId)).filter(item => /^\d+$/.test(item.name))) {
      if (/Global/.test(row.value.description)) continue;
      const found = (await own(row.value.objectId)).find(item => item.name === name);
      if (found?.value?.objectId) return found.value;
    }
    return null;
  }
  // Closure variables of an owner are visible from any of its function-valued properties.
  async function methodScopeVar(object, name) {
    for (const method of (await own(object.objectId)).filter(item => item.value?.type === 'function')) {
      const found = await scopeVar(method.value.objectId, name);
      if (found) return found;
    }
    return null;
  }
  async function read(object, functionDeclaration) {
    const result = await c.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || 'Host observation failed');
    return result.result.value;
  }
  try {
    // self/ui/pool-home/network-controls.js:163 binds this listener inside bindNetworkControls(container, session).
    const listener = (await c.send('Runtime.evaluate', {
      expression: 'getEventListeners(document.querySelector("[data-toggle-contribution]")).click[0].listener',
      includeCommandLineAPI: true
    })).result;
    if (!listener?.objectId) throw Error('Host session listener unavailable');
    const session = await scopeVar(listener.objectId, 'session');
    if (!session) throw Error('Host session observation unavailable');
    return await project({ session, scopeVar, methodScopeVar, read });
  } finally { await c.detach(); }
}


const [endpoint, origin] = process.argv.slice(2);
const browser = await chromium.connectOverCDP(endpoint);
try {
  const page = findPage(browser, origin);
  const out = await withHost(page, ({ session, read }) => read(session, `function() {
    const n = this.getState().network || {};
    const short = id => typeof id === 'string' ? id.slice(0, 8) : id;
    return { at: new Date().toISOString(), consumer: { peerId: short(n.consumer?.peerId), state: n.consumer?.connectionState,
      peers: (n.consumer?.peers || []).map(p => ({ peer: short(p.peerId), role: p.role, readiness: p.readiness })) },
      partitionPeers: (n.partitionPeers || []).map(p => ({ transport: short(p.transportId), participant: p.participantId, available: p.available,
        reason: p.reason ?? null, phase: p.description?.phase, indexes: (p.description?.models || []).map(m => m.index),
        slots: p.description?.capacity ?? null })),
      contribution: n.contribution ? Object.fromEntries(Object.entries(n.contribution).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v)?.slice(0, 600) : v])) : null };
  }`));
  console.log(JSON.stringify(out));
} finally { await browser.close(); }
