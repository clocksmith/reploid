/**
 * @fileoverview Signed, append-only causal ledger for bounded improvement attempts.
 */

import {
  encodeBytes,
  createPeerIdFromPublicJwk,
  ensureIdentityBundle,
  fromBase64Url,
  getIdentitySignAlgorithm,
  importSigningKey,
  importVerificationKey,
  toBase64Url
} from '../identity.js';
import { getCurrentReploidInstanceId } from '../instance.js';

export const IMPROVEMENT_EPISODE_SCHEMA = 'rsi.improvement-episode/v1';
export const IMPROVEMENT_EVENT_SCHEMA = 'rsi.improvement-episode-event/v1';
export const ALGORITHM_MANIFEST_SCHEMA = 'rsi.algorithm-manifest/v1';
export const IMPROVEMENT_EPISODE_ROOT = '/artifacts/rsi/improvement-episodes';
export const ALGORITHM_REGISTRY_PATH = '/artifacts/rsi/algorithm-registry/index.json';

const INDEX_PATH = `${IMPROVEMENT_EPISODE_ROOT}/index.json`;
const HASH_PATTERN = /^sha(?:256|512):[a-zA-Z0-9_-]{16,}$/;
const TERMINAL_STATES = new Set([
  'promoted',
  'rejected',
  'rolled_back',
  'abandoned',
  'inconclusive',
  'quarantined'
]);
const EVENT_TYPES = new Set([
  'episode.started',
  'diagnosis.recorded',
  'negative-evidence.recorded',
  'candidate.proposed',
  'execution.recorded',
  'verification.recorded',
  'evaluation.recorded',
  'comparison.recorded',
  'promotion.requested',
  'review.recorded',
  'decision.recorded',
  'effect.recorded',
  'outcome.recorded',
  'reopening.recorded',
  'rollback.recorded',
  'reflection.recorded'
]);
const PROMOTED_FOLLOW_UP_EVENTS = new Set([
  'effect.recorded',
  'outcome.recorded',
  'reopening.recorded',
  'rollback.recorded',
  'reflection.recorded'
]);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

export const canonicalJson = (value) => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Improvement evidence contains a non-finite number');
    return Object.is(value, -0) ? '0' : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`;
  }
  throw new Error(`Improvement evidence contains unsupported ${typeof value}`);
};

export async function hashImprovementValue(value, cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.subtle) throw new Error('SHA-256 is unavailable');
  const digest = await cryptoApi.subtle.digest('SHA-256', encodeBytes(canonicalJson(value)));
  return `sha256:${Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}

const assertText = (value, label) => {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
};

const assertSafeId = (value, label) => {
  const text = assertText(value, label);
  if (!/^[a-zA-Z0-9._:-]+$/.test(text)) {
    throw new Error(`${label} contains unsupported characters`);
  }
  return text;
};

const assertHash = (value, label) => {
  const hash = assertText(value, label);
  if (!HASH_PATTERN.test(hash)) throw new Error(`${label} must be a named cryptographic digest`);
  return hash;
};

const assertStringArray = (value, label, { allowEmpty = false } = {}) => {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new Error(`${label} must be ${allowEmpty ? 'an' : 'a non-empty'} array`);
  }
  return value.map((entry, index) => assertText(entry, `${label}[${index}]`));
};

const normalizePath = (value) => {
  const path = assertText(value, 'path').replace(/\/+/g, '/');
  if (!path.startsWith('/') || path.split('/').includes('..')) {
    throw new Error(`Invalid protected path: ${path}`);
  }
  return path.length > 1 ? path.replace(/\/$/, '') : path;
};

const pathsOverlap = (left, right) => (
  left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
);

const pathWithin = (candidatePath, allowedPath) => (
  candidatePath === allowedPath || candidatePath.startsWith(`${allowedPath}/`)
);

export function validateMetricDefinition(input) {
  const metric = cloneJson(input || {});
  metric.metricId = assertSafeId(metric.metricId, 'metric.metricId');
  metric.unit = assertText(metric.unit, 'metric.unit');
  if (!['maximize', 'minimize'].includes(metric.direction)) {
    throw new Error('metric.direction must be maximize or minimize');
  }
  metric.measurementSource = assertText(metric.measurementSource, 'metric.measurementSource');
  metric.aggregationRule = assertText(metric.aggregationRule, 'metric.aggregationRule');
  metric.validityConditions = assertStringArray(metric.validityConditions, 'metric.validityConditions');
  metric.noiseModel = assertText(metric.noiseModel, 'metric.noiseModel');
  if (!Number.isInteger(metric.minimumSampleSize) || metric.minimumSampleSize < 1) {
    throw new Error('metric.minimumSampleSize must be a positive integer');
  }
  if (!isObject(metric.promotionThreshold)) {
    throw new Error('metric.promotionThreshold is required');
  }
  if (!['>=', '<=', '>', '<', '=='].includes(metric.promotionThreshold.operator)) {
    throw new Error('metric.promotionThreshold.operator is invalid');
  }
  if (!Number.isFinite(metric.promotionThreshold.value)) {
    throw new Error('metric.promotionThreshold.value must be finite');
  }
  metric.operational = metric.operational === true;
  return metric;
}

