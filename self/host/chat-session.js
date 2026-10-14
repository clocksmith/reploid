/**
 * @fileoverview Host chat session connecting createChatWorkspace to Doppler WebGPU
 * and Poolday peer execution. Manages multithreaded conversations, persistent scopes,
 * fair device scheduling, and truthful execution placement.
 */
import { createChatWorkspace } from '../vendor/reploid/chat/index.js';
import { createReploidDopplerRuntimeService } from '../infrastructure/doppler-runtime-service.js';
import { createChatExecution } from './chat-execution.js';
import { projectChatCatalog, projectChatPlacements } from './chat-view.js';
import { createChatDrafts } from './chat-drafts.js';
import { createChatContext } from './chat-context.js';
import { attachmentInput, comparisonInput, comparisonSources, comparisonExport, COMPARISON_CHECK } from './document-comparison.js';
import { readonlyView } from './readonly-view.js';
import profile from '../config/work-profile.json' with { type: 'json' };
import { LOCAL_DOPPLER_MODELS } from '../config/doppler-local-models.js';
import { openCanonicalChatHistory } from './chat-history.js';
export { openChatHistory } from './chat-history.js';

const copy = value => structuredClone(value);
const assert = (ok, message) => { if (!ok) throw new Error(message); };

const STORAGE_KEY = 'reploid.chat-workspace:v1';

// Requesters and contributors use one artifact catalog.
export const CANONICAL_CHAT_MODELS = LOCAL_DOPPLER_MODELS;

