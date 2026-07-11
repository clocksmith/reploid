#!/usr/bin/env node
/**
 * Verifies that public surface claims have evidence and explicit blockers.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const PROJECT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
export const SURFACE_CLAIM_INDEX_PATH = path.join(
  PROJECT_ROOT,
  'docs',
  'status',
  'surface-claim-index.json'
);

const ALLOWED_STATUSES = new Set(['supported', 'blocked']);

const isStringArray = (value) => Array.isArray(value)
  && value.every((item) => typeof item === 'string' && item.trim().length > 0);

export async function validateSurfaceClaimIndex(index, { root = PROJECT_ROOT } = {}) {
  const errors = [];
  if (index?.schema !== 'reploid/surface-claim-index/v1') {
    errors.push('schema must be reploid/surface-claim-index/v1');
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
      const resolved = path.resolve(root, evidencePath);
      const insideRoot = resolved.startsWith(`${path.resolve(root)}${path.sep}`);
      if (path.isAbsolute(evidencePath) || !insideRoot) {
        errors.push(`${label}.evidencePaths escapes the repository: ${evidencePath}`);
        continue;
      }
      try {
        await fs.access(resolved);
      } catch {
        errors.push(`${label}.evidencePaths is missing: ${evidencePath}`);
      }
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
