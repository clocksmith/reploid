// An in-memory chat session for the design page and tests: synthetic models and answers, no
// network, no model. It implements the same port the host adapter does.
import type { AnswerDecisions, SheetSide } from '../features/chat/domain/decisions';
import type { ChatServices } from '../features/chat/domain/services';
import type { ChatPort, Draft, ExecutionLocation, HostChatState, HostModel, HostThread } from '../features/chat/domain/session';

const catalog: ReadonlyArray<HostModel> = [
  { id: 'qwen-2b', identity: 'sha256:demo-qwen-2b', name: 'Qwen 3.5 2B', localCached: true, availability: 'cached', networkAvailability: 'ready', providerIds: ['peer-a'], reachableProviderIds: ['peer-a'] },
  { id: 'gemma-27b', identity: 'sha256:demo-gemma-27b', name: 'Gemma 27B', availability: 'ready', networkAvailability: 'ready', providerIds: ['peer-b'], reachableProviderIds: ['peer-b'] },
  { id: 'qwen-0-8b', name: 'Qwen 3.5 0.8B', availability: 'unavailable', networkAvailability: 'unavailable' },
];

const usable = (model: HostModel | null | undefined, location: ExecutionLocation) =>
  !!model && (location === 'local' ? !!(model.localReady || model.localCached) : model.networkAvailability === 'ready');

export const demoDecisions: AnswerDecisions = {
  canDownload: true,
  executionState: (model, location) => ({ usable: usable(model, location), source: location === 'local' ? 'local' : 'network', status: usable(model, location) ? 'ready' : 'unavailable' }),
  describeAnswerChoice: (model, side, { sending }) => {
    const label = side === 'local' ? `${sending ? 'Send' : 'Answer'} on this device` : sending ? 'Send to contributors' : 'Answer with contributors';
    if (!model) return { issue: 'No model is available right now.', action: null, label };
    if (usable(model, side)) return { issue: null, action: 'commit', label };
    if (side === 'local' && usable(model, 'network')) return { issue: 'This model runs on contributors’ computers, not this device. The answering computer reads your messages.', action: 'use-contributors', label: 'Use contributors' };
    if (side === 'network' && usable(model, 'local')) return { issue: 'No contributor serves this model now. It is on this device.', action: 'use-device', label: 'Use this device' };
    if (side === 'local' && model.id === 'qwen-0-8b' && !model.localCached) return { issue: 'Not on this device yet. You see its size before it downloads.', action: 'download', label: `Download ${model.name}` };
    return { issue: 'No shared computer can answer with this model right now. Choose a model marked Ready.', action: null, label };
  },
  locationForModel: (model, side): SheetSide => (usable(model, side) ? side : usable(model, 'network') ? 'network' : usable(model, 'local') ? 'local' : side),
  modelForLocation: (list, model, side) => (usable(model, side) ? model : (list ?? []).find((item) => usable(item, side)) ?? model),
  contributorBlock: () => null,
  canDownloadHere: (model) => !model.localCached && !model.localReady && model.id === 'qwen-0-8b',
  modelLabel: (model) => model.name ?? model.id,
  answerPrivacy: (attempt) =>
    attempt?.execution?.placement === 'local' ? (['Readable by This device', 'Readable by This device. Checked here: nothing'] as const) : (['Readable by Contributor A', 'Readable by Contributor A. Not checked: recipient conduct'] as const),
  failureLabel: () => 'This answer could not finish.',
  destinationPolicy: (destination) => (destination === 'device' ? { placement: 'local-only', recipients: { kind: 'none', ids: [] } } : { placement: 'network-allowed', recipients: { kind: 'open', ids: [] } }),
  localPolicy: () => ({ placement: 'local-only', recipients: { kind: 'none', ids: [] } }),
};

/**
 * A fresh in-memory session; `answerDelayMs` paces the synthetic answer. With `searching`, discovery
 * is still running and no contributor serves a model until `controls.contributorsArrive()`.
 */
