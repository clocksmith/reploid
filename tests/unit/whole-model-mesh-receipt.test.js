// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createLegacyGenerationMesh } from '../../packages/reploid/src/mesh/legacy-generation.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { verifyReceipt } from '../../packages/reploid/src/artifacts/receipt.js';

async function fixture(tamper = false, measured = true, onReceipt) {
  const identities = await Promise.all(['ECDSA', 'Ed25519'].map(algorithm => createSigningIdentity({ algorithm })));
  const handlers = [new Map(), new Map()], wire = [], failures = [];
  const modelIdentity = 'sha256:' + 'a'.repeat(64);
  const deliver = (i, type, payload) => {
    payload = structuredClone(payload); wire.push({ i, type, payload });
    if (tamper && type === 'reploid:generation-result') payload.response.content = 'substituted';
    queueMicrotask(() => Promise.resolve(handlers[1 - i].get(type)?.('connection-' + i, payload)).catch(error => failures.push(error)));
    return true;
  };
  const meshes = [0, 1].map(i => {
    const listeners = new Map(), events = {
      on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); return () => listeners.get(name).delete(fn); },
      emit(name, value) { for (const fn of listeners.get(name) || []) fn(value); }
    };
    return createLegacyGenerationMesh({ config: resolveConfig({ overrides: { mesh: { enabled: true, executeJobs: true, roomId: 'receipt-test' } } }), ports: {
      instanceId: 'instance-' + i, modelConfig: i ? { id: 'model' } : null,
      getExecutionState: () => ({ phase: i ? 'ready' : 'idle', modelIdentity, adapterIdentities: [] }),
      authorize: async () => true, events, eventBus: events, utils: { generateId: () => crypto.randomUUID() },
      identity: { ensure: async () => identities[i], sync: async () => {}, save: async () => {} },
      onReceipt: i ? onReceipt : undefined,
      generate: async () => ({ model: 'model', modelIdentity, adapterIdentities: [], content: 'actual output',
        ...(measured ? { completion: { schema: 'doppler.generation-completion/v1', promptTokenCount: 7, generatedTokenCount: 3, stopReason: 'eos-token' } } : {}) }),
      createTransport: () => ({ init: async () => true, disconnect() {}, _getPeerId: () => 'connection-' + i,
        getPeerBinding: () => ({ local: 'certificate-' + i, remote: 'certificate-' + (1 - i) }),
        onMessage: (type, fn) => handlers[i].set(type, fn), broadcast: (type, payload) => deliver(i, type, payload),
        sendToPeer: (_peer, type, payload) => deliver(i, type, payload) })
    } });
  });
  await meshes[0].connect(); await meshes[1].connect(); meshes[1].refreshAdvertisement();
  await vi.waitFor(() => expect(meshes[0].getSwarmSnapshot().peers.some(peer => peer.readiness === 'ready')).toBe(true));
  return { identities, meshes, wire, failures, modelIdentity, close: () => Promise.all(meshes.map(mesh => mesh.close())) };
}
it('transports measured usage across identity proof, provider signing and requester countersigning', async () => {
  const f = await fixture();
  try {
    const result = await f.meshes[0].generate([{ role: 'user', content: 'not seven characters' }], null, { modelId: 'model', modelIdentity: f.modelIdentity });
    expect(result.executionReceipt).toMatchObject({ version: 2, provider: f.identities[1].peerId, consumer: f.identities[0].peerId,
      inputTokens: 7, outputTokens: 3, cleanup: 'settled' });
    expect(await verifyReceipt(result.executionReceipt)).toEqual({ valid: true, providerValid: true, consumerValid: true });
    expect(f.failures).toEqual([]);
  } finally { await f.close(); }
});
it('rejects transport substitution even when the original provider receipt is valid', async () => {
  const f = await fixture(true);
  try {
    await expect(f.meshes[0].generate([{ role: 'user', content: 'prompt' }], null, { modelId: 'model', modelIdentity: f.modelIdentity }))
      .rejects.toThrow('Measured receipt differs');
  } finally { await f.close(); }
});
it('keeps a legacy response unmetered instead of estimating tokens from text', async () => {
  const f = await fixture(false, false);
  try {
    const result = await f.meshes[0].generate([{ role: 'user', content: 'prompt' }], null, { modelId: 'model', modelIdentity: f.modelIdentity });
    expect(result.executionReceipt).toMatchObject({ version: 1, status: 'unmetered', inputTokens: 0, outputTokens: 0 });
  } finally { await f.close(); }
});
it('waits for admitted receipt persistence before closing the provider mesh', async () => {
  const began = Promise.withResolvers(), release = Promise.withResolvers();
  const f = await fixture(false, true, async () => { began.resolve(); await release.promise; });
  try {
    await f.meshes[0].generate([{ role: 'user', content: 'prompt' }], null, { modelId: 'model', modelIdentity: f.modelIdentity });
    await began.promise;
    let closed = false; const closing = f.meshes[1].close().then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false);
    release.resolve(); await closing; expect(closed).toBe(true);
  } finally { release.resolve(); await f.close(); }
});
