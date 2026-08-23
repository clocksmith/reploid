/**
 * @fileoverview Browser-safe Visual Feedback Bridge receipts for Change Passports.
 *
 * The Bridge owns annotation, session pairing, render notices, and reversible
 * workspace patches. This module verifies and content-addresses that source
 * material without importing Bridge code or granting it review/effect authority.
 */

import { hashChangePassportValue } from './contract.js';

export const VISUAL_CHANGE_CANDIDATE_SCHEMA = 'change.passport-visual-candidate/v1';
export const VISUAL_CHANGE_EVALUATION_SCHEMA = 'change.passport-visual-evaluation/v1';
export const VISUAL_CHANGE_ACCEPTANCE_SCHEMA = 'change.passport-visual-acceptance/v1';
export const VISUAL_CHANGE_RENDER_SCHEMA = 'change.passport-visual-render/v1';
export const VISUAL_CHANGE_REVERSE_SCHEMA = 'change.passport-visual-reverse/v1';
export const VISUAL_FEEDBACK_PATCH_SCHEMA = 'deco.visual-feedback.workspace-patch/v1';

const HASH_PATTERN = /^(?:sha256:)?([a-f0-9]{64})$/i;
const SAFE_PATH_SEGMENT = /^[^\0/\\]+$/;
const cloneJson = (value) => JSON.parse(JSON.stringify(value));
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const requiredText = (value, label, max = 10_000) => {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  if (normalized.length > max) throw new Error(`${label} exceeds ${max} characters`);
  return normalized;
};

const requiredTimestamp = (value, label) => {
  const normalized = requiredText(value, label, 64);
  if (!Number.isFinite(Date.parse(normalized))) throw new Error(`${label} must be an ISO timestamp`);
  return normalized;
};

export const normalizeVisualDigest = (value, label = 'digest') => {
  const match = String(value ?? '').trim().match(HASH_PATTERN);
  if (!match) throw new Error(`${label} must be a SHA-256 identity`);
  return `sha256:${match[1].toLowerCase()}`;
};

const optionalDigest = (value, label) => (
  value === null || value === undefined || value === '' ? null : normalizeVisualDigest(value, label)
);

const relativeSourcePath = (value, label) => {
  const normalized = requiredText(value, label, 2_000).replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
    throw new Error(`${label} must be relative to the paired worktree`);
  }
  const segments = normalized.split('/');
  if (segments.some((segment) => !SAFE_PATH_SEGMENT.test(segment) || segment === '.' || segment === '..')) {
    throw new Error(`${label} escapes the paired worktree`);
  }
  return segments.join('/');
};

const stringArray = (value, label, { allowEmpty = false } = {}) => {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new Error(`${label} must be ${allowEmpty ? 'an' : 'a non-empty'} array`);
  }
  return value.map((entry, index) => requiredText(entry, `${label}[${index}]`, 2_000));
};

const sameStrings = (left, right) => (
  JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
);

const normalizeBridgeEnvelope = (envelope, type) => {
  if (!isObject(envelope)) throw new Error(`${type} Bridge envelope is required`);
  if (envelope.protocolVersion !== 1) throw new Error(`${type} uses an unsupported Bridge protocol version`);
  if (envelope.type !== type) throw new Error(`expected Bridge event ${type}`);
  if (!Number.isInteger(envelope.sequence) || envelope.sequence < 1) {
    throw new Error(`${type}.sequence must be positive`);
  }
  if (!isObject(envelope.payload)) throw new Error(`${type}.payload must be an object`);
  return {
    protocolVersion: 1,
    eventId: requiredText(envelope.eventId, `${type}.eventId`, 500),
    requestId: requiredText(envelope.requestId, `${type}.requestId`, 500),
    projectId: requiredText(envelope.projectId, `${type}.projectId`, 500),
    worktreeId: requiredText(envelope.worktreeId, `${type}.worktreeId`, 500),
    sessionId: requiredText(envelope.sessionId, `${type}.sessionId`, 500),
    browserClientId: requiredText(envelope.browserClientId, `${type}.browserClientId`, 500),
    sequence: envelope.sequence,
    causationId: envelope.causationId ? requiredText(envelope.causationId, `${type}.causationId`, 500) : null,
    correlationId: requiredText(envelope.correlationId, `${type}.correlationId`, 500),
    emittedAt: requiredTimestamp(envelope.emittedAt, `${type}.emittedAt`),
    type,
    payload: cloneJson(envelope.payload)
  };
};

