// Adapts the host's chat session to Conversation details. The projections are
// apps/poolday/host/decisions/conversation-details.js, shared with the vanilla inspector's wording; the session
// records, revokes and exports, and the paired host's ledger issues receipts.
import * as projections from '../../../../../poolday/host/decisions/conversation-details.js';
import type { ContextSelection, ContextView, DetailsServices, DetailsView } from '../domain/services';

type Attempt = { readonly id: string; readonly error?: string };
type Thread = { readonly id: string; readonly model?: unknown; readonly attempts?: ReadonlyArray<Attempt>;
  readonly systemContext?: { readonly content: string; readonly metadata: { enabled: boolean; maxWords: number; wordCount: number } } };
type State = { readonly selectedId?: string | null; readonly activeThread?: Thread | null; readonly defaultModel?: unknown };
type Context = { readonly content: string; readonly metadata: { readonly enabled: boolean; readonly maxWords: number; readonly wordCount: number } };
type Session = {
  readonly getState: () => State;
  readonly subscribe: (listener: (state: State) => void) => () => void;
  readonly previewContextPrompt?: (selection: Partial<ContextSelection>, model?: unknown) => Context;
  readonly setContextPrompt?: (threadId: string, selection: ContextSelection) => unknown;
  readonly revokeGrant?: (threadId: string, grantId: string) => unknown;
  readonly exportConversation?: (threadId: string) => string;
  readonly privateComputers?: { readonly receipt?: (id: string) => Promise<unknown> } | null;
};

const { projectConversationDetails, ledgerOutcomeText, CONTEXT_WORD_LIMITS } = projections as unknown as {
  readonly CONTEXT_WORD_LIMITS: ReadonlyArray<number>;
  readonly projectConversationDetails: (state: State, options: { labels: unknown; inspected: { threadId: string | null; attemptId: string } | null }) => DetailsView;
  readonly ledgerOutcomeText: (receipt: unknown, prefix: string) => string;
};

function saveFile(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const asView = (context: Context): ContextView => ({ enabled: context.metadata.enabled, maxWords: context.metadata.maxWords, wordCount: context.metadata.wordCount, content: context.content });

export function createDetailsServices(product: { readonly host: object }): DetailsServices {
  const session = (product.host as { readonly chat: Session }).chat;
  // One snapshot per notification: the host builds a new state on every getState call.
  let state: State = session.getState();
  const listeners = new Set<() => void>();
  let detach: (() => void) | null = null;
  // Every notification is a change, even when a host (or a fixture) delivers the same state object again.
  let revision = 0;
  const cache = new Map<string | null, { revision: number; view: DetailsView }>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      if (!detach) {
        detach = session.subscribe((next) => {
          state = next;
          revision += 1;
          for (const each of listeners) each();
        });
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size && detach) {
          detach();
          detach = null;
        }
      };
    },
    project(attemptId) {
      const cached = cache.get(attemptId);
      if (cached?.revision === revision) return cached.view;
      const view = projectConversationDetails(state, { labels: session, inspected: attemptId ? { threadId: state.selectedId ?? null, attemptId } : null });
      cache.clear();
      cache.set(attemptId, { revision, view });
      return view;
    },
    wordLimits: CONTEXT_WORD_LIMITS,
    context(draft) {
      if (!session.previewContextPrompt) return null;
      const thread = state.activeThread;
      if (thread?.systemContext) return asView(thread.systemContext);
      return asView(session.previewContextPrompt(thread ? {} : draft ?? {}, thread?.model ?? state.defaultModel));
    },
    setContext: async (threadId, selection) => session.setContextPrompt?.(threadId, selection),
    revokeGrant: async (threadId, grantId) => session.revokeGrant?.(threadId, grantId),
    copyError: async (attemptId) => {
      const error = state.activeThread?.attempts?.find((attempt) => attempt.id === attemptId)?.error || '';
      await navigator.clipboard.writeText(error);
    },
    saveReceipt: async (requestId) => {
      const receipt = await session.privateComputers?.receipt?.(requestId);
      saveFile(JSON.stringify(receipt, null, 2), 'reploid-service-receipt.json', 'application/json');
      return ledgerOutcomeText(receipt, 'Saved');
    },
    ledgerNow: async (requestId) => {
      if (!session.privateComputers?.receipt) return null;
      try {
        return ledgerOutcomeText(await session.privateComputers.receipt(requestId), 'Ledger now');
      } catch {
        return null;
      }
    },
    downloadConversation(threadId) {
      const text = session.exportConversation?.(threadId);
      if (typeof text === 'string') saveFile(text, 'reploid-conversation.md', 'text/markdown;charset=utf-8');
    },
  };
}
