// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { nativeCommand } from '../../server/native-node-commands.js';
import { askMesh, askExecution, smallestServed } from '../../server/native-node-ask.js';
import { readFileSync } from 'node:fs';
import chatModels from '../../shared/config/chat-models.json' with { type: 'json' };
import { createWholeModelRequester } from '../../server/whole-model-requester.js';
import { bindExecutionRoute, plaintextExecutionRoute, requestExecutionPolicy } from '../../packages/reploid/src/chat/execution-policy.js';
import { GENERATION_CONTRACT } from '../../shared/config/doppler-generation-contract.js';

const approvals = vi.hoisted(() => []);
vi.mock('../../apps/poolday/config/partition-releases.json', () => ({ default: { approvals } }));
afterEach(() => { approvals.length = 0; });

it('asks any served model by default, accepts a quoted prompt and keeps compute flags out of ask', () => {
  expect(nativeCommand(['ask', 'two words'])).toEqual({ args: ['--connect-only'], prompt: 'two words', anyModel: true });
  expect(nativeCommand(['ask', '2b', 'two words'])).not.toHaveProperty('anyModel');
  expect(nativeCommand(['ask', '--model', '2b', '--room', 'my-team', '--', '--help'])).toMatchObject({
    args: ['qwen-3-5-2b-q4k-ef16-af32', '--connect-only', '--room', 'my-team'], prompt: '--help'
  });
  expect(nativeCommand(['ask', '27b', 'hello', '--model-config', '/abs/model.json', '--ordered-config', '/abs/host.json'])).toMatchObject({
    args: ['qwen-3-8-27b-text-q4k-ef16-af32', '--connect-only', '--model-config', '/abs/model.json', '--ordered-config', '/abs/host.json'],
    prompt: 'hello',
  });
  expect(() => nativeCommand(['ask', '2b', 'hello', '--contribute'])).toThrow('Unknown option');
  expect(() => nativeCommand(['ask'])).toThrow('Your question');
});

it('turns ask execution flags into inference requirements and never passes them to the participant', () => {
  const command = nativeCommand(['ask', 'hello', '--participant', 'peer:a', '--participant', 'peer:a', '--participant', 'peer:b',
    '--allow-metadata', 'model-id,timing', '--room', 'my-team']);
  expect(command.args).toEqual(['--connect-only', '--room', 'my-team']);
  expect(command.execution).toEqual({ placement: 'network-allowed', participants: { kind: 'named', ids: ['peer:a', 'peer:b'] },
    confidentiality: 'executor-readable', allowMetadata: ['model-id', 'timing'] });
  expect(nativeCommand(['ask', 'hello', '--confidentiality', 'requester-only']).execution.confidentiality).toBe('requester-only');
  expect(() => nativeCommand(['ask', 'hello', '--allow-metadata', 'plaintext'])).toThrow('--allow-metadata');
  expect(() => nativeCommand(['ask', 'hello', '--confidentiality', 'encrypted'])).toThrow('--confidentiality');
  expect(nativeCommand(['ask', 'hello'])).not.toHaveProperty('execution');
});

it('refuses requester-only confidentiality before discovery and sends nothing', async () => {
  const getState = vi.fn(() => ({ models: [] })), generate = vi.fn();
  await expect(askMesh({ getState, generate, roomId: 'team' }, { name: 'Small' }, 'secret',
    { signal: new AbortController().signal, execution: askExecution({ confidentiality: 'requester-only' }) }))
    .rejects.toMatchObject({ code: 'CONFIDENTIAL_EXECUTION_UNAVAILABLE' });
  expect(getState).not.toHaveBeenCalled();
  expect(generate).not.toHaveBeenCalled();
});

it('refuses a provider outside the named participants before approval and sends nothing', async () => {
  const model = { id: 'small', identity: 'sha256:' + 'a'.repeat(64), name: 'Small' };
  const approvals = [];
  const participant = { roomId: 'test-room', executionClass: 'public-pool', getState: () => ({ models: [{ ...model, availability: 'ready' }] }),
    async generate(request, controls) {
      // The mesh selected a provider the caller did not name.
      const other = await bindExecutionRoute({ model, privacy: request.privacy },
        plaintextExecutionRoute({ model }, { recipients: ['peer:other'] })).catch(() => null)
        ?? { policy: request.privacy, route: plaintextExecutionRoute({ model }, { recipients: ['peer:other'] }) };
      approvals.push(await controls.requestApproval({ privacyBinding: other }));
      throw Error('declined');
    } };
  await expect(askMesh(participant, model, 'secret', { signal: new AbortController().signal, report: vi.fn(),
    execution: askExecution({ participants: ['peer:named'] }) })).rejects.toMatchObject({ code: 'EXECUTION_PLAN_CHANGED' });
  expect(approvals).toEqual([false]);
});

