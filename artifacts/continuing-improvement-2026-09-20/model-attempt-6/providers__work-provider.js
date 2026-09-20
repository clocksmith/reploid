/** Host-selected compatibility providers. Signed Pack providers remain separate. */
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };

export function selectWorkModel({ models, modelId, defaultModelId }) {
  const id = modelId === undefined || modelId === null || modelId === '' ? defaultModelId : modelId;
  const model = models.find(item => item.id === id);
  requireValue(model, `Unknown application model: ${String(id)}`);
  requireValue(['doppler', 'gemini'].includes(model.provider), 'Model requires an explicit supported provider');
  return Object.freeze({ ...model });
}

export async function openWorkProvider({ model, service, scope, signal, credentials,
  fetchImpl = globalThis.fetch, generation, maxOutcomeCharacters, allowedFallbackModels = [], onProgress }) {
  signal.throwIfAborted();
  const session = model.provider === 'doppler'
    ? await service.open({ scope, source: model.id, options: { onProgress } }) : null;
  signal.throwIfAborted();
  if (session) requireValue(typeof session.stream === 'function', 'Configured Doppler session does not expose text streaming');
  else requireValue(typeof credentials === 'function', 'Firebase Auth and App Check credentials are required');
  return Object.freeze({
    async generate(messages, onUpdate = () => {}, { signal: attemptSignal }) {
      const combined = AbortSignal.any([signal, attemptSignal]);
      combined.throwIfAborted();
      let text = '', actualModel = model.id;
      const update = delta => {
        combined.throwIfAborted();
        requireValue(typeof delta === 'string', 'Provider emitted an invalid text delta');
        text += delta;
        requireValue(text.length <= maxOutcomeCharacters, 'Model response exceeded the configured size limit');
        onUpdate(delta);
      };
      if (session) {
        // Raw compatibility sessions cancel cooperatively; the host waits for settlement.
        for await (const event of session.stream(messages, generation)) {
          combined.throwIfAborted();
          if (event.type === 'text-delta') update(event.text);
        }
      } else {
        const headers = new Headers(await credentials({ signal: combined }));
        requireValue(/^Bearer\s+\S+$/i.test(headers.get('Authorization') || '')
          && !!headers.get('X-Firebase-AppCheck')?.trim(), 'Firebase Auth and App Check credentials are required');
        headers.set('Content-Type', 'application/json');
        combined.throwIfAborted();
        const response = await fetchImpl('/zero/gemini', {
          method: 'POST', headers,
          body: JSON.stringify({ model: model.id, provider: model.provider, messages,
            allowedFallbackModels, maxOutputTokens: generation.maxTokens }),
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
        update(data.content);
      }
      combined.throwIfAborted();
      requireValue(text.trim(), 'Provider returned no text');
      return { content: text, raw: text, requestedModel: model.id, model: actualModel,
        provider: model.provider, execution: session ? 'local-scoped-session' : 'cloud-proxy-session' };
    }
  });
}
