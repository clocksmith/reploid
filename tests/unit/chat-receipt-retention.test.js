import { expect, it, vi } from 'vitest';
import { createChatSession, CANONICAL_CHAT_MODELS } from '../../apps/poolday/host/chat-session.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createReceiptDraft, signReceiptDraft, countersignReceipt, verifyReceipt } from '../../packages/reploid/src/artifacts/receipt.js';
import { hashJson, sha256Hex } from '../../packages/reploid/src/artifacts/signatures.js';
import { createChatTestService } from '../fixtures/chat-service.js';
import { bindExecutionRoute, createExecutionPolicy, plaintextExecutionRoute } from '../../packages/reploid/src/chat/execution-policy.js';

const OPEN_POLICY = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } });

it.each(['public', 'private'])('retains a %s whole-model receipt through history reload without another request', async kind => {
  // Injected execution ports, real receipt signatures, no physical inference.
  const provider = await createSigningIdentity({ algorithm: 'Ed25519' });
  const consumer = await createSigningIdentity({ algorithm: 'Ed25519' });
  const model = { ...CANONICAL_CHAT_MODELS[0], ...(kind === 'private' ? {
    selectionId: 'private:fixture:model', fleet: { poolIdentity: 'fixture', requester: { participantId: consumer.peerId } }, availability: 'ready'
  } : {}) };
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  let receipt;
  const answer = vi.fn(async messages => {
    const content = 'Receipt-backed fixture';
    receipt = await countersignReceipt(await signReceiptDraft(await createReceiptDraft({
      version: 2, provider: provider.peerId, consumer: consumer.peerId, jobHash: 'request:fixture',
      model: model.id, modelIdentity: model.identity, adapterIdentities: [],
      inputDigest: await hashJson(messages), outputDigest: await sha256Hex(content),
      inputTokens: 4, outputTokens: 2, usage: 'raw-model-tokens/v1', status: 'completed',
      cleanup: 'settled', stopReason: 'eos-token', ownerPolicyDigest: null
    }), provider), consumer);
    return { model: model.id, modelIdentity: model.identity, adapterIdentities: [], content, provider: 'doppler',
      peerId: provider.peerId, executionReceipt: receipt };
  });
  const swarm = { getState: () => ({ sharing: false }), hasProvider: () => true, connect: async () => {},
    async generate(messages, controls) {
      const preview = { id: crypto.randomUUID(), providerId: provider.peerId, recipientIdentity: provider.peerId,
        operation: 'generate', disclosure: 'public', modelId: model.id, modelIdentity: model.identity,
        adapterIdentities: [], input: messages, expiresAt: Date.now() + 10000 };
      const request = { model, privacy: controls.privacy };
      preview.privacyBinding = await bindExecutionRoute(request, plaintextExecutionRoute(request, { recipients: [provider.peerId] }));
      if (!await controls.approve(preview)) throw Error('Declined');
      await controls.record({ stage: 'approved', preview });
      return answer(messages);
    } };
  const fleet = { state: () => ({ connected: true }), models: () => [model], close() {},
    describeRoute: async () => ({ shape: 'remote', backend: 'doppler-plaintext/v1', participants: [consumer.peerId, provider.peerId], selection: 'all' }),
    async execute(request, controls) {
      const inputRecipients = [consumer.peerId, provider.peerId];
      const privacyBinding = await bindExecutionRoute(request, plaintextExecutionRoute(request, { recipients: inputRecipients,
        route: { schema: 'reploid.paired-whole-route/v1', requester: consumer.peerId, providerIdentity: provider.peerId } }));
      if (!await controls.requestApproval({ id: crypto.randomUUID(), threadId: request.threadId, attemptId: request.attemptId,
        peerId: consumer.peerId, recipientIdentity: consumer.peerId, operation: 'generate', disclosure: 'public',
        modelId: model.id, modelIdentity: model.identity, adapterIdentities: [], expiresAt: Date.now() + 10000,
        privateDelegation: { poolIdentity: 'fixture' }, inputRecipients, privacyBinding, input: request.messages })) throw Error('Declined');
      return { ...await answer(request.messages), modelId: model.id,
      threadId: request.threadId, attemptId: request.attemptId,
      execution: { provider: 'peer', peerId: provider.peerId, placement: 'peer-whole-request' } }; } };
  const options = { storage, service: createChatTestService(), ...(kind === 'private' ? { privateComputers: fleet } : { swarm }) };
  const session = createChatSession(options);
  const thread = session.createThread({ model, privacy: OPEN_POLICY, executionLocation: 'network' });
  const result = await session.send(thread, 'Public fixture question');
  expect(result.error).toBeFalsy();
  expect(result.status).toBe('completed');
  await session.close();
  const reopened = createChatSession(options);
  const saved = reopened.getState().threads[0].attempts[0].execution;
  expect(saved.executionReceipt).toEqual(receipt);
  expect(await verifyReceipt(saved.executionReceipt)).toMatchObject({ providerValid: true, consumerValid: true });
  expect(saved.serviceCredit).toBeUndefined();
  expect(answer).toHaveBeenCalledOnce();
  await reopened.close();
});
