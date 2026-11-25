// Adapts the host's conversation controller to the conversation screens. The controller
// (apps/poolday/host/decisions/conversation-controller.js) makes every decision with the host's
// decision functions; this adapter only supplies the page's ports: this browser's storage for the
// remembered "Answer on" choice, the address bar an invite link is read from, and the clipboard.
import * as controllerModule from '../../../../../poolday/host/decisions/conversation-controller.js';
import type { ConversationPort } from '../domain/conversation';

type Host = { readonly chat: object; readonly webSearch?: object | null; readonly search?: object | null; readonly historyHandover?: object | null };

const { createConversationController } = controllerModule as unknown as {
  readonly createConversationController: (session: object, options: object) => ConversationPort;
};

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function createConversation(product: { readonly host: object }, viewState: object = {}): ConversationPort {
  const host = product.host as Host;
  return createConversationController(host.chat, {
    storage: safeStorage(),
    viewState,
    webSearch: host.webSearch ?? null,
    search: host.search ?? null,
    historyHandover: host.historyHandover ?? null,
    href: () => window.location.href,
    // An invite token leaves the address bar once read, so a reload or a shared tab cannot reuse it.
    forgetInvite: () => window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search),
    clipboard: (text: string) => navigator.clipboard?.writeText(text),
  });
}