export function validateAlgorithmManifest(input) {
  const manifest = cloneJson(input || {});
  manifest.schema = manifest.schema || ALGORITHM_MANIFEST_SCHEMA;
  if (manifest.schema !== ALGORITHM_MANIFEST_SCHEMA) {
    throw new Error(`algorithm.schema must be ${ALGORITHM_MANIFEST_SCHEMA}`);
  }
  manifest.algorithmId = assertSafeId(manifest.algorithmId, 'algorithm.algorithmId');
  manifest.version = assertText(manifest.version, 'algorithm.version');
  manifest.sourceModules = assertStringArray(manifest.sourceModules, 'algorithm.sourceModules');
  manifest.inputs = assertStringArray(manifest.inputs, 'algorithm.inputs');
  manifest.outputs = assertStringArray(manifest.outputs, 'algorithm.outputs');
  manifest.invariants = assertStringArray(manifest.invariants, 'algorithm.invariants');
  manifest.complexity = assertText(manifest.complexity, 'algorithm.complexity');
  manifest.resourceAssumptions = assertStringArray(
    manifest.resourceAssumptions,
    'algorithm.resourceAssumptions'
  );
  manifest.knownFailureModes = assertStringArray(
    manifest.knownFailureModes,
    'algorithm.knownFailureModes'
  );
  manifest.evaluationSuites = assertStringArray(manifest.evaluationSuites, 'algorithm.evaluationSuites');
  manifest.dependencies = assertStringArray(manifest.dependencies, 'algorithm.dependencies', { allowEmpty: true });
  if (!['production', 'shadow', 'candidate', 'quarantined', 'retired'].includes(manifest.status)) {
    throw new Error('algorithm.status is invalid');
  }
  manifest.historicalRevisions = Array.isArray(manifest.historicalRevisions)
    ? manifest.historicalRevisions
    : [];
  manifest.candidateAlternatives = Array.isArray(manifest.candidateAlternatives)
    ? manifest.candidateAlternatives
    : [];
  return manifest;
}

export function validateHypothesisReflection(input) {
  const reflection = cloneJson(input || {});
  for (const field of [
    'observation',
    'suspectedCause',
    'proposedDiagnostic',
    'candidateIntervention',
    'expectedResult',
    'falsifyingResult'
  ]) {
    reflection[field] = assertText(reflection[field], `reflection.${field}`);
  }
  reflection.alternativeExplanations = assertStringArray(
    reflection.alternativeExplanations,
    'reflection.alternativeExplanations'
  );
  reflection.followUpHypothesis = reflection.followUpHypothesis
    ? String(reflection.followUpHypothesis).trim()
    : null;
  return reflection;
}

const validateBaseline = (input) => {
  const baseline = cloneJson(input || {});
  baseline.generationId = assertSafeId(baseline.generationId, 'baseline.generationId');
  if (!isObject(baseline.hashes)) throw new Error('baseline.hashes is required');
  for (const key of ['code', 'config', 'model', 'prompt', 'artifacts', 'contract']) {
    baseline.hashes[key] = assertHash(baseline.hashes[key], `baseline.hashes.${key}`);
  }
  baseline.hashSemantics = isObject(baseline.hashSemantics) ? baseline.hashSemantics : {};
  baseline.snapshotPath = baseline.snapshotPath ? normalizePath(baseline.snapshotPath) : null;
  return baseline;
};

const validateEvaluator = (input) => {
  const evaluator = cloneJson(input || {});
  evaluator.evaluatorId = assertSafeId(evaluator.evaluatorId, 'evaluator.evaluatorId');
  evaluator.authorityId = assertSafeId(evaluator.authorityId, 'evaluator.authorityId');
  evaluator.version = assertText(evaluator.version, 'evaluator.version');
  evaluator.evaluatorHash = assertHash(evaluator.evaluatorHash, 'evaluator.evaluatorHash');
  evaluator.testSuiteDigest = assertHash(evaluator.testSuiteDigest, 'evaluator.testSuiteDigest');
  evaluator.protectedPaths = assertStringArray(evaluator.protectedPaths, 'evaluator.protectedPaths')
    .map(normalizePath);
  evaluator.heldOut = evaluator.heldOut === true;
  evaluator.frozenBeforeCandidate = evaluator.frozenBeforeCandidate === true;
  return evaluator;
};

const validateGenerator = (input) => {
  const generator = cloneJson(input || {});
  generator.authorityId = assertSafeId(generator.authorityId, 'generator.authorityId');
  generator.implementation = assertText(generator.implementation, 'generator.implementation');
  generator.implementationHash = assertHash(
    generator.implementationHash,
    'generator.implementationHash'
  );
  generator.frozenBeforeCandidate = generator.frozenBeforeCandidate === true;
  return generator;
};

const validateFrozenRecord = (input, label) => {
  const record = cloneJson(input || {});
  record.digest = assertHash(record.digest, `${label}.digest`);
  record.frozenBeforeCandidate = record.frozenBeforeCandidate === true;
  return record;
};

const validatePromotionAuthority = (input) => {
  const authority = cloneJson(input || {});
  authority.repositoryId = assertText(authority.repositoryId, 'promotionAuthority.repositoryId');
  authority.authorityId = assertSafeId(authority.authorityId, 'promotionAuthority.authorityId');
  authority.scope = assertText(authority.scope, 'promotionAuthority.scope');
  authority.allowedCandidatePaths = assertStringArray(
    authority.allowedCandidatePaths,
    'promotionAuthority.allowedCandidatePaths'
  ).map(normalizePath);
  authority.allowedEffectKinds = assertStringArray(
    authority.allowedEffectKinds,
    'promotionAuthority.allowedEffectKinds'
  );
  authority.frozenBeforeCandidate = authority.frozenBeforeCandidate === true;
  return authority;
};

const validateReopeningConditions = (input) => {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('reopeningConditions must be a non-empty array');
  }
  const conditions = input.map((entry, index) => ({
    ...cloneJson(entry || {}),
    conditionId: assertSafeId(entry?.conditionId, `reopeningConditions[${index}].conditionId`),
    observationKind: assertSafeId(
      entry?.observationKind,
      `reopeningConditions[${index}].observationKind`
    ),
    targetId: assertText(entry?.targetId, `reopeningConditions[${index}].targetId`),
    sensorAuthorityId: assertSafeId(
      entry?.sensorAuthorityId,
      `reopeningConditions[${index}].sensorAuthorityId`
    ),
    action: assertSafeId(entry?.action, `reopeningConditions[${index}].action`)
  }));
  if (new Set(conditions.map((entry) => entry.conditionId)).size !== conditions.length) {
    throw new Error('reopeningConditions conditionId values must be unique');
  }
  return conditions;
};

