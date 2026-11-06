// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createWholeModelRequester } from '../../server/whole-model-requester.js';
import { GENERATION_CONTRACT } from '../../shared/config/doppler-generation-contract.js';

const model = { id: 'whole', identity: 'sha256:' + 'a'.repeat(64), provider: 'doppler' };
const request = { threadId: 'thread', attemptId: 'attempt', model, messages: [{ role: 'user', content: 'hello' }] };
function fixture({ approve = async () => true, result = {}, dispatch = {}, readiness = 'ready' } = {}) {
  const controller = new AbortController();
  const controls = { signal: controller.signal, requestApproval: vi.fn(approve), onDelta: vi.fn() };
  const mesh = {
    getSwarmSnapshot: () => ({ peers: [{ peerId: 'peer-1', model: model.id, modelIdentity: model.identity,
      hasInference: true, readiness, availableSlots: 1 }] }),
    generate: vi.fn(async (messages, onDelta, options) => {
      if (!await requester.authorize({ action: 'mesh.dispatch', peerId: 'peer-1', modelId: options.modelId,
        modelIdentity: options.modelIdentity, adapterIdentities: options.adapterIdentities,
        requestContext: options.requestContext, messages, ...dispatch })) throw Error('Disclosure denied');
      onDelta('answer');
      return { model: model.id, modelIdentity: model.identity, adapterIdentities: [], content: 'answer',
        completion: { schema: GENERATION_CONTRACT.completionSchema, stopReason: 'eos-token', promptTokenCount: 7, generatedTokenCount: 2 }, ...result };
    })
  };
  const requester = createWholeModelRequester({ mesh, models: [model] });
  return { requester, mesh, controls, controller };
}

it('projects ready exact models and binds disclosure, deltas, counts and provider identity', async () => {
  const f = fixture();
  expect(f.requester.getModels()).toMatchObject([{ id: model.id, identity: model.identity, providerIds: ['peer-1'] }]);
  const value = await f.requester.generate(request, f.controls);
  expect(f.controls.requestApproval).toHaveBeenCalledWith(expect.objectContaining({ threadId: request.threadId,
    attemptId: request.attemptId, modelId: model.id, modelIdentity: model.identity, recipients: ['peer-1'],
    input: { messages: request.messages } }));
  expect(value).toMatchObject({ threadId: 'thread', attemptId: 'attempt', content: 'answer',
    usage: { inputTokens: 7, outputTokens: 2 }, execution: { placement: 'peer-whole-request', providerId: 'peer-1' } });
  expect(f.controls.onDelta).toHaveBeenCalledWith({ threadId: 'thread', attemptId: 'attempt', sequence: 0, text: 'answer' });
});

it.each([
  [{ approve: async () => false }, /Disclosure denied/],
  [{ dispatch: { modelIdentity: 'other' } }, /disclosure differs/],
  [{ result: { modelIdentity: 'other' } }, /result identity changed/],
  [{ result: { adapterIdentities: ['other'] } }, /result identity changed/],
  [{ result: { completion: null } }, /completion metadata missing/],
  [{ readiness: 'loading' }, /No ready whole-model provider/]
])('rejects unavailable, unauthorized or substituted execution %#', async (options, error) => {
  const f = fixture(options);
  await expect(f.requester.generate(request, f.controls)).rejects.toThrow(error);
});

it('cancels during disclosure without emitting output and forgets the request context', async () => {
  const f = fixture({ approve: async () => { f.controller.abort(Error('cancelled')); return true; } });
  await expect(f.requester.generate(request, f.controls)).rejects.toThrow('cancelled');
  expect(f.controls.onDelta).not.toHaveBeenCalled();
  const options = f.mesh.generate.mock.calls[0][2];
  expect(await f.requester.authorize({ action: 'mesh.dispatch', requestContext: options.requestContext })).toBe(false);
});

it('refuses unsupported caller token limits before dispatch', async () => {
  const f = fixture();
  await expect(f.requester.generate({ ...request, generationRequest: { maxOutputTokens: 1 } }, f.controls)).rejects.toThrow('not supported');
  expect(f.mesh.generate).not.toHaveBeenCalled();
});
