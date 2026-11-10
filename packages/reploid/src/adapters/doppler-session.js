import { hashJson } from '../artifacts/signatures.js';
import { computeManifestShardSetHash } from '../artifacts/manifest-identity.js';

// The one place application adapters call Doppler's public session surface:
// module loading, runtime exports, identity, generation, embedding, reset and
// cancellation. Doppler owns computation; hosts own module URLs, load policy,
// scopes, work queues and closing. Importing this module has no side effects.

const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const hasIdentityValue = value => value !== undefined && value !== null && String(value).trim() !== '';
const normalizeHashIdentity = value => {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.startsWith('sha256:') ? text : `sha256:${text}`;
};
const identityValuesMatch = (field, expected, actual) => field === 'modelHash' || field === 'manifestHash'
  ? normalizeHashIdentity(expected) === normalizeHashIdentity(actual)
  : expected === actual;

/** Doppler publishes one runtime object as `dr`, `doppler` and the default export. */
export const resolveDopplerRuntime = module => module?.dr || module?.doppler || module?.default || null;

/** Memoized ordered loading of host-chosen candidates. Objects are already-loaded
 * modules; `importModule` imports a specifier so the host keeps its declared loader.
 * A failed load is forgotten so the next call retries. */
export function createDopplerModuleLoader({ candidates, importModule, prepare = () => {}, fallback = () => null,
  injectedLabel = 'injected Doppler module', unavailableMessage = 'Unable to load public Doppler module.' }) {
  let pending = null;
  return Object.freeze({
    load() {
      pending ||= (async () => {
        prepare();
        const errors = [];
        for (const candidate of candidates()) {
          const label = typeof candidate === 'string' ? candidate : injectedLabel;
          try {
            return candidate && typeof candidate === 'object' ? candidate : await importModule(candidate);
          } catch (error) {
            errors.push(`${label}: ${error.message}`);
          }
        }
        const loaded = fallback();
        if (loaded && typeof loaded === 'object') return loaded;
        throw new Error(`${unavailableMessage} Attempts: ${errors.join('; ') || 'none'}`);
      })().catch(error => {
        pending = null;
        throw error;
      });
      return pending;
    },
    reset() { pending = null; }
  });
}

export function dopplerGenerateMethod(session) {
  if (!session) return null;
  for (const name of ['generateWithEvidence', 'generate', 'generateText', 'run']) {
    if (typeof session[name] === 'function') return name;
  }
  return null;
}

export function dopplerEmbedMethod(session) {
  if (!session) return null;
  for (const name of ['embed', 'embedText', 'run']) {
    if (typeof session[name] === 'function') return name;
  }
  return null;
}

/** Identity a loaded public session reports about itself; never the request's claim. */
export async function readDopplerSessionIdentity(session) {
  const manifest = session?.manifest || session?.model?.manifest || null;
  const artifactIdentity = manifest?.artifactIdentity || session?.artifactIdentity || session?.model?.artifactIdentity || null;
  const modelHash = manifest?.modelHash
    || manifest?.artifactIdentity?.weightPackHash
    || manifest?.artifactIdentity?.shardSetHash
    || (manifest ? await computeManifestShardSetHash(manifest) : null)
    || session?.modelHash
    || session?.hash
    || session?.model?.modelHash
    || session?.model?.hash
    || (artifactIdentity ? await hashJson(artifactIdentity) : null);
  const declaredManifestHash = manifest?.manifestHash || manifest?.hash || null;
  const manifestHash = declaredManifestHash
    || session?.manifestHash
    || session?.model?.manifestHash
    || session?.model?.manifest?.hash
    || null;
  return {
    modelId: manifest?.modelId || manifest?.id || session?.modelId || session?.id
      || session?.model?.modelId || session?.model?.id || null,
    modelHash,
    manifestHash,
    runtimeManifestHash: manifest ? await hashJson(manifest) : null,
    declaredManifestHash,
    artifactIdentity
  };
}

