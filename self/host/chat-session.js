/**
 * @fileoverview Host chat session connecting createChatWorkspace to Doppler WebGPU
 * and Poolday peer execution. Manages multithreaded conversations, persistent scopes,
 * fair device scheduling, and truthful execution placement.
 */
import { createChatWorkspace, createChatScheduler } from '../vendor/reploid/chat/index.js';
import { createReploidDopplerRuntimeService } from '../infrastructure/doppler-runtime-service.js';
import { createWorkResidentProvider } from '../providers/work-resident-provider.js';
import { createWorkNetworkProvider } from '../providers/work-network-provider.js';
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

  const listeners = new Set();

  let peerModels = [];
  let discovering = false;

  // Track active execution placements and latencies per thread
  const threadPlacements = new Map();

  const sessionScheduler = scheduler || createChatScheduler({
    open: async reqModel => {
      const resident = createWorkResidentProvider({ service, model: reqModel,
        generation: profile.generation, maxOutcomeCharacters: profile.maxOutcomeCharacters });
      await resident.prepare();
      return {
        run: (req, { signal: runSignal, onDelta }) => resident.generate(req.messages, onDelta, { signal: runSignal }),
        reset: async () => assert(resident.getState().ready, 'Resident session requires replacement'),
        setAdapters: async adapters => assert(!adapters.length, 'This execution path cannot apply adapters'),
        close: resident.close
      };
    },
    observe: () => {}
  });

  // Reuse the existing network provider. No simulated production responses.
  const execute = async (request, controls) => {
    const { threadId, attemptId, model } = request;
    assert(model.provider === 'doppler', 'Chat requires a Doppler participant');
    const catalogModel = getCatalogModels().find(m => m.id === model.id);
    const allowedAdapters = catalogModel?.adapters || [];
    for (const adapter of model.adapters || []) {
      const verified = allowedAdapters.some(a => a.identity === adapter.identity);
      assert(verified, 'This execution path cannot apply the selected adapter');
    }
    let sequence = 0;
    const state = (status, execution) => controls.onState({ threadId, attemptId, status, execution });

    if (request.permissions?.sharingScope === 'local') {
      const maxOutputTokens = Math.min(
        request.maxOutputTokens || profile.generation?.maxTokens || 1024,
        4096
      );
      state('queued', { provider: 'doppler', placement: 'local-webgpu' });
      const result = await sessionScheduler.schedule({
        ...request,
        maxOutputTokens
      }, {
        signal: controls.signal,
        onDelta: text => controls.onDelta({ threadId, attemptId, sequence: sequence++, text }),
        onState: status => state(status, { provider: 'doppler', placement: 'local-webgpu' })
      });
      const execution = { provider: 'doppler', placement: 'local-webgpu', modelId: result.model,
        modelIdentity: result.modelIdentity, adapterIdentities: result.adapterIdentities };
      threadPlacements.set(threadId, execution);
      return {
        threadId,
        attemptId,
        modelId: result.model,
        modelIdentity: result.modelIdentity,
        adapterIdentities: result.adapterIdentities,
        content: result.content,
        execution
      };
    }

    assert(swarm?.generate, 'No connected participant can execute this model');
    const provider = createWorkNetworkProvider({
      model, service, scope: 'chat:' + attemptId, signal: controls.signal,
      swarm: request.permissions?.sharingScope === 'local' ? null : swarm,
      generation: profile.generation, maxOutcomeCharacters: profile.maxOutcomeCharacters,
      controls: {
        async approve(preview) {
          return controls.requestApproval({ ...preview, peerId: preview.providerId, threadId, attemptId });
        },
        async record(record) {
          if (record.stage === 'approved') state('executing', {
            provider: 'peer', placement: 'peer-whole-request', peerId: record.preview.providerId
          });
        }
      },
      onProgress(progress) {
        // The network provider emits text; Doppler's loader emits progress records.
        const loading = progress !== null && typeof progress === 'object';
        const local = loading || (typeof progress === 'string' && /executing on this device/i.test(progress));
        state(local ? 'loading' : 'queued', local ? { provider: 'doppler', placement: 'local-webgpu' } : null);
      }
    });
    state('queued', null);
    const result = await provider.generate(request.messages, text => {
      controls.onDelta({ threadId, attemptId, sequence: sequence++, text });
    }, { signal: controls.signal });
    const execution = result.peerId
      ? { provider: 'peer', placement: 'peer-whole-request', peerId: result.peerId }
      : { provider: 'doppler', placement: 'local-webgpu' };
    Object.assign(execution, { modelId: result.model, modelIdentity: result.modelIdentity, adapterIdentities: result.adapterIdentities });
    threadPlacements.set(threadId, execution);
    return { threadId, attemptId, modelId: result.model, modelIdentity: result.modelIdentity,
      adapterIdentities: result.adapterIdentities, content: result.content, execution };
  };

  const workspace = createChatWorkspace({
    meshId,
    participantId,
    store,
    execute,
    now,
    id
  });

  const getCatalogModels = () => {
    const peers = swarm?.getState?.().consumer?.peers || [];
    return copy([...models, ...peerModels].map(model => {
      const compatible = peers.filter(peer => peer.model === model.id && peer.modelIdentity === model.identity);
      const ready = compatible.filter(peer => peer.readiness === 'ready' && peer.hasInference);
      const loading = peers.some(peer => peer.model === model.id && peer.readiness === 'loading');
      return { ...model, availability: ready.length ? (ready.some(peer => peer.availableSlots > 0) ? 'ready' : 'busy')
        : loading ? 'loading' : 'unavailable', providerIds: ready.map(peer => peer.peerId) };
    }));
  };

  const notifyAll = () => {
    const st = getSessionState();
    for (const listener of listeners) {
      try { listener(st); } catch (e) { console.error('[ChatSession] listener error', e); }
    }
  };

  const getSessionState = () => {
    const wsState = workspace.getState();
    const activeThread = wsState.threads.find(t => t.id === wsState.selectedId) || null;
    return {
      ...wsState,
      activeThread,
      models: getCatalogModels(),
      defaultModel: getCatalogModels().find(model => model.id === profile.defaultModelId) || getCatalogModels()[0] || null,
      discovering,
      network: copy(swarm?.getState?.() || { sharing: false, consumer: null }),
      scheduler: sessionScheduler?.getState() || null,
      placements: Object.fromEntries(threadPlacements.entries())
    };
  };

  // Re-emit workspace updates
  workspace.subscribe(() => {
    notifyAll();
  });

  return Object.freeze({
    getState: getSessionState,
    subscribe(listener) {
      listeners.add(listener);
      listener(getSessionState());
      return () => listeners.delete(listener);
    },
    refreshNetwork: notifyAll,
    createThread({ model = getSessionState().defaultModel, purpose = '', sharingScope = 'invited-mesh' } = {}) {
      assert(model, 'Model required to create thread');
      const threadId = workspace.createThread({
        model,
        purpose,
        permissions: { sharingScope }
      });
      notifyAll();
      return threadId;
    },
    select(threadId) {
      workspace.select(threadId);
      notifyAll();
    },
    send(threadId, content, attachments = []) {
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
      const res = workspace.send(threadId, content + appended);
      notifyAll();
      return res;
    },
    cancel(threadId) {
      const res = workspace.cancel(threadId);
      notifyAll();
      return res;
    },
    cancelAll() {
      const state = workspace.getState();
      for (const tid of state.runningIds) {
        try { workspace.cancel(tid); } catch {}
      }
      notifyAll();
    },
    retry(threadId, attemptId) {
      const res = workspace.retry(threadId, attemptId);
      notifyAll();
      return res;
    },
    approve(threadId, attemptId, previewId, accepted, options) {
      workspace.approve(threadId, attemptId, previewId, accepted, options);
      notifyAll();
    },
    revokeGrant(threadId, grantId) { workspace.revokeGrant(threadId, grantId); },
    closeThread(threadId) {
      workspace.closeThread(threadId);
      notifyAll();
    },
    async discoverPeers() {
      if (!peers || discovering) return;
      discovering = true;
      notifyAll();
      try {
        const found = await peers.discover();
        if (Array.isArray(found)) {
          peerModels = found.map(m => ({
            ...m,
            identity: m.identity,
            provider: 'peer'
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
      assert(swarm?.connect, 'Peer connection is unavailable');
      try { await swarm.connect(); } finally { notifyAll(); }
    },
    async disconnect() {
      assert(swarm?.disconnect, 'Peer disconnection is unavailable');
      try { await swarm.disconnect(); } finally { notifyAll(); }
    },
    async setSharing(enabled, modelId, approved) {
      assert(swarm, 'Contribution is unavailable');
      try {
        if (enabled) {
          assert(approved === true, 'Approve public prompt execution before sharing');
          await swarm.share(modelId, true);
        } else await swarm.stop();
      } finally { notifyAll(); }
    },
    async close() {
      await workspace.close();
      if (sessionScheduler) await sessionScheduler.close();
      listeners.clear();
    },
    scheduler: sessionScheduler
  });
}
