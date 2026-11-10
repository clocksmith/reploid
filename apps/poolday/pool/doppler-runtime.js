/**
 * @fileoverview Browser-only Doppler runtime adapter for pool providers.
 *
 * Reploid owns the pool protocol. Doppler owns model loading and WebGPU
 * generation. This adapter only talks to public Doppler surfaces or to a
 * caller-provided public handle/session.
 */

import { hashJson, sha256Hex } from '../../../shared/pool/inference-receipt.js';
import {
  assertDopplerSessionIdentity,
  cancelDopplerSession,
  createDopplerModuleLoader,
  dopplerEmbedMethod,
  dopplerGenerateMethod,
  embedWithDopplerSession,
  generateWithDopplerSession,
  readDopplerEmbedding,
  readDopplerOutputText,
  readDopplerSessionIdentity,
  readDopplerTokenCounts,
  readDopplerTokenIds,
  resetDopplerSession,
  verifyDopplerGenerationEvidence
} from '../../../shared/vendor/reploid/adapters/doppler-session.js';
import { collectRuntimeProfile } from './runtime-profile.js';
import { BROWSER_RUNTIME_CONFIG } from '../../../shared/pool/config.js';
import {
  POOLDAY_MODEL_WORKLOADS,
  getPoolModelWorkload,
  validateModelRuntimeCapabilities
} from '../../../shared/pool/model-contract.js';
import {
  isSequenceWorkload,
  validateSequenceRequest
} from '../../../shared/pool/sequence-workload.js';
import {
  callDopplerSequence,
  reduceDopplerSequenceResult,
  sequenceMethodName
} from './sequence-result.js';
import {
  adapterRequirementFromPack,
  verifyAdapterPack
} from '../../../shared/pool/adapter-pack.js';
import { verifyDopplerPersistentModelCache } from './model-cache-integrity.js';
import { DopplerRuntimeService } from '../../../shared/infrastructure/doppler-runtime-service.js';
import { assertPackSession, assertPackReceipt, executablePacksMatch } from '../../../shared/pool/executable-pack.js';
import { openCapsuleArtifactCache } from './capsule-artifact-cache.js';
import { resolveDopplerExecutionContract } from '../../../shared/config/doppler-execution-contracts.js';
import { SEQUENCE_WORKLOADS } from '../../../shared/pool/sequence-workload.js';

const DOPPLER_IMPORTS = Object.freeze([
  '@simulatte/doppler',
  'doppler-gpu'
]);

let dopplerStorageModulePromise = null;

const hasIdentityValue = (value) => value !== undefined && value !== null && String(value).trim() !== '';
const normalizeHashIdentity = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.startsWith('sha256:') ? text : `sha256:${text}`;
};

const configuredDopplerModuleCandidates = () => {
  const candidates = [];
  if (globalThis.REPLOID_DOPPLER_MODULE) candidates.push(globalThis.REPLOID_DOPPLER_MODULE);
  const configured = globalThis.REPLOID_DOPPLER_MODULE_URLS || globalThis.REPLOID_DOPPLER_MODULE_URL;
  if (Array.isArray(configured)) candidates.push(...configured);
  else if (configured) candidates.push(configured);
  if (BROWSER_RUNTIME_CONFIG.dopplerModuleUrl) candidates.push(BROWSER_RUNTIME_CONFIG.dopplerModuleUrl);
  candidates.push(...DOPPLER_IMPORTS);
  return candidates;
};

const configuredDopplerKernelBaseUrl = () => (
  globalThis.REPLOID_DOPPLER_KERNEL_BASE_URL
  || BROWSER_RUNTIME_CONFIG.dopplerKernelBaseUrl
  || ''
);

const configuredDopplerStorageModule = () => (
  globalThis.REPLOID_DOPPLER_STORAGE_MODULE
  || globalThis.REPLOID_DOPPLER_STORAGE_MODULE_URL
  || BROWSER_RUNTIME_CONFIG.dopplerStorageModuleUrl
  || null
);

const ensureDopplerKernelBasePath = () => {
  const kernelBaseUrl = String(configuredDopplerKernelBaseUrl() || '').trim();
  if (!kernelBaseUrl) {
    throw new Error('Doppler kernel base URL is required for browser module loading');
  }
  globalThis.__DOPPLER_KERNEL_BASE_PATH__ = kernelBaseUrl.replace(/\/+$/, '');
};

