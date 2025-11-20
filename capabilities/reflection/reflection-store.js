/**
 * @fileoverview Reflection Store
 * Persists insights, errors, and success patterns to VFS.
 */

const ReflectionStore = {
  metadata: {
    id: 'ReflectionStore',
    version: '2.0.0',
    dependencies: ['Utils', 'VFS'],
    async: true,
    type: 'capability'
  },

  factory: (deps) => {
    const { Utils, VFS } = deps;
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
        context: entry.context || {}
      };

      _cache.push(reflection);

      // Persist (debounced in a real app, immediate here for safety)
      await _save();

      logger.info(`[Reflection] Added: ${entry.type}`);
      return reflection.id;
    };

    const query = (filterFn) => {
      return _cache.filter(filterFn);
    };

    const _save = async () => {
      await VFS.write(STORE_PATH, JSON.stringify(_cache, null, 2));
    };

    return { init, add, query };
  }
};

export default ReflectionStore;
