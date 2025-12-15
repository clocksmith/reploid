/**
 * Pipeline statistics tracking and reporting.
 */

export interface PipelineStats {
  tokensGenerated: number;
  totalTimeMs: number;
  prefillTimeMs: number;
  decodeTimeMs: number;
}

export interface BatchingStats {
  batchedForwardCalls: number;
  unbatchedForwardCalls: number;
  totalBatchedTimeMs: number;
  totalUnbatchedTimeMs: number;
}

export interface PerformanceMetrics {
  totalTimeMs: number;
  prefillTimeMs: number;
  decodeTimeMs: number;
  tokensPerSecond: number;
  prefillTokensPerSecond: number;
  timeToFirstToken: number;
}

/**
 * Statistics tracker for pipeline performance.
 */
export class StatsTracker {
  private stats: PipelineStats = {
    tokensGenerated: 0,
    totalTimeMs: 0,
    prefillTimeMs: 0,
    decodeTimeMs: 0,
  };

  private batchingStats: BatchingStats = {
    batchedForwardCalls: 0,
    unbatchedForwardCalls: 0,
    totalBatchedTimeMs: 0,
    totalUnbatchedTimeMs: 0,
  };

  /**
   * Get current statistics.
   */
  getStats(): PipelineStats {
    return { ...this.stats };
  }

  /**
   * Get batching statistics.
   */
  getBatchingStats(): BatchingStats {
    return { ...this.batchingStats };
  }

  /**
   * Record prefill time.
   */
  recordPrefillTime(timeMs: number): void {
    this.stats.prefillTimeMs += timeMs;
  }

  /**
   * Record decode time.
   */
  recordDecodeTime(timeMs: number): void {
    this.stats.decodeTimeMs += timeMs;
  }

  /**
   * Record total time.
   */
  recordTotalTime(timeMs: number): void {
    this.stats.totalTimeMs += timeMs;
  }

  /**
   * Record tokens generated.
   */
  recordTokensGenerated(count: number): void {
    this.stats.tokensGenerated += count;
  }

  /**
   * Record batched forward call.
   */
  recordBatchedForward(timeMs: number): void {
    this.batchingStats.batchedForwardCalls++;
    this.batchingStats.totalBatchedTimeMs += timeMs;
  }

  /**
   * Record unbatched forward call.
   */
  recordUnbatchedForward(timeMs: number): void {
    this.batchingStats.unbatchedForwardCalls++;
    this.batchingStats.totalUnbatchedTimeMs += timeMs;
  }

  /**
   * Reset all statistics.
   */
  reset(): void {
    this.stats = {
      tokensGenerated: 0,
      totalTimeMs: 0,
      prefillTimeMs: 0,
      decodeTimeMs: 0,
    };
  }

  /**
   * Reset batching statistics.
   */
  resetBatchingStats(): void {
    this.batchingStats = {
      batchedForwardCalls: 0,
      unbatchedForwardCalls: 0,
      totalBatchedTimeMs: 0,
      totalUnbatchedTimeMs: 0,
    };
  }

  /**
   * Print batching report.
   */
  printBatchingReport(): void {
    const { batchedForwardCalls, unbatchedForwardCalls, totalBatchedTimeMs, totalUnbatchedTimeMs } =
      this.batchingStats;

    console.log('\n=== Batching Performance Report ===');
    console.log(`Batched calls:   ${batchedForwardCalls} (${totalBatchedTimeMs.toFixed(1)}ms total)`);
    console.log(`Unbatched calls: ${unbatchedForwardCalls} (${totalUnbatchedTimeMs.toFixed(1)}ms total)`);

    if (batchedForwardCalls > 0) {
      const avgBatched = totalBatchedTimeMs / batchedForwardCalls;
      console.log(`Avg batched:     ${avgBatched.toFixed(2)}ms per call`);
    }

    if (unbatchedForwardCalls > 0) {
      const avgUnbatched = totalUnbatchedTimeMs / unbatchedForwardCalls;
      console.log(`Avg unbatched:   ${avgUnbatched.toFixed(2)}ms per call`);
    }

    if (batchedForwardCalls > 0 && unbatchedForwardCalls > 0) {
      const avgBatched = totalBatchedTimeMs / batchedForwardCalls;
      const avgUnbatched = totalUnbatchedTimeMs / unbatchedForwardCalls;
      const speedup = avgUnbatched / avgBatched;
      console.log(`Speedup:         ${speedup.toFixed(2)}x (batched vs unbatched)`);
    }

    console.log('===================================\n');
  }

  /**
   * Calculate performance metrics.
   */
  getPerformanceMetrics(): PerformanceMetrics {
    const { tokensGenerated, totalTimeMs, prefillTimeMs, decodeTimeMs } = this.stats;

    return {
      totalTimeMs,
      prefillTimeMs,
      decodeTimeMs,
      tokensPerSecond: totalTimeMs > 0 ? (tokensGenerated / totalTimeMs) * 1000 : 0,
      prefillTokensPerSecond: prefillTimeMs > 0 ? (1 / prefillTimeMs) * 1000 : 0,
      timeToFirstToken: prefillTimeMs,
    };
  }
}
