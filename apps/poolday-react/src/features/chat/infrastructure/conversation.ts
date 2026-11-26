// Adapts the host's conversation controller to the conversation screens. The controller
// (apps/poolday/host/decisions/conversation-controller.js) makes every decision with the host's
// decision functions; this adapter only supplies the page's ports: this browser's storage for the
// remembered "Answer on" choice, the address bar an invite link is read from, and the clipboard.
import { createConversationController, type ConversationSession } from '../../../../../poolday/host/decisions/conversation-controller.js';
import type { ConversationPort } from '../domain/conversation';

type Host = { readonly chat: ConversationSession; readonly webSearch?: object | null; readonly search?: object | null; readonly historyHandover?: object | null };

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// What the person has staged in the conversation belongs to the product, not to one mount of its screens: a
// remount (React StrictMode mounts twice in development) gets the same state, so an invite link the first mount
// read from the address bar, and removed from it, is not lost to the second.
const viewStates = new WeakMap<object, object>();
function viewStateOf(product: object): object {
  let state = viewStates.get(product);
  if (!state) viewStates.set(product, (state = {}));
  return state;
}

export function createConversation(product: { readonly host: object }, viewState: object = viewStateOf(product)): ConversationPort {
  const host = product.host as Host;
  // The domain's record of the controller is checked against the controller's declaration here.
  const port: ConversationPort = createConversationController(host.chat, {
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
  return port;
}
