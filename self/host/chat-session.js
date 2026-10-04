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
import { comparisonInput, comparisonSources, comparisonExport, COMPARISON_CHECK } from './document-comparison.js';
import chatPolicy from '../vendor/reploid/chat/policy.json' with { type: 'json' };
import { readonlyView } from './readonly-view.js';
import profile from '../config/work-profile.json' with { type: 'json' };
import { LOCAL_DOPPLER_MODELS } from '../config/doppler-local-models.js';

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
  participantId = 'local-user',
  meshId = 'reploid-local-mesh',
  models = CANONICAL_CHAT_MODELS,
  now = Date.now,
  id = () => crypto.randomUUID()
} = {}) {
  const store = {
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
  const drafts = createChatDrafts({ storage, key: `${STORAGE_KEY}:drafts`, maxThreads: chatPolicy.maxThreads,
    maxCharacters: chatPolicy.maxMessageCharacters, maxFiles: profile.files.maxInputs,
    maxFileBytes: profile.files.maxFileBytes, maxInputBytes: profile.files.maxInputBytes });
  const comparisons = new Map();
  const listeners = new Set();
  let closed = false, closing = null;
  const assertOpen = () => assert(!closed, 'Chat session is closed');

  let peerModels = [];
  let discovering = false;

  const execution = createChatExecution({ service, swarm, partitions, scheduler, models,
    getModels: () => [...models, ...peerModels, ...(partitions?.getModels() || [])], profile });

  const workspace = createChatWorkspace({
    meshId,
    participantId,
    store,
    execute: execution.execute,
    now,
    id
  });

  const getCatalogModels = () => copy(projectChatCatalog({
    models: [...models, ...peerModels], peers: swarm?.getState?.().consumer?.peers || [],
    partitionModels: partitions?.getModels() || []
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
    getDraft: drafts.get,
    saveDraft: drafts.save,
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
    createThread({ model = getSessionState().defaultModel, purpose = '', sharingScope = 'mesh' } = {}) {
      assertOpen();
      assert(model, 'Model required to create thread');
      return workspace.createThread({
        model,
        purpose,
        permissions: { sharingScope }
      });
    },
    select(threadId) {
      assertOpen();
      workspace.select(threadId);
    },
    send(threadId, content, attachments = []) {
      assertOpen();
      assert(threadId, 'threadId required');
      assert(Array.isArray(attachments) && attachments.length <= profile.files.maxInputs, 'Too many attachments');
      let total = 0;
      const appended = attachments.map(file => {
        assert(typeof file.name === 'string' && typeof file.text === 'string', 'Invalid text attachment');
        const bytes = new TextEncoder().encode(file.text).byteLength;
        total += bytes;
        assert(bytes <= profile.files.maxFileBytes, 'Attachment exceeds the file allowance');
        return '\n\nAttached file: ' + file.name + '\n' + file.text;
      }).join('');
      assert(total <= profile.files.maxInputBytes, 'Attachments exceed the input allowance');
      return workspace.send(threadId, content + appended);
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
    retry(threadId, attemptId) {
      assertOpen();
      return workspace.retry(threadId, attemptId);
    },
    approve(threadId, attemptId, previewId, accepted, options) {
      assertOpen();
      workspace.approve(threadId, attemptId, previewId, accepted, options);
    },
    revokeGrant(threadId, grantId) { assertOpen(); workspace.revokeGrant(threadId, grantId); },
    closeThread(threadId) {
      assertOpen();
      comparisons.get(threadId)?.controller.abort();
      workspace.closeThread(threadId);
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
    async setFileSharing(enabled, selectionId, approved) {
      assertOpen();
      assert(swarm?.shareFiles, 'File contribution is unavailable');
      try {
        if (!enabled) { swarm.stopFiles(); return; }
        assert(approved === true, 'Approve file distribution separately from compute');
        const model = getCatalogModels().find(item => (item.selectionId || item.id) === selectionId);
        assert(model, 'Select a catalog model before distributing files');
        await swarm.shareFiles(model, true);
      } finally { notifyAll(); }
    },
    close() {
      if (closing) return closing;
      closed = true;
      for (const operation of comparisons.values()) operation.controller.abort();
      discovering = false;
      closing = Promise.resolve().then(async () => {
        try { await workspace.close(); }
        finally {
          try { await execution.close(); }
          finally { unsubscribeWorkspace(); unsubscribePartitions?.(); listeners.clear(); }
        }
      });
      return closing;
    }
  });
}
