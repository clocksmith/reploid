/** Cross-record link validation: targets exist in the room, remain active, and satisfy each kind's link rules. */
import {
  RESEARCH_RECORD_KINDS,
  decisionContextSnapshot
} from '../evidence-record-contract.js';
import {
  sameJson
} from './primitives.js';
import {
  crossRoomSourceIdentityKey
} from './cross-room-normalization.js';
import {
  invalidatedResearchHashes,
  researchRecordTargetHashes,
  revokedResearchHashes
} from './review-state.js';
import {
  questionLinkValidators
} from './question-links.js';
import {
  experimentLinkValidators
} from './experiment-links.js';
import {
  governanceLinkValidators
} from './governance-links.js';

// Record kinds arrive from untrusted records; only declared kinds resolve to link rules.
const LINK_VALIDATORS = new Map([
  ...questionLinkValidators,
  ...experimentLinkValidators,
  ...governanceLinkValidators
]);

export function validateCrossRoomReuseOrigin(record = {}, originRecord = null, originQuestion = null) {
  const reasons = [];
  const reuseContext = record.kind === RESEARCH_RECORD_KINDS.priorEvidence
    ? record.evidence?.reuseContext
    : null;
  if (!reuseContext) return { ok: true, reasons };
  if (originRecord?.kind !== RESEARCH_RECORD_KINDS.priorEvidence
    || originRecord.recordHash !== reuseContext.originRecordHash) {
    reasons.push('cross-room origin record is missing or has the wrong kind');
  } else {
    if (originRecord.roomId !== reuseContext.origin.roomId
      || originRecord.questionHash !== reuseContext.origin.questionHash) {
      reasons.push('cross-room origin record does not match its declared room and question');
    }
    if (crossRoomSourceIdentityKey(originRecord) !== crossRoomSourceIdentityKey(reuseContext.originSource)) {
      reasons.push('cross-room declared source identity does not match the origin record');
    }
  }
  if (originQuestion?.kind !== RESEARCH_RECORD_KINDS.submission
    || originQuestion.recordHash !== reuseContext.origin.questionHash) {
    reasons.push('cross-room origin question is missing or has the wrong kind');
  } else {
    const expected = decisionContextSnapshot(originQuestion);
    if (expected.roomId !== reuseContext.origin.roomId
      || expected.sequenceHash !== reuseContext.origin.sequenceHash
      || !sameJson(expected.consent, reuseContext.origin.consent)
      || !sameJson(expected.intent, reuseContext.origin.intent)) {
      reasons.push('cross-room origin context does not match the signed origin question');
    }
  }
  return { ok: reasons.length === 0, reasons };
}

export function validateResearchRecordLinks(record = {}, records = []) {
  const reasons = [];
  const recordsByHash = new Map(records.map((entry) => [entry.recordHash, entry]));
  const targets = researchRecordTargetHashes(record);
  const revoked = revokedResearchHashes(records);
  const invalidated = invalidatedResearchHashes(records);
  for (const targetHash of targets) {
    const target = recordsByHash.get(targetHash);
    if (!target) reasons.push(`linked research record does not exist: ${targetHash}`);
    else if (target.roomId !== record.roomId) reasons.push(`linked research record belongs to a different room: ${targetHash}`);
    else if (record.kind !== RESEARCH_RECORD_KINDS.revocation && invalidated.has(targetHash)) reasons.push(`linked research record is revoked or invalidated: ${targetHash}`);
  }
  const target = (hash) => recordsByHash.get(hash);
  LINK_VALIDATORS.get(record.kind)?.(record, reasons, { records, recordsByHash, target, revoked, invalidated });
  return { ok: reasons.length === 0, reasons, targetHashes: targets };
}
