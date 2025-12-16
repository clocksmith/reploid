/**
 * Submit Tracker - Measures GPU submit overhead for optimization benchmarking.
 *
 * Usage:
 *   // Before forward pass:
 *   resetSubmitStats();
 *
 *   // Run forward pass...
 *
 *   // After forward pass:
 *   const stats = getSubmitStats();
 *   console.log(`Submits: ${stats.count}, Total time: ${stats.totalMs.toFixed(2)}ms`);
 *
 * To enable tracking, set TRACK_SUBMITS = true and wrap queue.submit calls.
 *
 * @module gpu/submit-tracker
 */

/** Whether to track submits (disable in production for perf) */
export let TRACK_SUBMITS = false;

/** Submit statistics */
export interface SubmitStats {
  /** Number of queue.submit() calls */
  count: number;
  /** Total time spent in submit calls (ms) */
  totalMs: number;
  /** Average time per submit (ms) */
  avgMs: number;
  /** Max time for a single submit (ms) */
  maxMs: number;
  /** Min time for a single submit (ms) */
  minMs: number;
  /** Submit timestamps for detailed analysis */
  timestamps: number[];
}

/** Internal tracking state */
let submitCount = 0;
let submitTimes: number[] = [];
let totalSubmitMs = 0;
let maxSubmitMs = 0;
let minSubmitMs = Infinity;

/**
 * Enable/disable submit tracking.
 * @param enabled - Whether to track submits
 */
export function setTrackSubmits(enabled: boolean): void {
  TRACK_SUBMITS = enabled;
  if (enabled) {
    resetSubmitStats();
    console.log('[SubmitTracker] Enabled');
  } else {
    console.log('[SubmitTracker] Disabled');
  }
}

/**
 * Reset submit statistics.
 * Call before starting a new measurement.
 */
export function resetSubmitStats(): void {
  submitCount = 0;
  submitTimes = [];
  totalSubmitMs = 0;
  maxSubmitMs = 0;
  minSubmitMs = Infinity;
}

/**
 * Record a submit call.
 * Call this from a wrapper around queue.submit().
 * @param durationMs - Time spent in this submit call
 */
export function recordSubmit(durationMs: number): void {
  if (!TRACK_SUBMITS) return;

  submitCount++;
  submitTimes.push(durationMs);
  totalSubmitMs += durationMs;
  maxSubmitMs = Math.max(maxSubmitMs, durationMs);
  minSubmitMs = Math.min(minSubmitMs, durationMs);
}

/**
 * Get current submit statistics.
 * @returns Submit statistics
 */
export function getSubmitStats(): SubmitStats {
  return {
    count: submitCount,
    totalMs: totalSubmitMs,
    avgMs: submitCount > 0 ? totalSubmitMs / submitCount : 0,
    maxMs: maxSubmitMs,
    minMs: minSubmitMs === Infinity ? 0 : minSubmitMs,
    timestamps: [...submitTimes],
  };
}

/**
 * Log submit statistics summary.
 * @param label - Label for the log output
 */
export function logSubmitStats(label: string = 'Forward pass'): void {
  const stats = getSubmitStats();
  console.log(
    `[SubmitTracker] ${label}: ${stats.count} submits, ` +
    `total=${stats.totalMs.toFixed(2)}ms, ` +
    `avg=${stats.avgMs.toFixed(3)}ms, ` +
    `range=[${stats.minMs.toFixed(3)}-${stats.maxMs.toFixed(3)}ms]`
  );
}

/**
 * Wrap a GPU queue to track submit calls.
 * @param queue - GPU queue to wrap
 * @returns Wrapped queue with tracking
 */
export function wrapQueueForTracking(queue: GPUQueue): GPUQueue {
  const originalSubmit = queue.submit.bind(queue);

  (queue as any).submit = function(commandBuffers: Iterable<GPUCommandBuffer>): undefined {
    if (!TRACK_SUBMITS) {
      return originalSubmit(commandBuffers);
    }

    const start = performance.now();
    const result = originalSubmit(commandBuffers);
    const duration = performance.now() - start;

    recordSubmit(duration);
    return result;
  };

  return queue;
}

/**
 * Estimate submit overhead savings from batching.
 * @param currentStats - Current submit stats (unbatched)
 * @param targetSubmits - Target number of submits after batching
 * @returns Estimated time savings in ms
 */
export function estimateBatchingSavings(
  currentStats: SubmitStats,
  targetSubmits: number = 1
): { savedSubmits: number; estimatedSavingsMs: number } {
  const savedSubmits = Math.max(0, currentStats.count - targetSubmits);
  // Each submit has overhead, estimate savings based on average submit time
  const estimatedSavingsMs = savedSubmits * currentStats.avgMs;

  return {
    savedSubmits,
    estimatedSavingsMs,
  };
}
