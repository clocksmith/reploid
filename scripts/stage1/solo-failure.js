/** Maps a whole-model load failure to what it shows about memory. Pure. Anything unproven stays inconclusive. */
import { MINIMUM_LOAD_PROGRESS_BYTES } from './receipt-check.js';

const DEVICE_MEMORY = /VK_ERROR_OUT_OF_DEVICE_MEMORY|GPUOutOfMemoryError/;
const HOST_MEMORY = /VK_ERROR_OUT_OF_HOST_MEMORY/;

/** The error, its causes and its aggregated errors, without revisiting a cycle. */
function chain(error, seen = new Set()) {
  if (!error || typeof error !== 'object' || seen.has(error)) return [];
  seen.add(error);
  return [error, ...chain(error.cause, seen), ...(Array.isArray(error.errors) ? error.errors.flatMap(row => chain(row, seen)) : [])];
}
const textOf = row => `${row.name ?? ''} ${row.constructor?.name ?? ''} ${row.message ?? ''} ${row.detail ?? ''}`;

/** A size only when the device message states one for the refused allocation. */
export function failedBufferBytesFrom(text) {
  const match = /(?:size(?:\s*(?:of|=|:))?\s*|allocat\w*\s+)(\d{1,16})(?:\s*bytes)?/i.exec(text) ?? /\b(\d{1,16})\s*bytes\b/i.exec(text);
  const bytes = match ? Number(match[1]) : null;
  return Number.isSafeInteger(bytes) ? bytes : null;
}

/**
 * `stop` is why the harness ended the load, if it did: `guard`, `timeout` or `memory-pressure`. `requiredBytes` is the
 * whole-model GPU footprint the load asked for, not the buffer that failed. `budgetBytes` is any allocation cap in force.
 */
export function classifySoloFailure(error, { stop = null, requiredBytes, budgetBytes = null }) {
  if (stop === 'timeout') return { kind: 'stopped', timedOut: true };
  if (stop === 'guard') return { kind: 'stopped', guardTripped: true };
  if (stop === 'memory-pressure') return { kind: 'memory-pressure', guardTripped: true };
  const rows = chain(error), text = rows.map(textOf).join('\n');
  if (rows.some(row => row.code === 'MISSING_WEIGHTS' || row.code === 'ENOENT')) return { kind: 'missing-weights' };
  if (rows.some(row => row.code === 'WRONG_WEIGHTS')) return { kind: 'wrong-weights' };
  if (rows.some(row => row.code === 'RESOURCE_EXHAUSTED') || /GPU memory budget exceeded/.test(text)) {
    return { kind: 'out-of-memory', evidence: 'operator-budget', operatorCapped: true, requiredBytes };
  }
  if (HOST_MEMORY.test(text)) return { kind: 'host-out-of-memory' };
  if (!rows.some(row => row.code === 'GPU_OUT_OF_MEMORY') && !DEVICE_MEMORY.test(text)) return { kind: 'load-failed' };
  const during = rows.find(row => row.stage1During)?.stage1During ?? null;
  const peak = rows.find(row => Number.isSafeInteger(row.stage1Memory?.peakBytes))?.stage1Memory.peakBytes ?? null;
  const failedBufferBytes = failedBufferBytesFrom(rows.map(row => `${row.detail ?? ''} ${row.message ?? ''}`).join(' '));
  // Dawn accounts for a refused buffer before reporting it, so the peak can include the failed allocation.
  const allocatedBeforeFailureBytes = peak === null ? null : Math.max(0, peak - (failedBufferBytes ?? 0));
  return { kind: 'out-of-memory', evidence: 'device-out-of-memory',
    operatorCapped: Number.isSafeInteger(budgetBytes) && budgetBytes < requiredBytes,
    requiredBytes, during, allocatedBeforeFailureBytes, failedBufferBytes };
}

/** Claim a memory failure only when the record would satisfy the receipt checker. */
export function claimsMemory(failure) {
  return failure.kind === 'out-of-memory' && failure.evidence === 'device-out-of-memory' && failure.operatorCapped === false
    && failure.during === 'whole-model-load' && Number.isSafeInteger(failure.allocatedBeforeFailureBytes)
    && failure.allocatedBeforeFailureBytes + (failure.failedBufferBytes ?? 0) >= MINIMUM_LOAD_PROGRESS_BYTES;
}
