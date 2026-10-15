import { describe, expect, it } from 'vitest';
import { createChatWorkspace } from '../../packages/reploid/src/chat/workspace.js';
import defaults from '../../packages/reploid/src/chat/policy.json' with { type: 'json' };
import { partitionFailure } from '../../packages/reploid/src/mesh/partitions/partition-contract.js';

// Injected execution: proves the requester's deadline outcome, not route timing.
const model = { id: 'model-a', name: 'Model A', identity: 'sha256:' + 'a'.repeat(64) };
function workspace(execute, attemptTimeoutMs) {
  let data;
  return createChatWorkspace({ meshId: 'mesh', participantId: 'alice', execute,
    store: { load: () => data, save: value => { data = structuredClone(value); } }, policy: { ...defaults, attemptTimeoutMs } });
}
const outcome = attempt => ({ status: attempt.status, error: attempt.error });
const expected = { status: 'failed', error: 'Response timed out. Retry starts a new attempt.' };

describe('one answer deadline outcome', () => {
  it('the requester timer reaching the deadline first fails the attempt, not a stop', async () => {
    const app = workspace((request, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))), 20);
    const thread = app.createThread({ model, permissions: { sharingScope: 'local' } });
    expect(outcome(await app.send(thread, 'Question'))).toEqual(expected);
    await app.close();
  });
  it('an execution owner reaching the deadline first reports the same failure', async () => {
    const app = workspace(async () => { throw partitionFailure('ANSWER_DEADLINE_EXCEEDED'); }, 60000);
    const thread = app.createThread({ model, permissions: { sharingScope: 'local' } });
    expect(outcome(await app.send(thread, 'Question'))).toEqual(expected);
    await app.close();
  });
  it('a person stopping the attempt is still a stop', async () => {
    const app = workspace((request, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))), 60000);
    const thread = app.createThread({ model, permissions: { sharingScope: 'local' } });
    const pending = app.send(thread, 'Question');
    await app.cancel(thread);
    expect(outcome(await pending)).toEqual({ status: 'cancelled', error: 'Response stopped' });
    await app.close();
  });
});