const importDopplerCandidate = async (candidate) => {
  if (candidate && typeof candidate === 'object') return candidate;
  const specifier = String(candidate || '').trim();
  if (!specifier) throw new Error('empty Doppler module specifier');
  disableNodeQuickstartCacheForBrowser();
  return import(specifier);
};

const disableNodeQuickstartCacheForBrowser = () => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const current = globalThis.process;
  if (current && typeof current === 'object') {
    current.env = {
      ...(current.env || {}),
      DOPPLER_QUICKSTART_CACHE: 'false'
    };
    return;
  }
  globalThis.process = {
    env: {
      DOPPLER_QUICKSTART_CACHE: 'false'
    }
  };
};

const hasWebGpu = () => !!globalThis.navigator?.gpu;

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const normalizeAdapterInfo = (info) => {
  if (!info || typeof info !== 'object') return null;
  return {
    vendor: info.vendor || null,
    architecture: info.architecture || null,
    device: info.device || null,
    description: info.description || null
  };
};

export async function collectBrowserDeviceInfo() {
  const device = {
    hasWebGPU: hasWebGpu(),
    adapterInfo: null,
    features: [],
    limits: {},
    probeStatus: 'unavailable'
  };
  if (!globalThis.navigator?.gpu?.requestAdapter) return device;
  try {
    const adapter = await globalThis.navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) {
      return {
        ...device,
        probeStatus: 'adapter_unavailable'
      };
    }
    let adapterInfo = adapter.info ? normalizeAdapterInfo(adapter.info) : null;
    if (!adapterInfo && typeof adapter.requestAdapterInfo === 'function') {
      adapterInfo = normalizeAdapterInfo(await adapter.requestAdapterInfo());
    }
    return {
      hasWebGPU: true,
      adapterInfo,
      features: adapter.features ? Array.from(adapter.features).sort() : [],
      limits: adapter.limits ? Object.fromEntries(Object.entries(adapter.limits)) : {},
      hasF16: adapter.features ? adapter.features.has('shader-f16') : false,
      hasSubgroups: adapter.features ? adapter.features.has('subgroups') : false,
      maxBufferSize: Number(adapter.limits?.maxBufferSize || 0),
      probeStatus: 'ok'
    };
  } catch (error) {
    return {
      ...device,
      probeStatus: 'failed',
      reason: error.message
    };
  }
}

const publicMethodNameForWorkload = (candidate, model = {}) => {
  const workload = getPoolModelWorkload(model);
  if (workload === POOLDAY_MODEL_WORKLOADS.embedding) return dopplerEmbedMethod(candidate);
  if (isSequenceWorkload(workload)) return sequenceMethodName(candidate);
  return dopplerGenerateMethod(candidate);
};

const summarizeEmbeddingValues = (values) => {
  let nonFiniteCount = 0;
  let sumSquares = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) {
      nonFiniteCount += 1;
      continue;
    }
    sumSquares += value * value;
  }
  return {
    dimensions: values.length,
    nonFiniteCount,
    l2Norm: values.length ? Number(Math.sqrt(sumSquares).toFixed(6)) : 0
  };
};