export function createDemoChat({ answerDelayMs = 600, searching = false } = {}): ChatServices & { readonly controls: { readonly contributorsArrive: () => void } } {
  let threads: HostThread[] = [];
  let selectedId: string | null = null;
  let running: string[] = [];
  let counter = 0;
  const drafts = new Map<string | null, Draft>();
  let discoveryPhase = searching ? 'searching' : 'observed';
  const models = catalog.map((model) => (searching ? { ...model, networkAvailability: 'unavailable', reachableProviderIds: [] } : { ...model }));
  const listeners = new Set<(state: HostChatState) => void>();
  let state: HostChatState;
  const publish = () => {
    state = {
      threads,
      selectedId,
      activeThread: threads.find((thread) => thread.id === selectedId) ?? null,
      models,
      defaultModel: models[0] ?? null,
      runningIds: running,
      discoveryPhase,
    };
    for (const listener of listeners) listener(state);
  };
  publish();
  const update = (id: string, change: (thread: HostThread) => HostThread) => {
    threads = threads.map((thread) => (thread.id === id ? change(thread) : thread));
    publish();
  };
  const chat: ChatPort = {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    select: (threadId) => {
      selectedId = threadId;
      publish();
    },
    createThread: ({ model, executionLocation, privacy }) => {
      const id = `thread-${++counter}`;
      threads = [...threads, { id, model, messages: [], attempts: [], createdAt: Date.now(), permissions: { executionLocation }, privacy }];
      selectedId = id;
      publish();
      return id;
    },
    send: (threadId, content) => {
      const attemptId = `attempt-${++counter}`;
      const local = state.threads.find((thread) => thread.id === threadId)?.permissions?.executionLocation === 'local';
      running = [...running, threadId];
      update(threadId, (thread) => ({
        ...thread,
        messages: [...thread.messages, { id: `m-${counter}-u`, role: 'user', content }, { id: `m-${counter}-a`, role: 'assistant', content: '', attemptId }],
        attempts: [...thread.attempts, { id: attemptId, status: 'executing', createdAt: Date.now() }],
      }));
      return new Promise((resolve) => {
        setTimeout(() => {
          running = running.filter((id) => id !== threadId);
          update(threadId, (thread) => ({
            ...thread,
            messages: thread.messages.map((message) => (message.attemptId === attemptId ? { ...message, content: `A synthetic answer to: ${content}` } : message)),
            attempts: thread.attempts.map((attempt) =>
              attempt.id === attemptId
                ? { ...attempt, status: 'completed', finishedAt: Date.now(), execution: { placement: local ? 'local' : 'peer-whole-request', timing: { totalMs: answerDelayMs, generatedTokenCount: 12 } } }
                : attempt,
            ),
          }));
          resolve(undefined);
        }, answerDelayMs);
      });
    },
    cancel: (threadId) => {
      running = running.filter((id) => id !== threadId);
      publish();
    },
    setExecutionLocation: (threadId, location) => update(threadId, (thread) => ({ ...thread, permissions: { ...thread.permissions, executionLocation: location } })),
    setExecutionPrivacy: (threadId, privacy) => update(threadId, (thread) => ({ ...thread, privacy })),
    getDraft: (threadId) => drafts.get(threadId) ?? null,
    saveDraft: (threadId, value) => {
      if (value) drafts.set(threadId, value);
      else drafts.delete(threadId);
    },
    archiveThread: (threadId) => update(threadId, (thread) => ({ ...thread, closed: true })),
    getModelDownload: async () => ({ sizeBytes: 640000000 }),
    downloadLocalModel: async (modelId) => {
      const index = models.findIndex((model) => model.id === modelId);
      const model = models[index];
      if (model) models[index] = { ...model, localCached: true, availability: 'cached' };
      publish();
    },
    cancelModelDownload: () => undefined,
  };
  const contributorsArrive = () => {
    discoveryPhase = 'observed';
    models.forEach((model, index) => {
      const original = catalog[index];
      if (original) models[index] = { ...model, networkAvailability: original.networkAvailability, reachableProviderIds: original.reachableProviderIds };
    });
    publish();
  };
  return { chat, decisions: demoDecisions, controls: { contributorsArrive } };
}
