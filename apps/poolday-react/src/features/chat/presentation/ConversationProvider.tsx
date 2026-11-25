import { useEffect, useState, type ReactNode } from 'react';
import type { ConversationPort } from '../domain/conversation';
import { ConversationContext } from './conversationContext';

/**
 * Gives the conversation screens their controller for as long as the workspace is mounted: it is
 * created when the workspace mounts and disposed (saving the draft) when it goes away.
 */
export function ConversationProvider({ create, children }: { readonly create: () => ConversationPort; readonly children: ReactNode }) {
  const [port, setPort] = useState<ConversationPort | null>(null);
  useEffect(() => {
    const opened = create();
    setPort(opened);
    return () => opened.dispose();
  }, [create]);
  return port ? <ConversationContext.Provider value={port}>{children}</ConversationContext.Provider> : null;
}
