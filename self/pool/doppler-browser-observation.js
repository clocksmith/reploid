/**
 * @fileoverview Validation for persisted, non-promotable Doppler browser observations.
 *
 * A browser observation is useful durable evidence, but it is deliberately a
 * narrower object than a Poolday browser qualification receipt. It cannot
 * authorize model selection or promotion.
 */

import { BROWSER_QUALIFICATION_CHECKS } from './browser-qualification.js';
import { exactModelContractKey } from './model-contract.js';

export const DOPPLER_BROWSER_PROTEIN_OBSERVATION_SCHEMA = 'poolday.doppler_browser_protein_observation/v1';

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const GIT_OBJECT_PATTERN = /^[a-f0-9]{40}$/;
const isSha256 = (value) => SHA256_PATTERN.test(String(value || ''));
const isGitObject = (value) => GIT_OBJECT_PATTERN.test(String(value || ''));
const text = (value) => typeof value === 'string' && value.trim().length > 0;

export function validateDopplerBrowserProteinObservation(observation = {}, { model = {} } = {}) {
  const reasons = [];
  if (observation.schema !== DOPPLER_BROWSER_PROTEIN_OBSERVATION_SCHEMA) {
    reasons.push('browser observation schema is invalid');
  }
  if (observation.status !== 'incomplete') {
    reasons.push('browser observation must remain incomplete until the full qualification record exists');
  }
  if (observation.promotion?.eligible !== false) {
    reasons.push('browser observation must not be promotion eligible');
  }
  if (observation.model?.modelId !== model.modelId) {
    reasons.push('browser observation modelId does not match the exact model contract');
  }
  for (const field of ['modelHash', 'manifestHash', 'tokenizerHash']) {
    if (observation.model?.[field] !== model[field]) {
      reasons.push(`browser observation ${field} does not match the exact model contract`);
    }
  }
  if (observation.model?.shardSetHash !== model.artifactIdentity?.shardSetHash) {
    reasons.push('browser observation shardSetHash does not match the exact model contract');
  }
  if (observation.model?.sourceCheckpointId !== model.artifactIdentity?.sourceCheckpointId) {
    reasons.push('browser observation source checkpoint does not match the exact model contract');
  }
  if (observation.model?.runtime !== model.runtime || observation.model?.backend !== model.backend) {
    reasons.push('browser observation runtime identity does not match the exact model contract');
  }
  if (!isSha256(observation.release?.sourceStateHash) || !isSha256(observation.release?.browserModuleDigest)) {
    reasons.push('browser observation release hashes are invalid');
  }
  if (!isGitObject(observation.release?.dopplerSourceRevision)
    || !isGitObject(observation.release?.dopplerGitTree)
    || typeof observation.release?.sourceDirty !== 'boolean') {
    reasons.push('browser observation must bind an exact Doppler commit, tree, and dirty-state boolean');
  }
  const moduleScope = observation.release?.browserModuleDigestScope;
  if (!Array.isArray(moduleScope) || moduleScope.length === 0
    || moduleScope.some((entry) => !text(entry?.path) || !isSha256(entry?.sha256))) {
    reasons.push('browser observation browser module digest scope is incomplete');
  }
  const artifactSource = observation.release?.qualificationArtifactSource;
  if (!isGitObject(artifactSource?.revision)
    || !text(artifactSource?.baseUrl)
    || artifactSource?.pooldayLaunchRoute !== false) {
    reasons.push('browser observation must identify the pinned non-Poolday qualification artifact source');
  }
  if (!isSha256(observation.browser?.userAgentHash) || !text(observation.browser?.family)
    || observation.browser?.hardwareGpuRequested !== true || !text(observation.browser?.adapter?.description)) {
    reasons.push('browser observation browser and GPU identity is incomplete');
  }
  if (observation.fixture?.sequenceAlphabet !== model.sequence?.alphabet
    || observation.fixture?.embeddingDimension !== model.embeddingDimensions) {
    reasons.push('browser observation fixture does not match the exact protein model contract');
  }
  if (!isSha256(observation.fixture?.runtimeFixtureHash)) {
    reasons.push('browser observation fixture runtime hash is invalid');
  }
  if (observation.fixture?.referenceRepository !== 'doppler'
    || observation.fixture?.referenceSourceRevision !== observation.release?.dopplerSourceRevision
    || !text(observation.fixture?.referencePath)
    || !isSha256(observation.fixture?.referenceHash)) {
    reasons.push('browser observation fixture reference is not bound to the exact Doppler source');
  }
  const prime = observation.runs?.primeHttp;
  const restored = observation.runs?.opfsRestore;
  if (prime?.loadMode !== 'http' || restored?.loadMode !== 'opfs') {
    reasons.push('browser observation must bind an HTTP prime and OPFS restoration run');
  }
  if (!isSha256(prime?.outputHash) || !isSha256(prime?.resultHash)
    || !isSha256(restored?.outputHash) || !isSha256(restored?.resultHash)) {
    reasons.push('browser observation run hashes are invalid');
  }
  if (prime?.outputHash !== restored?.outputHash) {
    reasons.push('browser observation HTTP and OPFS output hashes do not match');
  }
  if (prime?.kvDtype !== 'f32' || restored?.kvDtype !== 'f32') {
    reasons.push('browser observation does not bind the required F32 KV lane');
  }
  const corruptionRecovery = observation.runs?.corruptionRecovery;
  if (
    corruptionRecovery?.mutatedTarget !== 'manifest-declared-shard'
    || corruptionRecovery?.opfsOnlyResolver !== 'rejected'
    || corruptionRecovery?.recoverySource !== 'immutable-source-http'
    || corruptionRecovery?.recoveredLoadMode !== 'opfs'
    || corruptionRecovery?.recoveredOutputHash !== restored?.outputHash
  ) {
    reasons.push('browser observation corruption evidence is incomplete or does not restore the frozen OPFS output');
  }
  const cancellation = observation.runs?.cancellation;
  if (
    cancellation?.mode !== 'after_start'
    || cancellation?.resultEnvelopePublished !== false
    || cancellation?.errorName !== 'AbortError'
  ) {
    reasons.push('browser observation cancellation evidence does not prove an after-start abort without a published result');
  }
  const staleResult = observation.runs?.staleResultRejection;
  if (
    staleResult?.mode !== 'after_start'
    || staleResult?.resultEnvelopePublished !== false
    || staleResult?.errorName !== 'StaleResultError'
  ) {
    reasons.push('browser observation stale-result evidence does not prove superseded output rejection before publication');
  }
  const passed = Array.isArray(observation.passedChecks) ? observation.passedChecks : [];
  const unmet = Array.isArray(observation.unmetChecks) ? observation.unmetChecks : [];
  if (![
    'webGpuExecution',
    'opfsPersistence',
    'opfsRestoration',
    'completeHashVerification',
    'corruptionRejection',
    'cancellation',
    'staleResultRejection',
  ].every((check) => passed.includes(check))) {
    reasons.push('browser observation is missing executed browser or OPFS evidence');
  }
  if (passed.some((check) => !BROWSER_QUALIFICATION_CHECKS.includes(check))
    || unmet.some((check) => !BROWSER_QUALIFICATION_CHECKS.includes(check))) {
    reasons.push('browser observation contains an unknown qualification check');
  }
  if (new Set([...passed, ...unmet]).size !== BROWSER_QUALIFICATION_CHECKS.length) {
    reasons.push('browser observation must account for every qualification check');
  }
  return {
    ok: reasons.length === 0,
    reasons,
    exactModelContractKey: exactModelContractKey(model),
    promotable: false,
  };
}

export default {
  DOPPLER_BROWSER_PROTEIN_OBSERVATION_SCHEMA,
  validateDopplerBrowserProteinObservation,
};
