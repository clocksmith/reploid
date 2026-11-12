import { expect, it } from 'vitest';
import { shouldFailover, MAX_AUTOMATIC_FAILOVERS } from '../../apps/poolday/host/chat-session.js';

const thread = (error, extra = {}) => ({ id: 't', closed: false, permissions: { sharingScope: 'mesh' },
  attempts: [{ id: 'a', userMessageId: 'm', status: 'failed', error, request: {} }], ...extra });

it('retries on another computer only when the chosen computer went away, a bounded number of times', () => {
  for (const error of ['Execution peer disconnected; retry requires a new attempt',
    'Selected contributor is no longer ready; retry requires new placement', 'Failed to send swarm generation request']) {
    expect(shouldFailover(thread(error))).toBe(true);
    expect(shouldFailover(thread(error), [], MAX_AUTOMATIC_FAILOVERS)).toBe(false);
  }
  const dropped = 'Execution peer disconnected; retry requires a new attempt';
  // Not a dropped computer: a refusal, a limit or a model failure stays failed for the reader to decide.
  for (const error of ['Host denied remote prompt disclosure', 'Pending remote job limit exceeded', 'No GPU', 'No remote host slot available', '']) {
    expect(shouldFailover(thread(error))).toBe(false);
  }
  expect(shouldFailover(thread(dropped, { closed: true }))).toBe(false);
  expect(shouldFailover(thread(dropped, { permissions: { sharingScope: 'local' } }))).toBe(false);
  expect(shouldFailover(thread(dropped), ['t'])).toBe(false);
  const searched = thread(dropped); searched.attempts[0].request = { retrieval: { query: 'q' } };
  expect(shouldFailover(searched)).toBe(false);
  const done = thread(dropped); done.attempts[0].status = 'completed';
  expect(shouldFailover(done)).toBe(false);
  expect(shouldFailover({ id: 't', attempts: [] })).toBe(false);
});
