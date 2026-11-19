// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { nativeCommand } from '../../server/native-node-commands.js';
import { askMesh } from '../../server/native-node-ask.js';

it('defaults to 2B, accepts a quoted prompt and keeps compute flags out of ask', () => {
  expect(nativeCommand(['ask', 'two words'])).toEqual({ args: ['--connect-only'], prompt: 'two words' });
  expect(nativeCommand(['ask', '--model', '2b', '--room', 'my-team', '--', '--help'])).toMatchObject({
    args: ['qwen-3-5-2b-q4k-ehaf16', '--connect-only', '--room', 'my-team'], prompt: '--help'
  });
  expect(() => nativeCommand(['ask', '2b', 'hello', '--contribute'])).toThrow('Unknown option');
  expect(() => nativeCommand(['ask'])).toThrow('Your question');
});

it('selects the exact whole route ahead of a split and binds disclosure to the requested input', async () => {
  const model = { id: 'small', identity: 'sha256:expected', name: 'Small' };
  const whole = { ...model, availability: 'ready' };
  const report = vi.fn();
  const participant = {
    roomId: 'test-room',
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