const assertSameBridgeIdentity = (left, right, label) => {
  for (const field of ['projectId', 'worktreeId', 'sessionId', 'browserClientId']) {
    if (left[field] !== right[field]) throw new Error(`${label} ${field} does not match the visual complaint`);
  }
};

const sourceFilesFromAnnotation = (annotation) => {
  const anchors = [
    ...(Array.isArray(annotation.elementAnchors) ? annotation.elementAnchors : []),
    ...(Array.isArray(annotation.regionAnchor?.candidateElements)
      ? annotation.regionAnchor.candidateElements
      : [])
  ];
  return anchors.flatMap((anchor) => (
    anchor?.component?.sourceFile
      ? [relativeSourcePath(anchor.component.sourceFile, 'annotation component sourceFile')]
      : []
  ));
};

const normalizeRequest = (envelope) => {
  const normalizedEnvelope = normalizeBridgeEnvelope(envelope, 'change.requested');
  const packet = normalizedEnvelope.payload;
  for (const field of ['changeId', 'projectId', 'worktreeId', 'sessionId', 'browserClientId']) {
    requiredText(packet[field], `change.requested.payload.${field}`, 500);
    if (field !== 'changeId' && packet[field] !== normalizedEnvelope[field]) {
      throw new Error(`change.requested payload ${field} does not match its envelope`);
    }
  }
  const routeKey = requiredText(packet.routeKey, 'change.requested.payload.routeKey', 2_000);
  const annotations = Array.isArray(packet.annotations) ? cloneJson(packet.annotations) : [];
  const comments = Array.isArray(packet.comments) ? cloneJson(packet.comments) : [];
  if (annotations.length === 0 || comments.length === 0) {
    throw new Error('visual complaint requires annotations and comments');
  }
  const annotationIds = new Set();
  const sourceFiles = new Set();
  for (const [index, annotation] of annotations.entries()) {
    const annotationId = requiredText(annotation?.id, `annotation[${index}].id`, 500);
    if (annotationIds.has(annotationId)) throw new Error(`duplicate annotation identity ${annotationId}`);
    annotationIds.add(annotationId);
    requiredText(annotation?.comment, `annotation[${index}].comment`);
    if (annotation.routeKey !== routeKey) throw new Error(`annotation ${annotationId} route does not match the request`);
    if (!Array.isArray(annotation.elementContext) || annotation.elementContext.length === 0) {
      throw new Error(`annotation ${annotationId} is missing captured DOM context`);
    }
    for (const sourceFile of sourceFilesFromAnnotation(annotation)) sourceFiles.add(sourceFile);
  }
  if (sourceFiles.size === 0) throw new Error('visual complaint is missing source ownership context');
  const commentIds = new Set();
  for (const [index, comment] of comments.entries()) {
    const commentId = requiredText(comment?.commentId, `comment[${index}].commentId`, 500);
    if (commentIds.has(commentId)) throw new Error(`duplicate comment identity ${commentId}`);
    commentIds.add(commentId);
    if (!annotationIds.has(comment.annotationId)) throw new Error(`comment ${commentId} has no owned annotation`);
    requiredText(comment.text, `comment[${index}].text`);
  }
  if (!isObject(packet.page) || !isObject(packet.page.viewport) || !isObject(packet.page.scroll)) {
    throw new Error('visual complaint is missing captured page context');
  }
  return {
    ...normalizedEnvelope,
    changeId: requiredText(packet.changeId, 'change.requested.payload.changeId', 500),
    routeKey,
    threadId: requiredText(packet.threadId, 'change.requested.payload.threadId', 500),
    page: cloneJson(packet.page),
    annotations,
    comments,
    sourceFiles: [...sourceFiles].sort()
  };
};

