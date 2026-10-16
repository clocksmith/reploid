/** Host-selected compatibility providers. Signed Pack providers remain separate. */
import profile from '../config/work-profile.json' with { type: 'json' };
import { consumeWorkGenerationStream, readWorkGenerationCompletion, readWorkGenerationTiming } from './work-generation-completion.js';
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };

export function selectWorkModel({ models, modelId, defaultModelId }) {
  const id = modelId === undefined || modelId === null || modelId === '' ? defaultModelId : modelId;
  const model = models.find(item => item.id === id);
  requireValue(model, `Unknown application model: ${String(id)}`);
  requireValue(['doppler', 'gemini'].includes(model.provider), 'Model requires an explicit supported provider');
  return Object.freeze({ ...model });
}

export async function openWorkProvider({ model, service, scope, signal, credentials,
  fetchImpl = globalThis.fetch, generation, maxOutcomeCharacters, allowedFallbackModels = [], onProgress,
  resolveAdapter, source = model.id, loadOptions = {} }) {
  signal.throwIfAborted();
  generation = { ...generation, ...model.generation };
  const session = model.provider === 'doppler'
    ? await service.open({ scope, source, options: { ...model.loadOptions, ...loadOptions, onProgress } }) : null;
  signal.throwIfAborted();
  if (session) requireValue(typeof session.stream === 'function', 'Configured Doppler session does not expose text streaming');
  else requireValue(typeof credentials === 'function', 'Firebase Auth and App Check credentials are required');
  let healthy = true;
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
    isReady: () => healthy && session?.loaded === true,
    reset,
    async prepareAdapters(adapters) {
      try {
        await setAdapters(adapters);
        // The pinned scoped API reports tensor identity in execution evidence, not a session getter.
        const result = await session.generate(profile.adapterQualification.messages,
          { ...profile.adapterQualification.generation, signal });
        signal.throwIfAborted();
        return evidencedIdentity(result, adapters).adapterIdentities;
      } finally {
        try { await setAdapters([]); await reset(); }
        catch (error) { healthy = false; throw error; }
      }
    },
    async generate(messages, onUpdate = () => {}, { signal: attemptSignal, adapters = [], maxOutputTokens }) {
      const combined = AbortSignal.any([signal, attemptSignal]);
      combined.throwIfAborted();
      requireValue(maxOutputTokens === undefined || Number.isSafeInteger(maxOutputTokens) && maxOutputTokens > 0,
        'Request maxOutputTokens must be a positive integer');
      const requestGeneration = maxOutputTokens === undefined ? generation
        : { ...generation, maxTokens: Math.min(generation.maxTokens ?? maxOutputTokens, maxOutputTokens) };
      let text = '', actualModel = model.id, actualIdentity = null, completion = null, timing = null;
      const update = delta => {
        combined.throwIfAborted();
        requireValue(typeof delta === 'string', 'Provider emitted an invalid text delta');
        text += delta;
        requireValue(text.length <= maxOutcomeCharacters, 'Model response exceeded the configured size limit');
        return onUpdate(delta);
      };
      if (session) {
        // Raw compatibility sessions cancel cooperatively; the host waits for settlement.
        await reset();
        try {
          await setAdapters(adapters, combined);
          if (adapters.length) {
            const result = await session.generate(messages, { ...requestGeneration, signal: combined,
              onToken: (_token, delta) => { if (typeof delta === 'string') update(delta); } });
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
            const result = await consumeWorkGenerationStream(session.stream(messages, { ...requestGeneration, signal: combined }),
              { signal: combined, onDelta: update, maxOutcomeCharacters });
            completion = result.completion;
            timing = readWorkGenerationTiming(session.supports?.('advanced') === false
              ? null : session.advanced?.getStats?.());
            requireValue(JSON.stringify(executionIdentity()) === JSON.stringify(actualIdentity),
              'Doppler execution identity changed during generation');
          }
        } finally {
          try { await reset(); await setAdapters([]); }
          catch (error) { healthy = false; throw error; }
        }
        actualModel = actualIdentity.model;
      } else {
        const headers = new Headers(await credentials({ signal: combined }));
        requireValue(/^Bearer\s+\S+$/i.test(headers.get('Authorization') || '')
          && !!headers.get('X-Firebase-AppCheck')?.trim(), 'Firebase Auth and App Check credentials are required');
        headers.set('Content-Type', 'application/json');
        combined.throwIfAborted();
        const response = await fetchImpl('/zero/gemini', {
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
      return { content: text, raw: text, requestedModel: model.id, model: actualModel,
        ...(session ? { ...actualIdentity, completion, timing } : {}),
        provider: model.provider, execution: session ? 'local-scoped-session' : 'cloud-proxy-session' };
    }
  });
}
