/**
 * What the Ask and Compute pages share: the enabled models and verification policies as choices,
 * the model's pack facts, this device's participation identity and mode, and the sharing limits.
 * The same reading the vanilla route controls rendered (ui/pool-home/route-controls.js,
 * participation-state-view.js), without markup.
 */
import { createPoolIdentity } from '../../../../shared/pool/identity.js';
import { LAUNCH_MODEL, getEnabledPoolModelContract, getPoolModelWorkload, listPoolModels } from '../../../../shared/pool/model-contract.js';
import { PARTICIPATION_MODES, readParticipationPreferences } from '../../../../shared/pool/participation-profile.js';
import { listPolicies } from '../../pool/policy-router.js';
import { compactHash } from '../../ui/pool-home/view-markup.js';
import { policyLabel } from './run-result.js';

/** The models this page can ask for, with their workload; the launch model is the default. */
export const modelChoices = () => listPoolModels({ enabledOnly: true }).map(model => ({
  value: model.modelId, title: model.label || model.modelId, workload: getPoolModelWorkload(model)
}));
export const DEFAULT_MODEL_ID = LAUNCH_MODEL.modelId;
export const workloadLabel = modelId => getPoolModelWorkload(getEnabledPoolModelContract(modelId) || LAUNCH_MODEL).replace(/[-_]/g, ' ');

/** Verification policies, named as a person reads them. */
export const policyChoices = () => listPolicies().map(policy => ({ value: policy.policyId, title: policyLabel(policy.policyId) }));

/** The model's pack facts, as the vanilla "Model details" listed them. */
export function packFacts(modelId = DEFAULT_MODEL_ID, providerState = 'Searching') {
  const model = getEnabledPoolModelContract(modelId) || LAUNCH_MODEL;
  const identity = model.artifactIdentity || {};
  const dimensions = Number(model.embeddingDimensions || model.dimensions || 0);
  const maxInput = Number(model.sequence?.maxLength || model.contextLength || 0);
  const work = model.executionMode === 'full_model_browser_sequence' ? 'Full model · one sequence' : `${model.runtime || 'Doppler'} · ${model.backend || 'qualified provider'}`;
  return [
    ['Model identity', compactHash(identity.weightPackId || model.modelHash || model.modelId)],
    ['Capability', dimensions ? `Sequence embedding · ${dimensions} dimensions` : getPoolModelWorkload(model).replace(/[._-]/g, ' ')],
    ['Input', maxInput ? `Public protein sequence · up to ${maxInput} residues` : 'Public protein sequence'],
    ['Work', work],
    ['Providers', providerState]
  ];
}

export const participationIdentity = createPoolIdentity('requester', { localOnly: true, namespace: 'network_participation' });
export const canRequestWith = preferences => preferences.mode === PARTICIPATION_MODES.request || preferences.mode === PARTICIPATION_MODES.both;
export const canContributeWith = preferences => preferences.mode === PARTICIPATION_MODES.contribute || preferences.mode === PARTICIPATION_MODES.both;

/** This device's identity as the participation line shows it: a short fingerprint and how its key is protected. */
export async function readDeviceIdentity() {
  try {
    const identity = await participationIdentity.getDeviceIdentity();
    const value = String(identity.identityRootId || identity.deviceId || '');
    const fingerprint = value.replace(/^[^_]+_/, '');
    let title = 'Browser identity fallback; use a passkey for stronger protection';
    if (identity.keyProtection === 'passkey') title = 'Passkey-bound device identity';
    else if (identity.keyProtection === 'browser_non_exportable') title = 'Non-exportable browser device key';
    return {
      label: fingerprint ? `ID ${fingerprint.slice(0, 6)}…${fingerprint.slice(-4)}` : 'Identity unavailable',
      protection: identity.keyProtection || null,
      title
    };
  } catch (error) {
    return { label: 'Identity unavailable', protection: null, title: String(error?.message || error) };
  }
}

/** The saved participation mode and limits, as the page reads them now. */
export const participation = () => readParticipationPreferences();
