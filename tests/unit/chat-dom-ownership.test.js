import { afterEach, describe, expect, it } from 'vitest';
import { createChatSession, CANONICAL_CHAT_MODELS } from '../../apps/poolday/host/chat-session.js';
import { createChatTestService } from '../fixtures/chat-service.js';
import { openConversation } from '../fixtures/conversation-view.js';

// The vanilla page proved its controls kept their nodes; React reconciles the composer and the drawers in place.
// What the person relies on is what this keeps: opening Answer on, the drawers and a discovery refresh never touch
// the draft.
describe('chat control ownership', () => {
  let session, view;
  afterEach(async () => { view?.dispose(); await session?.close(); });

  it('opens Answer on and refreshes discovery without replacing the draft', () => {
    session = createChatSession({ storage: null, service: createChatTestService(), models: [CANONICAL_CHAT_MODELS[1]] });
    view = openConversation(session);
    view.controller.setDraft('Keep this draft and selection');
    session.refreshNetwork();
    expect(view.composer().draft).toBe('Keep this draft and selection');
    view.controller.openSheet();
    expect(view.sheet().open).toBe(true);
    view.controller.closeSheet();
    expect(view.sheet().open).toBe(false);
    session.refreshNetwork();
    expect(view.composer().draft).toBe('Keep this draft and selection');
    expect(session.getDraft(null)?.text).toBe('Keep this draft and selection');
  });
});
