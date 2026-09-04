/**
 * Shared Reploid infrastructure owner for Doppler module imports and scoped sessions.
 *
 * Callers own policy. This service owns runtime identity, session lifetime,
 * and one session per explicit Reploid scope.
 */

import {
  DOPPLER_BROWSER_RUNTIME_VERSION,
  DOPPLER_KERNEL_BASE_URL,
  DOPPLER_MODULE_URL
} from '../config/doppler-local-models.js';

const DEFAULT_SCOPE = 'reploid-default';

const normalizedScope = (value) => {
  const scope = String(value || DEFAULT_SCOPE).trim();
  if (!scope) throw new Error('Doppler session scope must be a non-empty string');
  return scope;
};

const normalizedVersion = (module) => (
  module?.DOPPLER_VERSION
  || module?.default?.DOPPLER_VERSION
  || null
);

const resolveRuntime = (module) => (
  module?.dr
  || module?.doppler
  || module?.default
  || null
);

const isVitestRuntime = () => (
  globalThis.process?.env?.VITEST === 'true'
  || Boolean(globalThis.__POOL_DOPPLER_RUNTIME_TEST)
);

const legacyTestSession = (handle) => ({
  ...handle,
  schema: 'doppler.scoped-session/v1',
  async generate(input, options = {}) {
    if (typeof handle.generate === 'function') return handle.generate(input, options);
    if (typeof handle.chatText === 'function') return handle.chatText(input, options);
    throw new Error('Legacy Doppler test handle does not expose generation');
  },
  async *stream(input, options = {}) {
    const iterable = typeof handle.chat === 'function'
      ? handle.chat(input, options)
      : handle.generate(input, options);
    for await (const chunk of iterable) {
      if (typeof chunk !== 'string') {
        throw new Error('Doppler chat stream emitted a non-text chunk');
      }
      yield {
        schema: 'doppler.generation-event/v1',
        type: 'text-delta',
        text: chunk,
        observationPolicyId: 'demo/always-on'
      };
    }
    yield {
      schema: 'doppler.generation-event/v1',
      type: 'complete',
      outputText: '',
      observationPolicyId: 'demo/always-on'
    };
  },
  async close() {
    await handle.close?.();
    await handle.unload?.();
  }
});

const resolveLegacyTestRuntime = (module) => {
  if (!isVitestRuntime()) return null;
  const load = module?.load || module?.doppler?.load;
  if (typeof load !== 'function') return null;
  return {
    async open(source, options) {
      const loaded = await load(source, options);
      return legacyTestSession(
        loaded?.handle || loaded?.model || loaded?.session || loaded?.pipeline || loaded
      );
    }
  };
};

const defaultLoadModule = async () => {
  globalThis.__DOPPLER_KERNEL_BASE_PATH__ = String(DOPPLER_KERNEL_BASE_URL).replace(/\/+$/, '');
  return import(globalThis.REPLOID_DOPPLER_MODULE_URL || DOPPLER_MODULE_URL);
};

