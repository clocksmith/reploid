/** Cryptographic and structural record verification; verification is not review. */
import {
  DOMAIN_BY_KIND,
  LEGACY_RESEARCH_RECORD_VERSION,
  RESEARCH_RECORD_KINDS,
  RESEARCH_RECORD_VERSION
} from '../evidence-record-contract.js';
import {
  authorPolicyFor,
  isSha256,
  withoutIdentity,
  withoutSignature
} from './primitives.js';
import {
  computeRecordVerifiers
} from './compute-verification.js';
import {
  claimRecordVerifiers
} from './claim-verification.js';
import {
  experimentRecordVerifiers
} from './experiment-verification.js';
import {
  governanceRecordVerifiers
} from './governance-verification.js';
import {
  hashJson,
  verifyCanonicalSignature
} from '../../../../shared/pool/inference-receipt.js';

// Record kinds arrive from untrusted records; only declared kinds resolve to field verifiers.
const FIELD_VERIFIERS = new Map([
  ...computeRecordVerifiers,
  ...claimRecordVerifiers,
  ...experimentRecordVerifiers,
  ...governanceRecordVerifiers
]);

export async function verifyResearchRecord(record = {}) {
  const reasons = [];
  const legacyRecord = record.version === LEGACY_RESEARCH_RECORD_VERSION;
  const domain = DOMAIN_BY_KIND[record.kind];
  if (![RESEARCH_RECORD_VERSION, LEGACY_RESEARCH_RECORD_VERSION].includes(record.version)) {
    reasons.push('research record version mismatch');
  }
  if (legacyRecord && [
    RESEARCH_RECORD_KINDS.adjudicationExperiment,
    RESEARCH_RECORD_KINDS.adjudicationEvaluation,
    RESEARCH_RECORD_KINDS.discoveryCheckpoint,
    RESEARCH_RECORD_KINDS.resolutionPolicy,
    RESEARCH_RECORD_KINDS.realizedActionValue
  ].includes(record.kind)) reasons.push('governed proof records require research evidence v2');
  if (!domain) reasons.push('research record kind is not supported');
  if (domain && record.signatureDomain !== domain) reasons.push('research signature domain mismatch');
  if (!record.author?.roleId || !record.author?.publicKey) reasons.push('attributable author is required');
  if (!isSha256(record.recordHash)) reasons.push('recordHash must be a SHA-256 identity');
  if (record.recordHash && await hashJson(withoutIdentity(record)) !== record.recordHash) reasons.push('record hash mismatch');
  if (!record.signature) reasons.push('record signature is required');
  if (domain && record.signature && record.author?.publicKey) {
    try {
      const ok = await verifyCanonicalSignature(
        withoutSignature(record),
        record.author.publicKey,
        record.signature,
        { domain }
      );
      if (!ok) reasons.push('record signature invalid');
    } catch (error) {
      reasons.push(`record signature verification failed: ${error.message}`);
    }
  }
  if (!record.roomId) reasons.push('roomId is required');
  if (!record.createdAt || !Number.isFinite(Date.parse(record.createdAt))) reasons.push('createdAt must be an ISO timestamp');
  const authorPolicy = authorPolicyFor(record.kind);
  if (authorPolicy && !authorPolicy.roles.includes(record.author?.role)) {
    reasons.push(`${authorPolicy.label} author role is invalid`);
  }
  await FIELD_VERIFIERS.get(record.kind)?.(record, reasons, { legacyRecord });
  return { ok: reasons.length === 0, reasons, recordHash: record.recordHash || null };
}
