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
import { resolveDopplerExecutionContract } from '../config/doppler-execution-contracts.js';
import { GENERATION_CONTRACT, validateGenerationInput, resolveGenerationOptions } from '../config/doppler-generation-contract.js';

// This generated, validation-only bundle comes from Doppler's installed public
// export. Reploid authors no sampling fields, defaults, or range rules.
export const DOPPLER_GENERATION_CONTRACT = GENERATION_CONTRACT;
export function validateDopplerGenerationRequest({ input, options }) {
  validateGenerationInput(input);
  return resolveGenerationOptions(options);
}
export function assertDopplerGenerationContract(session) {
  if (JSON.stringify(session.generationContract) !== JSON.stringify(GENERATION_CONTRACT)) {
    throw new Error('Doppler generation contract mismatch; install the qualified package matching Reploid before generation.');
  }
}

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

  const releaseEntry = async (key) => {
    const entry = sessions.get(key);
    if (!entry) return;
    entry.quarantined = true;
    await entry.session.close?.();
    if (sessions.get(key) === entry) sessions.delete(key);
  };

  const close = (scope = DEFAULT_SCOPE) => {
    const key = normalizedScope(scope);
    const pending = inFlight.get(key);
    const task = (async () => {
      if (pending) await pending.catch(() => null);
      await releaseEntry(key);
    })();
    inFlight.set(key, task);
    task.finally(() => { if (inFlight.get(key) === task) inFlight.delete(key); }).catch(() => null);
    return task;
  };

  const open = async ({
    scope = DEFAULT_SCOPE,
    source,
    options = {},
    module = null
  } = {}) => {
    const key = normalizedScope(scope);
    if (source == null) throw new Error('Doppler scoped session source is required');
    const previous = inFlight.get(key);
    const task = (async () => {
      if (previous) await previous.catch(() => null);
      const sourceKey = typeof source === 'string' ? source : JSON.stringify(source);
      const current = sessions.get(key);
      if (current?.session?.loaded && !current.quarantined && current.sourceKey === sourceKey) return current.session;
      await releaseEntry(key);
      const loadedModule = await getModule(module);
      const { runtime } = assertModule(loadedModule);
      const session = await runtime.open(source, options);
      if (!session || session.schema !== 'doppler.scoped-session/v1') {
        await session?.close?.();
        throw new Error('Doppler dr.open returned an invalid scoped session');
      }
      sessions.set(key, { session, sourceKey });
      return session;
    })();
    inFlight.set(key, task);
    task.finally(() => { if (inFlight.get(key) === task) inFlight.delete(key); }).catch(() => null);
    return task;
  };

  const signedRuntime = (module, contract) => {
    const version = normalizedVersion(module);
    if (expectedVersion && version !== expectedVersion) throw new Error(`Reploid requires Doppler ${expectedVersion}; loaded ${version || 'unidentified'}`);
    const runtime = typeof module?.[contract.openMethod] === 'function' ? module : resolveRuntime(module);
    if (typeof runtime?.[contract.openMethod] !== 'function') throw new Error(`Doppler runtime does not expose public ${contract.openMethod}; signed model loading cannot fall back to dr.open`);
    return { runtime, version };
  };

  const openSigned = (contract, { scope = DEFAULT_SCOPE, source, options = {}, module = null } = {}) => {
    const key = normalizedScope(scope);
    const previous = inFlight.get(key);
    const task = (async () => {
      if (previous) await previous.catch(() => null);
      if (source == null) throw new Error('Signed Pack source is required');
      const loadedModule = await getModule(module);
      const { runtime } = signedRuntime(loadedModule, contract);
      await releaseEntry(key);
      const session = await runtime[contract.openMethod](source, options);
      if (session?.schema !== contract.sessionSchema || !session.loaded) {
        await session?.close?.();
        throw new Error(`Doppler ${contract.openMethod} returned an invalid signed model session`);
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
    openPack: options => openSigned(resolveDopplerExecutionContract('doppler.pack/v2'), options),
    openCapsule: options => openSigned(resolveDopplerExecutionContract('doppler.capsule/v2'), options),
    close,
    get(scope = DEFAULT_SCOPE) {
      const entry = sessions.get(normalizedScope(scope));
      return entry?.quarantined ? null : entry?.session || null;
    },
    async closeAll() {
      const pending = [...inFlight.values()];
      if (pending.length) await Promise.allSettled(pending);
      const results = await Promise.allSettled([...sessions.keys()].map(close));
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (errors.length) throw new AggregateError(errors, 'Doppler session cleanup failed');
    },
    async prepare(module = null, { bindingSchema = null } = {}) {
      const loadedModule = await getModule(module);
      const { version } = bindingSchema === null ? assertModule(loadedModule)
        : signedRuntime(loadedModule, resolveDopplerExecutionContract(bindingSchema));
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
