// An in-memory chat session for the design page and the screen tests: synthetic models and answers, no network
// and no model. It has the shape of the host's session (apps/poolday/host/chat-session.js) that the conversation
// controller, Conversation details and Settings read, so the shipped screens run on it unchanged.

type Model = Record<string, unknown> & { readonly id: string; readonly name: string };
type Attempt = Record<string, unknown> & { readonly id: string; status: string };
type Message = { readonly id: string; readonly role: 'user' | 'assistant'; content: string; readonly attemptId?: string };
type Thread = {
  readonly id: string;
  title?: string;
  closed?: boolean;
  readonly createdAt: number;
  readonly model: Model;
  messages: Message[];
  attempts: Attempt[];
  permissions: { sharingScope: string; executionLocation: string };
  privacy: unknown;
};
type Draft = { readonly text: string; readonly files: ReadonlyArray<unknown> };

const source = (id: string) => ({ baseUrl: `https://models.example/${id}/`, files: [{ path: 'manifest.json', role: 'model-manifest', sizeBytes: 1000 }] });
const CATALOG: ReadonlyArray<Model> = [
  { id: 'qwen-2b', selectionId: 'qwen-2b', identity: 'sha256:demo-qwen-2b', name: 'Qwen 3.5 2B', quantization: 'q4k', contextLength: 32768, source: source('qwen-2b'),
    localCached: true, availability: 'cached', networkAvailability: 'ready', providerIds: ['peer-a'], reachableProviderIds: ['peer-a'] },
  { id: 'gemma-27b', selectionId: 'gemma-27b', identity: 'sha256:demo-gemma-27b', name: 'Gemma 27B', quantization: 'q4k', contextLength: 131072,
    availability: 'ready', networkAvailability: 'ready', providerIds: ['peer-b', 'peer-c'], reachableProviderIds: ['peer-b', 'peer-c'] },
  { id: 'qwen-0-8b', selectionId: 'qwen-0-8b', identity: 'sha256:demo-qwen-0-8b', name: 'Qwen 3.5 0.8B', quantization: 'q4k', contextLength: 32768, source: source('qwen-0-8b'),
    availability: 'unavailable', networkAvailability: 'unavailable', providerIds: [], reachableProviderIds: [] },
];

// The policy a thread sent to contributors stores (shared/vendor/reploid/chat/execution-policy.js, open plaintext).
const OPEN_POLICY = {
  schema: 'reploid.execution-policy/v2', placement: 'network-allowed', recipients: { kind: 'open', ids: [] }, computation: 'plaintext', collusion: 'none',
  leakage: ['model-id', 'timing', 'length', 'access-patterns', 'plaintext'], protocol: null, attestation: null, keyContext: null,
  retention: 'execution-and-recovery', publication: false, reuse: false, allowDowngrade: false,
};

const receipt = (local: boolean) => ({
  schema: 'reploid.execution-receipt/v1',
  route: { shape: local ? 'local' : 'remote', participants: [local ? 'this-device' : 'peer-b'] },
  evidence: { confidentiality: { verified: [] }, integrity: { verified: [] } },
  disclosures: { metadata: local ? [] : ['timing', 'length'] },
});

export type DemoChat = ReturnType<typeof createDemoChat>;

/**
 * A fresh session. `stored: false` leaves nothing on this device. `answerDelayMs` paces each synthetic answer; with `searching`, discovery is still running and
 * no contributor serves a model until `contributorsArrive()`. `threads` seeds that many earlier conversations.
 */
