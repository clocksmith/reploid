/**
 * @fileoverview Arena Metrics - Results collection and ranking
 * Tracks competition results and provides ranking/summary utilities.
 */

const ArenaMetrics = {
  metadata: {
    id: 'ArenaMetrics',
    version: '1.0.0',
    dependencies: ['Utils'],
    async: false,
    type: 'utility'
  },

  factory: (deps) => {
    const { Utils } = deps;

    /** Result status constants */
    const Status = {
      PASS: 'PASS',
      FAIL: 'FAIL',
      ERROR: 'ERROR'
    };

    /**
     * Create a competition result object
     * @param {string} competitorName - Name of the competitor
     * @param {string} status - PASS, FAIL, or ERROR
     * @param {Object} details - Additional result details
     * @returns {Object} Standardized result object
     */
    const createResult = (competitorName, status, details = {}) => ({
      competitorName,
      status,
      verificationPassed: status === Status.PASS,
      executionMs: details.executionMs || 0,
      tokenCount: details.tokenCount || 0,
      model: details.model || null,
      provider: details.provider || null,
      errors: details.errors || [],
      warnings: details.warnings || [],
      solution: details.solution || null,
      timestamp: Date.now()
    });

    /**
     * Rank results by status and performance
     * @param {Array<Object>} results - Array of result objects
     * @param {string} sortBy - Secondary sort: 'speed' | 'tokens' (default: 'speed')
     * @returns {Array<Object>} Sorted results (passing first)
     */
    const rankResults = (results, sortBy = 'speed') => {
      return [...results].sort((a, b) => {
        // Primary: Passing before failing/error
        if (a.status === Status.PASS && b.status !== Status.PASS) return -1;
        if (b.status === Status.PASS && a.status !== Status.PASS) return 1;

        // Secondary: By selected metric
        if (sortBy === 'tokens') {
          return a.tokenCount - b.tokenCount;
        }
        return a.executionMs - b.executionMs;
      });
    };

    /**
     * Generate summary statistics for results
     * @param {Array<Object>} results - Array of result objects
     * @returns {Object} Summary statistics
     */
    const summarize = (results) => {
      const passed = results.filter(r => r.status === Status.PASS);
      const failed = results.filter(r => r.status === Status.FAIL);
      const errors = results.filter(r => r.status === Status.ERROR);

      const ranked = rankResults(results);

      // Calculate averages for passing results
      const avgExecutionMs = passed.length > 0
        ? Math.round(passed.reduce((sum, r) => sum + r.executionMs, 0) / passed.length)
        : 0;

      const avgTokens = passed.length > 0
        ? Math.round(passed.reduce((sum, r) => sum + r.tokenCount, 0) / passed.length)
        : 0;

      return {
        total: results.length,
        passed: passed.length,
        failed: failed.length,
        errors: errors.length,
        passRate: results.length > 0
          ? Math.round((passed.length / results.length) * 100)
          : 0,
        fastestPassing: passed.length > 0
          ? passed.reduce((min, r) => r.executionMs < min.executionMs ? r : min).competitorName
          : null,
        mostEfficient: passed.length > 0
          ? passed.reduce((min, r) => r.tokenCount < min.tokenCount ? r : min).competitorName
          : null,
        avgExecutionMs,
        avgTokens,
        rankings: ranked.map(r => ({
          name: r.competitorName,
          status: r.status,
          ms: r.executionMs,
          tokens: r.tokenCount
        }))
      };
    };

    /**
     * Compare two competition runs
     * @param {Object} summary1 - First summary
     * @param {Object} summary2 - Second summary
     * @returns {Object} Comparison results
     */
    const compare = (summary1, summary2) => ({
      passRateDiff: summary2.passRate - summary1.passRate,
      speedDiff: summary2.avgExecutionMs - summary1.avgExecutionMs,
      tokenDiff: summary2.avgTokens - summary1.avgTokens,
      improved: summary2.passRate > summary1.passRate ||
        (summary2.passRate === summary1.passRate && summary2.avgExecutionMs < summary1.avgExecutionMs)
    });

    return {
      Status,
      createResult,
      rankResults,
      summarize,
      compare
    };
  }
};

export default ArenaMetrics;
