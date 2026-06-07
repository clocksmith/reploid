/**
 * @fileoverview Browser-only Doppler runtime adapter for pool providers.
 *
 * Reploid owns the pool protocol. Doppler owns model loading and WebGPU
 * generation. This adapter only talks to public Doppler surfaces or to a
 * caller-provided public handle/session.
 */

import { hashJson } from './inference-receipt.js';

const DOPPLER_IMPORTS = Object.freeze([
  '@simulatte/doppler',
  'doppler-gpu'
]);

let dopplerModulePromise = null;

const hasIdentityValue = (value) => value !== undefined && value !== null && String(value).trim() !== '';

const isBrowserResolvableSpecifier = (specifier) => (
  typeof specifier === 'string'
  && (
    specifier.startsWith('/')
    || specifier.startsWith('./')
    || specifier.startsWith('../')
    || specifier.startsWith('http://')
    || specifier.startsWith('https://')
    || specifier.startsWith('blob:')
    || specifier.startsWith('data:')
  )
);

const configuredDopplerModuleCandidates = () => {
  const candidates = [];
  if (globalThis.REPLOID_DOPPLER_MODULE) candidates.push(globalThis.REPLOID_DOPPLER_MODULE);
  const configured = globalThis.REPLOID_DOPPLER_MODULE_URLS || globalThis.REPLOID_DOPPLER_MODULE_URL;
  if (Array.isArray(configured)) candidates.push(...configured);
  else if (configured) candidates.push(configured);
  candidates.push(...DOPPLER_IMPORTS);
  return candidates;
};