it('selects the exact whole route ahead of a split and binds disclosure to the requested input', async () => {
  const model = { id: 'small', identity: 'sha256:' + 'e'.repeat(64), name: 'Small' };
  const whole = { ...model, availability: 'ready' };
  const report = vi.fn();
  const participant = {
    roomId: 'test-room', executionClass: 'public-pool',
    getState: () => ({ models: [{ ...whole, identity: 'other' }, { ...whole, adapters: [{ id: 'other' }] },
      { ...whole, partition: {} }, whole] }),
    async generate(request, controls) {
      expect(request.model).toBe(whole);
      const privacyBinding = await bindExecutionRoute(request, plaintextExecutionRoute(request, { recipients: ['peer-id'] }));
      const preview = { modelId: model.id, modelIdentity: model.identity, recipients: ['peer-id'], threadId: request.threadId,
        attemptId: request.attemptId, input: { messages: request.messages }, privacyBinding };
      expect(await controls.requestApproval({ ...preview, modelIdentity: 'other' })).toBe(false);
      expect(await controls.requestApproval({ ...preview, input: { messages: [{ role: 'user', content: 'different' }] } })).toBe(false);
      expect(await controls.requestApproval(preview)).toBe(true);
      return { modelId: model.id, modelIdentity: model.identity, content: 'answer', execution: { stopReason: 'eos-token' } };
    }
  };
  expect(await askMesh(participant, model, 'query', { signal: new AbortController().signal, report })).toBe('answer');
  expect(report).toHaveBeenCalledTimes(1);
});

it('without a model, asks the smallest model a ready provider serves and says which', async () => {
  const catalog = [{ id: 'tiny' }, { id: 'small' }, { id: 'large' }];
  const at = (id, letter, extra = {}) => ({ id, identity: 'sha256:' + letter.repeat(64), name: id.toUpperCase(), availability: 'ready', ...extra });
  const large = at('large', 'c'), small = at('small', 'b');
  const report = vi.fn();
  const participant = { roomId: 'test-room', executionClass: 'public-pool',
    // The tiny model is advertised but not ready, and a split of the tiny model is listed: neither is taken.
    getState: () => ({ models: [large, at('tiny', 'a', { availability: 'unavailable' }), at('tiny', 'a', { partition: {} }), small] }),
    async generate(request, controls) {
      expect(request.model).toBe(small);
      const privacyBinding = await bindExecutionRoute(request, plaintextExecutionRoute(request, { recipients: ['peer-id'] }));
      expect(await controls.requestApproval({ modelId: small.id, modelIdentity: small.identity, recipients: ['peer-id'], threadId: request.threadId,
        attemptId: request.attemptId, input: { messages: request.messages }, privacyBinding })).toBe(true);
      return { modelId: small.id, modelIdentity: small.identity, content: 'answer', execution: { stopReason: 'eos-token' } };
    } };
  // The model the participant was started with (the serving default) is not what an unnamed ask is bound to.
  expect(await askMesh(participant, at('tiny', 'a'), 'query', { signal: new AbortController().signal, report, anyModel: true, catalog, settleMs: 0 })).toBe('answer');
  expect(report.mock.calls[0][0]).toBe('Asking SMALL, the smallest model a ready provider serves.');
});

it('lists catalog models from smallest to largest, which is the order smallestServed and the page default rely on', () => {
  const bytes = model => {
    const file = model.source.files.find(row => row.role === 'model-manifest');
    return JSON.parse(readFileSync(new URL(`../../shared${file.url}`, import.meta.url))).totalSize;
  };
  const sizes = chatModels.map(bytes);
  expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
  expect(smallestServed([{ id: chatModels[2].id }, { id: chatModels[1].id }]).id).toBe(chatModels[1].id);
});

it('without a model, waits a moment after the first advertisement so a smaller model can appear', async () => {
  const catalog = [{ id: 'small' }, { id: 'large' }];
  const at = (id, letter) => ({ id, identity: 'sha256:' + letter.repeat(64), name: id, availability: 'ready' });
  let models = [at('large', 'c')], chosen = null;
  setTimeout(() => { models = [at('large', 'c'), at('small', 'b')]; }, 300);
  const participant = { roomId: 'room', executionClass: 'public-pool', getState: () => ({ models }),
    async generate(request) { chosen = request.model.id; throw Error('stop here'); } };
  await expect(askMesh(participant, at('small', 'b'), 'q', { signal: new AbortController().signal, report: vi.fn(), anyModel: true, catalog, settleMs: 800 }))
    .rejects.toThrow();
  expect(chosen).toBe('small');
});

it('without a model and no ready provider, says so and sends nothing', async () => {
  const generate = vi.fn();
  await expect(askMesh({ roomId: 'room', getState: () => ({ models: [] }), generate }, { name: 'Tiny' }, 'q',
    { signal: new AbortController().signal, report: vi.fn(), anyModel: true, discoveryMs: 50 })).rejects.toThrow('No ready provider for any model in room room');
  expect(generate).not.toHaveBeenCalled();
});

