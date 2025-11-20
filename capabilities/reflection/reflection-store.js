/**
 * @fileoverview Reflection Store
 * Persists insights, errors, and success patterns to VFS.
 */

const ReflectionStore = {
  metadata: {
    id: 'ReflectionStore',
    version: '2.1.1',
    dependencies: ['Utils', 'VFS', 'EventBus'],
    async: true,
    type: 'capability'
  },

  factory: (deps) => {
    const { Utils, VFS, EventBus } = deps;
    const { logger, generateId } = Utils;

    const STORE_PATH = '/.memory/reflections.json';
    let _cache = [];

    const init = async () => {
      if (await VFS.exists(STORE_PATH)) {
        try {
          const content = await VFS.read(STORE_PATH);
          _cache = JSON.parse(content);
        } catch (e) {
          logger.error('[Reflection] Corrupt store, resetting.', e);
          _cache = [];
        }
      }
      return true;
    };

    const add = async (entry) => {
      const reflection = {
        id: generateId('ref'),
        ts: Date.now(),
        type: entry.type || 'insight', // 'insight', 'error', 'success'
        content: entry.content,
        context: entry.context || {},
        // Enriched fields for Analyzer
        tags: entry.tags || [],
        description: entry.description || entry.content
      };

      _cache.push(reflection);

      // Simple persistence (no debouncing in core to avoid async complexity)
      await _save();

      EventBus.emit('reflection:added', reflection);
      logger.info(`[Reflection] Added: ${entry.type}`);
      return reflection.id;
    };

    const query = (filterFn) => {
      return _cache.filter(filterFn);
    };

    const getReflections = async (options = {}) => {
      let results = [..._cache];

      if (options.outcome) {
        results = results.filter(r => r.context?.outcome === options.outcome);
      }

      results.sort((a, b) => b.ts - a.ts);

      if (options.limit) {
        results = results.slice(0, options.limit);
      }

      return results;
    };

    const _save = async () => {
      // Ensure directory exists
      if (!await VFS.exists('/.memory')) {
          await VFS.mkdir('/.memory');
      }
      await VFS.write(STORE_PATH, JSON.stringify(_cache, null, 2));
    };

    return { init, add, query, getReflections };
  }
};

export default ReflectionStore;