const artifactIdentityValueMatches = (expected, actual) => {
  if (expected === undefined) return true;
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && expected.length === actual.length
      && expected.every((value, index) => artifactIdentityValueMatches(value, actual[index]));
  }
  if (isObject(expected)) {
    return isObject(actual) && Object.entries(expected).every(([key, value]) => artifactIdentityValueMatches(value, actual[key]));
  }
  return expected === actual;
};

/** Reject a session whose reported identity differs from the requested descriptor.
 * A signed session passes `packIdentity` (its contract's session identity record),
 * whose semantic root and envelope digest replace the manifest-derived hashes. */
export async function assertDopplerSessionIdentity(session, descriptor = {}, options = {}) {
  const evidence = await readDopplerSessionIdentity(session);
  if (Object.hasOwn(options, 'packIdentity')) {
    evidence.modelHash = options.packIdentity.semanticRoot;
    evidence.manifestHash = options.packIdentity.envelopeDigest;
    evidence.declaredManifestHash = options.packIdentity.envelopeDigest;
  }
  const assertField = (field, expected, actual) => {
    if (!hasIdentityValue(expected)) return;
    if (!hasIdentityValue(actual)) throw new Error(`Loaded Doppler handle must expose ${field} before provider registration`);
    if (!identityValuesMatch(field, expected, actual)) {
      throw new Error(`Loaded Doppler handle ${field} does not match requested model identity`);
    }
  };
  assertField('modelId', descriptor?.modelId || descriptor?.id, evidence.modelId);
  assertField('modelHash', descriptor?.modelHash || descriptor?.hash, evidence.modelHash);
  if (hasIdentityValue(descriptor?.manifestHash)) {
    if (hasIdentityValue(evidence.declaredManifestHash)) {
      assertField('manifestHash', descriptor.manifestHash, evidence.declaredManifestHash);
    } else {
      const observed = [evidence.manifestHash, evidence.runtimeManifestHash].filter(hasIdentityValue);
      if (observed.length === 0 && !evidence.artifactIdentity) {
        throw new Error('Loaded Doppler handle must expose manifestHash or artifactIdentity before provider registration');
      }
      const canonicalHashMatches = observed.some(hash => identityValuesMatch('manifestHash', descriptor.manifestHash, hash));
      // A preflight-verified byte hash may name the manifest Doppler later normalized.
      const byteHashMatches = hasIdentityValue(descriptor.manifestByteHash) && hasIdentityValue(evidence.manifestHash)
        && identityValuesMatch('manifestHash', descriptor.manifestByteHash, evidence.manifestHash);
      if (observed.length > 0 && !canonicalHashMatches && !byteHashMatches) {
        throw new Error('Loaded Doppler handle manifestHash does not match requested model identity');
      }
    }
  }
  if (descriptor?.artifactIdentity && !(isObject(evidence.artifactIdentity) && Object.entries(descriptor.artifactIdentity)
    .every(([key, value]) => artifactIdentityValueMatches(value, evidence.artifactIdentity[key])))) {
    throw new Error('Loaded Doppler handle artifactIdentity does not match requested model identity');
  }
}

const positiveIntegerOrUndefined = value => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
};
const finiteNumberOrUndefined = value => {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};
const stopList = (value, mapItem) => {
  if (!Array.isArray(value)) return undefined;
  const list = value.map(mapItem).filter(item => item != null);
  return list.length ? list : undefined;
};

/** Translate a Reploid generation configuration into Doppler's public sampling
 * options. Doppler validates the values and owns their meaning. */
export function toDopplerSamplingOptions(generationConfig = {}) {
  const options = {
    maxTokens: positiveIntegerOrUndefined(generationConfig.maxTokens ?? generationConfig.maxOutputTokens),
    temperature: finiteNumberOrUndefined(generationConfig.temperature),
    topP: finiteNumberOrUndefined(generationConfig.topP),
    topK: positiveIntegerOrUndefined(generationConfig.topK),
    useSpeculative: typeof generationConfig.useSpeculative === 'boolean' ? generationConfig.useSpeculative : false,
    stopTokens: stopList(generationConfig.stopTokens, token => Number.isInteger(token) ? token : null),
    stopSequences: stopList(generationConfig.stopSequences, sequence => typeof sequence === 'string' ? sequence : null)
  };
  if (generationConfig.mode === 'greedy') Object.assign(options, { temperature: 0, topK: 1, topP: 1 });
  if (typeof generationConfig.useChatTemplate === 'boolean') options.useChatTemplate = generationConfig.useChatTemplate;
  return Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
}

