/**
 * @fileoverview Arena Harness - Main competition orchestrator
 * Runs test-driven competitive selection for model comparison and self-modification gating.
 */

const ArenaHarness = {
  metadata: {
    id: 'ArenaHarness',
    version: '1.0.0',
    dependencies: ['VFSSandbox', 'ArenaCompetitor', 'ArenaMetrics',
                   'VerificationManager', 'EventBus', 'Utils'],
    async: false,
    type: 'testing'
  },

  factory: (deps) => {
    const { VFSSandbox, ArenaCompetitor, ArenaMetrics,
            VerificationManager, EventBus, Utils } = deps;
    const { logger } = Utils;

    /**
     * Run a competition between multiple competitors
     * @param {Object} config - Competition configuration
     * @param {string} config.task - Task description for competitors
     * @param {string} config.context - Relevant context (existing code, etc.)
     * @param {Array<Object>} config.competitors - Competitor configurations
     * @param {Function} config.parseChanges - (solution: string) => { path: content }
     * @param {Object} [config.options] - Optional settings
     * @returns {Promise<Object>} Competition results with rankings
     */
    const runCompetition = async (config) => {
      const { task, context, competitors, parseChanges, options = {} } = config;
      const { timeout = 60000, continueOnError = true } = options;

      logger.info(`[Arena] Starting competition: ${competitors.length} competitors`);
      EventBus.emit('arena:start', {
        competitorCount: competitors.length,
        task: task.slice(0, 100)
      });

      // 1. Snapshot current state
      const snapshot = await VFSSandbox.createSnapshot();
      logger.info(`[Arena] Snapshot created: ${Object.keys(snapshot.files).length} files`);

      const results = [];

      try {
        // 2. Generate proposals (parallel)
        logger.info('[Arena] Generating proposals...');
        EventBus.emit('arena:proposals:start', { count: competitors.length });

        const proposalPromises = competitors.map(comp => {
          const competitor = ArenaCompetitor.createCompetitor(comp);
          return withTimeout(
            competitor.propose(task, context),
            timeout,
            `Proposal timeout for ${comp.name}`
          ).catch(err => ({
            competitorName: comp.name,
            error: err.message
          }));
        });

        const proposals = await Promise.all(proposalPromises);
        logger.info(`[Arena] ${proposals.length} proposals received`);

        // 3. Verify each proposal (sequential - needs VFS isolation)
        for (const proposal of proposals) {
          if (proposal.error) {
            results.push(ArenaMetrics.createResult(proposal.competitorName, 'ERROR', {
              errors: [proposal.error]
            }));
            logger.warn(`[Arena] ${proposal.competitorName}: ERROR - ${proposal.error}`);
            continue;
          }

          EventBus.emit('arena:verifying', { competitor: proposal.competitorName });
          logger.info(`[Arena] Verifying ${proposal.competitorName}...`);

          // Restore clean state before applying this solution
          await VFSSandbox.restoreSnapshot(snapshot);

          try {
            // Parse and apply changes from solution
            const changes = parseChanges(proposal.solution);
            if (!changes || Object.keys(changes).length === 0) {
              results.push(ArenaMetrics.createResult(proposal.competitorName, 'FAIL', {
                executionMs: proposal.executionMs,
                tokenCount: proposal.tokenCount,
                errors: ['No file changes extracted from solution']
              }));
              continue;
            }

            await VFSSandbox.applyChanges(changes);

            // Verify with VerificationManager
            const verification = await VerificationManager.verifyProposal(changes);

            if (verification.passed) {
              results.push(ArenaMetrics.createResult(proposal.competitorName, 'PASS', {
                executionMs: proposal.executionMs,
                tokenCount: proposal.tokenCount,
                model: proposal.model,
                provider: proposal.provider,
                solution: proposal.solution,
                warnings: verification.warnings || []
              }));
              logger.info(`[Arena] ${proposal.competitorName}: PASS (${proposal.executionMs}ms)`);
            } else {
              results.push(ArenaMetrics.createResult(proposal.competitorName, 'FAIL', {
                executionMs: proposal.executionMs,
                tokenCount: proposal.tokenCount,
                model: proposal.model,
                provider: proposal.provider,
                errors: verification.errors || [verification.reason]
              }));
              logger.info(`[Arena] ${proposal.competitorName}: FAIL`);
            }
          } catch (err) {
            results.push(ArenaMetrics.createResult(proposal.competitorName, 'ERROR', {
              executionMs: proposal.executionMs,
              tokenCount: proposal.tokenCount,
              errors: [err.message]
            }));
            logger.error(`[Arena] ${proposal.competitorName}: ERROR - ${err.message}`);

            if (!continueOnError) {
              throw err;
            }
          }
        }
      } finally {
        // 4. Restore original state
        await VFSSandbox.restoreSnapshot(snapshot);
        logger.info('[Arena] Original state restored');
      }

      // 5. Return ranked results
      const summary = ArenaMetrics.summarize(results);
      const ranked = ArenaMetrics.rankResults(results);

      EventBus.emit('arena:complete', {
        ...summary,
        winner: summary.fastestPassing
      });

      logger.info(`[Arena] Competition complete: ${summary.passed}/${summary.total} passed`);
      if (summary.fastestPassing) {
        logger.info(`[Arena] Winner: ${summary.fastestPassing}`);
      }

      return {
        results: ranked,
        summary,
        winner: summary.fastestPassing,
        winnerSolution: ranked.find(r => r.status === 'PASS')?.solution || null
      };
    };

    /**
     * Run a single-competitor verification (self-modification gating)
     * @param {Object} config - Verification configuration
     * @param {string} config.solution - The solution to verify
     * @param {Function} config.parseChanges - Solution parser
     * @returns {Promise<Object>} Verification result
     */
    const verifySolution = async (config) => {
      const { solution, parseChanges, name = 'self' } = config;

      logger.info('[Arena] Running single solution verification');

      const snapshot = await VFSSandbox.createSnapshot();

      try {
        const changes = parseChanges(solution);
        if (!changes || Object.keys(changes).length === 0) {
          return {
            passed: false,
            error: 'No file changes extracted from solution'
          };
        }

        await VFSSandbox.applyChanges(changes);
        const verification = await VerificationManager.verifyProposal(changes);

        return {
          passed: verification.passed,
          errors: verification.errors || [],
          warnings: verification.warnings || [],
          changes: Object.keys(changes)
        };
      } catch (err) {
        return {
          passed: false,
          error: err.message
        };
      } finally {
        await VFSSandbox.restoreSnapshot(snapshot);
      }
    };

    /**
     * Helper: Add timeout to a promise
     */
    const withTimeout = (promise, ms, message) => {
      return Promise.race([
        promise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(message)), ms)
        )
      ]);
    };

    return {
      runCompetition,
      verifySolution
    };
  }
};

export default ArenaHarness;