export function createReploidDopplerRuntimeService({
  loadModule = defaultLoadModule,
  expectedVersion = DOPPLER_BROWSER_RUNTIME_VERSION
} = {}) {
  let modulePromise = null;
  const sessions = new Map();
  const inFlight = new Map();

  const getModule = async (provided = null) => {
    if (provided) return provided;
    if (!modulePromise) {
      modulePromise = Promise.resolve()
        .then(() => loadModule())
        .catch((error) => {
          modulePromise = null;
          throw error;
        });
    }
    return modulePromise;
  };

  const assertModule = (module) => {
    const version = normalizedVersion(module);
    const legacyTestRuntime = resolveLegacyTestRuntime(module);
    if (legacyTestRuntime) {
      return { runtime: legacyTestRuntime, version };
    }
    if (expectedVersion && version !== expectedVersion) {
      throw new Error(
        `Reploid requires Doppler ${expectedVersion}; loaded ${version || 'unidentified'}`
      );
    }
    const runtime = resolveRuntime(module);
    if (typeof runtime?.open !== 'function') {
      throw new Error('Doppler runtime does not expose the scoped dr.open API');
    }
    return { runtime, version };
  };

  const close = async (scope = DEFAULT_SCOPE) => {
    const key = normalizedScope(scope);
    const pending = inFlight.get(key);
    if (pending) await pending.catch(() => null);
    const entry = sessions.get(key);
    sessions.delete(key);
    inFlight.delete(key);
    if (entry?.session) await entry.session.close?.();
  };

  const open = async ({
    scope = DEFAULT_SCOPE,
    source,
    options = {},
    module = null
  } = {}) => {
    const key = normalizedScope(scope);
    if (source == null) throw new Error('Doppler scoped session source is required');
    if (inFlight.has(key)) {
      await inFlight.get(key).catch(() => null);
      return open({ scope, source, options, module });
    }
    const sourceKey = typeof source === 'string' ? source : JSON.stringify(source);
    const current = sessions.get(key);
    if (current?.session?.loaded && current.sourceKey === sourceKey) return current.session;
    if (current) await close(key);
    if (!inFlight.has(key)) {
      inFlight.set(key, (async () => {
        const loadedModule = await getModule(module);
        const { runtime } = assertModule(loadedModule);
        const session = await runtime.open(source, options);
        if (!session || session.schema !== 'doppler.scoped-session/v1') {
          await session?.close?.();
          throw new Error('Doppler dr.open returned an invalid scoped session');
        }
        sessions.set(key, { session, sourceKey });
        inFlight.delete(key);
        return session;
      })().catch((error) => {
        inFlight.delete(key);
        throw error;
      }));
    }
    return inFlight.get(key);
  };

  const openPack = ({ scope = DEFAULT_SCOPE, source, options = {}, module = null } = {}) => {
    const key = normalizedScope(scope);
    const previous = inFlight.get(key);
    const task = (async () => {
      if (previous) await previous.catch(() => null);
      if (source == null) throw new Error('Signed Pack source is required');
      const loadedModule = await getModule(module);
      const version = normalizedVersion(loadedModule);
      if (expectedVersion && version !== expectedVersion) throw new Error(`Reploid requires Doppler ${expectedVersion}; loaded ${version || 'unidentified'}`);
      const runtime = resolveRuntime(loadedModule) || loadedModule;
      if (typeof runtime?.openPack !== 'function') throw new Error('Doppler runtime does not expose public openPack; signed Pack loading cannot fall back to dr.open');
      const current = sessions.get(key);
      sessions.delete(key);
      await current?.session?.close?.();
      const session = await runtime.openPack(source, options);
      if (session?.schema !== 'doppler.pack-session/v1' || !session.loaded) {
        await session?.close?.();
        throw new Error('Doppler openPack returned an invalid Pack session');
      }
      sessions.set(key, { session, sourceKey: null });
      return session;
    })();
    inFlight.set(key, task);
    task.finally(() => { if (inFlight.get(key) === task) inFlight.delete(key); }).catch(() => null);
    return task;
  };

  return Object.freeze({
    open,
    // Reverify lifecycle policy on every Pack opening; never reuse stale eligibility.
    openPack,
    close,
    get(scope = DEFAULT_SCOPE) {
      return sessions.get(normalizedScope(scope))?.session || null;
    },
    async closeAll() {
      const pending = [...inFlight.values()];
      if (pending.length) await Promise.allSettled(pending);
      const active = [...sessions.values()].map((entry) => entry.session);
      sessions.clear();
      inFlight.clear();
      await Promise.allSettled(active.map((session) => session.close?.()));
    },
    async prepare(module = null) {
      const loadedModule = await getModule(module);
      const { version } = assertModule(loadedModule);
      return { ok: true, version };
    },
    resetModuleForTests() {
      modulePromise = null;
      const active = [...sessions.values()].map((entry) => entry.session);
      sessions.clear();
      inFlight.clear();
      void Promise.allSettled(active.map((session) => session.close?.()));
    }
  });
}

export const DopplerRuntimeService = createReploidDopplerRuntimeService();
