/**
 * @fileoverview The pool-home views' single markup sink and the value formatting they share:
 * compact hash and ledger values, and cycle-safe JSON for raw records.
 */

// Single sink for the route views' markup writes: every caller builds attribute
// and text values through escapeHtml before reaching this assignment.
export const setPoolHtml = (element, markup) => {
  element.innerHTML = String(markup ?? '');
};

export const formatLedgerValue = (value, fallback = '—') => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number' && !Number.isFinite(value)) return fallback;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
};

export const compactHex = (value) => {
  const normalized = formatLedgerValue(value, '—');
  return normalized === '—' ? '—' : compactHash(normalized);
};

export const firstPresent = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');

export const compactHash = (value) => {
  const normalized = String(value ?? '');
  if (normalized.length <= 24) return normalized;
  return `${normalized.slice(0, 16)}...${normalized.slice(-8)}`;
};

const summarizedSequenceOutput = (sequenceOutput = {}) => {
  const pooledEmbedding = Array.isArray(sequenceOutput.pooledEmbedding)
    ? sequenceOutput.pooledEmbedding
    : null;
  return {
    omitted: 'Rendered in Protein embedding',
    pooledEmbeddingDimensions: pooledEmbedding?.length || 0,
    tokenEmbeddings: sequenceOutput.tokenEmbeddings == null ? null : '[omitted from raw result]',
    maskedLogits: Array.isArray(sequenceOutput.maskedLogits) && sequenceOutput.maskedLogits.length > 0
      ? '[omitted from raw result]'
      : []
  };
};

export const safeJsonStringify = (value, { redactSequenceOutput = false } = {}) => {
  const ancestors = [];
  try {
    return JSON.stringify(value, function replaceJsonEntry(_key, entry) {
      if (redactSequenceOutput && _key === 'sequenceOutput' && entry && typeof entry === 'object') {
        return summarizedSequenceOutput(entry);
      }
      if (typeof entry === 'function') return `[Function ${entry.name || 'anonymous'}]`;
      if (entry instanceof Error) {
        return {
          name: entry.name,
          message: entry.message,
          code: entry.code || null,
          payload: entry.payload || null
        };
      }
      if (entry && typeof entry === 'object') {
        while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) {
          ancestors.pop();
        }
        if (ancestors.includes(entry)) return '[Circular]';
        ancestors.push(entry);
      }
      return entry;
    }, 2);
  } catch (error) {
    return JSON.stringify({
      status: 'serialization_error',
      reason: error.message
    }, null, 2);
  }
};
