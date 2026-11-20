// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { nativeCommand } from '../../server/native-node-commands.js';
import { askMesh } from '../../server/native-node-ask.js';

const approvals = vi.hoisted(() => []);
vi.mock('../../apps/poolday/config/partition-releases.json', () => ({ default: { approvals } }));
afterEach(() => { approvals.length = 0; });

it('defaults to 2B, accepts a quoted prompt and keeps compute flags out of ask', () => {
  expect(nativeCommand(['ask', 'two words'])).toEqual({ args: ['--connect-only'], prompt: 'two words' });
  expect(nativeCommand(['ask', '--model', '2b', '--room', 'my-team', '--', '--help'])).toMatchObject({
    args: ['qwen-3-5-2b-q4k-ef16-af32', '--connect-only', '--room', 'my-team'], prompt: '--help'
  });
  expect(() => nativeCommand(['ask', '2b', 'hello', '--contribute'])).toThrow('Unknown option');
  expect(() => nativeCommand(['ask'])).toThrow('Your question');
});

it('selects the exact whole route ahead of a split and binds disclosure to the requested input', async () => {
  const model = { id: 'small', identity: 'sha256:expected', name: 'Small' };
  const whole = { ...model, availability: 'ready' };
  const report = vi.fn();
  const participant = {
    roomId: 'test-room', executionClass: 'public-pool',
    getState: () => ({ models: [{ ...whole, identity: 'other' }, { ...whole, adapters: [{ id: 'other' }] },
      { ...whole, partition: {} }, whole] }),
    async generate(request, controls) {
      expect(request.model).toBe(whole);
      const preview = { modelId: model.id, modelIdentity: model.identity, recipients: ['peer-id'], threadId: request.threadId,
        attemptId: request.attemptId, input: { messages: request.messages } };
      expect(controls.requestApproval({ ...preview, modelIdentity: 'other' })).toBe(false);
      expect(controls.requestApproval({ ...preview, input: { messages: [{ role: 'user', content: 'different' }] } })).toBe(false);
      expect(controls.requestApproval(preview)).toBe(true);
      return { modelIdentity: model.identity, content: 'answer' };
    }
  };
  expect(await askMesh(participant, model, 'query', { signal: new AbortController().signal, report })).toBe('answer');
  expect(report).toHaveBeenCalledTimes(1);
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
  const route = { id: 'small', identity: 'sha256:small', name: 'Small', availability: 'ready',
    partition: { planId: 'plan', participantA: 'first', participantB: 'last' } };
  if (executionClass === 'public-pool') approvals.push({ modelId: route.id, modelIdentity: route.identity,
    adapterIdentities: [], partition: route.partition, evidence: 'fixture://operator-review' });
  let present = true;
  const participant = { executionClass, roomId: 'test-room', getState: () => ({ models: present ? [route] : [] }),
    async generate(request, controls) {
      const preview = { ...route.partition, modelId: route.id, modelIdentity: route.identity, threadId: request.threadId,
        attemptId: request.attemptId, input: { messages: request.messages, recipients: ['first', 'last'] } };
      expect(controls.requestApproval({ ...preview, participantB: 'replacement' })).toBe(false);
      expect(controls.requestApproval({ ...preview, input: { ...preview.input, recipients: ['first', 'last', 'extra'] } })).toBe(false);
      expect(controls.requestApproval(preview)).toBe(true);
      if (executionClass === 'public-pool') {
        present = false;
        expect(controls.requestApproval(preview)).toBe(false);
      }
      return { modelIdentity: route.identity, content: 'answer' };
    } };
  const report = vi.fn();
  expect(await askMesh(participant, route, 'hello', { signal: new AbortController().signal, report })).toBe('answer');
  expect(report).toHaveBeenCalledTimes(1);
});
