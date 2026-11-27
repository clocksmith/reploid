/** Shared scoped Doppler/provider bridge; hosts supply catalog and execution policy. */
import { hostedApiUrl } from '../config/hosted-api.js';
import { createGenerationContextCache } from '../vendor/reploid/mesh/generation-context-cache.js';
import { REVERSE_PROMPT_GENERATION, REVERSE_PROMPT_GENERATION_HASH, hasReversePromptTemplate } from './reverse-prompt-profile.js';
import { DOPPLER_PACKAGE_VERSION } from '../config/doppler-local-models.js';
import { publicProviderHardware } from '../vendor/reploid/mesh/provider-hardware.js';
import { consumeWorkGenerationStream, readWorkGenerationCompletion, readWorkGenerationTiming } from './generation-completion.js';
import { createToolCallEnforcement, sessionEndTokenIds } from './tool-call-constraint.js';
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };

export async function openScopedModelProvider({ model, service, scope, signal, credentials,
  fetchImpl = globalThis.fetch, generation, maxOutcomeCharacters, allowedFallbackModels = [], onProgress,
  resolveAdapter, source = model.id, loadOptions = {}, providerPolicy }) {
  requireValue(providerPolicy?.contextCache && providerPolicy?.adapterQualification, 'Scoped provider policy is required');
  signal.throwIfAborted();
  generation = { ...generation, ...model.generation };
  const session = model.provider === 'doppler'
    ? await service.open({ scope, source, options: { ...model.loadOptions, ...loadOptions, onProgress } }) : null;
  signal.throwIfAborted();
  if (session) requireValue(typeof session.stream === 'function', 'Configured Doppler session does not expose text streaming');
  else requireValue(typeof credentials === 'function', 'Firebase Auth and App Check credentials are required');
  let healthy = true;
  const toolCalls = createToolCallEnforcement();
  const configuredBufferBudget = (loadOptions?.runtimeConfig ?? model.loadOptions?.runtimeConfig)?.shared?.bufferPool?.budget?.maxTotalBytes;
  const contextCachePolicy = Number.isFinite(configuredBufferBudget) && configuredBufferBudget > 0
    ? (() => {
      const maxBytes = Math.min(providerPolicy.contextCache.maxBytes, Math.max(67108864, Math.floor(configuredBufferBudget * 0.25)));
      return { ...providerPolicy.contextCache, maxBytes, maxEntryBytes: Math.min(providerPolicy.contextCache.maxEntryBytes, maxBytes) };
    })()
    : providerPolicy.contextCache;
  const contexts = session?.supports?.('generationContext') === true
    ? createGenerationContextCache({ policy: contextCachePolicy, create: options => session.createGenerationContext(options) }) : null;
  const executionIdentity = () => {
    if (!session) return null;
    requireValue(healthy, 'Doppler session requires replacement after failed cleanup');
    requireValue(session.loaded === true && typeof session.modelId === 'string', 'Doppler session is not ready');
    const hash = String(session.manifestHash || '').replace(/^sha256:/, '');
    requireValue(/^[a-f0-9]{64}$/.test(hash), 'Doppler session is missing its manifest identity');
    requireValue(session.modelId === model.id, 'Doppler loaded a different model');
    requireValue(!model.identity || model.identity === 'sha256:' + hash, 'Doppler loaded a different model artifact');
    requireValue(!session.activeLoRA, 'Active adapter identity requires Doppler generation evidence');
    return { model: session.modelId, modelIdentity: 'sha256:' + hash,
      adapterIdentities: [] };
  };
  const evidencedIdentity = (result, adapters) => {
    const actual = result?.evidence?.runtimeProfile?.model;
    const hash = String(actual?.manifestHash || '').replace(/^sha256:/, '');
    requireValue(actual?.modelId === model.id && 'sha256:' + hash === model.identity,
      'Doppler generation evidence has a different model artifact');
    const identities = actual.activeAdapterDigest ? [actual.activeAdapterDigest] : [];
    requireValue(JSON.stringify(identities) === JSON.stringify(adapters.map(item => item.identity)),
      'Doppler generation evidence has a different adapter artifact');
    return { model: actual.modelId, modelIdentity: 'sha256:' + hash, adapterIdentities: identities };
  };
  if (session) executionIdentity();
  const reset = async () => {
    if (!session) return;
    requireValue(typeof session.resetGenerationState === 'function', 'Doppler session cannot reset conversation state');
    try { await session.resetGenerationState(); }
    catch (error) { healthy = false; throw error; }
  };
  const setAdapters = async (adapters, attemptSignal = signal) => {
    requireValue(Array.isArray(adapters) && adapters.length <= 1, 'This Doppler session supports one adapter at a time');
    const selected = adapters[0];
    if (selected) {
      requireValue(selected.baseModelIdentity === model.identity, 'Adapter targets a different base model artifact');
      requireValue(/^sha256:[a-f0-9]{64}$/.test(selected.identity), 'Exact adapter execution identity required');
      requireValue(typeof resolveAdapter === 'function', 'Verified adapter acquisition is unavailable');
    }
    requireValue(session, 'Adapters require a Doppler session');
    if (session.activeLoRA) await session.unloadLoRA();
    requireValue(!session.activeLoRA, 'Doppler did not remove the previous adapter');
    if (!selected) return;
    attemptSignal.throwIfAborted();
    const acquired = await resolveAdapter(structuredClone(selected), { signal: attemptSignal });
    attemptSignal.throwIfAborted();
    requireValue(acquired?.manifest?.baseModel === model.id, 'Adapter manifest targets a different model');
    await session.loadLoRA(acquired.manifest, acquired.options);
    attemptSignal.throwIfAborted();
    requireValue(session.activeLoRA, 'Doppler did not apply the adapter');
  };
  return Object.freeze({
    getIdentity: executionIdentity,
    getHardware: () => publicProviderHardware(session?.deviceInfo),
    getContextCacheStats: () => contexts?.getStats?.() ?? null,
    isReady: () => healthy && session?.loaded === true,
    reset,
    close: () => contexts?.close(),
    async prepareAdapters(adapters) {
      try {
        await setAdapters(adapters);
        // The pinned scoped API reports tensor identity in execution evidence, not a session getter.
        const result = await session.generate(providerPolicy.adapterQualification.messages,
          { ...providerPolicy.adapterQualification.generation, signal });
        signal.throwIfAborted();
        return evidencedIdentity(result, adapters).adapterIdentities;
      } finally {
        try { await setAdapters([]); await reset(); }
        catch (error) { healthy = false; throw error; }
      }
    },
    /** Teacher-forced log-probability of `target` after `messages`, for the receipt-bound score (mesh/target-scoring.js). */
    scoreTarget({ messages, target, signal: attemptSignal }) {
      return this.executeOperation({ operation: 'scoreTargetSequence', payload: { messages, target }, signal: attemptSignal });
    },
    /** The mesh operations this session runs besides generation (mesh/operation-envelope.js), from what it exposes. */
    supportedOperations: () => ['generate', ...(session?.supports?.('targetScoring') === true && typeof session.scoreTargetSequence === 'function'
      ? ['scoreTargetSequence'] : []), ...(typeof session?.scoreChoices === 'function' ? ['scoreChoices'] : []),
    ...(session?.supports?.('embed') === true && typeof session.embed === 'function' ? ['embed'] : [])],
    /**
     * One non-generation mesh operation on the base model, as DopplerX defines it: `scoreTargetSequence` (teacher-forced
     * log-probability of `target` after `messages` or `prompt`), `scoreChoices` (next-token logits of each choice after
     * `prompt`) and `embed` (`input`). The context bound is the session's own. Returns DopplerX's result with `modelIdentity`.
     */
    async executeOperation({ operation, payload, signal: attemptSignal }) {
      const combined = AbortSignal.any([signal, attemptSignal]);
      combined.throwIfAborted();
      const identity = executionIdentity();
      const geometry = session.supports?.('advanced') === false ? null : session.advanced?.getGenerationGeometry?.();
      const maxSeqLen = Number.isSafeInteger(geometry?.maxSeqLen) && geometry.maxSeqLen > 0 ? geometry.maxSeqLen : 4096;
      let result;
      if (operation === 'scoreTargetSequence') {
        requireValue(session?.supports?.('targetScoring') === true && typeof session.scoreTargetSequence === 'function',
          'This runtime cannot score a target sequence; install DopplerX 0.1.6 or later');
        const { messages, prompt, target } = payload ?? {};
        result = await session.scoreTargetSequence({ ...(messages === undefined ? { prompt } : { messages: structuredClone(messages) }), target, maxSeqLen },
          { signal: combined });
        requireValue(result?.schema === 'doppler.target-sequence-score/v1' && Number.isFinite(result.roundedTotalLogProb)
          && Number.isSafeInteger(result.tokenCount) && result.tokenCount > 0, 'Doppler returned an invalid target score');
      } else if (operation === 'scoreChoices') {
        requireValue(typeof session?.scoreChoices === 'function', 'This runtime cannot score choices');
        result = await session.scoreChoices({ prompt: payload?.prompt, choices: structuredClone(payload?.choices), maxSeqLen }, { signal: combined });
        requireValue(result?.schema === 'doppler.choice-scores/v1' && Array.isArray(result.choices), 'Doppler returned invalid choice scores');
      } else if (operation === 'embed') {
        requireValue(session?.supports?.('embed') === true && typeof session.embed === 'function', 'This runtime cannot embed');
        requireValue(typeof payload?.input === 'string' && payload.input.length > 0, 'Embedding input text is required');
        const evidence = await session.embed(payload.input, {});
        requireValue(evidence?.schema === 'doppler_embedding_evidence/v1' && ArrayBuffer.isView(evidence.embedding), 'Doppler returned an invalid embedding');
        // Carried as JSON: the vector as numbers, with Doppler's own input and output hashes.
        result = { schema: evidence.schema, embedding: Array.from(evidence.embedding), tokenCount: evidence.tokens?.length ?? null,
          seqLen: evidence.seqLen, embeddingMode: evidence.embeddingMode, inputHash: evidence.inputHash, outputHash: evidence.outputHash };
      } else throw new Error(`Unsupported mesh operation ${operation}`);
      combined.throwIfAborted();
      return { ...result, modelIdentity: identity.modelIdentity };
    },
    async generate(messages, onUpdate = () => {}, { signal: attemptSignal, adapters = [], maxOutputTokens, contextOwner, contextId, settings, onUsage }) {
      const combined = AbortSignal.any([signal, attemptSignal]);
      combined.throwIfAborted();
      requireValue(maxOutputTokens === undefined || Number.isSafeInteger(maxOutputTokens) && maxOutputTokens > 0,
        'Request maxOutputTokens must be a positive integer');
      let requestGeneration = maxOutputTokens === undefined ? generation
        : { ...generation, maxTokens: Math.min(generation.maxTokens ?? maxOutputTokens, maxOutputTokens) };
      // Tool settings: Doppler's chat templates carry no tools, so the conversation is rendered to
      // plain messages here, and a call that may or must be made is enforced by a token mask whose
      // identity is returned for the receipt. A request without tools or tool messages is untouched.
      const reversePrompt = settings?.reversePrompt;
      let tooling;
      try {
        if (reversePrompt) {
          requireValue(hasReversePromptTemplate(session?.manifest),
          'Reverse prompting requires a pinned Qwen template with thinking disabled');
          requireValue(!adapters.length && maxOutputTokens === 16 && requestGeneration.maxTokens === 16,
            'Reverse prompting requires the base model and a 16-token budget');
          requestGeneration = { ...requestGeneration, ...REVERSE_PROMPT_GENERATION };
        }
        tooling = await toolCalls.prepare(messages, settings, { endTokenIds: () => sessionEndTokenIds(session) });
        // A model that declares reasoning output must open every answer with its reasoning marker,
        // which a constraint that starts at the first token forbids.
        requireValue(!tooling.constraintIdentity || !session.manifest?.inference?.output?.reasoningOutput,
          'An output constraint cannot be applied to a model that declares reasoning output');
      } catch (error) {
        // Refused before the session was touched: a request this provider cannot serve does not retire the model.
        throw Object.assign(error, { recoverableSession: true });
      }
      combined.throwIfAborted();
      messages = tooling.messages;
      requestGeneration = { ...requestGeneration, ...tooling.generation };
      let text = '', actualModel = model.id, actualIdentity = null, completion = null, timing = null;
      // The prompt's token count, known before generation only where it is tokenized for the context check.
      let promptTokenCount = null;
      const update = delta => {
        combined.throwIfAborted();
        requireValue(typeof delta === 'string', 'Provider emitted an invalid text delta');
        text += delta;
        requireValue(text.length <= maxOutcomeCharacters, 'Model response exceeded the configured size limit');
        return onUpdate(delta);
      };
      if (session) {
        const advanced = session.supports?.('advanced') === false ? null : session.advanced;
        if (typeof advanced?.getGenerationGeometry === 'function' && typeof advanced?.tokenizePrompt === 'function') {
          const maxSeqLen = advanced.getGenerationGeometry()?.maxSeqLen;
          if (Number.isSafeInteger(maxSeqLen) && maxSeqLen > 0) {
            const promptTokens = promptTokenCount = advanced.tokenizePrompt(messages, { useChatTemplate: requestGeneration.useChatTemplate !== false }).length;
            const requiredOutputTokens = Number.isSafeInteger(requestGeneration.maxTokens) && requestGeneration.maxTokens > 0
              ? requestGeneration.maxTokens : 1;
            // A request's own output budget must fit whole. The configured default is only a ceiling
            // (contributor profiles set it to the full context): it shrinks to the remaining context.
            if (promptTokens + requiredOutputTokens > maxSeqLen && maxOutputTokens === undefined && promptTokens < maxSeqLen) {
              requestGeneration = { ...requestGeneration, maxTokens: maxSeqLen - promptTokens };
            } else if (promptTokens + requiredOutputTokens > maxSeqLen) {
              throw Object.assign(
                new Error(`Conversation plus output budget exceeds model context limit (${promptTokens} + ${requiredOutputTokens} > ${maxSeqLen} tokens)`),
                { code: 'CONTEXT_LENGTH_EXCEEDED', recoverableSession: true, status: 400 }
              );
            }
          }
        }
        // Raw compatibility sessions cancel cooperatively; the host waits for settlement.
        await reset();
        let lease = null, complete = false;
        try {
          await setAdapters(adapters, combined);
          const contextKey = typeof contextOwner === 'string' && contextOwner && typeof contextId === 'string' && contextId
            ? JSON.stringify([contextOwner, contextId, model.identity, adapters.map(item => item.identity)]) : null;
          lease = reversePrompt ? null : contexts?.acquire(contextKey);
          const cachedGeneration = lease ? { ...requestGeneration, generationContext: lease.context } : requestGeneration;
          // Reported once, after tool rendering and before the first token, so a caller can open its
          // stream with the actual input count. Where the prompt was not tokenized nothing is
          // reported: a count is never invented.
          if (typeof onUsage === 'function' && promptTokenCount > 0) {
            await onUsage({ inputTokens: promptTokenCount });
            combined.throwIfAborted();
          }
          if (adapters.length || reversePrompt) {
            const result = await session.generate(messages, { ...cachedGeneration, signal: combined,
              ...(reversePrompt ? {} : { onToken: (_token, delta) => { if (typeof delta === 'string') update(delta); } }) });
            if (reversePrompt) {
              const actual = result.evidence?.generationConfig;
              const runtime = result.evidence?.runtimeProfile?.runtime;
              requireValue(runtime?.package === 'dopplerx' && runtime.version === DOPPLER_PACKAGE_VERSION && runtime.surface === 'node'
                && result.evidence?.backendIdentityHash === reversePrompt.backendIdentityHash
                && result.evidence.generationConfigHash === REVERSE_PROMPT_GENERATION_HASH
                && Object.entries(REVERSE_PROMPT_GENERATION).every(([key, value]) => key === 'stopSequences'
                  ? Array.isArray(actual?.stopSequences) && !actual.stopSequences.length : actual?.[key] === value),
              'Reverse-prompt execution differed from the qualified backend or decoding policy');
            }
            // Doppler owns visible output. Older callbacks supply only token IDs;
            // those sessions deliver completion text without decoding IDs here.
            requireValue(typeof result.outputText === 'string' && result.outputText.startsWith(text),
              'Doppler streamed text differs from generation evidence');
            await update(result.outputText.slice(text.length));
            actualIdentity = evidencedIdentity(result, adapters);
            completion = readWorkGenerationCompletion(result);
            timing = readWorkGenerationTiming(result.evidence?.stats);
            requireValue(text === result.outputText, 'Doppler streamed text differs from generation evidence');
          } else {
            actualIdentity = executionIdentity();
            const result = await consumeWorkGenerationStream(session.stream(messages, { ...cachedGeneration, signal: combined }),
              { signal: combined, onDelta: update, maxOutcomeCharacters });
            completion = result.completion;
            timing = readWorkGenerationTiming(session.supports?.('advanced') === false
              ? null : session.advanced?.getStats?.());
            requireValue(JSON.stringify(executionIdentity()) === JSON.stringify(actualIdentity),
              'Doppler execution identity changed during generation');
          }
          combined.throwIfAborted();
          complete = true;
        } finally {
          try { lease?.release({ discard: !complete }); await reset(); await setAdapters([]); }
          catch (error) { healthy = false; throw error; }
        }
        actualModel = actualIdentity.model;
      } else {
        const headers = new Headers(await credentials({ signal: combined }));
        requireValue(/^Bearer\s+\S+$/i.test(headers.get('Authorization') || '')
          && !!headers.get('X-Firebase-AppCheck')?.trim(), 'Firebase Auth and App Check credentials are required');
        headers.set('Content-Type', 'application/json');
        combined.throwIfAborted();
        const response = await fetchImpl(hostedApiUrl('/zero/gemini'), {
          method: 'POST', headers,
          body: JSON.stringify({ model: model.id, provider: model.provider, messages,
            allowedFallbackModels, maxOutputTokens: requestGeneration.maxTokens }),
          signal: combined
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          const error = new Error(`Gemini HTTP ${response.status}: ${data.error || response.statusText}`);
          error.status = response.status;
          error.retryAfter = response.headers.get('retry-after');
          throw error;
        }
        const data = await response.json();
        actualModel = data.model || data.effectiveModel;
        requireValue(typeof actualModel === 'string' && actualModel,
          'Provider response is missing execution model identity');
        requireValue(actualModel === model.id || allowedFallbackModels.includes(actualModel),
          'Provider substituted a model outside the declared fallback policy');
        requireValue(!data.provider || data.provider === model.provider, 'Provider identity mismatch');
        await update(data.content);
      }
      combined.throwIfAborted();
      requireValue(text.trim() || completion?.stopReason === 'max-tokens', 'Provider returned no text');
      // A constraint is reported only for an answer every one of whose tokens was sampled under the mask.
      if (tooling.constraintIdentity) {
        const generated = completion?.generatedTokenCount;
        requireValue(Number.isSafeInteger(generated) && tooling.maskedSteps() >= generated,
          `Model runtime applied the output constraint to ${tooling.maskedSteps()} of ${generated ?? 'an unknown number of'} generated tokens`);
      }
      return { content: text, raw: text, requestedModel: model.id, model: actualModel,
        ...(session ? { ...actualIdentity, completion, timing, hardware: publicProviderHardware(session.deviceInfo) } : {}),
        ...(tooling.constraintIdentity ? { constraintIdentity: tooling.constraintIdentity } : {}),
        provider: model.provider, execution: session ? 'local-scoped-session' : 'cloud-proxy-session' };
    }
  });
}
