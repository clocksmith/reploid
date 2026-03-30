/**
 * @fileoverview Arena Harness - Main competition orchestrator
 * Runs test-driven competitive selection for model comparison and self-modification gating.
 */

const ArenaHarness = {
  metadata: {
    id: 'ArenaHarness',
    version: '1.0.0',
    genesis: { introduced: 'full' },
    dependencies: ['VFSSandbox', 'ArenaCompetitor', 'ArenaMetrics',
                   'VerificationManager', 'EventBus', 'Utils', 'SchemaRegistry?'],
    async: false,
    type: 'testing'
  },

  factory: (deps) => {
    const { VFSSandbox, ArenaCompetitor, ArenaMetrics,
            VerificationManager, EventBus, Utils, SchemaRegistry } = deps;
    const { logger, generateId } = Utils;
    let _lastConfig = null;
    let _lastRunId = null;

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
      const runId = generateId('arena');
      _lastConfig = config;
      _lastRunId = runId;

      logger.info(`[Arena] Starting competition: ${competitors.length} competitors`);
      EventBus.emit('arena:start', {
        runId,
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
        runId,
        ...summary,
        summary,
        results: ranked,
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

    const validateAgainstSchema = (value, schema) => {
      if (!schema || typeof schema !== 'object') return { valid: true, errors: [] };
      const errors = [];
      const required = Array.isArray(schema.required) ? schema.required : [];
      const properties = schema.properties || {};

      if (schema.type === 'object' && (value === null || typeof value !== 'object' || Array.isArray(value))) {
        errors.push('Expected object');
        return { valid: false, errors };
      }

      for (const key of required) {
        if (!(key in (value || {}))) {
          errors.push(`Missing required field: ${key}`);
        }
      }

      for (const [key, def] of Object.entries(properties)) {
        if (!(key in (value || {}))) continue;
        const expectedType = def?.type;
        if (!expectedType) continue;
        const actual = value[key];
        if (expectedType === 'array' && !Array.isArray(actual)) {
          errors.push(`Field ${key} expected array`);
        } else if (expectedType === 'object' && (typeof actual !== 'object' || actual === null || Array.isArray(actual))) {
          errors.push(`Field ${key} expected object`);
        } else if (expectedType !== 'array' && expectedType !== 'object' && typeof actual !== expectedType) {
          errors.push(`Field ${key} expected ${expectedType}`);
        }
      }

      return { valid: errors.length === 0, errors };
    };

    const scoreOutput = (output, task, options = {}) => {
      const schema = task.schema || (task.schemaName && SchemaRegistry?.getToolSchema?.(task.schemaName)?.parameters) || null;
      const scored = {
        score: 0,
        valid: true,
        errors: [],
        parsed: output
      };

      if (schema) {
        let parsed = output;
        if (typeof output === 'string') {
          try {
            parsed = JSON.parse(output);
          } catch (err) {
            scored.valid = false;
            scored.errors.push('Output is not valid JSON');
            return scored;
          }
        }
        const validation = validateAgainstSchema(parsed, schema);
        scored.valid = validation.valid;
        scored.errors = validation.errors;
        scored.parsed = parsed;
        scored.score += validation.valid ? 0.7 : 0;
      } else {
        scored.score += 0.4;
      }

      if (typeof options.scoreOutput === 'function') {
        const extra = options.scoreOutput(output, task, scored);
        if (typeof extra === 'number') scored.score += extra;
      }

      return scored;
    };

    const runExpertPool = async (task, experts, doppler, options = {}) => {
      if (!Array.isArray(experts) || experts.length === 0) {
        throw new Error('Expert pool is empty');
      }
      const runner = options.run
        || doppler?.executeExpert
        || doppler?.inference
        || null;
      if (!runner) {
        throw new Error('No runner available for expert pool');
      }

      const outputs = await Promise.all(experts.map(async (expert) => {
        const started = Date.now();
        const result = await runner(expert.modelId || expert.id, task.prompt || task.input || task.description || '', {
          loraAdapter: expert.adapter,
          maxTokens: task.maxTokens,
          temperature: task.temperature,
          topP: task.topP,
          topK: task.topK
        });
        return {
          expert,
          output: result,
          durationMs: Date.now() - started
        };
      }));

      const scored = outputs.map((entry) => {
        const score = scoreOutput(entry.output, task, options);
        return { ...entry, score };
      });

      scored.sort((a, b) => b.score.score - a.score.score);
      return {
        winner: scored[0] || null,
        results: scored
      };
    };

    const rerunLast = async () => {
      if (!_lastConfig) {
        throw new Error('No previous arena run available');
      }
      logger.info(`[Arena] Re-running last competition (${_lastRunId || 'unknown'})`);
      return runCompetition(_lastConfig);
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
      verifySolution,
      runExpertPool,
      rerunLast
    };
  }
};

export default ArenaHarness;