const normalizeModelInfo = async (model, handle) => {
  const { packSource, packOpenOptions, ...descriptor } = model || {};
  const manifest = model?.manifest || handle?.manifest || handle?.model?.manifest || null;
  const evidence = await readDopplerSessionIdentity(handle);
  const manifestHash = model?.manifestHash
    || evidence.manifestHash
    || (manifest ? await hashJson(manifest) : null);
  // Preserve the full governed descriptor in runtime state. Provider routing and
  // receipt construction compare this exact contract, not a checkpoint subset.
  return {
    ...descriptor,
    modelId: model?.modelId || model?.id || evidence.modelId || null,
    modelHash: model?.modelHash || evidence.modelHash || null,
    manifestHash: manifestHash || null,
    tokenizerHash: model?.tokenizerHash || model?.artifactIdentity?.tokenizerHash || null,
    workload: getPoolModelWorkload(model || manifest || {}),
    workloads: Array.isArray(model?.workloads) ? [...model.workloads] : undefined,
    executionMode: model?.executionMode || model?.execution || null,
    executionModes: model?.executionModes || null,
    embeddingDimensions: Number(model?.embeddingDimensions || model?.dimensions || 0) || null,
    sequence: model?.sequence || manifest?.inference?.sequence || null,
    contextLength: Number(model?.contextLength || handle?.contextLength || handle?.model?.contextLength || 0),
    quantization: model?.quantization || handle?.quantization || handle?.model?.quantization || null,
    runtime: 'doppler',
    backend: 'browser-webgpu',
    artifactIdentity: model?.artifactIdentity || evidence.artifactIdentity || null,
    identityEvidence: {
      modelId: hasIdentityValue(evidence.modelId),
      modelHash: hasIdentityValue(evidence.modelHash),
      manifestHash: hasIdentityValue(evidence.manifestHash)
        || hasIdentityValue(evidence.runtimeManifestHash),
      artifactIdentity: !!evidence.artifactIdentity
    }
  };
};

const normalizeRuntimeInfo = (runtime, handle) => ({
  runtime: 'doppler',
  version: runtime?.version
    || runtime?.packageVersion
    || handle?.runtimeVersion
    || handle?.version
    || handle?.packageVersion
    || null,
  backend: 'browser-webgpu',
  hasWebGPU: hasWebGpu(),
  publicApi: dopplerGenerateMethod(handle),
  device: runtime?.device || handle?.deviceInfo || handle?.device || null,
  profile: runtime?.profile || handle?.runtimeProfile || handle?.profile || null,
  persistentCache: runtime?.persistentCache || handle?.persistentCache || null,
  cachePreflight: runtime?.cachePreflight || handle?.cachePreflight || null
});

const semanticVersionParts = (value) => {
  const match = String(value || '').trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
};

const versionAtLeast = (actual, minimum) => {
  const left = semanticVersionParts(actual);
  const right = semanticVersionParts(minimum);
  if (!left || !right) return false;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return true;
};

// A signed session's contract names the identity record that replaces manifest hashes.
const assertHandleMatchesDescriptor = async (handle, descriptor = {}) => assertDopplerSessionIdentity(handle, descriptor,
  descriptor.executablePack
    ? { packIdentity: handle[resolveDopplerExecutionContract(descriptor.executablePack.schema).sessionIdentity] }
    : {});

const dopplerModules = createDopplerModuleLoader({
  candidates: configuredDopplerModuleCandidates,
  importModule: importDopplerCandidate,
  prepare: ensureDopplerKernelBasePath,
  fallback: () => globalThis.Doppler || globalThis.doppler || globalThis.dopplerGpu,
  injectedLabel: 'globalThis.REPLOID_DOPPLER_MODULE',
  unavailableMessage: 'Unable to load public Doppler module. Configure window.REPLOID_DOPPLER_MODULE_URL or window.REPLOID_DOPPLER_MODULE.'
});
const loadDopplerModule = () => dopplerModules.load();

const loadDopplerStorageModule = async () => {
  const configured = configuredDopplerStorageModule();
  if (configured && typeof configured === 'object') return configured;
  const specifier = String(configured || '').trim();
  if (!specifier) throw new Error('Doppler public storage module URL is required for OPFS verification');
  if (!dopplerStorageModulePromise) {
    dopplerStorageModulePromise = importDopplerCandidate(specifier).catch((error) => {
      dopplerStorageModulePromise = null;
      throw error;
    });
  }
  return dopplerStorageModulePromise;
};

const browserOpfsAvailable = () => (
  typeof globalThis.navigator?.storage?.getDirectory === 'function'
);

const preflightPersistentModelCache = async (model, loadOptions) => {
  if (loadOptions?.cache !== 'opfs' || !browserOpfsAvailable()) return null;
  return verifyDopplerPersistentModelCache({
    model,
    storage: await loadDopplerStorageModule()
  });
};

export function resetDopplerModuleCacheForTests() {
  dopplerModules.reset();
  dopplerStorageModulePromise = null;
  DopplerRuntimeService.resetModuleForTests();
}

