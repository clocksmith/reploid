/**
 * @fileoverview Shared promotion and validator quarantine policy.
 */

import { isWithinRoot, normalizeVfsPath } from '../config/vfs-policy.js';
import {
  CLOCKWORK_CONTRACT_SET_DIGEST,
  TRUSTED_GAMMA_RECEIPTS
} from '../config/clockwork-gamma-receipts.js';

export { isWithinRoot } from '../config/vfs-policy.js';

export const TEXT_LIMIT_BYTES = 8 * 1024 * 1024;
const VFS_PREFIX = 'vfs:';

export const ALLOWED_TARGET_ROOTS = Object.freeze([
  '/self/capabilities',
  '/self/capsule',
  '/self/config',
  '/self/core',
  '/self/host',
  '/self/infrastructure',
  '/self/kernel',
  '/self/tools',
  '/self/prompts',
  '/self/blueprints',
  '/self/pool',
  '/self/styles',
  '/self/ui'
]);

export const ALLOWED_TARGET_PATHS = Object.freeze([
  '/self/blueprint-index.json',
  '/self/boot-spec.js',
  '/self/bridge.js',
  '/self/environment.js',
  '/self/identity.js',
  '/self/instance.js',
  '/self/manifest.js',
  '/self/receipt.js',
  '/self/reward-policy.js',
  '/self/runtime.js',
  '/self/self.json',
  '/self/swarm.js',
  '/self/tool-runner.js'
]);

export const ALLOWED_TARGET_EXTENSIONS = Object.freeze([
  '.js',
  '.json',
  '.md',
  '.css',
  '.html'
]);

export const VALIDATOR_QUARANTINE_TARGETS = Object.freeze([
  '/self/core/change-passport.js',
  '/self/core/change-passport-policy.js',
  '/self/core/change-passport-improvement-adapter.js',
  '/self/core/improvement-episode.js',
  '/self/core/promotion-policy.js',
  '/self/core/verification-manager.js',
  '/self/testing/arena/arena-harness.js',
  '/self/capabilities/communication/consensus.js',
  '/self/capabilities/reflection/reflection-store.js',
  '/self/capabilities/system/doppler-optimizer.js',
  '/self/infrastructure/audit-logger.js',
  '/self/infrastructure/genesis-snapshot.js',
  '/self/config/genesis-levels.json',
  '/self/config/clockwork-gamma-receipts.js',
  '/self/core/tool-runner.js',
  '/self/tools/Promote.js'
]);

export const VALIDATOR_QUARANTINE_PREFIXES = Object.freeze([
  '/self/testing/arena/',
  '/self/core/verification-',
  '/self/infrastructure/policy-'
]);

export function normalizePromotionPath(rawPath) {
  let path = String(rawPath || '').trim();
  if (!path) throw new Error('Missing path argument');
  if (path.startsWith(VFS_PREFIX)) {
    path = path.slice(VFS_PREFIX.length);
  }
  return normalizeVfsPath(path);
}

export function hasAllowedExtension(path) {
  return ALLOWED_TARGET_EXTENSIONS.some((extension) => path.endsWith(extension));
}

export function defaultAllowTargetPath(path) {
  return (
    (ALLOWED_TARGET_PATHS.includes(path) || ALLOWED_TARGET_ROOTS.some((root) => isWithinRoot(path, root)))
      && hasAllowedExtension(path)
  );
}

export function isValidatorMutationTarget(path) {
  return VALIDATOR_QUARANTINE_TARGETS.includes(path)
    || VALIDATOR_QUARANTINE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function textBytes(content) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(String(content)).length;
  }
  return String(content).length;
}

export async function sha256(content) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('SHA-256 not available in this environment');
  }
  const bytes = typeof TextEncoder !== 'undefined'
    ? new TextEncoder().encode(String(content))
    : Uint8Array.from(String(content), (char) => char.charCodeAt(0));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function parseEvidence(content, evidencePath) {
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`Evidence is not valid JSON: ${evidencePath}`);
  }
}

export async function readRequired(VFS, path, label) {
  const exists = await VFS.exists(path);
  if (!exists) {
    throw new Error(`${label} not found: ${path}`);
  }
  return VFS.read(path);
}

export function getEvidencePath(evidence, key) {
  const value = evidence?.[key] || evidence?.promotion?.[key];
  return typeof value === 'string' && value.trim() ? normalizePromotionPath(value) : '';
}

export function getEvidenceBoolean(evidence, key) {
  if (typeof evidence?.[key] === 'boolean') return evidence[key];
  if (typeof evidence?.promotion?.[key] === 'boolean') return evidence.promotion[key];
  return false;
}

export function getEvidenceHash(evidence, key) {
  const value = evidence?.[key] || evidence?.promotion?.[key];
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : '';
}

