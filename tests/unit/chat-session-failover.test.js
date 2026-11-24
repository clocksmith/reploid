import { remotePermissionWording } from '../../apps/poolday/ui/pool-home/remote-permission.js';
import { bindExecutionRoute, createExecutionPolicy, plaintextExecutionRoute } from '../../packages/reploid/src/chat/execution-policy.js';
import { expect, it } from 'vitest';
import { createChatSession } from '../../apps/poolday/host/chat-session.js';
import { createChatTestService } from '../fixtures/chat-service.js';

// Injected swarm port, not actual inference or a physical peer loss.
const DROPPED = 'Execution peer disconnected; retry requires a new attempt';
const peerId = index => 'peer:' + String(index).repeat(24);
function fixture(outcome, recipients = { kind: 'open', ids: [] }) {
  const calls = [], disclosed = [], reviewed = [];
  const swarm = {
    getState: () => ({ sharing: false }), connect: async () => {}, hasProvider: () => true,
    async generate(messages, controls) {
      const index = calls.length, peer = peerId(index + 1);
      calls.push({ peer, question: messages.at(-1).content });
      const request = { model: { id: controls.modelId, identity: controls.modelIdentity }, privacy: controls.privacy };
      const privacyBinding = await bindExecutionRoute(request, plaintextExecutionRoute(request, { recipients: [peer] }));
      const preview = { privacyBinding, id: crypto.randomUUID(), providerId: peer, recipientIdentity: peer, operation: 'generate', disclosure: 'public',
        modelId: controls.modelId, modelIdentity: controls.modelIdentity, adapterIdentities: [], input: messages, expiresAt: Date.now() + 10000 };
      if (!await controls.approve(preview)) throw new Error('Declined');
      disclosed.push(peer);
      await controls.record({ stage: 'approved', preview });
      controls.onPartial('Answer from ' + peer);
      if (outcome(index) === 'drop') throw new Error(DROPPED);
      if (outcome(index) === 'refuse') throw new Error('Pending remote job limit exceeded');
      return { model: controls.modelId, modelIdentity: controls.modelIdentity, adapterIdentities: [], provider: 'doppler', peerId: peer, content: 'Answer from ' + peer };
    }
  };
  const session = createChatSession({ storage: null, service: createChatTestService(), swarm });
  session.setRemoteAnswersEnabled(true);
  const threadId = session.createThread({ executionLocation: 'network',
    privacy: createExecutionPolicy({ placement: 'network-allowed', recipients }) });
  const settled = async count => {
    for (let turn = 0; turn < 200; turn++) {
      const state = session.getState();
      const attempt = state.activeThread.attempts.at(-1);
      if (attempt?.status === 'approval') {
        const { permissionNeed, recipientIdentity } = attempt.approval;
        expect(disclosed).not.toContain(recipientIdentity);
        reviewed.push(recipientIdentity);
        await session.grantRemotePermission(permissionNeed, { wording: remotePermissionWording(permissionNeed) });
      }
      if (calls.length >= count && !state.runningIds?.includes(threadId)
        && !['queued', 'loading', 'executing', 'approval'].includes(state.activeThread.attempts.at(-1).status)) return state.activeThread;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('Conversation did not settle');
  };
  return { session, threadId, calls, reviewed, disclosed, settled };
}

it('a conversation pinned to one computer is not resent when that computer drops', async () => {
  const f = fixture(() => 'drop', { kind: 'named', ids: [peerId(1)] });
  expect((await f.session.send(f.threadId, 'Pinned question')).status).toBe('failed');
  await new Promise(resolve => setTimeout(resolve, 40));
  const thread = f.session.getState().activeThread;
  expect(f.calls).toHaveLength(1);
  expect(f.disclosed).toEqual([peerId(1)]);
  expect(thread.attempts.map(attempt => attempt.status)).toEqual(['failed']);
});

it('an open conversation is not resent when its computer drops, and keeps the partial answer', async () => {
  const f = fixture(() => 'drop');
  expect((await f.session.send(f.threadId, 'Public question')).status).toBe('failed');
  await new Promise(resolve => setTimeout(resolve, 60));
  const thread = f.session.getState().activeThread;
  expect(f.calls).toHaveLength(1);
  expect(f.disclosed).toEqual([peerId(1)]);
  expect(thread.attempts.map(attempt => attempt.status)).toEqual(['failed']);
  expect(thread.attempts[0].error).toBe(DROPPED);
  expect(thread.messages.at(-1).content).toBe('Answer from ' + peerId(1));
  await f.session.close();
});

it('an explicit Retry is a new attempt and a new computer still needs approval', async () => {
  const f = fixture(index => index === 0 ? 'drop' : 'complete');
  await f.session.send(f.threadId, 'Public question');
  const failed = f.session.getState().activeThread.attempts[0];
  const retried = f.session.retry(f.threadId, failed.id);
  const thread = await f.settled(2);
  await retried;
  expect(f.reviewed).toEqual([peerId(2)]);
  expect(f.disclosed).toEqual([peerId(1), peerId(2)]);
  expect(thread.attempts.map(attempt => attempt.status)).toEqual(['failed', 'completed']);
  expect(thread.attempts[1].userMessageId).toBe(thread.attempts[0].userMessageId);
  expect(thread.messages.filter(message => message.role === 'user')).toHaveLength(1);
  expect(thread.messages.at(-1).content).toBe('Answer from ' + peerId(2));
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
