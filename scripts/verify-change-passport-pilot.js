#!/usr/bin/env node
/**
 * @fileoverview Structural and external-freeze gate for the Change Passport pilot.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CHANGE_PASSPORT_PILOT_PATH = path.resolve(
  __dirname,
  '../docs/change-passport/pilot-manifest.json'
);

const text = (value) => String(value || '').trim();

export function verifyChangePassportPilotManifest(manifest, { requireFrozen = false } = {}) {
  const errors = [];
  if (manifest?.schema !== 'change.passport-pilot/v1') errors.push('schema must be change.passport-pilot/v1');
  if (!text(manifest?.pilotId)) errors.push('pilotId is required');
  if (!['awaiting_external_freeze', 'frozen', 'running', 'complete', 'rejected'].includes(manifest?.status)) {
    errors.push('status is invalid');
  }
  if (!Number.isInteger(manifest?.minimumReportableCases) || manifest.minimumReportableCases < 1) {
    errors.push('minimumReportableCases must be positive');
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
  if (!Array.isArray(manifest?.requiredScenarios) || !manifest.requiredScenarios.includes('verified_reopening')) {
    errors.push('a verified reopening scenario is required');
  }

  const frozenFields = [
    ['adopter', manifest?.adopter],
    ['operatorRole', manifest?.operatorRole],
    ['independentEvaluator', manifest?.independentEvaluator],
    ['approvingAuthority', manifest?.approvingAuthority],
    ['repository', manifest?.repository],
    ['changeClass', manifest?.changeClass],
    ['baselineWorkflow.evidenceCutoff', manifest?.baselineWorkflow?.evidenceCutoff],
    ['baselineWorkflow.resourceBudget', manifest?.baselineWorkflow?.resourceBudget]
  ];
  const unfrozenFields = frozenFields.filter(([, value]) => (
    value === null || value === undefined || value === ''
  )).map(([field]) => field);

  if (requireFrozen) {
    if (manifest?.status !== 'frozen') errors.push('status must be frozen');
    errors.push(...unfrozenFields.map((field) => `${field} is not frozen`));
  }
  return {
    valid: errors.length === 0,
    structurallyValid: errors.filter((error) => !error.includes('not frozen') && error !== 'status must be frozen').length === 0,
    frozen: manifest?.status === 'frozen' && unfrozenFields.length === 0,
    unfrozenFields,
    errors
  };
}

export function verifyChangePassportPilotFile(filePath = DEFAULT_CHANGE_PASSPORT_PILOT_PATH, options = {}) {
  const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return verifyChangePassportPilotManifest(manifest, options);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const requireFrozen = process.argv.includes('--require-frozen');
  const fileArg = process.argv.slice(2).find((value) => value !== '--require-frozen');
  const result = verifyChangePassportPilotFile(
    fileArg ? path.resolve(process.cwd(), fileArg) : DEFAULT_CHANGE_PASSPORT_PILOT_PATH,
    { requireFrozen }
  );
  if (!result.valid) {
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}