const normalizeCompletion = (envelope, request) => {
  const normalizedEnvelope = normalizeBridgeEnvelope(envelope, 'agent.completed');
  assertSameBridgeIdentity(request, normalizedEnvelope, 'agent completion');
  if (normalizedEnvelope.causationId !== request.eventId) {
    throw new Error('agent completion is not caused by the visual complaint event');
  }
  const payload = normalizedEnvelope.payload;
  if (payload.changeId !== request.changeId) throw new Error('agent completion changeId does not match');
  const changedFiles = stringArray(payload.changedFiles, 'agent completion changedFiles')
    .map((entry, index) => relativeSourcePath(entry, `agent completion changedFiles[${index}]`));
  const expectedComments = new Set(request.comments.map((entry) => entry.commentId));
  const observedComments = new Set();
  const commentResults = Array.isArray(payload.commentResults) ? cloneJson(payload.commentResults) : [];
  for (const result of commentResults) {
    const commentId = requiredText(result?.commentId, 'comment result identity', 500);
    if (!expectedComments.has(commentId) || observedComments.has(commentId)) {
      throw new Error(`agent completion has an invalid comment disposition for ${commentId}`);
    }
    observedComments.add(commentId);
    if (!['addressed', 'partially_addressed', 'blocked', 'needs_input', 'out_of_scope', 'superseded']
      .includes(result.disposition)) {
      throw new Error(`comment ${commentId} has an invalid disposition`);
    }
  }
  if (observedComments.size !== expectedComments.size) {
    throw new Error('agent completion omitted one or more comment dispositions');
  }
  const validation = Array.isArray(payload.validation) ? cloneJson(payload.validation) : [];
  return {
    ...normalizedEnvelope,
    changeId: request.changeId,
    summary: requiredText(payload.summary, 'agent completion summary'),
    changedFiles: [...new Set(changedFiles)].sort(),
    commentResults,
    validation,
    patchArtifactHash: normalizeVisualDigest(payload.patchHash, 'agent completion patchHash')
  };
};

const normalizePatchManifest = (manifest, request, completion) => {
  if (!isObject(manifest) || manifest.schema !== VISUAL_FEEDBACK_PATCH_SCHEMA) {
    throw new Error(`workspace patch must use ${VISUAL_FEEDBACK_PATCH_SCHEMA}`);
  }
  if (manifest.changeId !== request.changeId) throw new Error('workspace patch changeId does not match');
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    throw new Error('workspace patch must own at least one changed file');
  }
  if (Array.isArray(manifest.unpatchableChanges) && manifest.unpatchableChanges.length > 0) {
    throw new Error('workspace patch contains changes outside the reversible capture boundary');
  }
  const entries = manifest.entries.map((entry, index) => {
    const path = relativeSourcePath(entry?.path, `workspace patch entries[${index}].path`);
    const kind = ['created', 'modified', 'deleted'].includes(entry?.kind) ? entry.kind : null;
    if (!kind) throw new Error(`workspace patch ${path} has an invalid change kind`);
    const beforeHash = optionalDigest(entry.beforeHash, `workspace patch ${path} beforeHash`);
    const afterHash = optionalDigest(entry.afterHash, `workspace patch ${path} afterHash`);
    if (kind === 'created' && beforeHash !== null) throw new Error(`created file ${path} has a beforeHash`);
    if (kind === 'deleted' && afterHash !== null) throw new Error(`deleted file ${path} has an afterHash`);
    if (kind === 'modified' && (!beforeHash || !afterHash || beforeHash === afterHash)) {
      throw new Error(`modified file ${path} does not bind distinct before and after hashes`);
    }
    return { path, kind, beforeHash, afterHash };
  }).sort((left, right) => left.path.localeCompare(right.path));
  if (new Set(entries.map((entry) => entry.path)).size !== entries.length) {
    throw new Error('workspace patch contains duplicate file paths');
  }
  if (!sameStrings(entries.map((entry) => entry.path), completion.changedFiles)) {
    throw new Error('agent completion changedFiles do not match the reversible workspace patch');
  }
  return {
    schema: VISUAL_FEEDBACK_PATCH_SCHEMA,
    changeId: request.changeId,
    createdAt: requiredTimestamp(manifest.createdAt, 'workspace patch createdAt'),
    entries
  };
};

export async function hashVisualSourceState(files = [], cryptoApi = globalThis.crypto) {
  if (!Array.isArray(files) || files.length === 0) throw new Error('visual source state cannot be empty');
  const normalized = files.map((entry, index) => ({
    path: relativeSourcePath(entry?.path, `source state[${index}].path`),
    hash: optionalDigest(entry?.hash, `source state[${index}].hash`)
  })).sort((left, right) => left.path.localeCompare(right.path));
  if (new Set(normalized.map((entry) => entry.path)).size !== normalized.length) {
    throw new Error('visual source state contains duplicate paths');
  }
  return hashChangePassportValue({ schema: 'change.passport-visual-source-state/v1', files: normalized }, cryptoApi);
}