const validateStart = (input) => {
  const start = cloneJson(input || {});
  start.episodeId = assertSafeId(start.episodeId, 'episodeId');
  start.parentEpisodeId = start.parentEpisodeId
    ? assertSafeId(start.parentEpisodeId, 'parentEpisodeId')
    : null;
  start.groupId = start.groupId ? assertSafeId(start.groupId, 'groupId') : null;
  if (!['zero', 'x', 'substrate', 'poolday', 'other'].includes(start.surface)) {
    throw new Error('surface is invalid');
  }
  if (!isObject(start.objective)) throw new Error('objective is required');
  start.objective.objectiveId = assertSafeId(start.objective.objectiveId, 'objective.objectiveId');
  start.objective.statement = assertText(start.objective.statement, 'objective.statement');
  start.objective.successMetricId = assertSafeId(
    start.objective.successMetricId,
    'objective.successMetricId'
  );
  start.baseline = validateBaseline(start.baseline);
  start.proposer = {
    ...cloneJson(start.proposer || {}),
    authorityId: assertSafeId(start.proposer?.authorityId, 'proposer.authorityId')
  };
  start.generator = validateGenerator(start.generator);
  start.evaluator = validateEvaluator(start.evaluator);
  if (start.proposer.authorityId === start.evaluator.authorityId) {
    throw new Error('proposer and evaluator authority must be distinct');
  }
  if (start.generator.authorityId !== start.proposer.authorityId) {
    throw new Error('candidate generator authority must match the declared proposer authority');
  }
  if (!Array.isArray(start.metrics) || start.metrics.length === 0) {
    throw new Error('metrics must be a non-empty array');
  }
  start.metrics = start.metrics.map(validateMetricDefinition);
  const metricIds = new Set(start.metrics.map((metric) => metric.metricId));
  if (!metricIds.has(start.objective.successMetricId)) {
    throw new Error('objective.successMetricId must name a declared metric');
  }
  const primaryMetric = start.metrics.find((metric) => (
    metric.metricId === start.objective.successMetricId
  ));
  if (primaryMetric.operational) throw new Error('the success metric cannot be operational-only');
  start.algorithm = validateAlgorithmManifest(start.algorithm);
  start.environment = isObject(start.environment) ? start.environment : {};
  start.corpus = validateFrozenRecord(start.corpus, 'corpus');
  start.resourceBudget = validateFrozenRecord(start.resourceBudget, 'resourceBudget');
  start.promotionAuthority = validatePromotionAuthority(start.promotionAuthority);
  start.reopeningConditions = validateReopeningConditions(start.reopeningConditions);
  if (start.promotionAuthority.authorityId === start.proposer.authorityId
    || start.promotionAuthority.authorityId === start.evaluator.authorityId) {
    throw new Error('promotion authority must be independent from proposer and evaluator authority');
  }
  return start;
};

const episodePaths = (episodeId) => {
  const id = assertSafeId(episodeId, 'episodeId');
  const root = `${IMPROVEMENT_EPISODE_ROOT}/${id}`;
  return {
    root,
    events: `${root}/events.jsonl`,
    projection: `${root}/projection.json`
  };
};

