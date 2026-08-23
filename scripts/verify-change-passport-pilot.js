#!/usr/bin/env node
/**
 * @fileoverview Fail-closed freeze gate for the Agent Release Passport pilot.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CHANGE_PASSPORT_PILOT_PATH = path.resolve(
  __dirname,
  '../docs/change-passport/pilot-manifest.json'
);

const ALLOWED_CHANGE_CLASSES = Object.freeze([
  'mcp_server_version',
  'agent_tool_manifest',
  'agent_permission_policy',
  'production_agent_configuration'
]);
const REQUIRED_APPROVAL_ROLES = Object.freeze([
  'adopter',
  'operator',
  'independent_evaluator',
  'approving_authority'
]);
const EXPECTED_PERMISSIONS = Object.freeze({ checks: 'write', metadata: 'read', pullRequests: 'read' });
const EXPECTED_EVENTS = Object.freeze(['pull_request', 'pull_request_review']);
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

const text = (value) => String(value || '').trim();
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
};
const comparable = (value) => JSON.stringify(canonical(value));
const isTimestamp = (value) => {
  const normalized = text(value);
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === normalized;
};
const isPositiveNumber = (value) => Number.isFinite(Number(value)) && Number(value) > 0;

export function hashChangePassportPilotManifest(manifest = {}) {
  const { freeze: _freeze, ...core } = manifest;
  return `sha256:${crypto.createHash('sha256').update(comparable(core)).digest('hex')}`;
}

export function verifyChangePassportPilotManifest(manifest, { requireFrozen = false } = {}) {
  const errors = [];
  if (manifest?.schema !== 'reploid.agent-release-passport-pilot/v1') {
    errors.push('schema must be reploid.agent-release-passport-pilot/v1');
  }
  if (!text(manifest?.pilotId)) errors.push('pilotId is required');
  if (!['awaiting_external_freeze', 'frozen', 'running', 'complete', 'rejected'].includes(manifest?.status)) {
    errors.push('status is invalid');
  }
  if (!Number.isInteger(manifest?.minimumReportableCases) || manifest.minimumReportableCases < 20) {
    errors.push('minimumReportableCases must be at least 20');
  }
  if (comparable(manifest?.product?.supportedChangeClasses) !== comparable(ALLOWED_CHANGE_CLASSES)) {
    errors.push('supported change classes must match the Agent Release Passport wedge');
  }
  if (manifest?.changeClass && !ALLOWED_CHANGE_CLASSES.includes(manifest.changeClass)) {
    errors.push('changeClass is outside the Agent Release Passport wedge');
  }
  if (manifest?.assignmentPolicy?.sameCandidateAndEvidenceCutoff !== true) {
    errors.push('both arms must receive the same candidate and evidence cutoff');
  }
  if (manifest?.assignmentPolicy?.retainEveryAttempt !== true) {
    errors.push('every attempted case must remain counted');
  }
  if (!Array.isArray(manifest?.successPaths) || manifest.successPaths.length < 2) {
    errors.push('quality and effort success paths are required');
  }
  if (!Array.isArray(manifest?.requiredScenarios)
    || !manifest.requiredScenarios.includes('verified_reopening')
    || !manifest.requiredScenarios.includes('candidate_changed_after_freeze')) {
    errors.push('reopening and changed-candidate scenarios are required');
  }
  if (comparable(manifest?.githubApp?.permissions) !== comparable(EXPECTED_PERMISSIONS)) {
    errors.push('GitHub App permissions must match the check-only contract');
  }
  if (comparable([...(manifest?.githubApp?.events || [])].sort()) !== comparable(EXPECTED_EVENTS)) {
    errors.push('GitHub App events must match the pull-request-only contract');
  }
  const prohibited = new Set(manifest?.githubApp?.prohibitedPermissions || []);
  for (const permission of ['contents', 'deployments', 'administration', 'workflows', 'secrets']) {
    if (!prohibited.has(permission)) errors.push(`prohibited GitHub permission missing: ${permission}`);
  }

  const frozenFields = [
    ['adopter.organizationId', manifest?.adopter?.organizationId],
    ['operator.authorityId', manifest?.operator?.authorityId],
    ['independentEvaluator.authorityId', manifest?.independentEvaluator?.authorityId],
    ['approvingAuthority.authorityId', manifest?.approvingAuthority?.authorityId],
    ['repository.fullName', manifest?.repository?.fullName],
    ['repository.repositoryId', manifest?.repository?.repositoryId],
    ['repository.installationId', manifest?.repository?.installationId],
    ['repository.baseBranch', manifest?.repository?.baseBranch],
    ['agentProgram.programId', manifest?.agentProgram?.programId],
    ['agentProgram.environment', manifest?.agentProgram?.environment],
    ['changeClass', manifest?.changeClass],
    ['candidate.baselineDigest', manifest?.candidate?.baselineDigest],
    ['candidate.candidateDigest', manifest?.candidate?.candidateDigest],
    ['candidate.artifactUri', manifest?.candidate?.artifactUri],
    ['candidate.rollbackTarget.revision', manifest?.candidate?.rollbackTarget?.revision],
    ['candidate.rollbackTarget.artifactDigest', manifest?.candidate?.rollbackTarget?.artifactDigest],
    ['evaluation.evaluatorDigest', manifest?.evaluation?.evaluatorDigest],
    ['evaluation.suiteDigest', manifest?.evaluation?.suiteDigest],
    ['evaluation.contractDigest', manifest?.evaluation?.contractDigest],
    ['baselineWorkflow.evidenceCutoff', manifest?.baselineWorkflow?.evidenceCutoff],
    ['baselineWorkflow.outcomeWindow', manifest?.baselineWorkflow?.outcomeWindow],
    ['baselineWorkflow.resourceBudget', manifest?.baselineWorkflow?.resourceBudget]
  ];
  const unfrozenFields = frozenFields.filter(([, value]) => (
    value === null || value === undefined || value === ''
  )).map(([field]) => field);

  const authorityIds = [
    manifest?.operator?.authorityId,
    manifest?.independentEvaluator?.authorityId,
    manifest?.approvingAuthority?.authorityId
  ].filter(Boolean);
  if (new Set(authorityIds).size !== authorityIds.length) {
    errors.push('operator, evaluator, and approving authority must be distinct');
  }
  for (const [field, digest] of [
    ['candidate.baselineDigest', manifest?.candidate?.baselineDigest],
    ['candidate.candidateDigest', manifest?.candidate?.candidateDigest],
    ['candidate.rollbackTarget.artifactDigest', manifest?.candidate?.rollbackTarget?.artifactDigest],
    ['evaluation.evaluatorDigest', manifest?.evaluation?.evaluatorDigest],
    ['evaluation.suiteDigest', manifest?.evaluation?.suiteDigest],
    ['evaluation.contractDigest', manifest?.evaluation?.contractDigest]
  ]) {
    if (digest && !SHA256.test(digest)) errors.push(`${field} must be a SHA-256 digest`);
  }
  if (manifest?.baselineWorkflow?.evidenceCutoff && !isTimestamp(manifest.baselineWorkflow.evidenceCutoff)) {
    errors.push('baselineWorkflow.evidenceCutoff must be a canonical UTC timestamp');
  }
  const budget = manifest?.baselineWorkflow?.resourceBudget;
  if (budget && (!isPositiveNumber(budget.caseCount)
    || !isPositiveNumber(budget.maximumOperatorMinutes)
    || !isPositiveNumber(budget.maximumElapsedMilliseconds))) {
    errors.push('resource budget must bind positive case, operator-minute, and elapsed-time limits');
  }
  if (manifest?.reopening?.rules && !Array.isArray(manifest.reopening.rules)) {
    errors.push('reopening.rules must be an array');
  }

  if (requireFrozen) {
    if (manifest?.status !== 'frozen') errors.push('status must be frozen');
    errors.push(...unfrozenFields.map((field) => `${field} is not frozen`));
    if (manifest?.githubApp?.externallyInstallable !== true) {
      errors.push('GitHub App is not externally installable');
    }
    if (!Array.isArray(manifest?.reopening?.rules) || manifest.reopening.rules.length < 1) {
      errors.push('at least one reopening rule must be frozen');
    }
    if (!isTimestamp(manifest?.freeze?.frozenAt)) errors.push('freeze.frozenAt must be a canonical UTC timestamp');
    const expectedHash = hashChangePassportPilotManifest(manifest);
    if (manifest?.freeze?.manifestHash !== expectedHash) errors.push('freeze.manifestHash does not match the manifest');
    const receipts = Array.isArray(manifest?.freeze?.approvalReceipts) ? manifest.freeze.approvalReceipts : [];
    for (const role of REQUIRED_APPROVAL_ROLES) {
      const receipt = receipts.find((entry) => entry?.role === role);
      if (!receipt || !text(receipt.authorityId) || !SHA256.test(text(receipt.receiptDigest)) || !text(receipt.evidenceRef)) {
        errors.push(`freeze approval receipt is missing or invalid: ${role}`);
      }
    }
  }
  const freezeErrors = new Set(['status must be frozen', 'GitHub App is not externally installable', 'at least one reopening rule must be frozen', 'freeze.frozenAt must be a canonical UTC timestamp', 'freeze.manifestHash does not match the manifest']);
  return {
    valid: errors.length === 0,
    structurallyValid: errors.filter((error) => !error.includes('not frozen') && !error.startsWith('freeze approval receipt') && !freezeErrors.has(error)).length === 0,
    frozen: manifest?.status === 'frozen' && unfrozenFields.length === 0 && errors.length === 0,
    manifestHash: hashChangePassportPilotManifest(manifest),
    unfrozenFields,
    errors
  };
}

export function verifyChangePassportPilotFile(filePath = DEFAULT_CHANGE_PASSPORT_PILOT_PATH, options = {}) {
  return verifyChangePassportPilotManifest(JSON.parse(fs.readFileSync(filePath, 'utf8')), options);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const requireFrozen = process.argv.includes('--require-frozen');
  const printHash = process.argv.includes('--print-manifest-hash');
  const fileArg = process.argv.slice(2).find((value) => !value.startsWith('--'));
  const result = verifyChangePassportPilotFile(
    fileArg ? path.resolve(process.cwd(), fileArg) : DEFAULT_CHANGE_PASSPORT_PILOT_PATH,
    { requireFrozen }
  );
  if (printHash) console.log(result.manifestHash);
  else if (!result.valid) {
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  } else console.log(JSON.stringify(result, null, 2));
}