export function createChatSession({
  storage = globalThis.localStorage,
  service = createReploidDopplerRuntimeService(),
  peers = null,
  swarm = null,
  partitions = null,
  scheduler = null,
  canonicalHistory = null,
  bindPublicationAuthorization = null,
  // History owner. Ordered disclosure binds requesterIdentity, the host's authenticated swarm peer;
  // omitted, the workspace uses participantId, so this placeholder can never verify one.
  participantId = 'local-user',
  requesterIdentity,
  meshId = 'reploid-local-mesh',
  models = CANONICAL_CHAT_MODELS,
  now = Date.now,
  id = () => crypto.randomUUID()
} = {}) {
  const store = canonicalHistory || {
    load() {
      try {
        const raw = storage?.getItem ? storage.getItem(STORAGE_KEY) : null;
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    save(data) {
      if (storage?.setItem) {
        storage.setItem(STORAGE_KEY, JSON.stringify(data));
      }
    }
  };

  // Catalog identity is resolved once; discovery snapshots cannot mutate it.
  models = copy(models);
  const comparisons = new Map();
  const listeners = new Set();
  let closed = false, closing = null;
  const assertOpen = () => assert(!closed, 'Chat session is closed');

  let peerModels = [];
  let discovering = false;

  const execution = createChatExecution({ service, swarm, partitions, scheduler, models,
    getModels: () => [...models, ...peerModels, ...(partitions?.getModels() || [])], profile, onChange: () => notifyAll() });

  const workspace = createChatWorkspace({
    meshId,
    participantId,
    requesterIdentity,
    store,
    execute: execution.execute,
    now,
    id
  });
  bindPublicationAuthorization?.(workspace.authorizePublication);
  const allowances = workspace.getState().limits;
  const drafts = createChatDrafts({ storage: canonicalHistory ? { getItem: () => canonicalHistory.drafts } : storage,
    persist: canonicalHistory ? raw => canonicalHistory.saveDrafts(raw) : null, key: `${STORAGE_KEY}:drafts`, maxThreads: allowances.maxThreads,
    maxCharacters: allowances.maxMessageCharacters, maxFiles: profile.files.maxInputs,
    maxFileBytes: profile.files.maxFileBytes, maxInputBytes: profile.files.maxInputBytes });

  const getCatalogModels = () => copy(projectChatCatalog({
    models: [...models, ...peerModels], peers: swarm?.getState?.().consumer?.peers || [],
    partitionModels: partitions?.getModels() || []
  }).map(model => {
    const local = execution.getLocalState();
    return local?.ready && local.modelIdentity === model.identity && !(model.adapters?.length)
      ? { ...model, availability: 'ready', localReady: true } : model;
  }));

  const notifyAll = () => {
    if (closed) return;
    const st = getSessionState();
    for (const listener of listeners) {
      try { listener(st); } catch (e) { console.error('[ChatSession] listener error', e); }
    }
  };

  const getSessionState = () => {
    const wsState = workspace.getState();
    // Only active execution metadata is ephemeral. Text and terminal states
    // remain the committed workspace projection supplied above.
    for (const view of wsState.ephemeralExecutions || []) {
      const attempt = wsState.threads.find(thread => thread.id === view.threadId)?.attempts.find(item => item.id === view.attemptId);
      if (attempt) Object.assign(attempt, { persistedStatus: attempt.status, ephemeral: true,
        status: view.status, approval: view.approval, execution: view.execution });
    }
    const activeThread = wsState.threads.find(t => t.id === wsState.selectedId) || null;
    const catalog = getCatalogModels();
    const preferred = candidates => candidates.find(model => model.id === profile.defaultModelId) || candidates[0];
    return readonlyView({
      ...wsState,
      closed,
      activeThread,
      comparisonPhase: comparisons.get(wsState.selectedId)?.phase || null,
      models: catalog,
      defaultModel: preferred(catalog.filter(model => model.availability === 'ready'))
        || preferred(catalog.filter(model => model.availability === 'busy')) || preferred(catalog) || null,
      discovering,
      localModel: execution.getLocalState(),
      network: copy({ ...(swarm?.getState?.() || { sharing: false, consumer: null }), files: swarm?.getFileState?.() || null }),
      scheduler: execution.getState(),
      placements: projectChatPlacements(wsState.threads)
    });
  };

  // Re-emit workspace updates
  const unsubscribeWorkspace = workspace.subscribe(() => {
    notifyAll();
  });

  const unsubscribePartitions = partitions?.subscribe(notifyAll);

  return Object.freeze({
    getState: getSessionState,
    subscribe(listener) {
      assertOpen();
      listeners.add(listener);
      listener(getSessionState());
      return () => listeners.delete(listener);
    },
    refreshNetwork: notifyAll,
    previewContextPrompt(selection, model = getSessionState().defaultModel) {
      return createChatContext(selection, model, models);
    },
    setContextPrompt(threadId, selection) {
      assertOpen();
      const thread = workspace.getState().threads.find(item => item.id === threadId);
      assert(thread, 'Conversation not found');
      return workspace.setSystemContext(threadId, createChatContext(selection, thread.model, models));
    },
    async prepareLocalModel(modelId) {
      assertOpen();
      const model = models.find(item => item.id === modelId);
      assert(model, 'Choose a catalog model');
      try { await execution.prepareLocal(model); } finally { notifyAll(); }
    },
    async getModelDownload(modelId, { signal } = {}) {
      assertOpen();
      const model = models.find(item => item.id === modelId);
      assert(model?.source, 'Choose a catalog model');
      const file = model.source.files.find(item => item.role === 'model-manifest');
      const response = await fetch(new URL(file.path, model.source.baseUrl), { signal });
      assert(response.ok, 'Could not check the model download');
      const bytes = await response.arrayBuffer();
      assert(bytes.byteLength === file.sizeBytes, 'Model manifest size mismatch');
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
      assert('sha256:' + hash === model.identity, 'Model manifest identity mismatch');
      const manifest = JSON.parse(new TextDecoder().decode(bytes));
      assert(manifest.modelId === model.id && Array.isArray(manifest.shards), 'Model manifest is incomplete');
      const sizeBytes = manifest.shards.reduce((total, shard) => total + shard.size, 0)
        + model.source.files.filter(item => item.role !== 'model-piece-index').reduce((total, item) => total + item.sizeBytes, 0);
      assert(Number.isSafeInteger(sizeBytes) && sizeBytes > 0, 'Model download size is unavailable');
      return { id: model.id, name: model.name, sizeBytes };
    },
    getDraft: drafts.get,
    saveDraft(threadId, value) { assertOpen(); return drafts.save(threadId, value); },
    getDocumentSources: comparisonSources,
    exportConversation(threadId) {
      assertOpen();
      return comparisonExport(workspace.getState().threads.find(thread => thread.id === threadId));
    },
    compareDocuments(threadId, question, files) {
      assertOpen();
      assert(!comparisons.has(threadId), 'This comparison is already running');
      const input = comparisonInput(question, files);
      const controller = new AbortController(), operation = { controller, phase: 'comparing' };
      comparisons.set(threadId, operation);
      return (async () => { try {
        const draft = await workspace.send(threadId, input);
        if (draft.status !== 'completed' || controller.signal.aborted) return draft;
        operation.phase = 'checking'; notifyAll();
        return await workspace.send(threadId, COMPARISON_CHECK, { select: false });
      } finally { comparisons.delete(threadId); notifyAll(); } })();
    },
    createThread({ model = getSessionState().defaultModel, purpose = '', sharingScope = 'mesh', contextPrompt } = {}) {
      assertOpen();
      assert(model, 'Model required to create thread');
      return workspace.createThread({
        model,
        purpose,
        systemContext: createChatContext(contextPrompt, model, models),
        permissions: { sharingScope }
      });
    },
    select(threadId) {
      assertOpen();
      workspace.select(threadId);
    },
    send(threadId, content, attachments = [], { allowPeerExecution = false } = {}) {
      assertOpen();
      assert(typeof allowPeerExecution === 'boolean', 'Invalid peer execution authorization');
      assert(threadId, 'threadId required');
      assert(Array.isArray(attachments) && attachments.length <= profile.files.maxInputs, 'Too many attachments');
      let total = 0;
      attachments.forEach(file => {
        assert(typeof file.name === 'string' && typeof file.text === 'string', 'Invalid text attachment');
        const bytes = new TextEncoder().encode(file.text).byteLength;
        total += bytes;
        assert(bytes <= profile.files.maxFileBytes, 'Attachment exceeds the file allowance');
      });
      assert(total <= profile.files.maxInputBytes, 'Attachments exceed the input allowance');
      return workspace.send(threadId, attachmentInput(content, attachments), {
        authorizeDisclosure: allowPeerExecution ? () => true : null
      });
    },
    cancel(threadId) {
      assertOpen();
      comparisons.get(threadId)?.controller.abort();
      return workspace.cancel(threadId);
    },
    cancelAll() {
      assertOpen();
      for (const operation of comparisons.values()) operation.controller.abort();
      const state = workspace.getState();
      for (const tid of state.runningIds) {
        workspace.cancel(tid);
      }
    },
    retry(threadId, attemptId, { allowPeerExecution = false } = {}) {
      assertOpen();
      assert(typeof allowPeerExecution === 'boolean', 'Invalid peer execution authorization');
      return workspace.retry(threadId, attemptId, { authorizeDisclosure: allowPeerExecution ? () => true : null });
    },
    approve(threadId, attemptId, previewId, accepted, options) {
      assertOpen();
      return workspace.approve(threadId, attemptId, previewId, accepted, options);
    },
    revokeGrant(threadId, grantId) { assertOpen(); return workspace.revokeGrant(threadId, grantId); },
    renameThread(threadId, title) { assertOpen(); return workspace.renameThread(threadId, title); },
    archiveThread(threadId) { assertOpen(); return workspace.closeThread(threadId); },
    restoreThread(threadId) { assertOpen(); return workspace.reopenThread(threadId); },
    closeThread(threadId) {
      assertOpen();
      comparisons.get(threadId)?.controller.abort();
      const saved = workspace.closeThread(threadId);
      if (canonicalHistory) return Promise.resolve(saved).then(() => drafts.save(threadId, null));
      drafts.save(threadId, null);
    },
    async discoverPeers() {
      assertOpen();
      if (!peers || discovering) return;
      discovering = true;
      notifyAll();
      try {
        const found = await peers.discover();
        if (!closed && Array.isArray(found)) {
          peerModels = copy(found).map(m => ({
            ...m,
            identity: m.identity,
            provider: 'doppler'
          }));
        }
      } catch (e) {
        console.warn('[ChatSession] Peer discovery failed', e);
      } finally {
        discovering = false;
        notifyAll();
      }
    },
    async connect() {
      assertOpen();
      assert(swarm?.connect, 'Peer connection is unavailable');
      try { await swarm.connect(); } finally { notifyAll(); }
    },
    async disconnect() {
      assertOpen();
      assert(swarm?.disconnect, 'Peer disconnection is unavailable');
      try { await swarm.disconnect(); } finally { notifyAll(); }
    },
    setIntroductionAssistance(enabled) {
      if (!swarm) throw new Error('Network unavailable');
      swarm.allowIntroductions(enabled);
    },
    async setSharing(enabled, selectionId, approved) {
      assertOpen();
      assert(swarm, 'Contribution is unavailable');
      try {
        if (enabled) {
          assert(approved === true, 'Approve public prompt execution before sharing');
          const model = getCatalogModels().find(item => (item.selectionId || item.id) === selectionId);
          assert(model, 'Select a catalog model before contributing');
          await swarm.share(model.id, true, model.adapters || []);
        } else await swarm.stop();
      } finally { notifyAll(); }
    },
    async setFileSharing(enabled, selectionId, approved, controls) {
      assertOpen();
      assert(swarm?.shareFiles, 'File contribution is unavailable');
      try {
        if (!enabled) { await swarm.stopFiles(); return; }
        assert(approved === true, 'Approve file distribution separately from compute');
        const model = getCatalogModels().find(item => (item.selectionId || item.id) === selectionId);
        assert(model, 'Select a catalog model before distributing files');
        await swarm.shareFiles(model, true, controls);
      } finally { notifyAll(); }
    },
    close() {
      if (closing) return closing;
      closed = true;
      for (const operation of comparisons.values()) operation.controller.abort();
      discovering = false;
      closing = Promise.resolve().then(async () => {
        const failures = [];
        for (const owner of [workspace, execution, drafts, canonicalHistory]) {
          try { await owner?.close(); } catch (error) { failures.push(error); }
        }
        unsubscribeWorkspace(); unsubscribePartitions?.(); listeners.clear();
        if (failures.length) throw new AggregateError(failures, 'Chat session cleanup failed');
      });
      return closing;
    }
  });
}

/** Opt-in async composition. Opening history never dispatches a request. */
export async function openCanonicalChatSession({ canonical, ...options }) {
  assert(canonical && options.meshId && options.participantId, 'Canonical session requires explicit persistent identity');
  const storage = options.storage ?? globalThis.localStorage;
  let authorizeExecution = () => false;
  const history = await openCanonicalChatHistory({ ...canonical, meshId: options.meshId, participantId: options.participantId,
    legacy: { workspace: storage?.getItem?.(STORAGE_KEY) ?? null, drafts: storage?.getItem?.(`${STORAGE_KEY}:drafts`) ?? null },
    authorizeExecution: scope => authorizeExecution(scope) });
  try {
    return createChatSession({ ...options, storage, canonicalHistory: history,
      bindPublicationAuthorization: authorize => { authorizeExecution = authorize; } });
  } catch (error) { await history.close(); throw error; }
}