const parseJsonl = (content, path) => String(content || '')
  .split('\n')
  .filter((line) => line.trim())
  .map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid improvement event at ${path}:${index + 1}: ${error.message}`);
    }
  });

const eventHashInput = (event) => {
  const unsigned = { ...event };
  delete unsigned.eventHash;
  delete unsigned.signature;
  return unsigned;
};

async function signEventHash(eventHash, identityBundle, cryptoApi = globalThis.crypto) {
  const key = await importSigningKey(identityBundle, cryptoApi);
  const signature = await cryptoApi.subtle.sign(
    getIdentitySignAlgorithm(identityBundle),
    key,
    encodeBytes(eventHash)
  );
  return {
    signerId: identityBundle.peerId,
    algorithm: identityBundle.algorithm,
    publicJwk: identityBundle.publicJwk,
    value: toBase64Url(signature)
  };
}

async function verifyEventSignature(event, cryptoApi = globalThis.crypto) {
  if (!event?.signature?.publicJwk || !event?.signature?.value) return false;
  try {
    const signerId = await createPeerIdFromPublicJwk(event.signature.publicJwk, cryptoApi);
    if (signerId !== event.signature.signerId) return false;
    const key = await importVerificationKey(event.signature.publicJwk, cryptoApi);
    return cryptoApi.subtle.verify(
      getIdentitySignAlgorithm(event.signature),
      key,
      fromBase64Url(event.signature.value),
      encodeBytes(event.eventHash)
    );
  } catch {
    return false;
  }
}

export async function verifyImprovementEvents(events, cryptoApi = globalThis.crypto) {
  const reasons = [];
  let previousHash = null;
  let validSignatures = 0;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.schema !== IMPROVEMENT_EVENT_SCHEMA) reasons.push(`event ${index} schema mismatch`);
    if (event.sequence !== index + 1) reasons.push(`event ${index} sequence mismatch`);
    if (event.previousEventHash !== previousHash) reasons.push(`event ${index} previous hash mismatch`);
    const expectedHash = await hashImprovementValue(eventHashInput(event), cryptoApi);
    if (event.eventHash !== expectedHash) reasons.push(`event ${index} hash mismatch`);
    if (await verifyEventSignature(event, cryptoApi)) validSignatures += 1;
    else reasons.push(`event ${index} signature invalid`);
    previousHash = event.eventHash || null;
  }
  return {
    valid: events.length > 0 && reasons.length === 0,
    eventCount: events.length,
    validSignatures,
    headHash: previousHash,
    reasons
  };
}

const projectEvents = (events, integrity) => {
  if (events.length === 0 || events[0].type !== 'episode.started') return null;
  const started = events[0].payload;
  const projection = {
    schema: IMPROVEMENT_EPISODE_SCHEMA,
    episodeId: started.episodeId,
    parentEpisodeId: started.parentEpisodeId,
    groupId: started.groupId,
    surface: started.surface,
    status: 'open',
    objective: started.objective,
    baseline: started.baseline,
    proposer: started.proposer,
    generator: started.generator,
    evaluator: started.evaluator,
    metrics: started.metrics,
    algorithm: started.algorithm,
    environment: started.environment,
    corpus: started.corpus,
    resourceBudget: started.resourceBudget,
    promotionAuthority: started.promotionAuthority,
    reopeningConditions: started.reopeningConditions,
    diagnosis: null,
    hypothesis: null,
    negativeEvidence: [],
    candidate: null,
    execution: null,
    verification: null,
    evaluation: null,
    comparison: null,
    promotionRequest: null,
    reviews: [],
    decision: null,
    effects: [],
    outcomes: [],
    reopenings: [],
    rollback: null,
    reflections: [],
    generation: {
      baseline: started.baseline.generationId,
      candidate: null,
      current: started.baseline.generationId
    },
    createdAt: events[0].timestamp,
    updatedAt: events.at(-1).timestamp,
    integrity
  };
  for (const event of events.slice(1)) {
    const payload = event.payload;
    if (event.type === 'diagnosis.recorded') {
      projection.diagnosis = payload.diagnosis;
      projection.hypothesis = payload.hypothesis;
      projection.status = 'diagnosed';
    } else if (event.type === 'negative-evidence.recorded') {
      projection.negativeEvidence.push(payload);
    } else if (event.type === 'candidate.proposed') {
      projection.candidate = payload;
      projection.generation.candidate = payload.generationId;
      projection.status = 'candidate';
    } else if (event.type === 'execution.recorded') {
      projection.execution = payload;
      projection.status = 'executed';
    } else if (event.type === 'verification.recorded') {
      projection.verification = payload;
      projection.status = payload.passed === true ? 'verified' : 'verification_failed';
    } else if (event.type === 'evaluation.recorded') {
      projection.evaluation = payload;
      projection.status = 'evaluated';
    } else if (event.type === 'comparison.recorded') {
      projection.comparison = payload;
      projection.status = 'compared';
    } else if (event.type === 'promotion.requested') {
      projection.promotionRequest = payload;
      projection.status = 'awaiting_promotion';
    } else if (event.type === 'review.recorded') {
      projection.reviews.push(payload);
    } else if (event.type === 'decision.recorded') {
      projection.decision = payload;
      projection.status = payload.state;
      if (payload.state === 'promoted' && projection.generation.candidate) {
        projection.generation.current = projection.generation.candidate;
      }
    } else if (event.type === 'effect.recorded') {
      projection.effects.push(payload);
    } else if (event.type === 'outcome.recorded') {
      projection.outcomes.push(payload);
    } else if (event.type === 'reopening.recorded') {
      projection.reopenings.push(payload);
    } else if (event.type === 'rollback.recorded') {
      projection.rollback = payload;
      projection.status = 'rolled_back';
      projection.generation.current = payload.restoredGenerationId || projection.generation.baseline;
    } else if (event.type === 'reflection.recorded') {
      projection.reflections.push(payload);
    }
  }
  return projection;
};

const validateCandidate = (candidate, episode) => {
  const next = cloneJson(candidate || {});
  next.candidateId = assertSafeId(next.candidateId, 'candidate.candidateId');
  next.candidateHash = assertHash(next.candidateHash, 'candidate.candidateHash');
  next.patchHash = assertHash(next.patchHash, 'candidate.patchHash');
  next.generationId = assertSafeId(next.generationId, 'candidate.generationId');
  next.parentGenerationId = assertSafeId(
    next.parentGenerationId,
    'candidate.parentGenerationId'
  );
  if (next.parentGenerationId !== episode.baseline.generationId) {
    throw new Error('candidate parent generation does not match the frozen baseline');
  }
  next.changedFiles = assertStringArray(next.changedFiles, 'candidate.changedFiles', { allowEmpty: true })
    .map(normalizePath);
  next.semanticScope = assertStringArray(next.semanticScope, 'candidate.semanticScope');
  next.expectedBehavior = assertText(next.expectedBehavior, 'candidate.expectedBehavior');
  next.affectedInvariants = assertStringArray(next.affectedInvariants, 'candidate.affectedInvariants');
  next.falsifier = assertText(next.falsifier, 'candidate.falsifier');
  next.generatorAuthorityId = assertSafeId(
    next.generatorAuthorityId,
    'candidate.generatorAuthorityId'
  );
  next.generatorHash = assertHash(next.generatorHash, 'candidate.generatorHash');
  if (next.generatorAuthorityId !== episode.generator?.authorityId
    || next.generatorHash !== episode.generator?.implementationHash) {
    throw new Error('candidate generator identity does not match the frozen generator');
  }
  for (const changedPath of next.changedFiles) {
    const protectedPath = episode.evaluator.protectedPaths.find((path) => pathsOverlap(changedPath, path));
    if (protectedPath) {
      throw new Error(`candidate overlaps protected evaluator authority: ${protectedPath}`);
    }
    if (!episode.promotionAuthority.allowedCandidatePaths.some((allowedPath) => (
      pathWithin(changedPath, allowedPath)
    ))) {
      throw new Error(`candidate exceeds repository-owned promotion scope: ${changedPath}`);
    }
  }
  return next;
};

export function assessPromotionReadiness(episode) {
  const reasons = [];
  if (!episode) return { ready: false, reasons: ['episode not found'] };
  if (episode.integrity?.valid !== true) reasons.push('episode signature or hash chain is invalid');
  if (!episode.candidate) reasons.push('candidate is missing');
  if (!episode.execution?.isolated) reasons.push('isolated execution evidence is missing');
  if (episode.verification?.passed !== true) reasons.push('verification did not pass');
  if (!episode.evaluation) reasons.push('paired evaluation is missing');
  if (!episode.comparison) reasons.push('baseline-candidate comparison is missing');
  if (episode.evaluator?.authorityId === episode.proposer?.authorityId) {
    reasons.push('evaluator authority is not independent from proposer authority');
  }
  if (episode.evaluator?.frozenBeforeCandidate !== true) {
    reasons.push('evaluator and task set were not frozen before the candidate');
  }
  if (episode.generator?.frozenBeforeCandidate !== true) {
    reasons.push('candidate generator was not frozen before the candidate');
  }
  if (episode.candidate && (episode.candidate.generatorAuthorityId !== episode.generator?.authorityId
    || episode.candidate.generatorHash !== episode.generator?.implementationHash)) {
    reasons.push('candidate does not bind the frozen generator identity');
  }
  if (episode.corpus?.frozenBeforeCandidate !== true || !HASH_PATTERN.test(episode.corpus?.digest || '')) {
    reasons.push('corpus identity was not frozen before the candidate');
  }
  if (episode.resourceBudget?.frozenBeforeCandidate !== true
    || !HASH_PATTERN.test(episode.resourceBudget?.digest || '')) {
    reasons.push('resource budget was not frozen before the candidate');
  }
  if (episode.promotionAuthority?.frozenBeforeCandidate !== true) {
    reasons.push('repository promotion authority was not frozen before the candidate');
  }
  if (!Array.isArray(episode.reopeningConditions) || episode.reopeningConditions.length === 0) {
    reasons.push('reopening conditions are missing');
  }
  if (!Array.isArray(episode.negativeEvidence)
    || !episode.negativeEvidence.some((entry) => entry.retained === true)) {
    reasons.push('retained negative evidence is missing');
  }
  const primary = episode.metrics?.find((metric) => (
    metric.metricId === episode.objective?.successMetricId
  ));
  if (!primary) {
    reasons.push('primary success metric is missing');
  } else {
    const sampleCount = Number(episode.evaluation?.sampleCount || 0);
    if (sampleCount < primary.minimumSampleSize) {
      reasons.push(`primary metric requires at least ${primary.minimumSampleSize} paired samples`);
    }
    const primaryResult = episode.evaluation?.metrics?.find((metric) => (
      metric.metricId === primary.metricId
    ));
    if (!primaryResult) reasons.push('primary metric result is missing');
    if (primaryResult?.valid !== true) reasons.push('primary metric result is invalid');
    const operator = primary.promotionThreshold.operator;
    const threshold = primary.promotionThreshold.value;
    const value = primaryResult?.value;
    const thresholdPassed = Number.isFinite(value) && ({
      '>=': value >= threshold,
      '<=': value <= threshold,
      '>': value > threshold,
      '<': value < threshold,
      '==': value === threshold
    })[operator];
    if (!thresholdPassed) reasons.push('primary metric did not pass its predeclared threshold');
    if (episode.comparison?.primaryMetricId !== primary.metricId) {
      reasons.push('comparison does not bind the declared primary metric');
    }
  }
  if (episode.comparison?.conclusion !== 'improved') {
    reasons.push('comparison conclusion is not improved');
  }
  if (!Array.isArray(episode.evaluation?.rawObservations)
    || episode.evaluation.rawObservations.length === 0) {
    reasons.push('raw paired observations are missing');
  }
  if (episode.evaluation?.baselineContractHash !== episode.baseline?.hashes?.contract) {
    reasons.push('evaluation baseline does not match the frozen contract');
  }
  if (episode.evaluation?.candidateContractHash !== episode.baseline?.hashes?.contract) {
    reasons.push('candidate was not evaluated under the frozen contract');
  }
  return { ready: reasons.length === 0, reasons };
}

export async function validateImprovementEpisodePromotionEvidence(
  evidence,
  { VFS, cryptoApi = globalThis.crypto } = {}
) {
  const claim = evidence?.improvementEpisode || evidence?.promotion?.improvementEpisode || null;
  const required = evidence?.schema === 'reploid.doppler-profile-promotion-evidence/v1'
    || claim !== null;
  if (!required) return { required: false, ok: true, reasons: [] };
  const reasons = [];
  if (!VFS) return { required: true, ok: false, reasons: ['Improvement episode verification requires VFS'] };
  if (!isObject(claim)) {
    return { required: true, ok: false, reasons: ['Doppler promotion requires improvementEpisode evidence'] };
  }
  let paths = null;
  try {
    paths = episodePaths(claim.episodeId);
  } catch (error) {
    reasons.push(error.message);
  }
  if (paths && claim.projectionPath !== paths.projection) {
    reasons.push('Improvement episode projection path mismatch');
  }
  let events = [];
  if (paths) {
    try {
      if (!(await VFS.exists(paths.events))) {
        reasons.push('Improvement episode event ledger is missing');
      } else {
        events = parseJsonl(await VFS.read(paths.events), paths.events);
      }
    } catch (error) {
      reasons.push(error.message);
    }
  }
  let integrity = null;
  let episode = null;
  if (events.length > 0) {
    integrity = await verifyImprovementEvents(events, cryptoApi);
    episode = projectEvents(events, integrity);
    if (!integrity.valid) reasons.push(...integrity.reasons);
  }
  if (episode?.schema !== IMPROVEMENT_EPISODE_SCHEMA) {
    reasons.push('Improvement episode projection schema mismatch');
  }
  if (episode?.episodeId !== claim.episodeId) {
    reasons.push('Improvement episode identity mismatch');
  }
  if (integrity?.headHash !== claim.eventHeadHash) {
    reasons.push('Improvement episode head hash mismatch');
  }
  if (integrity?.eventCount !== claim.eventCount) {
    reasons.push('Improvement episode event count mismatch');
  }
  if (claim.signaturesValid !== true) {
    reasons.push('Improvement episode evidence does not declare valid signatures');
  }
  if (episode?.status !== 'awaiting_promotion') {
    reasons.push('Improvement episode is not awaiting promotion');
  }
  const readiness = assessPromotionReadiness(episode);
  if (!readiness.ready) reasons.push(...readiness.reasons);
  return {
    required: true,
    ok: reasons.length === 0,
    episodeId: episode?.episodeId || claim.episodeId || null,
    eventHeadHash: integrity?.headHash || null,
    readiness,
    reasons: [...new Set(reasons)]
  };
}

const ImprovementEpisodeLedger = {
  metadata: {
    id: 'ImprovementEpisodeLedger',
    version: '1.0.0',
    genesis: { introduced: 'full' },
    dependencies: ['Utils', 'VFS', 'EventBus?', 'AuditLogger?'],
    async: true,
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, VFS, EventBus, AuditLogger } = deps;
    const logger = Utils?.logger;
    const cryptoApi = deps.cryptoApi || globalThis.crypto;
    let writeQueue = Promise.resolve();
    let identityPromise = null;

    const serialize = (operation) => {
      const pending = writeQueue.then(operation, operation);
      writeQueue = pending.catch(() => {});
      return pending;
    };

    const getIdentity = async () => {
      if (!identityPromise) {
        identityPromise = deps.identityBundle
          ? Promise.resolve(deps.identityBundle)
          : ensureIdentityBundle({
            instanceId: getCurrentReploidInstanceId() || 'default',
            cryptoApi
          });
      }
      return identityPromise;
    };

    const readEvents = async (episodeId) => {
      const paths = episodePaths(episodeId);
      if (!(await VFS.exists(paths.events))) return [];
      return parseJsonl(await VFS.read(paths.events), paths.events);
    };

    const readIndex = async () => {
      if (!(await VFS.exists(INDEX_PATH))) {
        return { schema: 'rsi.improvement-episode-index/v1', episodes: [] };
      }
      return JSON.parse(await VFS.read(INDEX_PATH));
    };

    const updateIndex = async (episode) => {
      const index = await readIndex();
      const entry = {
        episodeId: episode.episodeId,
        parentEpisodeId: episode.parentEpisodeId,
        groupId: episode.groupId,
        surface: episode.surface,
        objectiveId: episode.objective.objectiveId,
        candidateId: episode.candidate?.candidateId || null,
        status: episode.status,
        generationId: episode.generation.current,
        integrityValid: episode.integrity.valid,
        updatedAt: episode.updatedAt,
        projectionPath: episodePaths(episode.episodeId).projection
      };
      const episodes = [
        entry,
        ...(Array.isArray(index.episodes) ? index.episodes : [])
          .filter((item) => item.episodeId !== episode.episodeId)
      ].slice(0, 500);
      await VFS.write(INDEX_PATH, `${JSON.stringify({ ...index, episodes }, null, 2)}\n`);
    };

    const persistProjection = async (events) => {
      const integrity = await verifyImprovementEvents(events, cryptoApi);
      const projection = projectEvents(events, integrity);
      if (!projection) throw new Error('Improvement episode is missing its start event');
      const paths = episodePaths(projection.episodeId);
      await VFS.write(paths.projection, `${JSON.stringify(projection, null, 2)}\n`);
      await updateIndex(projection);
      return projection;
    };

    const appendEvent = async (episodeId, type, payload, actor = {}) => serialize(async () => {
      if (!EVENT_TYPES.has(type)) throw new Error(`Unsupported improvement event type: ${type}`);
      const events = await readEvents(episodeId);
      if (type === 'episode.started' && events.length > 0) {
        throw new Error(`Improvement episode already exists: ${episodeId}`);
      }
      if (type !== 'episode.started' && events.length === 0) {
        throw new Error(`Improvement episode not found: ${episodeId}`);
      }
      const current = events.length > 0
        ? projectEvents(events, await verifyImprovementEvents(events, cryptoApi))
        : null;
      const mayFollowPromotion = current?.status === 'promoted'
        && PROMOTED_FOLLOW_UP_EVENTS.has(type);
      if (current && TERMINAL_STATES.has(current.status)
        && type !== 'reflection.recorded'
        && !mayFollowPromotion) {
        throw new Error(`Improvement episode is terminal: ${current.status}`);
      }
      const identity = await getIdentity();
      const event = {
        schema: IMPROVEMENT_EVENT_SCHEMA,
        episodeId,
        sequence: events.length + 1,
        type,
        timestamp: new Date().toISOString(),
        previousEventHash: events.at(-1)?.eventHash || null,
        actor: {
          authorityId: assertSafeId(actor.authorityId || identity.peerId, 'actor.authorityId'),
          role: assertText(actor.role || 'recorder', 'actor.role')
        },
        payload: cloneJson(payload)
      };
      event.eventHash = await hashImprovementValue(eventHashInput(event), cryptoApi);
      event.signature = await signEventHash(event.eventHash, identity, cryptoApi);
      const paths = episodePaths(episodeId);
      await VFS.write(paths.events, `${events.map((entry) => JSON.stringify(entry)).join('\n')}${events.length ? '\n' : ''}${JSON.stringify(event)}\n`);
      const projection = await persistProjection([...events, event]);
      EventBus?.emit?.('rsi:improvement-episode', {
        episodeId,
        type,
        status: projection.status,
        projectionPath: paths.projection
      });
      if (AuditLogger?.logEvent) {
        await AuditLogger.logEvent('RSI_IMPROVEMENT_EPISODE_EVENT', {
          episodeId,
          type,
          eventHash: event.eventHash,
          status: projection.status
        });
      }
      return projection;
    });

    const begin = async (input) => {
      const start = validateStart(input);
      if (start.parentEpisodeId) {
        const parent = await getEpisode(start.parentEpisodeId);
        if (!parent) throw new Error(`Parent improvement episode not found: ${start.parentEpisodeId}`);
        if (parent.generation.current !== start.baseline.generationId) {
          throw new Error('Child baseline generation does not match the parent current generation');
        }
      }
      await registerAlgorithm(start.algorithm);
      return appendEvent(start.episodeId, 'episode.started', start, {
        authorityId: start.proposer.authorityId,
        role: 'proposer'
      });
    };

    const getEpisode = async (episodeId) => {
      const events = await readEvents(episodeId);
      if (events.length === 0) return null;
      return projectEvents(events, await verifyImprovementEvents(events, cryptoApi));
    };

    const listEpisodes = async (options = {}) => {
      let episodes = (await readIndex()).episodes || [];
      if (options.surface) episodes = episodes.filter((entry) => entry.surface === options.surface);
      if (options.groupId) episodes = episodes.filter((entry) => entry.groupId === options.groupId);
      if (options.status) episodes = episodes.filter((entry) => entry.status === options.status);
      return options.limit ? episodes.slice(0, options.limit) : episodes;
    };

    const recordDiagnosis = async (episodeId, payload) => {
      const diagnosis = assertText(payload?.diagnosis, 'diagnosis');
      const hypothesis = validateHypothesisReflection(payload?.hypothesis);
      return appendEvent(episodeId, 'diagnosis.recorded', { diagnosis, hypothesis }, {
        authorityId: payload?.authorityId || 'reploid:zero',
        role: 'proposer'
      });
    };

    const recordNegativeEvidence = (episodeId, evidence) => appendEvent(
      episodeId,
      'negative-evidence.recorded',
      {
        ...cloneJson(evidence || {}),
        evidenceId: assertSafeId(evidence?.evidenceId, 'negativeEvidence.evidenceId'),
        kind: assertSafeId(evidence?.kind, 'negativeEvidence.kind'),
        digest: assertHash(evidence?.digest, 'negativeEvidence.digest'),
        summary: assertText(evidence?.summary, 'negativeEvidence.summary'),
        retained: evidence?.retained === true,
        sourcePath: evidence?.sourcePath ? normalizePath(evidence.sourcePath) : null
      },
      { authorityId: evidence?.authorityId || 'reploid:x:evaluator', role: 'evidence-producer' }
    );

    const proposeCandidate = async (episodeId, candidate) => {
      const episode = await getEpisode(episodeId);
      return appendEvent(episodeId, 'candidate.proposed', validateCandidate(candidate, episode), {
        authorityId: episode.proposer.authorityId,
        role: 'proposer'
      });
    };

    const recordExecution = (episodeId, execution) => appendEvent(
      episodeId,
      'execution.recorded',
      {
        ...cloneJson(execution || {}),
        isolated: execution?.isolated === true,
        sandboxId: assertText(execution?.sandboxId, 'execution.sandboxId'),
        runtimeIdentity: assertText(execution?.runtimeIdentity, 'execution.runtimeIdentity')
      },
      { authorityId: execution?.authorityId || 'reploid:x:sandbox', role: 'executor' }
    );

    const recordVerification = (episodeId, verification) => appendEvent(
      episodeId,
      'verification.recorded',
      {
        ...cloneJson(verification || {}),
        passed: verification?.passed === true,
        verifierId: assertSafeId(verification?.verifierId, 'verification.verifierId'),
        evidencePaths: assertStringArray(
          verification?.evidencePaths,
          'verification.evidencePaths'
        ).map(normalizePath)
      },
      { authorityId: verification?.verifierId, role: 'verifier' }
    );

    const recordEvaluation = async (episodeId, evaluation) => {
      const episode = await getEpisode(episodeId);
      if (evaluation?.evaluatorHash !== episode.evaluator.evaluatorHash) {
        throw new Error('evaluation evaluator hash does not match the frozen evaluator');
      }
      const next = {
        ...cloneJson(evaluation || {}),
        baselineContractHash: assertHash(
          evaluation?.baselineContractHash,
          'evaluation.baselineContractHash'
        ),
        candidateContractHash: assertHash(
          evaluation?.candidateContractHash,
          'evaluation.candidateContractHash'
        ),
        evaluatorHash: assertHash(evaluation?.evaluatorHash, 'evaluation.evaluatorHash'),
        sampleCount: Number(evaluation?.sampleCount || 0),
        rawObservations: Array.isArray(evaluation?.rawObservations)
          ? cloneJson(evaluation.rawObservations)
          : [],
        metrics: Array.isArray(evaluation?.metrics) ? cloneJson(evaluation.metrics) : []
      };
      if (!Number.isInteger(next.sampleCount) || next.sampleCount < 0) {
        throw new Error('evaluation.sampleCount must be a non-negative integer');
      }
      return appendEvent(episodeId, 'evaluation.recorded', next, {
        authorityId: episode.evaluator.authorityId,
        role: 'evaluator'
      });
    };

    const recordComparison = (episodeId, comparison) => appendEvent(
      episodeId,
      'comparison.recorded',
      {
        ...cloneJson(comparison || {}),
        primaryMetricId: assertSafeId(comparison?.primaryMetricId, 'comparison.primaryMetricId'),
        tradeoffs: Array.isArray(comparison?.tradeoffs) ? cloneJson(comparison.tradeoffs) : [],
        regressions: Array.isArray(comparison?.regressions) ? cloneJson(comparison.regressions) : [],
        conclusion: assertText(comparison?.conclusion, 'comparison.conclusion')
      },
      { authorityId: comparison?.authorityId || 'reploid:x:comparison', role: 'evaluator' }
    );

    const requestPromotion = async (episodeId, request) => {
      const episode = await getEpisode(episodeId);
      const readiness = assessPromotionReadiness(episode);
      if (!readiness.ready) throw new Error(`Improvement episode is not promotion-ready: ${readiness.reasons.join('; ')}`);
      return appendEvent(episodeId, 'promotion.requested', {
        ...cloneJson(request || {}),
        requestedAt: new Date().toISOString(),
        readiness
      }, {
        authorityId: request?.authorityId || 'reploid:x:promotion-policy',
        role: 'promotion-policy'
      });
    };

    const recordReview = (episodeId, review) => appendEvent(
      episodeId,
      'review.recorded',
      {
        ...cloneJson(review || {}),
        reviewerId: assertSafeId(review?.reviewerId, 'review.reviewerId'),
        decision: assertText(review?.decision, 'review.decision')
      },
      { authorityId: review?.reviewerId, role: 'reviewer' }
    );

    const recordDecision = async (episodeId, decision) => {
      const state = assertText(decision?.state, 'decision.state');
      if (!TERMINAL_STATES.has(state)) throw new Error(`Invalid terminal decision state: ${state}`);
      const episode = await getEpisode(episodeId);
      if (state === 'promoted') {
        const readiness = assessPromotionReadiness(episode);
        if (!readiness.ready) {
          throw new Error(`Improvement episode cannot be promoted: ${readiness.reasons.join('; ')}`);
        }
        const decisionAuthorityId = decision?.authorityId || episode.promotionAuthority?.authorityId;
        if (decisionAuthorityId !== episode.promotionAuthority?.authorityId) {
          throw new Error('promotion decision authority does not match repository-owned authority');
        }
      }
      const decisionAuthorityId = decision?.authorityId
        || episode.promotionAuthority?.authorityId
        || 'reploid:x:promotion-policy';
      return appendEvent(episodeId, 'decision.recorded', {
        ...cloneJson(decision || {}),
        authorityId: decisionAuthorityId,
        state,
        reasons: assertStringArray(decision?.reasons, 'decision.reasons', { allowEmpty: state === 'promoted' })
      }, {
        authorityId: decisionAuthorityId,
        role: 'promotion-policy'
      });
    };

    const recordEffect = async (episodeId, effect) => {
      const episode = await getEpisode(episodeId);
      const kind = assertSafeId(effect?.kind, 'effect.kind');
      if (!episode.promotionAuthority?.allowedEffectKinds?.includes(kind)) {
        throw new Error(`effect kind is outside repository-owned authority: ${kind}`);
      }
      return appendEvent(episodeId, 'effect.recorded', {
        ...cloneJson(effect || {}),
        effectId: assertSafeId(effect?.effectId, 'effect.effectId'),
        kind,
        state: assertSafeId(effect?.state, 'effect.state'),
        targetId: assertText(effect?.targetId, 'effect.targetId'),
        artifactHash: assertHash(effect?.artifactHash, 'effect.artifactHash'),
        receiptPath: normalizePath(effect?.receiptPath)
      }, {
        authorityId: effect?.authorityId || episode.promotionAuthority.authorityId,
        role: 'effect-authority'
      });
    };

    const recordOutcome = (episodeId, outcome) => appendEvent(
      episodeId,
      'outcome.recorded',
      {
        ...cloneJson(outcome || {}),
        outcomeId: assertSafeId(outcome?.outcomeId, 'outcome.outcomeId'),
        observationKind: assertSafeId(outcome?.observationKind, 'outcome.observationKind'),
        targetId: assertText(outcome?.targetId, 'outcome.targetId'),
        observationDigest: assertHash(outcome?.observationDigest, 'outcome.observationDigest'),
        sensorAuthorityId: assertSafeId(
          outcome?.sensorAuthorityId,
          'outcome.sensorAuthorityId'
        ),
        observedAt: assertText(outcome?.observedAt, 'outcome.observedAt')
      },
      { authorityId: outcome?.sensorAuthorityId, role: 'outcome-sensor' }
    );

    const recordReopening = async (episodeId, reopening) => {
      const episode = await getEpisode(episodeId);
      const condition = episode.reopeningConditions?.find((entry) => (
        entry.conditionId === reopening?.conditionId
      ));
      if (!condition) throw new Error('reopening does not match a declared condition');
      if (condition.sensorAuthorityId !== reopening?.authorityId) {
        throw new Error('reopening authority does not match the declared sensor authority');
      }
      return appendEvent(episodeId, 'reopening.recorded', {
        ...cloneJson(reopening || {}),
        conditionId: condition.conditionId,
        observationId: assertSafeId(reopening?.observationId, 'reopening.observationId'),
        targetId: assertText(reopening?.targetId, 'reopening.targetId'),
        resultingDecisionState: assertSafeId(
          reopening?.resultingDecisionState,
          'reopening.resultingDecisionState'
        ),
        retainedEffectState: assertSafeId(
          reopening?.retainedEffectState,
          'reopening.retainedEffectState'
        ),
        action: condition.action
      }, { authorityId: reopening.authorityId, role: 'reopening-sensor' });
    };

    const recordRollback = (episodeId, rollback) => appendEvent(
      episodeId,
      'rollback.recorded',
      {
        ...cloneJson(rollback || {}),
        rollbackPointer: normalizePath(rollback?.rollbackPointer),
        restoredGenerationId: assertSafeId(
          rollback?.restoredGenerationId,
          'rollback.restoredGenerationId'
        ),
        reason: assertText(rollback?.reason, 'rollback.reason')
      },
      { authorityId: rollback?.authorityId || 'reploid:x:rollback', role: 'rollback-authority' }
    );

    const recordReflection = (episodeId, reflection) => appendEvent(
      episodeId,
      'reflection.recorded',
      validateHypothesisReflection(reflection),
      { authorityId: reflection?.authorityId || 'reploid:x:reflection', role: 'reflection' }
    );

    const registerAlgorithm = (input) => serialize(async () => {
      const manifest = validateAlgorithmManifest(input);
      const manifestHash = await hashImprovementValue(manifest, cryptoApi);
      const registry = await (async () => {
        if (!(await VFS.exists(ALGORITHM_REGISTRY_PATH))) {
          return { schema: 'rsi.algorithm-registry/v1', algorithms: [] };
        }
        return JSON.parse(await VFS.read(ALGORITHM_REGISTRY_PATH));
      })();
      const existing = (registry.algorithms || []).find((entry) => (
        entry.algorithmId === manifest.algorithmId && entry.version === manifest.version
      ));
      if (existing && existing.manifestHash !== manifestHash) {
        throw new Error('Algorithm version is immutable and already has different contents');
      }
      const entry = { ...manifest, manifestHash };
      const algorithms = [
        entry,
        ...(registry.algorithms || []).filter((item) => !(
          item.algorithmId === manifest.algorithmId && item.version === manifest.version
        ))
      ];
      await VFS.write(ALGORITHM_REGISTRY_PATH, `${JSON.stringify({ ...registry, algorithms }, null, 2)}\n`);
      return entry;
    });

    const verifyEpisode = async (episodeId) => verifyImprovementEvents(
      await readEvents(episodeId),
      cryptoApi
    );

    return {
      begin,
      getEpisode,
      listEpisodes,
      proposeCandidate,
      readEvents,
      recordComparison,
      recordDecision,
      recordDiagnosis,
      recordEffect,
      recordEvaluation,
      recordExecution,
      recordNegativeEvidence,
      recordOutcome,
      recordReopening,
      recordReflection,
      recordReview,
      recordRollback,
      recordVerification,
      registerAlgorithm,
      requestPromotion,
      verifyEpisode,
      assessPromotionReadiness,
      pathsForEpisode: episodePaths
    };
  }
};

export default ImprovementEpisodeLedger;