const getDopplerLoadInput = async (model = {}, module = null) => {
  if (model.loadInput) return model.loadInput;
  const registryReference = model.dopplerLoadRef || model.registryId || model.loadRef || null;
  const listModels = module?.doppler?.listModels;
  if (registryReference && typeof listModels === 'function') {
    try {
      const promotedModels = await listModels();
      if (Array.isArray(promotedModels) && promotedModels.includes(model.modelId || model.id)) {
        return registryReference;
      }
    } catch {
      // Explicit pinned artifact input remains the fail-closed fallback.
    }
  }
  if (registryReference) return registryReference;
  if (model.url) return { url: model.url };
  if (model.manifest) return { manifest: model.manifest, baseUrl: model.baseUrl };
  return model.modelId || model.id || model;
};

const getConfiguredLoadOptions = (model = {}) => ({
  ...(BROWSER_RUNTIME_CONFIG.loadOptions || {}),
  ...(globalThis.REPLOID_POOL_MODEL_BASE_URL || BROWSER_RUNTIME_CONFIG.modelBaseUrl
    ? { modelBaseUrl: globalThis.REPLOID_POOL_MODEL_BASE_URL || BROWSER_RUNTIME_CONFIG.modelBaseUrl }
    : {}),
  ...(globalThis.REPLOID_DOPPLER_LOAD_OPTIONS || {}),
  ...(model.loadOptions || {})
});

const assertModelRuntimeCapabilities = async (model = {}) => {
  const validation = validateModelRuntimeCapabilities(model, await collectBrowserDeviceInfo());
  if (validation.ok) return validation;
  if (validation.missingFeatures.length === 0) return validation;
  const error = new Error(`Selected model is not compatible with this browser runtime: ${validation.reasons.join('; ')}`);
  error.code = 'model_runtime_capability_unsupported';
  error.payload = {
    modelId: model.modelId || model.id || null,
    ...validation
  };
  throw error;
};

const cancelledRuntimeWorkError = (reason = 'cancelled') => {
  const error = new Error(`Doppler runtime work was cancelled: ${reason}`);
  error.code = 'pool_runtime_work_cancelled';
  error.reason = reason;
  return error;
};

const staleRuntimeResultError = (reason = 'superseded') => {
  const error = new Error(`Doppler runtime rejected a stale result: ${reason}`);
  error.name = 'StaleResultError';
  error.code = 'pool_runtime_stale_result';
  error.reason = reason;
  return error;
};

