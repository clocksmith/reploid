#!/usr/bin/env node
/**
 * Verifies that public surface claims have evidence and explicit blockers.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePoolCriticalUserJourneys } from './verify-pool-critical-user-journeys.js';
import { validateZeroCriticalUserJourneys } from './verify-zero-critical-user-journeys.js';
import { validateXCriticalUserJourneys } from './verify-x-critical-user-journeys.js';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const PROJECT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
export const SURFACE_CLAIM_INDEX_PATH = path.join(
  PROJECT_ROOT,
  'docs',
  'status',
  'surface-claim-index.json'
);

const ALLOWED_STATUSES = new Set(['supported', 'blocked']);
const REQUIRED_JOURNEY_REGISTRIES = Object.freeze({
  '/': 'docs/status/poolday-critical-user-journeys.json',
  '/zero': 'docs/status/zero-critical-user-journeys.json',
  '/x': 'docs/status/x-critical-user-journeys.json'
});
const JOURNEY_VALIDATORS = Object.freeze({
  '/': validatePoolCriticalUserJourneys,
  '/zero': validateZeroCriticalUserJourneys,
  '/x': validateXCriticalUserJourneys
});

const isStringArray = (value) => Array.isArray(value)
  && value.every((item) => typeof item === 'string' && item.trim().length > 0);

const checkEvidencePath = async (evidencePath, label, root, errors) => {
  const resolved = path.resolve(root, evidencePath);
  const insideRoot = resolved.startsWith(`${path.resolve(root)}${path.sep}`);
  if (path.isAbsolute(evidencePath) || !insideRoot) {
    errors.push(`${label} escapes the repository: ${evidencePath}`);
    return;
  }
  try {
    await fs.access(resolved);
  } catch {
    errors.push(`${label} is missing: ${evidencePath}`);
  }
};

export async function validateSurfaceClaimIndex(index, { root = PROJECT_ROOT } = {}) {
  const errors = [];
  if (index?.schema !== 'reploid/surface-claim-index/v2') {
    errors.push('schema must be reploid/surface-claim-index/v2');
  }
  if (!index?.journeyRegistries || typeof index.journeyRegistries !== 'object') {
    errors.push('journeyRegistries must map every product route to its registry');
  } else {
    for (const [surface, registryPath] of Object.entries(REQUIRED_JOURNEY_REGISTRIES)) {
      if (index.journeyRegistries[surface] !== registryPath) {
        errors.push(`journeyRegistries.${surface} must be ${registryPath}`);
        continue;
      }
      await checkEvidencePath(registryPath, `journeyRegistries.${surface}`, root, errors);
      try {
        const registry = JSON.parse(await fs.readFile(path.resolve(root, registryPath), 'utf8'));
        const journeyErrors = await JOURNEY_VALIDATORS[surface](registry, { root });
        errors.push(...journeyErrors.map((error) => `journeyRegistries.${surface}: ${error}`));
      } catch (error) {
        errors.push(`journeyRegistries.${surface} could not be validated: ${error.message}`);
      }
    }
  }
  if (!Array.isArray(index?.entries) || index.entries.length === 0) {
    errors.push('entries must be a non-empty array');
    return errors;
  }

  const seen = new Set();
  for (const [position, entry] of index.entries.entries()) {
    const label = `entries[${position}]`;
    if (typeof entry?.surface !== 'string' || !entry.surface.trim()) {
      errors.push(`${label}.surface must be a non-empty string`);
    } else if (seen.has(entry.surface)) {
      errors.push(`${label}.surface duplicates ${entry.surface}`);
    } else {
      seen.add(entry.surface);
    }

    if (!ALLOWED_STATUSES.has(entry?.status)) {
      errors.push(`${label}.status must be supported or blocked`);
    }
    if (!isStringArray(entry?.evidencePaths)) {
      errors.push(`${label}.evidencePaths must be a non-empty string array`);
    }
    if (!Array.isArray(entry?.blockers) || entry.blockers.some((item) => typeof item !== 'string' || !item.trim())) {
      errors.push(`${label}.blockers must be a string array`);
    }
    if (typeof entry?.claimPermission !== 'boolean') {
      errors.push(`${label}.claimPermission must be boolean`);
    }
    if (entry?.status === 'blocked' && entry?.claimPermission !== false) {
      errors.push(`${label} is blocked and cannot grant claimPermission`);
    }
    if (entry?.status === 'blocked' && entry?.blockers?.length === 0) {
      errors.push(`${label} is blocked and must name a blocker`);
    }
    if (entry?.status === 'supported' && entry?.blockers?.length > 0) {
      errors.push(`${label} is supported and cannot retain blockers`);
    }

    for (const evidencePath of entry?.evidencePaths || []) {
      await checkEvidencePath(evidencePath, `${label}.evidencePaths`, root, errors);
    }

    const journeyRegistry = REQUIRED_JOURNEY_REGISTRIES[entry?.surface];
    if (journeyRegistry && !entry?.evidencePaths?.includes(journeyRegistry)) {
      errors.push(`${label}.evidencePaths must include ${journeyRegistry}`);
    }
  }

  return errors;
}

export async function verifySurfaceClaimIndex(indexPath = SURFACE_CLAIM_INDEX_PATH) {
  const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  const errors = await validateSurfaceClaimIndex(index);
  return { index, errors };
}

async function main() {
  const { index, errors } = await verifySurfaceClaimIndex();
  if (errors.length > 0) {
    console.error('[verify-surface-claims] Errors:');
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`[verify-surface-claims] ${index.entries.length} claim rows passed`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((error) => {
    console.error('[verify-surface-claims] Failed to verify index');
    console.error(error);
    process.exit(1);
  });
}