const isAsyncIterable = value => value && typeof value[Symbol.asyncIterator] === 'function';
const isIterable = value => value && typeof value[Symbol.iterator] === 'function' && typeof value !== 'string';
const collected = (chunks, stream) => {
  const outputText = chunks.join('');
  return { outputText, tokenIds: [], transcript: { chunks, outputText, tokenIds: [], stream } };
};
async function collectGeneration(value) {
  if (isAsyncIterable(value)) {
    const chunks = [];
    for await (const chunk of value) chunks.push(String(chunk ?? ''));
    return collected(chunks, true);
  }
  if (isIterable(value)) return collected(Array.from(value, chunk => String(chunk ?? '')), false);
  return value;
}

async function firstSuccessful(attempts) {
  let firstError = null;
  for (const attempt of attempts) {
    try {
      return await collectGeneration(await attempt());
    } catch (error) {
      if (!firstError) firstError = error;
    }
  }
  throw firstError || new Error('Doppler generation failed without an error');
}

/** Generate through whichever public method the session exposes. Prompt-and-options
 * calls precede the request-object form older handles accept. */
export async function generateWithDopplerSession(session, prompt, generationConfig, assignment) {
  const samplingOptions = toDopplerSamplingOptions(generationConfig);
  const requestOptions = toDopplerSamplingOptions(generationConfig);
  const request = { prompt, assignment, generationConfig, samplingOptions: requestOptions, ...requestOptions };
  if (typeof session.generateWithEvidence === 'function') {
    return collectGeneration(await session.generateWithEvidence(prompt, samplingOptions));
  }
  for (const method of ['generateText', 'generate']) {
    if (typeof session[method] === 'function') {
      return firstSuccessful([() => session[method](prompt, samplingOptions), () => session[method](request)]);
    }
  }
  if (typeof session.run === 'function') return collectGeneration(await session.run(request));
  throw new Error('Doppler public handle does not expose generate, generateText, or run');
}

export async function embedWithDopplerSession(session, prompt, assignment, { workload } = {}) {
  if (typeof session.embed === 'function') return session.embed(prompt, { assignment });
  if (typeof session.embedText === 'function') return session.embedText(prompt, { assignment });
  if (typeof session.run === 'function') return session.run({ prompt, input: prompt, assignment, workload });
  throw new Error('Doppler public handle does not expose embed, embedText, or run');
}

/** Text deltas from a scoped session stream; completion events carry no new text. */
export async function* streamDopplerText(session, input, options) {
  for await (const event of session.stream(input, options)) {
    if (event?.type === 'text-delta') yield event.text;
  }
}

export function readDopplerOutputText(result) {
  if (typeof result === 'string') return result;
  const direct = result?.outputText ?? result?.text ?? result?.content ?? result?.completion ?? result?.response;
  if (typeof direct === 'string') return direct;
  const first = result?.output?.[0]?.content?.[0]?.text ?? result?.choices?.[0]?.message?.content ?? result?.choices?.[0]?.text;
  return typeof first === 'string' ? first : '';
}

export function readDopplerTokenIds(result) {
  const raw = [result?.tokenIds, result?.tokens, result?.generatedTokenIds, result?.outputTokenIds,
    result?.receipt?.tokenIds, result?.receipt?.generatedTokenIds, result?.usage?.tokenIds].find(Array.isArray);
  if (!raw) return [];
  return raw.map(token => {
    if (Number.isInteger(token)) return token;
    if (Number.isInteger(token?.id)) return token.id;
    if (Number.isInteger(token?.tokenId)) return token.tokenId;
    return null;
  }).filter(Number.isInteger);
}

export function readDopplerTokenCounts(result, tokenIds) {
  const counts = result?.tokenCounts || result?.usage || result?.receipt?.tokenCounts;
  if (!counts) return { input: 0, output: tokenIds.length };
  return {
    input: Number(counts.input ?? counts.promptTokens ?? counts.prompt_tokens ?? 0),
    output: Number(counts.output ?? counts.completionTokens ?? counts.completion_tokens ?? tokenIds.length)
  };
}