export function createDopplerRuntime({
  modelSession = null,
  model = null,
  runtime = null,
  resultReleaseBarrier = null
} = {}) {
  if (resultReleaseBarrier !== null && typeof resultReleaseBarrier !== 'function') {
    throw new TypeError('Doppler runtime resultReleaseBarrier must be a function');
  }
  const serviceScope = 'pool:provider';
  let session = modelSession;
  let sessionOwnedByService = false;
  let capsuleCache = null;
  let modelInfo = model;
  let runtimeInfo = normalizeRuntimeInfo(runtime, modelSession);
  let loadState = session ? 'loaded' : 'empty';
  let deviceInfo = null;
  let generationQueue = Promise.resolve();
  let activeAdapter = null;
  let workEpoch = 0;
  let activeWork = null;
  let lastWorkSettlement = null;

  const assertWorkCurrent = (expectedEpoch) => {
    if (expectedEpoch !== workEpoch) throw cancelledRuntimeWorkError(activeWork?.reason || 'superseded');
  };

  const enqueueWork = (operation) => {
    const expectedEpoch = workEpoch;
    const abortController = new AbortController();
    const run = async () => {
      assertWorkCurrent(expectedEpoch);
      const work = {
        epoch: expectedEpoch,
        startedAt: new Date().toISOString(),
        reason: null,
        abortController
      };
      activeWork = work;
      try {
        const result = await operation(
          () => assertWorkCurrent(expectedEpoch),
          abortController.signal,
          () => {
            if (expectedEpoch !== workEpoch) {
              throw staleRuntimeResultError(work.reason || 'superseded');
            }
          }
        );
        if (expectedEpoch !== workEpoch) {
          throw staleRuntimeResultError(work.reason || 'superseded');
        }
        lastWorkSettlement = {
          status: 'completed',
          epoch: expectedEpoch,
          startedAt: work.startedAt,
          settledAt: new Date().toISOString(),
          errorName: null,
          errorCode: null,
          reason: null
        };
        return result;
      } catch (error) {
        let settledError = error;
        if (expectedEpoch !== workEpoch
          && error?.code !== 'pool_runtime_stale_result'
          && error?.code !== 'pool_runtime_work_cancelled') {
          settledError = cancelledRuntimeWorkError(work.reason || 'cancelled');
        }
        lastWorkSettlement = {
          status: settledError?.code === 'pool_runtime_stale_result'
            ? 'stale_result_rejected'
            : settledError?.code === 'pool_runtime_work_cancelled'
              ? 'cancelled'
              : 'failed',
          epoch: expectedEpoch,
          startedAt: work.startedAt,
          settledAt: new Date().toISOString(),
          errorName: settledError?.name || 'Error',
          errorCode: settledError?.code || null,
          reason: settledError?.reason || settledError?.message || null
        };
        throw settledError;
      } finally {
        if (activeWork?.epoch === expectedEpoch) activeWork = null;
      }
    };
    const task = generationQueue.then(run, run);
    generationQueue = task.catch(() => null);
    return task;
  };

  const attachHandle = async (
    handle,
    nextModel = null,
    nextRuntime = null,
    { ownedByService = false } = {}
  ) => {
    const nextModelInfo = nextModel || modelInfo || {};
    if (nextModelInfo.executablePack) await assertPackSession(nextModelInfo.executablePack, handle);
    const method = publicMethodNameForWorkload(handle, nextModelInfo);
    if (!method) {
      throw new Error(`Doppler handle is missing a public ${getPoolModelWorkload(nextModelInfo)} method`);
    }
    await assertHandleMatchesDescriptor(handle, nextModelInfo);
    session = handle;
    sessionOwnedByService = ownedByService;
    activeAdapter = null;
    modelInfo = await normalizeModelInfo(nextModelInfo, handle);
    runtimeInfo = {
      ...normalizeRuntimeInfo(nextRuntime || runtimeInfo, handle),
      publicApi: method
    };
    loadState = 'loaded';
    return { ok: true, model: modelInfo, runtime: runtimeInfo };
  };

  const api = {
    async prepare() {
      const module = await loadDopplerModule();
      return {
        ok: true,
        version: module?.DOPPLER_VERSION
          || module?.default?.DOPPLER_VERSION
          || null
      };
    },
    async attachHandle(handle, nextModel = null, nextRuntime = null) {
      return attachHandle(handle, nextModel, nextRuntime);
    },
    async loadModel(nextModel = {}, nextSession = null) {
      try {
        if (nextSession) {
          return await attachHandle(nextSession, nextModel, runtimeInfo);
        }
        if (nextModel?.handle || nextModel?.session || nextModel?.modelSession) {
          return await attachHandle(nextModel.handle || nextModel.session || nextModel.modelSession, nextModel, runtimeInfo);
        }
        await assertModelRuntimeCapabilities(nextModel);
        const module = await loadDopplerModule();
        if (nextModel.executablePack) {
          const contract = resolveDopplerExecutionContract(nextModel.executablePack.schema);
          capsuleCache?.close();
          capsuleCache = null;
          try {
            if (nextModel.artifactPolicy?.cache === 'browser_opfs') {
              capsuleCache = await openCapsuleArtifactCache({ model: nextModel });
            }
            const handle = await DopplerRuntimeService[contract.openMethod]({
              scope: serviceScope,
              source: capsuleCache?.capsule || nextModel.packSource,
              options: { ...nextModel.packOpenOptions,
                ...(capsuleCache ? { artifactStore: capsuleCache.artifactStore } : {}),
                acceptedTargetPlanDigests: nextModel.executablePack.acceptedTargetPlanDigests },
              module
            });
            return await attachHandle(handle, nextModel, { ...runtimeInfo, version: module.DOPPLER_VERSION,
              persistentCache: capsuleCache?.getReceipt() || null }, { ownedByService: true });
          } catch (error) {
            try { await DopplerRuntimeService.close(serviceScope); }
            finally { capsuleCache?.close(); capsuleCache = null; }
            throw error;
          }
        }
        const loadOptions = getConfiguredLoadOptions(nextModel);
        const cachePreflight = await preflightPersistentModelCache(nextModel, loadOptions);
        const handle = await DopplerRuntimeService.open({
          scope: serviceScope,
          source: await getDopplerLoadInput(nextModel, module),
          options: loadOptions,
          module
        });
        return await attachHandle(handle, nextModel, {
          ...runtimeInfo,
          version: module?.DOPPLER_VERSION
            || module?.default?.DOPPLER_VERSION
            || runtimeInfo?.version
            || null,
          cachePreflight
        }, { ownedByService: true });
      } catch (error) {
        loadState = 'failed';
        return {
          ok: false,
          reason: error.message
        };
      }
    },
    async activateAdapterPack(pack, { source = null, loadOptions = {}, artifactSources = [] } = {}) {
      if (!session || !modelInfo) throw new Error('Doppler base model must be loaded before an adapter pack');
      const verification = await verifyAdapterPack(pack, { requirePromoted: true });
      if (!verification.ok) throw new Error(`Adapter pack rejected: ${verification.reasons.join('; ')}`);
      if (!versionAtLeast(runtimeInfo.version, pack.runtime.minimumVersion)) {
        throw new Error(
          `Adapter pack requires Doppler ${pack.runtime.minimumVersion} or newer; loaded runtime is ${runtimeInfo.version || 'unidentified'}`
        );
      }
      if (pack.baseModel.modelId !== modelInfo.modelId
        || normalizeHashIdentity(pack.baseModel.modelHash) !== normalizeHashIdentity(modelInfo.modelHash)
        || normalizeHashIdentity(pack.baseModel.manifestHash) !== normalizeHashIdentity(modelInfo.manifestHash)) {
        throw new Error('Adapter pack base model identity does not match the loaded Doppler model');
      }
      if (typeof session.loadLoRA !== 'function') {
        throw new Error('Loaded Doppler session does not expose loadLoRA');
      }
      const loadSource = source || pack.runtimeManifest;
      if (!loadSource) throw new Error('Adapter pack has no runtime load source');
      await session.loadLoRA(loadSource, loadOptions);
      const requirement = adapterRequirementFromPack(pack);
      activeAdapter = Object.freeze({
        ...requirement,
        state: 'active',
        artifactSources: Array.isArray(artifactSources) ? artifactSources : [],
        activatedAt: new Date().toISOString()
      });
      modelInfo = {
        ...modelInfo,
        adapterPacks: [activeAdapter]
      };
      return activeAdapter;
    },
    async deactivateAdapterPack() {
      if (typeof session?.unloadLoRA === 'function') await session.unloadLoRA();
      activeAdapter = null;
      if (modelInfo) modelInfo = { ...modelInfo, adapterPacks: [] };
      return { ok: true };
    },
    getActiveAdapterPack() {
      return activeAdapter;
    },
    isReady() {
      return !!session && !!publicMethodNameForWorkload(session, modelInfo || {});
    },
    getLoadState() {
      return loadState;
    },
    getModelInfo() {
      return modelInfo;
    },
    getRuntimeInfo() {
      return runtimeInfo;
    },
    async getDeviceInfo() {
      if (!deviceInfo) deviceInfo = await collectBrowserDeviceInfo();
      return deviceInfo;
    },
    async getRuntimeProfile() {
      return collectRuntimeProfile({
        runtime: api,
        modelInfo,
        runtimeInfo,
        deviceInfo: await api.getDeviceInfo()
      });
    },
    async cancelActiveWork({ reason = 'cancelled' } = {}) {
      workEpoch += 1;
      if (activeWork) activeWork.reason = reason;
      const signalCancellation = {
        requested: false,
        method: null,
        alreadyAborted: false
      };
      if (activeWork?.abortController) {
        signalCancellation.alreadyAborted = activeWork.abortController.signal.aborted;
        if (!signalCancellation.alreadyAborted) {
          activeWork.abortController.abort(reason);
          signalCancellation.requested = true;
          signalCancellation.method = 'abort_signal';
        }
      }
      const sessionCancellation = await cancelDopplerSession(session, reason).catch((error) => ({
        requested: false,
        method: null,
        error: error.message
      }));
      const cancellation = {
        requested: signalCancellation.requested || sessionCancellation.requested,
        method: sessionCancellation.method || signalCancellation.method,
        signal: signalCancellation,
        session: sessionCancellation
      };
      return {
        ok: true,
        status: 'cancelled',
        reason,
        invalidatedEpoch: workEpoch - 1,
        cancellation
      };
    },
    async generate({ prompt, generationConfig, assignment }) {
      if (!session || !dopplerGenerateMethod(session)) {
        throw new Error('Doppler browser model session is not connected');
      }
      const runGeneration = async (assertCurrent, _signal, assertResultCurrent) => {
        await resetDopplerSession(session);
        assertCurrent();
        const startedAt = new Date().toISOString();
        const result = await generateWithDopplerSession(session, prompt, generationConfig, assignment);
        assertResultCurrent();
        const completedAt = new Date().toISOString();
        const outputText = readDopplerOutputText(result);
        const tokenIds = readDopplerTokenIds(result);
        const dopplerEvidenceComparison = await verifyDopplerGenerationEvidence({
          result,
          generationConfig,
          modelId: modelInfo?.modelId,
          manifestHash: modelInfo?.manifestHash
        });
        const evidenceWarnings = [];
        if (!dopplerEvidenceComparison && tokenIds.length === 0) {
          evidenceWarnings.push('doppler_token_ids_unavailable_from_public_handle');
        }
        const transcript = isObject(result?.transcript)
          ? result.transcript
          : {
            outputText,
            tokenIds,
            evidenceWarnings
          };
        return {
          outputText,
          tokenIds,
          transcript,
          tokenCounts: readDopplerTokenCounts(result, tokenIds),
          timing: result?.timing || { startedAt, completedAt },
          dopplerProviderReceipt: result?.receipt || result?.dopplerProviderReceipt || null,
          dopplerEvidenceComparison,
          adapter: activeAdapter,
          model: modelInfo,
          runtime: runtimeInfo,
          evidenceWarnings,
          status: 'completed'
        };
      };
      return enqueueWork(runGeneration);
    },
    async embed({ prompt, assignment }) {
      if (!session || !dopplerEmbedMethod(session)) {
        throw new Error('Doppler browser embedding session is not connected');
      }
      const runEmbedding = async (assertCurrent, _signal, assertResultCurrent) => {
        await resetDopplerSession(session);
        assertCurrent();
        const startedAt = new Date().toISOString();
        const result = await embedWithDopplerSession(session, prompt, assignment, { workload: POOLDAY_MODEL_WORKLOADS.embedding });
        assertResultCurrent();
        const completedAt = new Date().toISOString();
        const values = readDopplerEmbedding(result);
        if (values.length === 0) throw new Error('Doppler embedding result did not include an embedding vector');
        const stats = summarizeEmbeddingValues(values);
        if (stats.nonFiniteCount > 0) {
          throw new Error(`Doppler embedding result contains ${stats.nonFiniteCount} non-finite values`);
        }
        const vectorHash = await hashJson(values);
        const transcript = {
          outputKind: POOLDAY_MODEL_WORKLOADS.embedding,
          vectorHash,
          dimensions: stats.dimensions,
          l2Norm: stats.l2Norm
        };
        return {
          outputKind: POOLDAY_MODEL_WORKLOADS.embedding,
          outputText: '',
          tokenIds: [],
          vectorHash,
          embeddingDimensions: stats.dimensions,
          embeddingStats: stats,
          transcript,
          tokenCounts: {
            input: Number(result?.tokenCount || result?.tokenCounts?.input || result?.usage?.promptTokens || 0),
            output: 0
          },
          timing: result?.timing || { startedAt, completedAt },
          dopplerProviderReceipt: result?.receipt || result?.dopplerProviderReceipt || null,
          adapter: activeAdapter,
          model: modelInfo,
          runtime: runtimeInfo,
          evidenceWarnings: [],
          status: 'completed'
        };
      };
      return enqueueWork(runEmbedding);
    },
    async encodeSequence({ sequence, request, assignment }) {
      if (!session || !sequenceMethodName(session)) {
        throw new Error('Doppler browser sequence model session is not connected');
      }
      const requiredPack = assignment?.model?.requirements?.executablePack || assignment?.model?.executablePack;
      if (!executablePacksMatch(requiredPack, modelInfo.executablePack)) {
        throw new Error('Assignment executable Pack does not match the loaded session');
      }
      const validation = validateSequenceRequest(request, { model: modelInfo });
      if (!validation.ok) throw new Error(`Sequence request rejected: ${validation.reasons.join('; ')}`);
      if (await sha256Hex(sequence) !== request.sequenceHash) throw new Error('sequence input hash mismatch');
      const runSequence = async (assertCurrent, signal, assertResultCurrent) => {
        await resetDopplerSession(session);
        assertCurrent();
        const startedAt = new Date().toISOString();
        const result = await callDopplerSequence(
          session,
          sequence,
          request,
          assignment,
          { signal }
        );
        if (modelInfo.executablePack) {
          if (!requiredPack) throw new Error('Signed Pack execution requires an assignment Pack binding');
          await assertPackReceipt(requiredPack, result.receipt, {
            assignment, sequence, result,
            options: { assignment, includeTokenEmbeddings: request.includeTokenEmbeddings, includeLogits: request.workload === SEQUENCE_WORKLOADS.maskedLogits }
          });
        }
        if (resultReleaseBarrier) {
          await resultReleaseBarrier({
            workload: request.workload,
            assignment,
            signal
          });
        }
        assertResultCurrent();
        const completedAt = new Date().toISOString();
        const reduced = await reduceDopplerSequenceResult(result, request);
        const {
          tokens,
          pooledEmbedding,
          tokenEmbeddings,
          residueEmbeddings,
          maskedLogits,
          pooledEmbeddingHash,
          pooledStats,
          sequenceResult,
          sequenceResultHash
        } = reduced;
        return {
          outputKind: request.workload,
          outputText: '',
          tokenIds: [],
          vectorHash: pooledEmbeddingHash,
          sequenceResultHash,
          sequenceResult,
          sequenceOutput: {
            pooledEmbedding,
            tokenEmbeddings: request.includeTokenEmbeddings ? tokenEmbeddings : null,
            residueEmbeddings,
            maskedLogits
          },
          embeddingDimensions: pooledEmbedding.length,
          embeddingStats: pooledStats,
          transcript: {
            outputKind: request.workload,
            sequenceResultHash,
            sequenceResult
          },
          tokenCounts: {
            input: tokens.length,
            output: 0
          },
          timing: result?.phase || { startedAt, completedAt },
          dopplerProviderReceipt: result?.receipt || result?.dopplerProviderReceipt || null,
          adapter: activeAdapter,
          model: modelInfo,
          runtime: runtimeInfo,
          evidenceWarnings: [],
          status: 'completed'
        };
      };
      return enqueueWork(runSequence);
    },
    async close({ cancellation: priorCancellation = null } = {}) {
      const cancellation = priorCancellation || await api.cancelActiveWork({ reason: 'runtime_closed' });
      await generationQueue.catch(() => null);
      const activeSession = session;
      const ownedByService = sessionOwnedByService;
      session = null;
      sessionOwnedByService = false;
      activeAdapter = null;
      modelInfo = null;
      deviceInfo = null;
      runtimeInfo = normalizeRuntimeInfo(runtime, null);
      loadState = 'empty';
      try {
        if (ownedByService) {
          await DopplerRuntimeService.close(serviceScope);
        } else {
          await activeSession?.close?.();
          await activeSession?.unload?.();
        }
      } finally { capsuleCache?.close(); capsuleCache = null; }
      return {
        ok: true,
        status: 'closed',
        cancellation,
        workSettlement: lastWorkSettlement ? { ...lastWorkSettlement } : null
      };
    }
  };
  globalThis.REPLOID_POOL_ATTACH_DOPPLER_HANDLE = (handle, nextModel = null, nextRuntime = null) => (
    api.attachHandle(handle, nextModel, nextRuntime)
  );
  return api;
}

export default {
  createDopplerRuntime,
  resetDopplerModuleCacheForTests
};
