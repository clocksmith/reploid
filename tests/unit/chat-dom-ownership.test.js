import { afterEach, describe, expect, it } from 'vitest';
import { renderConversationWorkspace, bindConversationWorkspace } from '../../self/ui/pool-home/conversation-workspace.js';
import { createChatSession, CANONICAL_CHAT_MODELS } from '../../self/host/chat-session.js';
import { createChatTestService } from '../fixtures/chat-service.js';

describe('chat control ownership', () => {
  let root, session, dispose;
  afterEach(async () => { dispose?.(); await session?.close(); root?.remove(); });
  const controls = ['[data-network-rail]', '[data-inspector-navigation]', '[data-model-control]',
    '[data-model-selection-details]', '[data-file-sharing-row]', '[data-model-sharing-limits]',
    '[data-contribution-limits]', '[data-network-message]', '[data-composer-input]'];

  it('binds, opens panels and refreshes discovery without moving existing controls or replacing the composer', () => {
    root = document.createElement('main'); root.className = 'pool-home'; root.dataset.poolRouteId = 'home';
    root.innerHTML = renderConversationWorkspace(); document.body.append(root);
    session = createChatSession({ storage: null, service: createChatTestService(), models: [CANONICAL_CHAT_MODELS[1]] });
    const original = controls.map(selector => { const node = root.querySelector(selector); return { selector, node, parent: node.parentNode }; });
    const stable = () => { for (const { selector, node, parent } of original) {
      expect(root.querySelector(selector), selector + ' identity').toBe(node);
      expect(node.parentNode, selector + ' owner').toBe(parent);
    } };
    dispose = bindConversationWorkspace(root, session);
    stable();
    const input = root.querySelector('[data-composer-input]');
    input.value = 'Keep this draft and selection'; input.focus(); input.setSelectionRange(5, 15);
    session.refreshNetwork();
    stable(); expect(document.activeElement).toBe(input); expect(input.selectionStart).toBe(5);
    root.querySelector('[data-open-model]').click(); stable();
    expect(root.querySelector('[data-model-picker]').open).toBe(true);
    root.querySelector('[data-model-picker-close]').click(); stable();
    root.querySelector('[data-inspector-section="participants"]').click(); stable();
    root.querySelector('[data-close-inspector]').click(); stable();
    root.querySelector('[data-inspector-section="settings"]').click(); stable();
    root.querySelector('[data-close-inspector]').click(); stable();
    expect(input.value).toBe('Keep this draft and selection'); expect(input.selectionEnd).toBe(15);
    dispose(); dispose = null; stable();
  });
});
