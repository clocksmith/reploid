/**
 * @fileoverview Stable cursor helpers for ordered Poolday relay pages.
 */

const toTimestamp = (value) => {
  const timestamp = Number(value || 0);
  return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : 0;
};

const toSequence = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const sequence = Number(value);
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : null;
};

export function normalizeRelayCursor({ after = 0, afterId = '', afterSequence = null } = {}) {
  return Object.freeze({
    sequence: toSequence(afterSequence),
    createdAt: toTimestamp(after),
    messageId: String(afterId || '')
  });
}

export function cursorForRelayRecord(record = {}, idField = 'id') {
  return Object.freeze({
    sequence: toSequence(record.relaySequence),
    createdAt: toTimestamp(record.createdAt),
    messageId: String(record[idField] || record.id || record.relayId || '')
  });
}

export function compareRelayCursors(left = {}, right = {}) {
  const leftSequence = Number(left.sequence);
  const rightSequence = Number(right.sequence);
  if (Number.isSafeInteger(leftSequence) && leftSequence >= 0
    && Number.isSafeInteger(rightSequence) && rightSequence >= 0) {
    return leftSequence - rightSequence;
  }
  const timestampDifference = toTimestamp(left.createdAt) - toTimestamp(right.createdAt);
  if (timestampDifference !== 0) return timestampDifference;
  return String(left.messageId || '').localeCompare(String(right.messageId || ''));
}

export function isAfterRelayCursor(record, cursor, idField = 'id') {
  const recordCursor = cursorForRelayRecord(record, idField);
  if (Number.isSafeInteger(cursor?.sequence) && cursor.sequence >= 0) {
    return Number.isSafeInteger(recordCursor.sequence) && recordCursor.sequence > cursor.sequence;
  }
  return compareRelayCursors(recordCursor, cursor) > 0;
}

export function attachRelayPage(messages, nextCursor = null) {
  Object.defineProperty(messages, 'nextCursor', {
    value: nextCursor,
    enumerable: false,
    configurable: true
  });
  return messages;
}

export default {
  normalizeRelayCursor,
  cursorForRelayRecord,
  compareRelayCursors,
  isAfterRelayCursor,
  attachRelayPage
};
