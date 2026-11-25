import { createContext, useContext, useSyncExternalStore } from 'react';
import type { ConversationPort, ConversationSnapshot } from '../domain/conversation';

/** Supplied once at the composition root; the design page and tests supply their own. */
export const ConversationContext = createContext<ConversationPort | null>(null);

export function useConversationPort(): ConversationPort {
  const port = useContext(ConversationContext);
  if (!port) throw new Error('useConversationPort requires a ConversationContext provider');
  return port;
}

/** The conversation snapshot, re-read on each change. */
export function useConversation(): readonly [ConversationSnapshot, ConversationPort] {
  const port = useConversationPort();
  return [useSyncExternalStore(port.subscribe, port.getSnapshot), port];
}
