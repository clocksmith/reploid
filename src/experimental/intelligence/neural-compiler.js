/**
 * @fileoverview Neural Compiler
 * Routes tasks to LoRA adapters and batches execution to minimize swaps.
 */

const NeuralCompiler = {
  metadata: {
    id: 'NeuralCompiler',
    version: '1.0.0',
    genesis: { introduced: 'full' },
    dependencies: ['Utils', 'EventBus?', 'VFS', 'LLMClient', 'DopplerToolbox?', 'SemanticMemory', 'IntentBundleGate?'],
    async: true,
    type: 'capability'
  },

  factory: (deps) => {
    const { Utils, EventBus, VFS, LLMClient, DopplerToolbox, SemanticMemory, IntentBundleGate } = deps;
    const { logger, Errors, generateId } = Utils;

    const REGISTRY_PATH = '/.memory/neural-compiler/adapters.json';
    const DEFAULT_BUNDLE_PATH = '/.system/intent-bundle.json';
    const DEFAULT_MANIFEST_DIR = '/config/lora-adapters';

    const _registry = new Map();
    let _activeAdapter = null;
    let _stats = { swaps: 0, tasks: 0 };

    const emit = (event, payload) => {
      if (EventBus) {
        EventBus.emit(event, payload);
      }
    };

    const cosineSimilarity = (a, b) => {
      if (!a || !b || a.length !== b.length) return 0;
      let dot = 0;
      let normA = 0;
      let normB = 0;
      for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
      }
      const denom = Math.sqrt(normA) * Math.sqrt(normB);
      return denom === 0 ? 0 : dot / denom;
    };

    const normalizePath = (path) => {
      if (!path || typeof path !== 'string') return null;
      return path.startsWith('/') ? path : `/${path}`;
    };

    const loadBundle = async (path = DEFAULT_BUNDLE_PATH) => {
      if (IntentBundleGate?.loadBundle) {
        return IntentBundleGate.loadBundle(path);
      }

      const raw = await VFS.read(path);
      try {
        return JSON.parse(raw);
      } catch (err) {
        throw new Errors.ValidationError(`Intent bundle parse failed: ${err?.message || 'invalid JSON'}`);
      }
    };

    const requestApproval = async (bundle, options = {}) => {
      if (IntentBundleGate?.requestApproval) {
        return IntentBundleGate.requestApproval(bundle, options);
      }
      return { approved: true, reason: 'IntentBundleGate not available', bundle };
    };

    const resolveAdapterRef = (bundle) => {
      const payload = bundle?.payload || {};
      const loraTarget = bundle?.targets?.loras?.[0] || null;
      return payload.loraAdapterManifest || payload.loraAdapter || loraTarget?.loraId || null;
    };

    const resolveManifestPath = (bundle) => {
      const ref = resolveAdapterRef(bundle);
      if (!ref) {
        return { path: null, reason: 'No LoRA adapter reference found' };
      }

      if (ref.endsWith('.json')) {
        return { path: normalizePath(ref), reason: null };
      }

      if (ref.includes('/')) {
        return { path: null, reason: 'LoRA reference does not point to a manifest' };
      }

      return { path: `${DEFAULT_MANIFEST_DIR}/${ref}.json`, reason: null };
    };

    const loadManifest = async (manifestPath) => {
      if (!manifestPath) return null;
      try {
        const raw = await VFS.read(manifestPath);
        return JSON.parse(raw);
      } catch (err) {
        logger.warn('[NeuralCompiler] Intent bundle manifest load failed:', err?.message || err);
        return null;
      }
    };

    const verifyAssets = async (manifest, options = {}) => {
      if (!options.verifyAssets) {
        return { ok: true, missing: [] };
      }

      const shards = Array.isArray(manifest?.shards) ? manifest.shards : [];
      if (shards.length === 0 || typeof VFS.exists !== 'function') {
        return { ok: true, missing: [] };
      }

      const missing = [];
      for (const shard of shards) {
        const shardPath = shard?.path;
        if (!shardPath) continue;
        const exists = await VFS.exists(shardPath);
        if (!exists) missing.push(shardPath);
      }

      return { ok: missing.length === 0, missing };
    };

    const persistRegistry = async () => {
      if (!VFS) return;
      const data = Array.from(_registry.values());
      await VFS.write(REGISTRY_PATH, JSON.stringify({ adapters: data }, null, 2));
    };

    const loadRegistry = async () => {
      if (!VFS) return;
      try {
        const content = await VFS.read(REGISTRY_PATH);
        const data = JSON.parse(content || '{}');
        _registry.clear();
        for (const entry of data.adapters || []) {
          _registry.set(entry.name, entry);
        }
      } catch (err) {
        if (!String(err?.message || '').includes('not found')) {
          logger.warn('[NeuralCompiler] Failed to load registry:', err.message);
        }
      }
    };

    const init = async () => {
      await loadRegistry();
      logger.info('[NeuralCompiler] Initialized');
      return true;
    };

    const registerAdapter = async (name, manifestPath, options = {}) => {
      if (!name) {
        throw new Errors.ValidationError('Adapter name required');
      }
      if (!manifestPath && !options.manifest) {
        throw new Errors.ValidationError('Adapter manifest path or manifest required');
      }

      let embedding = options.embedding;
      const routingText = options.routingText || options.keywords?.join(' ') || name;
      if (!embedding && SemanticMemory) {
        embedding = await SemanticMemory.embed(routingText);
      }

      const entry = {
        name,
        manifestPath: manifestPath || null,
        manifest: options.manifest || null,
        embedding: embedding || null,
        metadata: options.metadata || {},
        routingText,
        updatedAt: Date.now()
      };

      _registry.set(name, entry);
      await persistRegistry();

      emit('neural-compiler:adapter-registered', { name });
      return entry;
    };

    const unregisterAdapter = async (name) => {
      if (!_registry.has(name)) return false;
      _registry.delete(name);
      await persistRegistry();
      emit('neural-compiler:adapter-removed', { name });
      return true;
    };

    const listAdapters = () => Array.from(_registry.values());

    const findNearestAdapter = (embedding) => {
      let best = { name: null, score: 0 };
      for (const entry of _registry.values()) {
        if (!entry.embedding) continue;
        const score = cosineSimilarity(embedding, entry.embedding);
        if (score > best.score) {
          best = { name: entry.name, score };
        }
      }
      return best;
    };

    const resolveAdapterForTask = async (task) => {
      if (task.adapter) return { name: task.adapter, score: 1 };
      const text = task.routingText || task.description || task.prompt || '';
      if (!text) return { name: null, score: 0 };
      if (!SemanticMemory) return { name: null, score: 0 };
      const embedding = await SemanticMemory.embed(text);
      return findNearestAdapter(embedding);
    };

    const loadAdapter = async (name) => {
      if (!name) {
        const unload = DopplerToolbox?.unloadLoRAAdapter || LLMClient?.unloadLoRAAdapter;
        if (unload) {
          await unload();
        }
        _activeAdapter = null;
        return null;
      }

      if (_activeAdapter === name) return name;

      const entry = _registry.get(name);
      if (!entry) {
        throw new Errors.ValidationError(`Adapter not registered: ${name}`);
      }

      const manifest = entry.manifest
        ? entry.manifest
        : entry.manifestPath
          ? JSON.parse(await VFS.read(entry.manifestPath))
          : null;

      if (!manifest) {
        throw new Errors.ValidationError(`Adapter manifest missing for ${name}`);
      }

      const load = DopplerToolbox?.loadLoRAAdapter || LLMClient?.loadLoRAAdapter;
      if (!load) {
        throw new Errors.ConfigError('LoRA adapter loading requires DopplerToolbox or LLMClient support');
      }
      await load(manifest);
      _activeAdapter = name;
      _stats.swaps += 1;
      emit('neural-compiler:adapter-loaded', { name });
      return name;
    };

    const getActiveAdapter = () => _activeAdapter;

    const deriveAdapterName = (bundle, manifest) => {
      if (manifest?.name) return manifest.name;
      const ref = resolveAdapterRef(bundle);
      if (!ref) return 'intent-bundle-adapter';
      const tail = ref.split('/').pop() || ref;
      return tail.endsWith('.json') ? tail.slice(0, -5) : tail;
    };

    const applyIntentBundle = async (bundleOrPath = DEFAULT_BUNDLE_PATH, options = {}) => {
      const bundle = typeof bundleOrPath === 'string'
        ? await loadBundle(bundleOrPath)
        : bundleOrPath;

      if (!bundle) {
        throw new Errors.ValidationError('Intent bundle required');
      }

      const approval = await requestApproval(bundle, options);
      if (!approval.approved) {
        emit('intent-bundle:lora:rejected', {
          bundleId: bundle.bundleId || null,
          reason: approval.reason || 'rejected'
        });
        return {
          status: 'rejected',
          approved: false,
          reason: approval.reason || 'rejected',
          bundleId: bundle.bundleId || null
        };
      }

      const { path: manifestPath, reason } = resolveManifestPath(bundle);
      if (!manifestPath) {
        emit('intent-bundle:lora:missing', {
          bundleId: bundle.bundleId || null,
          reason
        });
        return {
          status: 'missing_assets',
          approved: true,
          stub: true,
          reason,
          bundleId: bundle.bundleId || null
        };
      }

      const manifest = await loadManifest(manifestPath);
      if (!manifest) {
        emit('intent-bundle:lora:missing', {
          bundleId: bundle.bundleId || null,
          reason: 'Manifest missing',
          manifestPath
        });
        return {
          status: 'missing_assets',
          approved: true,
          stub: true,
          reason: 'Manifest missing',
          manifestPath,
          bundleId: bundle.bundleId || null
        };
      }

      const assetCheck = await verifyAssets(manifest, options);
      if (!assetCheck.ok) {
        const missing = assetCheck.missing || [];
        emit('intent-bundle:lora:missing', {
          bundleId: bundle.bundleId || null,
          reason: 'LoRA shards missing',
          missing,
          manifestPath
        });
        return {
          status: 'missing_assets',
          approved: true,
          stub: true,
          reason: 'LoRA shards missing',
          missing,
          manifestPath,
          bundleId: bundle.bundleId || null
        };
      }

      const adapterName = deriveAdapterName(bundle, manifest);
      let registered = null;
      if (options.registerAdapter !== false) {
        const metadata = {
          source: 'intent-bundle',
          bundleId: bundle.bundleId || null,
          baseModel: manifest.baseModel || bundle?.targets?.model?.modelId || null
        };
        const routingText = options.routingText || bundle?.payload?.instructions || adapterName;
        registered = await registerAdapter(adapterName, manifestPath, {
          manifest,
          metadata,
          routingText
        });
      }

      try {
        await loadAdapter(adapterName);
      } catch (err) {
        logger.warn('[NeuralCompiler] Intent bundle LoRA load failed:', err?.message || err);
        emit('intent-bundle:lora:error', {
          bundleId: bundle.bundleId || null,
          error: err?.message || String(err)
        });
        return {
          status: 'failed',
          approved: true,
          error: err?.message || String(err),
          manifestPath,
          bundleId: bundle.bundleId || null
        };
      }

      const result = {
        status: 'loaded',
        approved: true,
        adapter: _activeAdapter,
        manifestPath,
        bundleId: bundle.bundleId || null,
        registered: !!registered
      };

      emit('intent-bundle:lora:loaded', result);
      return result;
    };

    const executeTask = async (task, options = {}) => {
      if (!task) {
        throw new Errors.ValidationError('Task required');
      }

      const modelConfig = task.model || options.model;
      if (!modelConfig) {
        throw new Errors.ValidationError('Model config required');
      }

      const target = await resolveAdapterForTask(task);
      if (target.name || options.forceUnload) {
        await loadAdapter(target.name);
      }

      const messages = task.messages || [
        { role: 'user', content: task.prompt || task.description || '' }
      ];

      const response = await LLMClient.chat(messages, modelConfig, null, task.chatOptions || {});
      _stats.tasks += 1;

      return {
        id: task.id || generateId('nc_task'),
        adapter: _activeAdapter,
        response
      };
    };

    const scheduleTasks = async (tasks = [], options = {}) => {
      if (!Array.isArray(tasks) || tasks.length === 0) return [];

      const classified = [];
      for (const task of tasks) {
        const adapter = await resolveAdapterForTask(task);
        classified.push({ task, adapter });
      }

      const batches = new Map();
      for (const item of classified) {
        const key = item.adapter.name || '__base__';
        if (!batches.has(key)) batches.set(key, []);
        batches.get(key).push(item.task);
      }

      const results = [];
      for (const [adapterName, batch] of batches.entries()) {
        await loadAdapter(adapterName === '__base__' ? null : adapterName);
        for (const task of batch) {
          const result = await executeTask(task, options);
          results.push(result);
        }
      }

      return results;
    };

    return {
      init,
      registerAdapter,
      unregisterAdapter,
      listAdapters,
      getActiveAdapter,
      applyIntentBundle,
      executeTask,
      scheduleTasks
    };
  }
};

export default NeuralCompiler;
