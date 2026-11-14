/** Product-selected provider defaults; runtime lifetime belongs to shared infrastructure. */
import profile from '../config/work-profile.json' with { type: 'json' };
import { openScopedModelProvider } from '../../../shared/infrastructure/scoped-model-provider.js';
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };

export function selectWorkModel({ models, modelId, defaultModelId }) {
  const id = modelId === undefined || modelId === null || modelId === '' ? defaultModelId : modelId;
  const model = models.find(item => item.id === id);
  requireValue(model, `Unknown application model: ${String(id)}`);
  requireValue(['doppler', 'gemini'].includes(model.provider), 'Model requires an explicit supported provider');
  return Object.freeze({ ...model });
}

export function openWorkProvider(options) {
  return openScopedModelProvider({ ...options, providerPolicy: profile });
}