/** Embedding values as float32-rounded numbers; finiteness is the caller's check. */
export function readDopplerEmbedding(result) {
  const candidate = ArrayBuffer.isView(result) || Array.isArray(result) ? result
    : result?.embedding || result?.vector || result?.values || result?.outputEmbedding
      || result?.result?.embedding || result?.receipt?.embedding;
  if (!(ArrayBuffer.isView(candidate) || Array.isArray(candidate))) return [];
  return Array.from(candidate, item => Math.fround(Number(item)));
}

const DOPPLER_GENERATION_EVIDENCE_SCHEMA = 'doppler_generation_evidence/v1';
const field = (name, expected, actual) => ({ field: name, expected, actual, matched: expected === actual });

/** Check Doppler's own generation evidence against the delivered output, the requested
 * options and the loaded model. Null when the session supplied no evidence. */
export async function verifyDopplerGenerationEvidence({ result, generationConfig, modelId, manifestHash }) {
  if (result?.schema !== DOPPLER_GENERATION_EVIDENCE_SCHEMA) return null;
  if (!isObject(result.transcript) || !isObject(result.generationConfig)) {
    throw new Error('Doppler generation evidence is missing transcript or generationConfig');
  }
  if (!isObject(result.runtimeProfile) || !isObject(result.backendIdentity)) {
    throw new Error('Doppler generation evidence is missing runtimeProfile or backendIdentity');
  }
  const configFields = await Promise.all(Object.entries(toDopplerSamplingOptions(generationConfig))
    .filter(([name]) => name !== 'stopTokens')
    .map(async ([name, expected]) => field(`generationConfig.${name}`,
      await hashJson(expected), await hashJson(result.generationConfig[name]))));
  const fields = [
    field('outputText', readDopplerOutputText(result), result.transcript.outputText),
    field('tokenIdsHash', await hashJson(readDopplerTokenIds(result)), await hashJson(result.transcript.tokenIds)),
    field('transcriptHash', await hashJson(result.transcript), result.transcriptHash),
    field('generationConfigHash', await hashJson(result.generationConfig), result.generationConfigHash),
    field('runtimeProfileHash', await hashJson(result.runtimeProfile), result.runtimeProfileHash),
    field('backendIdentityHash', await hashJson(result.backendIdentity), result.backendIdentityHash),
    field('modelId', modelId || null, result.runtimeProfile?.model?.modelId || null),
    field('manifestHash', normalizeHashIdentity(manifestHash), normalizeHashIdentity(result.runtimeProfile?.model?.manifestHash)),
    field('backend', 'webgpu', result.backendIdentity?.backend || null),
    ...configFields
  ];
  const mismatch = fields.find(item => item.matched !== true);
  if (mismatch) {
    throw new Error(`Doppler generation evidence ${mismatch.field} mismatch: expected ${mismatch.expected}, got ${mismatch.actual}`);
  }
  return {
    schema: 'reploid.doppler_generation_evidence_comparison/v1',
    verified: true,
    evidenceSchema: result.schema,
    transcriptHash: result.transcriptHash,
    generationConfigHash: result.generationConfigHash,
    runtimeProfileHash: result.runtimeProfileHash,
    backendIdentityHash: result.backendIdentityHash,
    fields
  };
}

/** Clear decoder state between independent requests on a resident session. */
export async function resetDopplerSession(session) {
  if (typeof session?.resetGenerationState === 'function') {
    await session.resetGenerationState();
    return;
  }
  if (typeof session?.resetToSeqLen === 'function') await session.resetToSeqLen(0);
}

/** Ask the session to stop. A request is not a confirmation that GPU work ended. */
export async function cancelDopplerSession(session, reason) {
  if (!session) return { requested: false, method: null };
  for (const method of ['abort', 'cancel']) {
    if (typeof session[method] !== 'function') continue;
    await session[method]({ reason });
    return { requested: true, method };
  }
  return { requested: false, method: null };
}
