import { afterEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
const ports = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock('../../self/host/model-acquisition.js', async original => ({ ...await original(),
  createModelAcquisition: () => ({ start: ports.start, getState: () => ({ phase: 'idle' }), supportError: () => null,
    cancel() {}, async close() {} }) }));
import { createChatSession } from '../../self/host/chat-session.js';
import { createChatTestService } from '../fixtures/chat-service.js';
const sessions = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map(session => session.close())); vi.unstubAllGlobals(); vi.clearAllMocks(); });
async function fixture() {
  const bytes = new TextEncoder().encode(JSON.stringify({ modelId: 'setup-fixture', shards: [{ size: 120 }] }));
  const hash = Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex');
  const model = { id: 'setup-fixture', name: 'Fixture', identity: 'sha256:' + hash, contextLength: 4096,
    source: { baseUrl: 'https://models.invalid/fixture/', files: [{ path: 'manifest.json', role: 'model-manifest', sizeBytes: bytes.length }] } };
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => bytes.buffer })));
  const swarm = { getState: () => ({ sharing: false }), share: vi.fn(async () => {}), stop: vi.fn(async () => {}) };
  const session = createChatSession({ storage: null, service: createChatTestService(), models: [model], swarm });
  sessions.push(session); await session.getModelDownload(model.id);
  return { session, swarm, model };
}
it('finishes the approved download before connecting a contribution provider', async () => {
  const { session, swarm, model } = await fixture();
  let finish; ports.start.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const sharing = session.setSharing(true, model.id, true);
  expect(ports.start).toHaveBeenCalledOnce(); expect(swarm.share).not.toHaveBeenCalled();
  finish({ id: model.id, identity: model.identity }); await sharing;
  expect(swarm.share).toHaveBeenCalledWith(model.id, true, [], { mode: 'whole-model' });
  expect(session.getState().models[0].localCached).toBe(true);
});
it('retains the completed download when contributor connection fails', async () => {
  const { session, swarm, model } = await fixture();
  ports.start.mockResolvedValue({ id: model.id, identity: model.identity });
  swarm.share.mockRejectedValue(new Error('Connection failed'));
  await expect(session.setSharing(true, model.id, true)).rejects.toThrow('Connection failed');
  expect(session.getState().models[0].localCached).toBe(true);
  await expect(session.setSharing(true, model.id, true)).rejects.toThrow('Connection failed');
  expect(ports.start).toHaveBeenCalledOnce();
});
