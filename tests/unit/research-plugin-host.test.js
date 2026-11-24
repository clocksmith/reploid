import { it, expect, vi } from 'vitest';
import { createResearchPlugins } from '../../apps/poolday/host/research-plugins.js';
import { bindExecutionRoute, createExecutionPolicy, plaintextExecutionRoute } from '../../shared/vendor/reploid/chat/execution-policy.js';

const SMALL = 'sha256:' + 'a'.repeat(64), LARGE = 'sha256:' + 'b'.repeat(64);
const models = [{ id: 'small', name: 'Small', identity: SMALL, provider: 'doppler' }, { id: 'large', name: 'Large', identity: LARGE, provider: 'doppler' }];

const fixture = () => {
  const data = new Map(), storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const peers = models.map(model => ({ model: model.id, modelIdentity: model.identity, role: 'provider', peerId: model.id,
    participantId: 'signed-' + model.id, identityVerified: true, admissionProtocol: 2, readiness: 'ready', availableSlots: 1 }));
  return { data, storage, peers };
};
// The disclosure preview the real swarm sends before the prompt: the policy bound to the one recipient it chose.
const preview = async (controls, recipient) => {
  const request = { model: { id: controls.modelId, identity: controls.modelIdentity }, privacy: controls.privacy };
  const privacyBinding = await bindExecutionRoute(request, plaintextExecutionRoute(request, { recipients: [recipient] }));
  return { privacyBinding, providerId: recipient, recipientIdentity: recipient, modelId: controls.modelId,
    modelIdentity: controls.modelIdentity, adapterIdentities: [] };
};
const reviewed = { target: { ...models[0], recipients: ['signed-small'] }, imitator: { ...models[1], recipients: ['signed-large'] } };
const input = { targetId: 'small', imitatorId: 'large', approved: true, reviewed };

it('requires consent, pins exact models and recipients, and refuses substituted responses', async () => {
  const { data, storage, peers } = fixture();
  const swarm = { getState: () => ({ consumer: { peers } }),
    generate: vi.fn(async (messages, controls) => {
      expect(controls.privacy.recipients).toEqual({ kind: 'named', ids: ['signed-small'] });
      expect(await controls.approve(await preview(controls, 'signed-small'))).toBe(true);
      return { model: 'small', modelIdentity: 'sha256:' + 'f'.repeat(64), provider: 'doppler', content: 'answer' };
    }) };
  const service = createResearchPlugins({ chat: { getState: () => ({ models }) }, swarm, storage });
  await expect(service.create({ ...input, approved: false })).rejects.toThrow('Approve');
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
  await expect(session.dispatch({ type: 'start' })).rejects.toThrow('different model');
  expect(session.export().effects[0].status).toBe('failed');
});

it('runs each study call through reploid/inference and keeps its execution receipt in the record', async () => {
  const { storage, peers } = fixture(), sent = [];
  const swarm = { getState: () => ({ consumer: { peers } }),
    async generate(messages, controls) {
      const recipient = 'signed-' + controls.modelId;
      if (!await controls.approve(await preview(controls, recipient))) throw new Error('Declined');
      await controls.record({ stage: 'approved', recipient });
      sent.push(recipient);
      return { model: controls.modelId, modelIdentity: controls.modelIdentity, adapterIdentities: [], provider: 'doppler',
        peerId: controls.modelId, content: 'Example answer' };
    } };
  const session = await createResearchPlugins({ chat: { getState: () => ({ models }) }, swarm, storage }).create(input);
  await session.dispatch({ type: 'start' });
  const effects = session.export().effects.filter(effect => effect.status === 'completed');
  expect(effects.length).toBeGreaterThan(2);
  expect(sent).toHaveLength(effects.length);
  for (const effect of effects) {
    const recipient = 'signed-' + effect.input.model.id;
    expect(effect.output.executionReceipt).toMatchObject({ schema: 'reploid.execution-receipt/v1', status: 'completed',
      requested: { model: { id: effect.input.model.id, identity: effect.input.model.identity },
        execution: { participants: { kind: 'named', ids: [recipient] }, confidentiality: 'executor-readable' } },
      route: { shape: 'remote', participants: [recipient], backend: 'doppler-plaintext/v1' } });
    expect(effect.output.permissions).toEqual([{ stage: 'approved', recipient }]);
  }
});

it('refuses a route change after approval and a requester-only study call, with nothing sent', async () => {
  const { data, storage, peers } = fixture(), sent = [];
  peers.push({ ...peers[0], peerId: 'small-2', participantId: 'signed-small-2' });
  const swarm = { getState: () => ({ consumer: { peers } }),
    generate: vi.fn(async (messages, controls) => {
      expect(await controls.approve(await preview(controls, 'signed-small'))).toBe(true);
      // The same attempt then proposes the other reviewed recipient: the plan admits no second route.
      if (await controls.approve(await preview(controls, 'signed-small-2'))) sent.push(messages);
      throw new Error('Declined');
    }) };
  const service = createResearchPlugins({ chat: { getState: () => ({ models }) }, swarm, storage });
  const changed = await service.create({ ...input, reviewed: { ...reviewed, target: { ...reviewed.target, recipients: ['signed-small', 'signed-small-2'] } } });
  await expect(changed.dispatch({ type: 'start' })).rejects.toMatchObject({ code: 'EXECUTION_PLAN_CHANGED' });
  expect(changed.export().effects[0]).toMatchObject({ status: 'failed' });
  expect(sent).toEqual([]);

  const confidential = await service.create(input);
  const key = `reploid.plugin-session:${confidential.view().sessionId}`;
  const record = JSON.parse(data.get(key));
  for (const scope of record.config.authorizedModels) {
    scope.privacy = createExecutionPolicy({ placement: 'network-allowed', recipients: scope.privacy.recipients,
      computation: 'cryptographic', protocol: 'unsupported', keyContext: 'key', leakage: ['model-id', 'timing', 'length', 'access-patterns'] });
  }
  data.set(key, JSON.stringify(record));
  storage.setItem('reploid.plugin-latest:model-imitation', confidential.view().sessionId);
  await confidential.close();
  swarm.generate.mockClear();
  const restored = await service.restore();
  await expect(restored.dispatch({ type: 'start' })).rejects.toMatchObject({ code: 'CONFIDENTIAL_EXECUTION_UNAVAILABLE' });
  expect(swarm.generate).not.toHaveBeenCalled();
});
