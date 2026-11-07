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

function recoveryFixture() {
  const f = fixture();
  let finish;
  const response = { model: model.id, modelIdentity: model.identity, adapterIdentities: [], content: 'recovered answer',
    completion: { schema: GENERATION_CONTRACT.completionSchema, stopReason: 'eos-token', promptTokenCount: 7, generatedTokenCount: 2 } };
  f.mesh.recoverGeneration = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  return { ...f, input: structuredClone(request), reference: { requestId: 'original', providerId: 'peer-1', providerIdentity: 'signed-peer-1' },
    finish: (outcome = { status: 'completed', response }) => finish(outcome) };
}

it('does not query recovery after cancellation', async () => {
  const f = recoveryFixture();
  f.controller.abort(Error('cancelled before recovery'));
  // A pre-cancelled operation must reject without waiting for the transport.
  f.mesh.recoverGeneration.mockResolvedValue({ status: 'unresolved' });
  await expect(f.requester.recover(f.input, f.reference, f.controls)).rejects.toThrow('cancelled before recovery');
  expect(f.mesh.recoverGeneration).not.toHaveBeenCalled();
});

it.each(['completed', 'unresolved', 'cancelled'])('rejects late %s recovery after cancellation', async status => {
  const f = recoveryFixture();
  const pending = f.requester.recover(f.input, f.reference, f.controls);
  f.controller.abort(Error('cancelled during recovery'));
  if (status === 'completed') f.finish();
  else f.finish({ status });
  await expect(pending).rejects.toThrow('cancelled during recovery');
});

it('retains original recovery provenance when the caller changes its inputs while waiting', async () => {
  const f = recoveryFixture();
  const pending = f.requester.recover(f.input, f.reference, f.controls);
  f.input.threadId = 'different-thread';
  f.input.attemptId = 'different-attempt';
  f.input.model.identity = 'different-model';
  f.input.messages[0].content = 'different prompt';
  f.reference.providerId = 'different-peer';
  f.reference.providerIdentity = 'different-signer';
  expect(f.mesh.recoverGeneration.mock.calls[0][1]).toEqual(request.messages);
  f.finish();
  await expect(pending).resolves.toMatchObject({ status: 'completed', result: {
    threadId: request.threadId, attemptId: request.attemptId, modelIdentity: model.identity,
    execution: { providerId: 'peer-1', providerIdentity: 'signed-peer-1' }
  } });
});

it('does not let the recovery port mutate the identity used to accept a result', async () => {
  const f = recoveryFixture();
  f.mesh.recoverGeneration.mockImplementation(async (reference, messages) => {
    reference.providerId = 'different-peer';
    messages[0].content = 'changed by port';
    return { status: 'completed', response: { model: model.id, modelIdentity: model.identity, adapterIdentities: ['wrong-adapter'],
      content: 'substitution', completion: { schema: GENERATION_CONTRACT.completionSchema, stopReason: 'eos-token', promptTokenCount: 7, generatedTokenCount: 2 } } };
  });
  await expect(f.requester.recover(f.input, f.reference, f.controls)).rejects.toThrow('result identity changed');
  expect(f.input.messages).toEqual(request.messages);
  expect(f.reference.providerId).toBe('peer-1');
});
