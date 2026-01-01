/**
 * @fileoverview Neural Compiler
 * Routes tasks to LoRA adapters and batches execution to minimize swaps.
 */

const NeuralCompiler = {
  metadata: {
    id: 'NeuralCompiler',
    version: '1.0.0',
    genesis: { introduced: 'full' },
    dependencies: ['Utils', 'EventBus?', 'VFS', 'LLMClient', 'SemanticMemory'],
    async: true,
    type: 'capability'
  },

  factory: (deps) => {
    const { Utils, EventBus, VFS, LLMClient, SemanticMemory } = deps;
    const { logger, Errors, generateId } = Utils;

    const REGISTRY_PATH = '/.memory/neural-compiler/adapters.json';

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
        await LLMClient.unloadLoRAAdapter?.();
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

      await LLMClient.loadLoRAAdapter(manifest);
      _activeAdapter = name;
      _stats.swaps += 1;
      emit('neural-compiler:adapter-loaded', { name });
      return name;
    };

    const getActiveAdapter = () => _activeAdapter;

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
      executeTask,
      scheduleTasks
    };
  }
};

export default NeuralCompiler;