export function createDemoChat({ answerDelayMs = 600, searching = false, stored = true, threads: seeded = 0 }: { readonly answerDelayMs?: number; readonly searching?: boolean; readonly stored?: boolean; readonly threads?: number } = {}) {
  let counter = 0;
  let selectedId: string | null = null;
  let running: string[] = [];
  let discoveryPhase = searching ? 'searching' : 'observed';
  let acquisition: Record<string, unknown> | null = null;
  const drafts = new Map<string | null, Draft>();
  // `stored: false` is a first visit: nothing is on this device yet.
  const models: Model[] = CATALOG.map((model) => ({
    ...model,
    ...(searching ? { networkAvailability: 'unavailable', reachableProviderIds: [] } : {}),
    ...(stored ? {} : { localCached: false, availability: model.availability === 'cached' ? 'ready' : model.availability }),
  }));
  let threads: Thread[] = Array.from({ length: seeded }, (_, index) => ({
    id: `seed-${index}`,
    createdAt: Date.now() - (seeded - index) * 3600000,
    model: CATALOG[1] as Model,
    messages: [
      { id: `seed-${index}-u`, role: 'user', content: `Earlier question ${index + 1}` },
      { id: `seed-${index}-a`, role: 'assistant', content: `Earlier answer ${index + 1}.`, attemptId: `seed-${index}-attempt` },
    ],
    attempts: [{ id: `seed-${index}-attempt`, status: 'completed', createdAt: Date.now() - (seeded - index) * 3600000, finishedAt: Date.now() - (seeded - index) * 3600000 + 2000,
      execution: { placement: 'peer-whole-request', peerId: 'peer-b', timing: { totalMs: 2000, generatedTokenCount: 40 }, receipt: receipt(false) } }],
    permissions: { sharingScope: 'mesh', executionLocation: 'network' },
    privacy: OPEN_POLICY,
  }));
  const listeners = new Set<(state: unknown) => void>();
  let renders = 0;
  // A fresh copy of everything per notification, as the host delivers it.
  const snapshot = () => {
    renders++;
    const copy = structuredClone(threads);
    return {
      threads: copy,
      selectedId,
      activeThread: copy.find((thread) => thread.id === selectedId) ?? null,
      models: structuredClone(models),
      defaultModel: models[0] ?? null,
      defaultModels: { local: models[0], network: models[1], auto: models[0] },
      runningIds: [...running],
      discoveryPhase,
      peerDiscoveryTimedOut: discoveryPhase === 'observed',
      localDownloadIssue: null,
      acquisition,
      network: { consumer: { connectionState: 'connected', peers: [] } },
    };
  };
  let state = snapshot();
  const publish = () => {
    state = snapshot();
    for (const listener of listeners) listener(state);
  };
  const update = (id: string, change: (thread: Thread) => void) => {
    const thread = threads.find((item) => item.id === id);
    if (thread) change(thread);
    publish();
  };
  const chat = {
    getState: () => state,
    subscribe(listener: (state: unknown) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    select(threadId: string | null) {
      selectedId = threadId;
      publish();
    },
    createThread({ model, executionLocation, sharingScope, privacy }: { model: Model; executionLocation: string; sharingScope: string; privacy?: unknown }) {
      const id = `thread-${++counter}`;
      threads = [...threads, { id, model: { ...model }, messages: [], attempts: [], createdAt: Date.now(), permissions: { executionLocation, sharingScope }, privacy: privacy ?? null }];
      selectedId = id;
      publish();
      return id;
    },
    send(threadId: string, content: string) {
      const attemptId = `attempt-${++counter}`;
      const thread = threads.find((item) => item.id === threadId);
      const local = thread?.permissions.executionLocation === 'local' || thread?.permissions.sharingScope === 'local';
      running = [...running, threadId];
      update(threadId, (item) => {
        item.messages.push({ id: `m-${counter}-u`, role: 'user', content }, { id: `m-${counter}-a`, role: 'assistant', content: '', attemptId });
        item.attempts.push({ id: attemptId, status: 'executing', createdAt: Date.now() });
      });
      const completion = new Promise<void>((resolve) => {
        setTimeout(() => {
          running = running.filter((id) => id !== threadId);
          update(threadId, (item) => {
            const message = item.messages.find((entry) => entry.attemptId === attemptId);
            if (message) message.content = `A synthetic answer to: ${content}`;
            const attempt = item.attempts.find((entry) => entry.id === attemptId);
            if (attempt) Object.assign(attempt, { status: 'completed', finishedAt: Date.now(),
              execution: { placement: local ? 'local-webgpu' : 'peer-whole-request', ...(local ? {} : { peerId: 'peer-b' }), timing: { totalMs: answerDelayMs || 1, generatedTokenCount: 12 }, receipt: receipt(local) } });
          });
          resolve();
        }, answerDelayMs);
      });
      return Object.assign(completion, { admitted: Promise.resolve() });
    },
    /** Appends text to a running answer, as a stream delivers it. */
    stream(threadId: string, text: string) {
      update(threadId, (item) => {
        const last = item.messages.at(-1);
        if (last?.role === 'assistant') last.content += text;
      });
    },
    cancel(threadId: string | null) {
      running = running.filter((id) => id !== threadId);
      publish();
    },
    cancelAll: () => undefined,
    setExecutionLocation: (threadId: string, location: string) => update(threadId, (item) => { item.permissions.executionLocation = location; }),
    setExecutionPrivacy: (threadId: string, privacy: unknown) => update(threadId, (item) => { item.privacy = privacy; }),
    getDraft: (threadId: string | null) => drafts.get(threadId) ?? null,
    saveDraft(threadId: string | null, value: Draft | null) {
      if (value) drafts.set(threadId, value);
      else drafts.delete(threadId);
    },
    archiveThread: (threadId: string) => update(threadId, (item) => { item.closed = true; }),
    restoreThread: (threadId: string) => update(threadId, (item) => { item.closed = false; }),
    renameThread: (threadId: string, title: string) => update(threadId, (item) => { item.title = title; }),
    connect: async () => undefined,
    getModelDownload: async (id: string) => ({ id, name: id, sizeBytes: 640000000 }),
    async downloadLocalModel(modelId: string) {
      const index = models.findIndex((model) => model.id === modelId);
      const model = models[index];
      if (model) models[index] = { ...model, localCached: true, availability: 'cached' };
      acquisition = null;
      publish();
    },
    cancelModelDownload: () => undefined,
    exportConversation: (threadId: string) => JSON.stringify(threads.find((thread) => thread.id === threadId) ?? null),
    previewContextPrompt: (selection: { enabled?: boolean; maxWords?: number }) => ({
      content: selection.enabled === false ? '' : 'You are answering in Reploid, a chat on shared computers.',
      metadata: { enabled: selection.enabled !== false, maxWords: selection.maxWords ?? 64, wordCount: selection.enabled === false ? 0 : 10 },
    }),
    setContextPrompt: () => undefined,
  };
  return {
    chat,
    /** How many host states the session has built, so tests can bound the work an update causes. */
    states: () => renders,
    contributorsArrive() {
      discoveryPhase = 'observed';
      models.forEach((model, index) => {
        const original = CATALOG[index];
        if (original) models[index] = { ...model, networkAvailability: original.networkAvailability, reachableProviderIds: original.reachableProviderIds };
      });
      publish();
    },
    downloading(progress: number | null) {
      acquisition = { phase: 'downloading', modelId: 'qwen-0-8b', progress: { message: progress === null ? 'Checking model files.' : `Downloading · ${Math.round(progress * 100)}%`, receivedBytes: progress === null ? null : progress * 640000000, totalBytes: progress === null ? null : 640000000 } };
      publish();
    },
  };
}