const importDopplerCandidate = async (candidate) => {
  if (candidate && typeof candidate === 'object') return candidate;
  const specifier = String(candidate || '').trim();
  if (!specifier) throw new Error('empty Doppler module specifier');
  if (isBrowserResolvableSpecifier(specifier)) return import(specifier);
  return import(specifier);
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

const generateMethodName = (candidate) => {
  if (!candidate) return null;
  if (typeof candidate.generate === 'function') return 'generate';
  if (typeof candidate.generateText === 'function') return 'generateText';
  if (typeof candidate.run === 'function') return 'run';
  return null;
};

const normalizeTokenIds = (value) => {
  const candidates = [
    value?.tokenIds,
    value?.tokens,
    value?.generatedTokenIds,
    value?.outputTokenIds,
    value?.receipt?.tokenIds,
    value?.receipt?.generatedTokenIds,
    value?.usage?.tokenIds
  ];
  const raw = candidates.find(Array.isArray);
  if (!raw) return [];
  return raw
    .map((token) => {
      if (Number.isInteger(token)) return token;
      if (Number.isInteger(token?.id)) return token.id;
      if (Number.isInteger(token?.tokenId)) return token.tokenId;
      return null;
    })
    .filter(Number.isInteger);
};

const normalizeOutputText = (value) => {
  if (typeof value === 'string') return value;
  const direct = value?.outputText ?? value?.text ?? value?.content ?? value?.completion ?? value?.response;
  if (typeof direct === 'string') return direct;
  const firstOutput = value?.output?.[0]?.content?.[0]?.text ?? value?.choices?.[0]?.message?.content ?? value?.choices?.[0]?.text;
  return typeof firstOutput === 'string' ? firstOutput : '';
};

const normalizeTokenCounts = (value, tokenIds) => {
  const counts = value?.tokenCounts || value?.usage || value?.receipt?.tokenCounts;
  if (counts) {
    return {
      input: Number(counts.input ?? counts.promptTokens ?? counts.prompt_tokens ?? 0),
      output: Number(counts.output ?? counts.completionTokens ?? counts.completion_tokens ?? tokenIds.length)
    };
  }
  return {
    input: 0,
    output: tokenIds.length
  };
};

const isAsyncIterable = (value) => value && typeof value[Symbol.asyncIterator] === 'function';
const isIterable = (value) => value && typeof value[Symbol.iterator] === 'function' && typeof value !== 'string';

const collectGenerationResult = async (value) => {
  if (isAsyncIterable(value)) {
    const chunks = [];
    for await (const chunk of value) {
      chunks.push(String(chunk ?? ''));
    }
    const outputText = chunks.join('');
    return {
      outputText,
      tokenIds: [],
      transcript: {
        chunks,
        outputText,
        tokenIds: [],
        stream: true
      }
    };
  }
  if (isIterable(value)) {
    const chunks = Array.from(value, (chunk) => String(chunk ?? ''));
    const outputText = chunks.join('');
    return {
      outputText,
      tokenIds: [],
      transcript: {
        chunks,
        outputText,
        tokenIds: [],
        stream: false
      }
    };
  }
  return value;
};

const normalizeModelInfo = async (model, handle) => {
  const manifest = model?.manifest || handle?.manifest || handle?.model?.manifest || null;
  const evidence = await getHandleModelEvidence(handle);
  const manifestHash = model?.manifestHash
    || evidence.manifestHash
    || (manifest ? await hashJson(manifest) : null);
  return {
    modelId: model?.modelId || model?.id || evidence.modelId || null,
    modelHash: model?.modelHash || evidence.modelHash || null,
    manifestHash: manifestHash || null,
    contextLength: Number(model?.contextLength || handle?.contextLength || handle?.model?.contextLength || 0),
    quantization: model?.quantization || handle?.quantization || handle?.model?.quantization || null,
    runtime: 'doppler',
    backend: 'browser-webgpu',
    identityEvidence: {
      modelId: hasIdentityValue(evidence.modelId),
      modelHash: hasIdentityValue(evidence.modelHash),
      manifestHash: hasIdentityValue(evidence.manifestHash)
    }
  };
};

const normalizeRuntimeInfo = (runtime, handle) => ({
  runtime: 'doppler',
  backend: 'browser-webgpu',
  hasWebGPU: hasWebGpu(),
  publicApi: generateMethodName(handle),
  device: runtime?.device || handle?.deviceInfo || handle?.device || null,
  profile: runtime?.profile || handle?.runtimeProfile || handle?.profile || null
});

const getHandleModelEvidence = async (handle) => {
  const manifest = handle?.manifest || handle?.model?.manifest || null;
  return {
    modelId: handle?.modelId
      || handle?.id
      || handle?.model?.modelId
      || handle?.model?.id
      || manifest?.modelId
      || manifest?.id
      || null,
    modelHash: handle?.modelHash
      || handle?.hash
      || handle?.model?.modelHash
      || handle?.model?.hash
      || manifest?.modelHash
      || manifest?.hash
      || null,
    manifestHash: handle?.manifestHash
      || handle?.model?.manifestHash
      || handle?.model?.manifest?.hash
      || manifest?.manifestHash
      || manifest?.hash
      || (manifest ? await hashJson(manifest) : null)
  };
};

const assertHandleMatchesDescriptor = async (handle, descriptor = {}) => {
  const evidence = await getHandleModelEvidence(handle);
  const assertField = (field, expected, actual) => {
    if (!hasIdentityValue(expected)) return;
    if (!hasIdentityValue(actual)) {
      throw new Error(`Loaded Doppler handle must expose ${field} before provider registration`);
    }
    if (expected !== actual) {
      throw new Error(`Loaded Doppler handle ${field} does not match requested model identity`);
    }
  };
  assertField('modelId', descriptor?.modelId || descriptor?.id, evidence.modelId);
  assertField('modelHash', descriptor?.modelHash || descriptor?.hash, evidence.modelHash);
  assertField('manifestHash', descriptor?.manifestHash, evidence.manifestHash);
};

const loadDopplerModule = async () => {
  if (!dopplerModulePromise) {
    dopplerModulePromise = (async () => {
      const errors = [];
      for (const candidate of configuredDopplerModuleCandidates()) {
        const label = typeof candidate === 'string' ? candidate : 'globalThis.REPLOID_DOPPLER_MODULE';
        try {
          return await importDopplerCandidate(candidate);
        } catch (error) {
          errors.push(`${label}: ${error.message}`);
        }
      }
      const globalCandidate = globalThis.Doppler || globalThis.doppler || globalThis.dopplerGpu;
      if (globalCandidate && typeof globalCandidate === 'object') return globalCandidate;
      throw new Error(`Unable to load public Doppler module. Configure window.REPLOID_DOPPLER_MODULE_URL or window.REPLOID_DOPPLER_MODULE. Attempts: ${errors.join('; ') || 'none'}`);
    })().catch((error) => {
      dopplerModulePromise = null;
      throw error;
    });
  }
  return dopplerModulePromise;
};

export function resetDopplerModuleCacheForTests() {
  dopplerModulePromise = null;
}

const pickHandle = (result) => result?.handle || result?.model || result?.session || result?.pipeline || result;

const getDopplerLoadInput = (model = {}) => {
  if (model.loadInput) return model.loadInput;
  if (model.dopplerLoadRef || model.registryId || model.loadRef) return model.dopplerLoadRef || model.registryId || model.loadRef;
  if (model.url) return { url: model.url };
  if (model.manifest) return { manifest: model.manifest, baseUrl: model.baseUrl };
  return model.modelId || model.id || model;
};

const positiveIntegerOrUndefined = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
};

const finiteNumberOrUndefined = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

const normalizeStopList = (value, mapItem) => {
  if (!Array.isArray(value)) return undefined;
  const list = value.map(mapItem).filter((item) => item != null);
  return list.length ? list : undefined;
};