export async function buildVisualChangeCandidate({
  requestEnvelope,
  completionEnvelope,
  patchManifest,
  patchArtifactHash,
  cryptoApi = globalThis.crypto
} = {}) {
  const request = normalizeRequest(requestEnvelope);
  const completion = normalizeCompletion(completionEnvelope, request);
  const artifactHash = normalizeVisualDigest(
    patchArtifactHash || completion.patchArtifactHash,
    'workspace patch artifact hash'
  );
  if (artifactHash !== completion.patchArtifactHash) {
    throw new Error('workspace patch artifact does not match the agent completion');
  }
  const patch = normalizePatchManifest(patchManifest, request, completion);
  const requestHash = await hashChangePassportValue(request, cryptoApi);
  const completionHash = await hashChangePassportValue(completion, cryptoApi);
  const manifestHash = await hashChangePassportValue(patch, cryptoApi);
  const baselineHash = await hashVisualSourceState(
    patch.entries.map((entry) => ({ path: entry.path, hash: entry.beforeHash })),
    cryptoApi
  );
  const candidateHash = await hashVisualSourceState(
    patch.entries.map((entry) => ({ path: entry.path, hash: entry.afterHash })),
    cryptoApi
  );
  const candidate = {
    schema: VISUAL_CHANGE_CANDIDATE_SCHEMA,
    bridge: {
      protocolVersion: 1,
      projectId: request.projectId,
      worktreeId: request.worktreeId,
      sessionId: request.sessionId,
      browserClientId: request.browserClientId,
      changeId: request.changeId,
      threadId: request.threadId,
      routeKey: request.routeKey
    },
    request: { ...request, digest: requestHash },
    completion: { ...completion, digest: completionHash },
    patch: { ...patch, artifactHash, manifestHash },
    baselineHash,
    candidateHash
  };
  candidate.candidateRootHash = await hashChangePassportValue(candidate, cryptoApi);
  return Object.freeze(candidate);
}

export async function verifyVisualChangeCandidate(candidate, cryptoApi = globalThis.crypto) {
  const reasons = [];
  try {
    if (candidate?.schema !== VISUAL_CHANGE_CANDIDATE_SCHEMA) reasons.push('candidate schema mismatch');
    if (candidate?.request?.changeId !== candidate?.bridge?.changeId) reasons.push('request change identity mismatch');
    if (candidate?.completion?.changeId !== candidate?.bridge?.changeId) reasons.push('completion change identity mismatch');
    if (candidate?.patch?.changeId !== candidate?.bridge?.changeId) reasons.push('patch change identity mismatch');
    if (candidate?.completion?.patchArtifactHash !== candidate?.patch?.artifactHash) reasons.push('patch artifact identity mismatch');
    if (!sameStrings(candidate?.completion?.changedFiles || [], (candidate?.patch?.entries || []).map((entry) => entry.path))) {
      reasons.push('changed file closure mismatch');
    }
    for (const field of ['baselineHash', 'candidateHash', 'candidateRootHash']) {
      normalizeVisualDigest(candidate?.[field], `candidate.${field}`);
    }
    const unsigned = cloneJson(candidate);
    delete unsigned.candidateRootHash;
    if (await hashChangePassportValue(unsigned, cryptoApi) !== candidate.candidateRootHash) {
      reasons.push('candidate root hash mismatch');
    }
  } catch (error) {
    reasons.push(error.message);
  }
  return { valid: reasons.length === 0, reasons };
}

const normalizeCheck = (check, index, label) => ({
  name: requiredText(check?.name, `${label}[${index}].name`, 500),
  status: ['passed', 'failed'].includes(check?.status) ? check.status : (() => {
    throw new Error(`${label}[${index}].status is invalid`);
  })(),
  artifactHash: normalizeVisualDigest(check?.artifactHash, `${label}[${index}].artifactHash`),
  runner: requiredText(check?.runner, `${label}[${index}].runner`, 500)
});

const receiptRoot = async (receipt, cryptoApi) => {
  const unsigned = cloneJson(receipt);
  delete unsigned.receiptHash;
  return hashChangePassportValue(unsigned, cryptoApi);
};