it('runs normal ask through the whole-model requester with current explicit policy', async () => {
  const model = { id: 'small', identity: 'sha256:' + 'a'.repeat(64), name: 'Small', provider: 'doppler' };
  const provider = { peerId: 'connection', participantId: 'signing-id', identityVerified: true, model: model.id,
    modelIdentity: model.identity, hasInference: true, readiness: 'ready', availableSlots: 1, identityProtocol: 1, admissionProtocol: 2 };
  const report = vi.fn();
  const mesh = {
    getSwarmSnapshot: () => ({ peers: [provider] }),
    async generate(messages, onDelta, options) {
      expect(options.privacy).toMatchObject({ schema: 'reploid.execution-policy/v2', placement: 'network-allowed',
        recipients: { kind: 'open', ids: [] } });
      const request = { model, privacy: options.privacy };
      const privacyBinding = await bindExecutionRoute(request, plaintextExecutionRoute(request, { recipients: [provider.participantId] }));
      expect(await requester.authorize({ action: 'mesh.dispatch', messages, privacyBinding,
        peerId: provider.peerId, recipientIdentity: provider.participantId, admission: { schema: 'reploid.generation-admission/v2' },
        modelId: options.modelId, modelIdentity: options.modelIdentity, adapterIdentities: options.adapterIdentities,
        requestContext: options.requestContext })).toBe(true);
      expect(report).toHaveBeenCalledWith(expect.stringContaining(provider.participantId));
      onDelta('answer');
      return { model: model.id, modelIdentity: model.identity, content: 'answer',
        completion: { schema: GENERATION_CONTRACT.completionSchema, stopReason: 'eos-token', promptTokenCount: 1, generatedTokenCount: 1 } };
    }
  };
  const requester = createWholeModelRequester({ mesh, models: [model] });
  const participant = { roomId: 'test-room', executionClass: 'public-pool',
    getState: () => ({ models: requester.getModels() }), generate: requester.generate };
  await expect(askMesh(participant, model, 'query', { signal: new AbortController().signal, report })).resolves.toBe('answer');
});

it('exits discovery without sending the prompt if the requested model is unavailable', async () => {
  const generate = vi.fn();
  await expect(askMesh({ getState: () => ({}), generate, roomId: 'team' }, { name: 'Small' }, 'hello',
    { signal: new AbortController().signal, discoveryMs: 10 })).rejects.toThrow('No ready provider');
  expect(generate).not.toHaveBeenCalled();
});

it('excludes an advertised split from public ask until the exact route has a public release', async () => {
  const model = { id: 'small', identity: 'sha256:small', name: 'Small' };
  const advertised = { ...model, availability: 'ready', qualified: true, partition: { planId: 'plan', participantA: 'a', participantB: 'b' } };
  const participant = { roomId: 'public', executionClass: 'public-pool', getState: () => ({ models: [advertised] }), generate: vi.fn() };
  await expect(askMesh(participant, model, 'hello', { signal: new AbortController().signal, discoveryMs: 10 })).rejects.toThrow('No ready provider');
  expect(participant.generate).not.toHaveBeenCalled();
});


it.each(['public-pool', 'private-pool'])('sends to a matching %s split and binds the exact disclosure', async executionClass => {
  const route = { id: 'small', identity: 'sha256:' + 'f'.repeat(64), name: 'Small', availability: 'ready',
    partition: { planId: 'plan', participantA: 'first', participantB: 'last' } };
  if (executionClass === 'public-pool') approvals.push({ modelId: route.id, modelIdentity: route.identity,
    adapterIdentities: [], partition: route.partition, evidence: 'fixture://operator-review' });
  let present = true;
  const participant = { executionClass, roomId: 'test-room', getState: () => ({ models: present ? [route] : [] }),
    async generate(request, controls) {
      expect(requestExecutionPolicy(request).recipients).toEqual({ kind: 'named', ids: ['first', 'last'] });
      const privacyBinding = await bindExecutionRoute(request, plaintextExecutionRoute(request, { recipients: ['first', 'last'], route: route.partition }));
      const preview = { ...route.partition, modelId: route.id, modelIdentity: route.identity, threadId: request.threadId,
        attemptId: request.attemptId, input: { messages: request.messages, recipients: ['first', 'last'] }, privacyBinding };
      expect(await controls.requestApproval({ ...preview, participantB: 'replacement' })).toBe(false);
      expect(await controls.requestApproval({ ...preview, input: { ...preview.input, recipients: ['first', 'last', 'extra'] } })).toBe(false);
      expect(await controls.requestApproval(preview)).toBe(true);
      if (executionClass === 'public-pool') {
        present = false;
        expect(await controls.requestApproval(preview)).toBe(false);
      }
      return { modelId: route.id, modelIdentity: route.identity, content: 'answer', execution: { stopReason: 'eos-token' } };
    } };
  const report = vi.fn();
  expect(await askMesh(participant, route, 'hello', { signal: new AbortController().signal, report })).toBe('answer');
  expect(report).toHaveBeenCalledTimes(1);
});
