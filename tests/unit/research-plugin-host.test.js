import { it, expect, vi } from 'vitest';
import { createResearchPlugins } from '../../self/host/research-plugins.js';

it('requires consent, pins exact models and recipients, and refuses substituted responses', async () => {
  const models = [{ id: 'small', name: 'Small', identity: 's', provider: 'doppler' }, { id: 'large', name: 'Large', identity: 'l', provider: 'doppler' }];
  const data = new Map(), storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const swarm = { getState: () => ({ consumer: { peers: models.map(model => ({ model: model.id, modelIdentity: model.identity, role: 'provider', peerId: model.id, readiness: 'ready', availableSlots: 1 })) } }),
    generate: vi.fn(async (messages, controls) => {
      expect(await controls.approve({ providerId: 'stranger', modelId: 'small', modelIdentity: 's', adapterIdentities: [] })).toBe(false);
      expect(await controls.approve({ providerId: 'small', modelId: 'small', modelIdentity: 's', adapterIdentities: [] })).toBe(true);
      return { model: 'small', modelIdentity: 'wrong', provider: 'doppler', content: 'answer' };
    }) };
  const service = createResearchPlugins({ chat: { getState: () => ({ models }) }, swarm, storage });
  await expect(service.create({ targetId: 'small', imitatorId: 'large', approved: false })).rejects.toThrow('Approve');
  expect(swarm.generate).not.toHaveBeenCalled();
  const session = await service.create({ targetId: 'small', imitatorId: 'large', approved: true });
  await expect(session.dispatch({ type: 'start' })).rejects.toThrow('identity');
  expect(session.export().effects[0].status).toBe('failed');
});
