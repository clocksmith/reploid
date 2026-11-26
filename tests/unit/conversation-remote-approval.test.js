// The conversation's permission prompt for sending to another computer (host/decisions/remote-approval.js through
// the conversation controller): which attempt it is for, how it reads, and what Allow and Decline ask the session.
import { afterEach, expect, it, vi } from 'vitest';
import { createChatSession, CANONICAL_CHAT_MODELS } from '../../apps/poolday/host/chat-session.js';
import { openConversation } from '../fixtures/conversation-view.js';

const cleanups = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

it('asks once for the attempt waiting on permission, and Allow grants that need while Decline answers that attempt', async () => {
  const host = createChatSession({ storage: null, models: [CANONICAL_CHAT_MODELS[0]] });
  cleanups.push(() => host.close());
  const need = { networkId: 'net', sharingScope: 'mesh', routeId: 'route-1', disclosure: 'public' };
  const thread = { id: 't', model: CANONICAL_CHAT_MODELS[0], messages: [], grants: [], permissions: { sharingScope: 'mesh', executionLocation: 'network' },
    attempts: [{ id: 'a1', status: 'completed' }, { id: 'a2', status: 'approval', approval: { id: 'p', permissionNeed: need, recipientIdentity: 'peer:x' } }] };
  const state = { ...host.getState(), threads: [thread], selectedId: 't', activeThread: thread, discoveryPhase: 'observed', localDownloadIssue: null };
  const grantRemotePermission = vi.fn(async () => undefined), approve = vi.fn(async () => undefined);
  const view = openConversation({ ...host, getState: () => state, subscribe: () => () => undefined, grantRemotePermission, approve });
  cleanups.push(() => view.dispose());
  expect(view.snapshot().remotePermission).toMatchObject({ key: 'a2:p', title: 'Send to another computer?', recipient: 'peer:x' });
  view.controller.allowRemote();
  await vi.waitFor(() => expect(grantRemotePermission).toHaveBeenCalledTimes(1));
  expect(grantRemotePermission.mock.calls[0][0]).toBe(need);
  expect(typeof grantRemotePermission.mock.calls[0][1].wording).toBe('object');
  view.controller.declineRemote();
  await vi.waitFor(() => expect(approve).toHaveBeenCalledWith('t', 'a2', 'p', false));
});