const toDopplerGenerationOptions = (generationConfig = {}) => {
  const maxTokens = positiveIntegerOrUndefined(
    generationConfig.maxTokens ?? generationConfig.maxOutputTokens
  );
  const temperature = finiteNumberOrUndefined(generationConfig.temperature);
  const topP = finiteNumberOrUndefined(generationConfig.topP);
  const topK = positiveIntegerOrUndefined(generationConfig.topK);
  const options = {
    maxTokens,
    temperature,
    topP,
    topK,
    stopTokens: normalizeStopList(generationConfig.stopTokens, (token) => (
      Number.isInteger(token) ? token : null
    )),
    stopSequences: normalizeStopList(generationConfig.stopSequences, (sequence) => (
      typeof sequence === 'string' ? sequence : null
    ))
  };
  if (generationConfig.mode === 'greedy') {
    options.temperature = 0;
    options.topK = 1;
    options.topP = 1;
  }
  if (typeof generationConfig.useChatTemplate === 'boolean') {
    options.useChatTemplate = generationConfig.useChatTemplate;
  }
  return Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined)
  );
};

const toDopplerGenerationRequest = (prompt, generationConfig, assignment) => {
  const samplingOptions = toDopplerGenerationOptions(generationConfig);
  return {
    prompt,
    assignment,
    generationConfig,
    samplingOptions,
    ...samplingOptions
  };
};

const runGenerationAttempts = async (attempts) => {
  let firstError = null;
  for (const attempt of attempts) {
    try {
      return await collectGenerationResult(await attempt());
    } catch (error) {
      if (!firstError) firstError = error;
    }
  }
  throw firstError || new Error('Doppler generation failed without an error');
};

const callGenerate = async (session, prompt, generationConfig, assignment) => {
  const dopplerOptions = toDopplerGenerationOptions(generationConfig);
  const request = toDopplerGenerationRequest(prompt, generationConfig, assignment);
  if (typeof session.generate === 'function') {
    const objectFirst = session.generate.length <= 1;
    const promptAttempt = () => session.generate(prompt, dopplerOptions);
    const requestAttempt = () => session.generate(request);
    return runGenerationAttempts(objectFirst
      ? [requestAttempt, promptAttempt]
      : [promptAttempt, requestAttempt]);
  }
  if (typeof session.generateText === 'function') {
    const objectFirst = session.generateText.length <= 1;
    const promptAttempt = () => session.generateText(prompt, dopplerOptions);
    const requestAttempt = () => session.generateText(request);
    return runGenerationAttempts(objectFirst
      ? [requestAttempt, promptAttempt]
      : [promptAttempt, requestAttempt]);
  }
  if (typeof session.run === 'function') {
    return collectGenerationResult(await session.run(request));
  }
  throw new Error('Doppler public handle does not expose generate, generateText, or run');
};

export function createDopplerRuntime({ modelSession = null, model = null, runtime = null } = {}) {
  let session = modelSession;
  let modelInfo = model;
  let runtimeInfo = normalizeRuntimeInfo(runtime, modelSession);
  let loadState = session ? 'loaded' : 'empty';
  let deviceInfo = null;

  const attachHandle = async (handle, nextModel = null, nextRuntime = null) => {
    const method = generateMethodName(handle);
    if (!method) {
      throw new Error('Doppler handle is missing a public generation method');
    }
    await assertHandleMatchesDescriptor(handle, nextModel || modelInfo || {});
    session = handle;
    modelInfo = await normalizeModelInfo(nextModel || modelInfo || {}, handle);
    runtimeInfo = normalizeRuntimeInfo(nextRuntime || runtimeInfo, handle);
    loadState = 'loaded';
    return { ok: true, model: modelInfo, runtime: runtimeInfo };
  };

  const api = {
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
        const module = await loadDopplerModule();
        const loader = module?.load || module?.loadModel || module?.doppler?.load || module?.default?.load;
        if (typeof loader !== 'function') {
          loadState = 'failed';
          return {
            ok: false,
            reason: 'Public Doppler module does not expose load or loadModel'
          };
        }
        const loadOptions = {
          ...(globalThis.REPLOID_DOPPLER_LOAD_OPTIONS || {}),
          ...(nextModel.loadOptions || {})
        };
        const result = await loader(getDopplerLoadInput(nextModel), loadOptions);
        const handle = pickHandle(result);
        return await attachHandle(handle, nextModel, runtimeInfo);
      } catch (error) {
        loadState = 'failed';
        return {
          ok: false,
          reason: error.message
        };
      }
    },
    isReady() {
      return !!session && !!generateMethodName(session);
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
    async generate({ prompt, generationConfig, assignment }) {
      if (!session || !generateMethodName(session)) {
        throw new Error('Doppler browser model session is not connected');
      }
      const startedAt = new Date().toISOString();
      const result = await callGenerate(session, prompt, generationConfig, assignment);
      const completedAt = new Date().toISOString();
      const outputText = normalizeOutputText(result);
      const tokenIds = normalizeTokenIds(result);
      const evidenceWarnings = [];
      if (tokenIds.length === 0) evidenceWarnings.push('doppler_token_ids_unavailable_from_public_handle');
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
        tokenCounts: normalizeTokenCounts(result, tokenIds),
        timing: result?.timing || { startedAt, completedAt },
        dopplerProviderReceipt: result?.receipt || result?.dopplerProviderReceipt || null,
        model: modelInfo,
        runtime: runtimeInfo,
        evidenceWarnings,
        status: 'completed'
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