const CLOCKWORK_GATE_NAMES = Object.freeze([
  'roundtrip',
  'chronologicalReplay',
  'sourceAccounting',
  'transfer',
  'runtime',
  'memory'
]);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const canonicalJson = (value) => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Clockwork evidence contains a non-finite number');
    return Object.is(value, -0) ? '0' : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`;
  }
  throw new Error(`Clockwork evidence contains unsupported ${typeof value}`);
};

const receiptDigest = async (receipt) => {
  const unsigned = { ...receipt };
  delete unsigned.receiptDigest;
  return `sha256:${await sha256(canonicalJson(unsigned))}`;
};

const getClockworkClaim = (evidence) => (
  evidence?.authorityClaim
  || evidence?.promotion?.authorityClaim
  || (evidence?.clockwork ? 'clockwork' : null)
);

const getClockworkEvidence = (evidence) => evidence?.clockwork || evidence?.promotion?.clockwork || null;

export async function validateClockworkPromotionEvidence(
  evidence,
  { trustedReceipts = TRUSTED_GAMMA_RECEIPTS } = {}
) {
  const authorityClaim = getClockworkClaim(evidence);
  if (authorityClaim !== 'clockwork') {
    return { required: false, ok: true, reasons: [] };
  }
  const reasons = [];
  const clockwork = getClockworkEvidence(evidence);
  const gammaReceipt = clockwork?.gammaReceipt;
  if (!isObject(clockwork)) {
    return {
      required: true,
      ok: false,
      reasons: ['Clockwork promotion requires evidence.clockwork']
    };
  }
  if (!isObject(gammaReceipt)) {
    return {
      required: true,
      ok: false,
      reasons: ['Clockwork promotion requires a full Gamma candidate receipt']
    };
  }
  if (gammaReceipt.schema !== 'gamma.candidate_receipt.v1') {
    reasons.push('Clockwork promotion requires gamma.candidate_receipt.v1');
  }
  if (gammaReceipt.authority !== 'gamma') {
    reasons.push('Clockwork Gamma receipt authority must be gamma');
  }
  if (gammaReceipt.contractSetDigest !== CLOCKWORK_CONTRACT_SET_DIGEST) {
    reasons.push('Clockwork Gamma receipt contract-set digest mismatch');
  }
  if (gammaReceipt.challengeDigest !== clockwork.challengeDigest) {
    reasons.push('Clockwork Gamma receipt challenge digest mismatch');
  }
  if (gammaReceipt.candidateDigest !== clockwork.candidateDigest) {
    reasons.push('Clockwork Gamma receipt candidate digest mismatch');
  }
  if (gammaReceipt.result !== 'accepted' || gammaReceipt.firstFailedGate !== null) {
    reasons.push('Clockwork Gamma receipt is not accepted');
  }
  for (const gateName of CLOCKWORK_GATE_NAMES) {
    if (gammaReceipt.gates?.[gateName]?.status !== 'passed') {
      reasons.push(`Clockwork Gamma receipt gate ${gateName} did not pass`);
    }
  }
  let computedDigest = null;
  try {
    computedDigest = await receiptDigest(gammaReceipt);
  } catch (error) {
    reasons.push(error.message);
  }
  if (computedDigest && computedDigest !== gammaReceipt.receiptDigest) {
    reasons.push('Clockwork Gamma receipt self-digest mismatch');
  }
  const trusted = trustedReceipts.find((entry) => entry.receiptDigest === gammaReceipt.receiptDigest);
  if (!trusted) {
    reasons.push('Clockwork Gamma receipt is not in the trusted registry');
  } else {
    if (trusted.challengeDigest !== clockwork.challengeDigest) {
      reasons.push('Trusted Gamma receipt challenge digest mismatch');
    }
    if (trusted.candidateDigest !== clockwork.candidateDigest) {
      reasons.push('Trusted Gamma receipt candidate digest mismatch');
    }
    if (trusted.sourceRevision !== gammaReceipt.sourceRevision) {
      reasons.push('Trusted Gamma receipt source revision mismatch');
    }
  }
  if (clockwork.searchReceipt) {
    if (clockwork.searchReceipt.schema !== 'clockwork.search_receipt.v1'
      || clockwork.searchReceipt.authority !== 'advisory') {
      reasons.push('Clockwork search receipt must remain advisory');
    }
    if (clockwork.searchReceipt.receiptDigest !== gammaReceipt.searchReceiptDigest) {
      reasons.push('Clockwork search receipt does not match the Gamma receipt');
    }
  }
  return {
    required: true,
    ok: reasons.length === 0,
    receiptDigest: gammaReceipt.receiptDigest || null,
    reasons
  };
}