export async function buildVisualChangeEvaluationReceipt({
  candidate,
  evaluator,
  checks,
  renderOracle,
  observedAt,
  cryptoApi = globalThis.crypto
} = {}) {
  const verification = await verifyVisualChangeCandidate(candidate, cryptoApi);
  if (!verification.valid) throw new Error(`Visual candidate is invalid: ${verification.reasons.join('; ')}`);
  if (evaluator?.authorityId === candidate.request?.payload?.proposerAuthorityId) {
    throw new Error('visual evaluator cannot be the patch proposer');
  }
  const normalizedChecks = (Array.isArray(checks) ? checks : []).map((check, index) => (
    normalizeCheck(check, index, 'evaluation checks')
  ));
  if (normalizedChecks.length === 0) throw new Error('independent evaluation requires frozen checks');
  const assertions = (Array.isArray(renderOracle?.assertions) ? renderOracle.assertions : [])
    .map((check, index) => normalizeCheck(check, index, 'render assertions'));
  if (assertions.length === 0) throw new Error('independent evaluation requires render assertions');
  const conclusion = [...normalizedChecks, ...assertions].every((check) => check.status === 'passed')
    ? 'pass'
    : 'fail';
  const receipt = {
    schema: VISUAL_CHANGE_EVALUATION_SCHEMA,
    candidateRootHash: candidate.candidateRootHash,
    candidateHash: candidate.candidateHash,
    evaluator: {
      evaluatorId: requiredText(evaluator?.evaluatorId, 'evaluator.evaluatorId', 500),
      authorityId: requiredText(evaluator?.authorityId, 'evaluator.authorityId', 500),
      version: requiredText(evaluator?.version, 'evaluator.version', 160),
      evaluatorHash: normalizeVisualDigest(evaluator?.evaluatorHash, 'evaluator.evaluatorHash'),
      suiteHash: normalizeVisualDigest(evaluator?.suiteHash, 'evaluator.suiteHash'),
      contractHash: normalizeVisualDigest(evaluator?.contractHash, 'evaluator.contractHash'),
      frozenBeforeCandidate: evaluator?.frozenBeforeCandidate === true
    },
    checks: normalizedChecks,
    renderOracle: {
      engine: requiredText(renderOracle?.engine, 'renderOracle.engine', 500),
      routeKey: requiredText(renderOracle?.routeKey, 'renderOracle.routeKey', 2_000),
      artifactHash: normalizeVisualDigest(renderOracle?.artifactHash, 'renderOracle.artifactHash'),
      assertions
    },
    conclusion,
    observedAt: requiredTimestamp(observedAt, 'evaluation observedAt')
  };
  if (!receipt.evaluator.frozenBeforeCandidate) throw new Error('visual evaluator must be frozen before the candidate');
  receipt.receiptHash = await receiptRoot(receipt, cryptoApi);
  return Object.freeze(receipt);
}

export async function buildVisualChangeRenderReceipt({
  candidate,
  renderEnvelope,
  effectId,
  activationReference,
  oracle,
  observedAt,
  cryptoApi = globalThis.crypto
} = {}) {
  const verification = await verifyVisualChangeCandidate(candidate, cryptoApi);
  if (!verification.valid) throw new Error(`Visual candidate is invalid: ${verification.reasons.join('; ')}`);
  const envelope = normalizeBridgeEnvelope(renderEnvelope, 'page.rendered');
  assertSameBridgeIdentity(candidate.bridge, envelope, 'render receipt');
  if (envelope.payload.changeId !== candidate.bridge.changeId) throw new Error('render receipt changeId does not match');
  if (envelope.payload.routeKey !== candidate.bridge.routeKey) throw new Error('render receipt route does not match');
  const assertions = (Array.isArray(oracle?.assertions) ? oracle.assertions : [])
    .map((check, index) => normalizeCheck(check, index, 'render verification assertions'));
  if (assertions.length === 0) throw new Error('rendered verification requires independent assertions');
  const receipt = {
    schema: VISUAL_CHANGE_RENDER_SCHEMA,
    candidateRootHash: candidate.candidateRootHash,
    candidateHash: candidate.candidateHash,
    effectId: requiredText(effectId, 'render effectId', 500),
    activationReference: requiredText(activationReference, 'render activationReference', 2_000),
    bridgeEventHash: await hashChangePassportValue(envelope, cryptoApi),
    routeKey: candidate.bridge.routeKey,
    mode: requiredText(envelope.payload.mode, 'render mode', 100),
    oracle: {
      engine: requiredText(oracle?.engine, 'render oracle engine', 500),
      artifactHash: normalizeVisualDigest(oracle?.artifactHash, 'render oracle artifactHash'),
      assertions
    },
    status: assertions.every((check) => check.status === 'passed') ? 'verified' : 'failed',
    observedAt: requiredTimestamp(observedAt, 'render observedAt')
  };
  receipt.receiptHash = await receiptRoot(receipt, cryptoApi);
  return Object.freeze(receipt);
}

