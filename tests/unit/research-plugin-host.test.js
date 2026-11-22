import { it, expect, vi } from 'vitest';
import { createResearchPlugins } from '../../apps/poolday/host/research-plugins.js';
import { assertAvailableExecutionPolicy } from '../../shared/vendor/reploid/chat/execution-policy.js';

it('requires consent, pins exact models and recipients, and refuses substituted responses', async () => {
  const models = [{ id: 'small', name: 'Small', identity: 's', provider: 'doppler' }, { id: 'large', name: 'Large', identity: 'l', provider: 'doppler' }];
  const data = new Map(), storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const peers = models.map(model => ({ model: model.id, modelIdentity: model.identity, role: 'provider', peerId: model.id,
    participantId: 'signed-' + model.id, identityVerified: true, admissionProtocol: 2, readiness: 'ready', availableSlots: 1 }));
  const swarm = { getState: () => ({ consumer: { peers } }),
    generate: vi.fn(async (messages, controls) => {
      expect(assertAvailableExecutionPolicy(controls.privacy).recipients).toEqual({ kind: 'named', ids: ['signed-small'] });
      const preview = { modelId: 'small', modelIdentity: 's', adapterIdentities: [] };
      expect(await controls.approve({ ...preview, providerId: 'small', recipientIdentity: 'stranger' })).toBe(false);
      expect(await controls.approve({ ...preview, providerId: 'large', recipientIdentity: 'signed-large' })).toBe(false);
      expect(await controls.approve({ ...preview, providerId: 'reconnected', recipientIdentity: 'signed-small' })).toBe(true);
      return { model: 'small', modelIdentity: 'wrong', provider: 'doppler', content: 'answer' };
    }) };
  const service = createResearchPlugins({ chat: { getState: () => ({ models }) }, swarm, storage });
  await expect(service.create({ targetId: 'small', imitatorId: 'large', approved: false })).rejects.toThrow('Approve');
  const reviewed = { target: { ...models[0], recipients: ['signed-small'] }, imitator: { ...models[1], recipients: ['signed-large'] } };
  const input = { targetId: 'small', imitatorId: 'large', approved: true, reviewed };
  peers[0].identityVerified = false;
  await expect(service.create(input)).rejects.toThrow('Reviewed contributors changed');
  peers[0].identityVerified = true;
  peers.push({ ...peers[0], peerId: 'new-connection', participantId: 'unreviewed' });
  expect(swarm.generate).not.toHaveBeenCalled();
  const session = await service.create(input);
  const key = [...data.keys()].find(key => key.startsWith('reploid.plugin-session:'));
  const stale = JSON.parse(data.get(key));
  delete stale.config.authorizedModels;
  stale.config.recipients = ['small', 'large'];
  data.set(key, JSON.stringify(stale));
  const restored = await service.restore();
  await expect(restored.dispatch({ type: 'start' })).rejects.toThrow('fresh approval');
  expect(swarm.generate).not.toHaveBeenCalled();
  await expect(session.dispatch({ type: 'start' })).rejects.toThrow('identity');
  expect(session.export().effects[0].status).toBe('failed');
});
