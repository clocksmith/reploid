/**
 * @fileoverview Exact-contract evidence for the separately governed DNA lane.
 */

export const DNA_LANE_ADMISSION_SCHEMA = 'poolday.dna_lane_admission/v1';

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const isSha256 = (value) => SHA256_PATTERN.test(String(value || ''));
const nonEmptyText = (value) => typeof value === 'string' && value.trim().length > 0;

export function validateDnaLaneAdmissionRecord(record = {}, {
  gate,
  exactModelContractKey = ''
} = {}) {
  const reasons = [];
  if (record.schema !== DNA_LANE_ADMISSION_SCHEMA) reasons.push('DNA admission schema is invalid');
  if (record.gate !== gate) reasons.push('DNA admission gate does not match the required gate');
  if (!nonEmptyText(exactModelContractKey) || record.exactModelContractKey !== exactModelContractKey) {
    reasons.push('DNA admission exact model contract does not match');
  }
  if (record.decision !== 'qualified') reasons.push('DNA admission decision is not qualified');
  if (!nonEmptyText(record.evaluatorIdentity) || !isSha256(record.policyHash)
    || !isSha256(record.evidenceHash) || !isSha256(record.recordHash)) {
    reasons.push('DNA admission evidence identity is invalid');
  }
  return { ok: reasons.length === 0, reasons };
}

export default { DNA_LANE_ADMISSION_SCHEMA, validateDnaLaneAdmissionRecord };