export async function buildVisualChangeAcceptanceReceipt({
  candidate,
  acceptedEnvelope,
  observedAt,
  cryptoApi = globalThis.crypto
} = {}) {
  const verification = await verifyVisualChangeCandidate(candidate, cryptoApi);
  if (!verification.valid) throw new Error(`Visual candidate is invalid: ${verification.reasons.join('; ')}`);
  const envelope = normalizeBridgeEnvelope(acceptedEnvelope, 'review.accepted');
  assertSameBridgeIdentity(candidate.bridge, envelope, 'acceptance receipt');
  if (envelope.payload.changeId !== candidate.bridge.changeId) throw new Error('acceptance receipt changeId does not match');
  const receipt = {
    schema: VISUAL_CHANGE_ACCEPTANCE_SCHEMA,
    candidateRootHash: candidate.candidateRootHash,
    candidateHash: candidate.candidateHash,
    bridgeEventHash: await hashChangePassportValue(envelope, cryptoApi),
    accepted: true,
    observedAt: requiredTimestamp(observedAt || envelope.emittedAt, 'acceptance observedAt')
  };
  receipt.receiptHash = await receiptRoot(receipt, cryptoApi);
  return Object.freeze(receipt);
}

export async function buildVisualChangeReverseReceipt({
  candidate,
  revertedEnvelope,
  currentSourceHash,
  observedAt,
  cryptoApi = globalThis.crypto
} = {}) {
  const verification = await verifyVisualChangeCandidate(candidate, cryptoApi);
  if (!verification.valid) throw new Error(`Visual candidate is invalid: ${verification.reasons.join('; ')}`);
  const envelope = normalizeBridgeEnvelope(revertedEnvelope, 'change.reverted');
  assertSameBridgeIdentity(candidate.bridge, envelope, 'reverse receipt');
  if (envelope.payload.changeId !== candidate.bridge.changeId) throw new Error('reverse receipt changeId does not match');
  const revertedFiles = stringArray(envelope.payload.revertedFiles, 'reverse receipt revertedFiles')
    .map((entry, index) => relativeSourcePath(entry, `reverse receipt revertedFiles[${index}]`));
  const expectedFiles = candidate.patch.entries.map((entry) => entry.path);
  if (!sameStrings(revertedFiles, expectedFiles)) throw new Error('reverse receipt does not cover the owned patch');
  const sourceHash = normalizeVisualDigest(currentSourceHash, 'reverse receipt currentSourceHash');
  if (sourceHash !== candidate.baselineHash) throw new Error('reverse patch did not restore the frozen baseline');
  const receipt = {
    schema: VISUAL_CHANGE_REVERSE_SCHEMA,
    candidateRootHash: candidate.candidateRootHash,
    bridgeEventHash: await hashChangePassportValue(envelope, cryptoApi),
    revertedFiles: [...new Set(revertedFiles)].sort(),
    previousSourceHash: candidate.candidateHash,
    currentSourceHash: sourceHash,
    restoredBaseline: true,
    observedAt: requiredTimestamp(observedAt, 'reverse observedAt')
  };
  receipt.receiptHash = await receiptRoot(receipt, cryptoApi);
  return Object.freeze(receipt);
}

export default {
  VISUAL_CHANGE_CANDIDATE_SCHEMA,
  VISUAL_CHANGE_EVALUATION_SCHEMA,
  VISUAL_CHANGE_ACCEPTANCE_SCHEMA,
  VISUAL_CHANGE_RENDER_SCHEMA,
  VISUAL_CHANGE_REVERSE_SCHEMA,
  buildVisualChangeCandidate,
  buildVisualChangeEvaluationReceipt,
  buildVisualChangeAcceptanceReceipt,
  buildVisualChangeRenderReceipt,
  buildVisualChangeReverseReceipt,
  hashVisualSourceState,
  normalizeVisualDigest,
  verifyVisualChangeCandidate
};
