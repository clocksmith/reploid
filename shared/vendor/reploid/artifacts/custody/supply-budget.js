/** Shared record validation; hosts provide the atomic durable transaction. */
export function custodyBudgetError(code, message, cause) {
  return Object.assign(new Error(message, { cause }), { code: 'CUSTODY_BUDGET_' + code });
}
function validRecord(record, bytes, maxBytes, purpose) {
  if (!['supply', 'acquisition'].includes(purpose)) throw custodyBudgetError('INVALID', 'Unknown transfer allowance purpose');
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || !Number.isSafeInteger(bytes) || bytes < 0) {
    throw custodyBudgetError('INVALID', 'Invalid file contribution allowance');
  }
  if (!record) throw custodyBudgetError('MISSING', 'File contribution ledger missing; previous allowance cannot be inferred');
  if (record.schema !== `reploid.custody-${purpose}-budget/v1` || !Number.isSafeInteger(record.maxBytes)
    || record.maxBytes <= 0 || !Number.isSafeInteger(record.reservedBytes)
    || record.reservedBytes < 0 || record.reservedBytes > record.maxBytes) {
    throw custodyBudgetError('CORRUPT', 'File contribution ledger is corrupt');
  }
  if (record.maxBytes !== maxBytes) throw custodyBudgetError('POLICY', 'File contribution allowance changed; renewal is not authorized');
}
export function reserveCustodyBudget(record, bytes, maxBytes, purpose = 'supply') {
  validRecord(record, bytes, maxBytes, purpose);
  if (bytes > maxBytes - record.reservedBytes) throw custodyBudgetError('LIMIT', 'File contribution allowance exhausted');
  return { ...record, reservedBytes: record.reservedBytes + bytes };
}
/** Returns reserved bytes that never arrived (a transfer that failed part-way); bytes received stay counted. */
export function releaseCustodyBudget(record, bytes, maxBytes, purpose = 'acquisition') {
  validRecord(record, bytes, maxBytes, purpose);
  if (bytes > record.reservedBytes) throw custodyBudgetError('INVALID', 'Cannot return more than was reserved');
  return { ...record, reservedBytes: record.reservedBytes - bytes };
}
