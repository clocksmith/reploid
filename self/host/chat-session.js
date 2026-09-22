/**
 * @fileoverview Host chat session connecting createChatWorkspace to Doppler WebGPU
 * and Poolday peer execution. Manages multithreaded conversations, persistent scopes,
 * fair device scheduling, and truthful execution placement.
 */
import { createChatWorkspace, createChatScheduler } from '../vendor/reploid/chat/index.js';
import { createReploidDopplerRuntimeService } from '../infrastructure/doppler-runtime-service.js';
import { createWorkNetworkProvider } from '../providers/work-network-provider.js';
import profile from '../config/work-profile.json' with { type: 'json' };

const copy = value => structuredClone(value);
const assert = (ok, message) => { if (!ok) throw new Error(message); };

const STORAGE_KEY = 'reploid.chat-workspace:v1';

// Canonical fallback model identities for verified catalog compatibility
export const CANONICAL_CHAT_MODELS = Object.freeze([
  Object.freeze({
    id: 'qwen-3-5-0-8b-q4k-ehaf16',
    name: 'Qwen 3.5 0.8B',
    identity: 'sha256:fab133e49d6dc67912fc3a087222ec44ca1941d9b7bc36c60cb1379863a6dd4f',
    provider: 'doppler',
    contextLength: 262144,
    quantization: 'q4k',
    adapters: []
  }),
  Object.freeze({
    id: 'qwen-3-5-2b-q4k-ehaf16',
    name: 'Qwen 3.5 2B',
    identity: 'sha256:502fbd6d4c9ed6a890931665995c8ebb42a30e5cda23aa2cfd8e680bee7fa5bc',
    provider: 'doppler',
    contextLength: 262144,
    quantization: 'q4k',
    adapters: []
  })
]);

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

  const sessionScheduler = scheduler || (typeof service?.openCapsule === 'function' ? createChatScheduler({
    open: async (reqModel, { signal }) => {
      const capsule = await service.openCapsule({
        scope: 'chat-resident:' + reqModel.id,
        source: reqModel.id,
        options: { signal }
      });
      return {
        run: async (req, { signal: runSignal, onDelta }) => {
          let text = '';
          for await (const event of capsule.stream(req.messages, profile.generation)) {
            runSignal?.throwIfAborted();
            if (event.type === 'text-delta') {
              text += event.text;
              onDelta(event.text);
            }
          }
          return {
            content: text,
            modelId: reqModel.id,
            modelIdentity: reqModel.identity,
            adapterIdentities: (reqModel.adapters || []).map(a => a.identity)
          };
        },
        reset: async () => { if (typeof capsule.reset === 'function') await capsule.reset(); },
        setAdapters: async (adapters) => { if (typeof capsule.setAdapters === 'function') await capsule.setAdapters(adapters); },
        close: async () => { await service.close('chat-resident:' + reqModel.id); }
      };
    },
    observe: () => {}
  }) : null);

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

    if (sessionScheduler && (request.permissions?.sharingScope === 'local' || !swarm?.hasProvider?.(model.id))) {
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
      const execution = { provider: 'doppler', placement: 'local-webgpu' };
      threadPlacements.set(threadId, execution);
      return {
        threadId,
        attemptId,
        modelId: model.id,
        modelIdentity: model.identity,
        adapterIdentities: (model.adapters || []).map(a => a.identity),
        content: result.content,
        execution
      };
    }

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
    threadPlacements.set(threadId, execution);
    return { threadId, attemptId, modelId: model.id, modelIdentity: model.identity,
      adapterIdentities: (model.adapters || []).map(a => a.identity), content: result.content, execution };
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
    return copy([...models, ...peerModels]);
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
    approve(threadId, attemptId, previewId, accepted) {
      workspace.approve(threadId, attemptId, previewId, accepted);
      notifyAll();
    },
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
      if (sessionScheduler) await sessionScheduler.close();
      await workspace.close();
      listeners.clear();
    },
    scheduler: sessionScheduler
  });
}
