import { createContext, useContext, useSyncExternalStore } from 'react';
import type { ChatServices } from '../domain/services';
import type { HostChatState } from '../domain/session';

/** Supplied once at the composition root; tests supply their own. */
export const ChatServicesContext = createContext<ChatServices | null>(null);

export function useChatServices(): ChatServices {
  const services = useContext(ChatServicesContext);
  if (!services) throw new Error('useChatServices requires a ChatServicesContext provider');
  return services;
}

/** The host's conversation state, re-read on each host notification. */
export function useChatState(): HostChatState {
  const { chat } = useChatServices();
  return useSyncExternalStore(chat.subscribe, chat.getState);
}
