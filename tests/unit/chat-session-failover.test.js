import { expect, it } from 'vitest';
import { createChatSession, MAX_AUTOMATIC_FAILOVERS } from '../../apps/poolday/host/chat-session.js';
import { createChatTestService } from '../fixtures/chat-service.js';

// Injected swarm port, not actual inference or a physical peer loss.
const DROPPED = 'Execution peer disconnected; retry requires a new attempt';
const peerId = index => 'peer:' + String(index).repeat(24);
function fixture(outcome) {
  const calls = [];
  const swarm = {
    getState: () => ({ sharing: false }), connect: async () => {}, hasProvider: () => true,
    async generate(messages, controls) {
      const index = calls.length, peer = peerId(index + 1);
      calls.push({ peer, question: messages.at(-1).content });
      const preview = { id: crypto.randomUUID(), providerId: peer, recipientIdentity: peer, operation: 'generate', disclosure: 'public',
        modelId: controls.modelId, modelIdentity: controls.modelIdentity, adapterIdentities: [], input: messages, expiresAt: Date.now() + 10000 };
      if (!await controls.approve(preview)) throw new Error('Declined');
      await controls.record({ stage: 'approved', preview });
      controls.onPartial('Answer from ' + peer);
      if (outcome(index) === 'drop') throw new Error(DROPPED);
      if (outcome(index) === 'refuse') throw new Error('Pending remote job limit exceeded');
      return { model: controls.modelId, modelIdentity: controls.modelIdentity, adapterIdentities: [], provider: 'doppler', peerId: peer, content: 'Answer from ' + peer };
    }
  };
  const session = createChatSession({ storage: null, service: createChatTestService(), swarm });
  const threadId = session.createThread({ executionLocation: 'network' });
  const settled = async count => {
    for (let turn = 0; turn < 200; turn++) {
      const state = session.getState();
      if (calls.length >= count && !state.runningIds?.includes(threadId)
        && !['queued', 'loading', 'executing', 'approval'].includes(state.activeThread.attempts.at(-1).status)) return state.activeThread;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('Conversation did not settle');
  };
  return { session, threadId, calls, settled };
}

it('answers on another computer as a new attempt after the chosen computer drops, keeping the failed attempt', async () => {
  const f = fixture(index => index === 0 ? 'drop' : 'complete');
  expect((await f.session.send(f.threadId, 'Public question')).status).toBe('failed');
  const thread = await f.settled(2);
  expect(f.calls.map(call => call.question)).toEqual(['Public question', 'Public question']);
  expect(thread.attempts.map(attempt => attempt.status)).toEqual(['failed', 'completed']);
  expect(thread.attempts[0].error).toBe(DROPPED);
  expect(new Set(thread.attempts.map(attempt => attempt.id)).size).toBe(2);
  expect(thread.attempts[1].userMessageId).toBe(thread.attempts[0].userMessageId);
  expect(thread.messages.filter(message => message.role === 'user')).toHaveLength(1);
  expect(thread.messages.at(-1).content).toBe('Answer from ' + peerId(2));
  // The dropped attempt stays in the record as failed; only the new attempt completes.
  expect(thread.messages.filter(message => message.role !== 'user').map(message => message.status)).toEqual(['failed', 'completed']);
  await f.session.close();
});

it('stops after the bounded number of automatic attempts and leaves the last failure for the reader', async () => {
  const f = fixture(() => 'drop');
  await f.session.send(f.threadId, 'Public question');
  const thread = await f.settled(1 + MAX_AUTOMATIC_FAILOVERS);
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(f.calls).toHaveLength(1 + MAX_AUTOMATIC_FAILOVERS);
  expect(thread.attempts.map(attempt => attempt.status)).toEqual(Array(1 + MAX_AUTOMATIC_FAILOVERS).fill('failed'));
  expect(f.session.getState().activeThread.attempts).toHaveLength(1 + MAX_AUTOMATIC_FAILOVERS);
  await f.session.close();
});

it('does not send the question to another computer after a refusal', async () => {
  const f = fixture(() => 'refuse');
  expect((await f.session.send(f.threadId, 'Public question')).status).toBe('failed');
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(f.calls).toHaveLength(1);
  expect(f.session.getState().activeThread.attempts).toHaveLength(1);
  await f.session.close();
});
