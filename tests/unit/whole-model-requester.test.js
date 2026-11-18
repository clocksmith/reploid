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

it('binds verified peer signing identity in recipients and enforces prepared whole-model token ceilings', async () => {
  const boundedModel = { ...model, generation: { maxTokens: 16 } };
  const controller = new AbortController();
  const controls = { signal: controller.signal, requestApproval: vi.fn(async () => true), onDelta: vi.fn() };
  let requester;
  const mesh = {
    getSwarmSnapshot: () => ({ peers: [{ peerId: 'transport-uuid', participantId: 'peer:enrolled1234567890abcdef',
      model: boundedModel.id, modelIdentity: boundedModel.identity, hasInference: true, readiness: 'ready', availableSlots: 1 }] }),
    generate: vi.fn(async (messages, onDelta, options) => {
      if (!await requester.authorize({ action: 'mesh.dispatch', peerId: 'transport-uuid',
        recipientIdentity: 'peer:enrolled1234567890abcdef', requestId: 'req-1',
        modelId: options.modelId, modelIdentity: options.modelIdentity, adapterIdentities: options.adapterIdentities,
        requestContext: options.requestContext, messages })) throw Error('Disclosure denied');
      onDelta('{"ok":true}');
      return { model: boundedModel.id, modelIdentity: boundedModel.identity, adapterIdentities: [], content: '{"ok":true}',
        completion: { schema: GENERATION_CONTRACT.completionSchema, stopReason: 'eos-token', promptTokenCount: 7, generatedTokenCount: 4 } };
    })
  };
  requester = createWholeModelRequester({ mesh, models: [boundedModel] });
  expect(requester.getModels()[0].textGeneration).toEqual({ schema: 'reploid.text-generation/v1', usage: 'raw-model-tokens/v1' });
  await expect(requester.generate({ ...request, model: boundedModel, generationRequest: {
    schema: 'reploid.partition-generation-request/v1', maxOutputTokens: 8, usage: 'raw-model-tokens/v1'
  } }, controls)).rejects.toThrow('below the prepared model ceiling');
  expect(mesh.generate).not.toHaveBeenCalled();
  const value = await requester.generate({ ...request, model: boundedModel, generationRequest: {
    schema: 'reploid.partition-generation-request/v1', maxOutputTokens: 16, usage: 'raw-model-tokens/v1'
  } }, controls);
  expect(controls.requestApproval).toHaveBeenCalledWith(expect.objectContaining({
    providerId: 'transport-uuid',
    recipientIdentity: 'peer:enrolled1234567890abcdef',
    recipients: ['peer:enrolled1234567890abcdef'],
    input: { messages: request.messages, generationRequest: {
      schema: 'reploid.partition-generation-request/v1', maxOutputTokens: 16, usage: 'raw-model-tokens/v1'
    } }
  }));
  expect(value.usage).toEqual({ schema: 'raw-model-tokens/v1', inputTokens: 7, outputTokens: 4 });
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

function settingsFixture({ capabilities = [{ schema: 'reploid.generation-settings/v1', maxOutputTokens: true, tools: false, outputSchema: false, thinking: false }],
  dispatch = options => ({ settings: options.settings }), generated = 2 } = {}) {
  const bounded = { ...model, generation: { maxTokens: 16 } };
  const controls = { signal: new AbortController().signal, requestApproval: vi.fn(async () => true), onDelta: vi.fn() };
  const mesh = {
    getSwarmSnapshot: () => ({ peers: capabilities.map((generationSettings, index) => ({ peerId: 'peer-' + index, model: bounded.id, modelIdentity: bounded.identity,
      hasInference: true, readiness: 'ready', availableSlots: 1, ...(generationSettings ? { generationSettings } : {}) })) }),
    generate: vi.fn(async (messages, onDelta, options) => {
      if (!await requester.authorize({ action: 'mesh.dispatch', peerId: 'peer-0', modelId: options.modelId, modelIdentity: options.modelIdentity,
        adapterIdentities: options.adapterIdentities, requestContext: options.requestContext, messages, ...dispatch(options) })) throw Error('Disclosure denied');
      return { model: bounded.id, modelIdentity: bounded.identity, adapterIdentities: [], content: 'answer',
        completion: { schema: GENERATION_CONTRACT.completionSchema, stopReason: 'max-tokens', promptTokenCount: 7, generatedTokenCount: generated } };
    })
  };
  const requester = createWholeModelRequester({ mesh, models: [bounded] });
  return { requester, mesh, controls, request: { ...request, model: bounded } };
}
const canonical = maxOutputTokens => ({ schema: 'reploid.generation-settings/v1', maxOutputTokens, tools: [], toolChoice: 'none', outputSchema: null, thinking: null });

it('lets settings lower the output limit and binds them in the mesh control and the disclosure preview', async () => {
  const f = settingsFixture();
  expect(f.requester.getModels()[0].generationSettings).toMatchObject({ maxOutputTokens: true, tools: false });
  const value = await f.requester.generate({ ...f.request, settings: { maxOutputTokens: 2 } }, f.controls);
  expect(f.mesh.generate.mock.calls[0][2].settings).toEqual(canonical(2));
  expect(f.controls.requestApproval.mock.calls[0][0].input).toEqual({ messages: f.request.messages, settings: canonical(2) });
  expect(value.usage.outputTokens).toBe(2);
  // A request without settings passes no settings control and previews no settings.
  await f.requester.generate(f.request, f.controls);
  expect(f.mesh.generate.mock.calls[1][2]).not.toHaveProperty('settings');
  expect(f.controls.requestApproval.mock.calls[1][0].input).toEqual({ messages: f.request.messages });
});

it.each([
  ['changed settings', options => ({ settings: { ...options.settings, maxOutputTokens: 3 } })],
  ['dropped settings', () => ({})]
])('refuses a dispatch with %s before approval', async (_label, dispatch) => {
  const f = settingsFixture({ dispatch });
  await expect(f.requester.generate({ ...f.request, settings: { maxOutputTokens: 2 } }, f.controls)).rejects.toThrow('disclosure differs');
  expect(f.controls.requestApproval).not.toHaveBeenCalled();
});

it('refuses a dispatch that adds settings to a request without them', async () => {
  const f = settingsFixture({ dispatch: () => ({ settings: canonical(2) }) });
  await expect(f.requester.generate(f.request, f.controls)).rejects.toThrow('disclosure differs');
  expect(f.controls.requestApproval).not.toHaveBeenCalled();
});

it('refuses settings unless every ready provider of the model advertises them, and a limit above the prepared ceiling', async () => {
  const limit = { schema: 'reploid.generation-settings/v1', maxOutputTokens: true, tools: true, outputSchema: false, thinking: false };
  const mixed = settingsFixture({ capabilities: [limit, null] });
  expect(mixed.requester.getModels()[0]).not.toHaveProperty('generationSettings');
  await expect(mixed.requester.generate({ ...mixed.request, settings: { maxOutputTokens: 2 } }, mixed.controls)).rejects.toThrow('not supported by this route');
  const narrowed = settingsFixture({ capabilities: [limit, { ...limit, tools: false }] });
  expect(narrowed.requester.getModels()[0].generationSettings).toEqual({ ...limit, tools: false });
  await expect(narrowed.requester.generate({ ...narrowed.request, settings: { tools: [{ name: 'lookup', parameters: {} }] } }, narrowed.controls))
    .rejects.toThrow('Generation setting tools is not supported');
  await expect(narrowed.requester.generate({ ...narrowed.request, settings: { maxOutputTokens: 17 } }, narrowed.controls)).rejects.toThrow('exceeds the prepared model ceiling');
  await expect(narrowed.requester.generate({ ...narrowed.request, settings: { temperature: 1 } }, narrowed.controls)).rejects.toThrow('unknown key temperature');
  for (const f of [mixed, narrowed]) { expect(f.mesh.generate).not.toHaveBeenCalled(); expect(f.controls.requestApproval).not.toHaveBeenCalled(); }
});

it('rejects a provider result that reports more output than the caller limit', async () => {
  const f = settingsFixture({ generated: 3 });
  await expect(f.requester.generate({ ...f.request, settings: { maxOutputTokens: 2 } }, f.controls)).rejects.toThrow('exceeded the caller output limit');
});
