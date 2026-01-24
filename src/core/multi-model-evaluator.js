/**
 * @fileoverview Multi-Model Evaluator
 * Runs task suites across model configs and scores outputs.
 */

const MultiModelEvaluator = {
  metadata: {
    id: 'MultiModelEvaluator',
    version: '1.0.0',
    genesis: { introduced: 'full' },
    dependencies: ['Utils', 'LLMClient', 'EventBus?', 'SchemaRegistry?'],
    async: true,
    type: 'core'
  },

  factory: (deps) => {
    const { Utils, LLMClient, EventBus, SchemaRegistry } = deps;
    const { Errors, generateId } = Utils;

    const DEFAULT_MODEL_CONCURRENCY = 2;
    const DEFAULT_LENGTH_TARGET = 400;

    const emit = (event, payload) => {
      if (EventBus) {
        EventBus.emit(event, payload);
      }
    };

    const nowMs = () => (
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now()
    );

    const estimateTokens = (text) => {
      if (!text || typeof text !== 'string') return 0;
      const words = text.split(/\s+/).filter(Boolean).length;
      return Math.ceil(words / 0.7);
    };

    const buildMessages = (task) => {
      if (Array.isArray(task?.messages) && task.messages.length > 0) {
        return task.messages;
      }
      const content = task?.prompt || task?.description || '';
      return [{ role: 'user', content }];
    };

    const scoreOutput = (task, output, modelId, options = {}) => {
      if (typeof options.scoreOutput === 'function') {
        return options.scoreOutput({ task, output, modelId, SchemaRegistry });
      }

      let valid = true;
      const errors = [];
      let score = 0.5;

      if (task?.schema && SchemaRegistry?.validateCombinedOutput) {
        const validation = SchemaRegistry.validateCombinedOutput({ [modelId]: output }, task.schema);
        valid = validation.valid;
        if (!validation.valid && Array.isArray(validation.errors)) {
          errors.push(...validation.errors);
        }
        score = validation.valid ? 0.7 : 0.1;
      }

      if (task?.expected !== undefined) {
        const expected = String(task.expected).trim().toLowerCase();
        const actual = String(output || '').trim().toLowerCase();
        const matchMode = task.matchMode || options.matchMode || 'contains';
        const matches = matchMode === 'exact'
          ? actual === expected
          : actual.includes(expected);

        if (!matches) {
          valid = false;
          errors.push('Expected output mismatch');
          score = Math.max(0, score - 0.2);
        } else {
          score = Math.min(1, score + 0.2);
        }
      }

      const lengthTarget = options.lengthTarget || DEFAULT_LENGTH_TARGET;
      if (lengthTarget > 0) {
        const lengthScore = Math.min(1, (output || '').length / lengthTarget) * 0.2;
        score = Math.min(1, score + lengthScore);
      }

      return { score, valid, errors };
    };

    const summarizeResults = (results) => {
      const total = results.length;
      if (total === 0) {
        return {
          total: 0,
          successRate: 0,
          avgScore: 0,
          avgLatencyMs: 0,
          avgTokens: 0
        };
      }

      const successes = results.filter(r => r.valid && !r.error).length;
      const avgScore = results.reduce((sum, r) => sum + (r.score || 0), 0) / total;
      const avgLatencyMs = results.reduce((sum, r) => sum + (r.durationMs || 0), 0) / total;
      const avgTokens = results.reduce((sum, r) => sum + (r.tokens || 0), 0) / total;

      return {
        total,
        successRate: successes / total,
        avgScore,
        avgLatencyMs,
        avgTokens
      };
    };

    const runTask = async (task, modelConfig, options = {}) => {
      const modelId = modelConfig?.id || modelConfig?.modelId || modelConfig?.provider || 'unknown';
      const taskId = task?.id || generateId('mmeval_task');
      const messages = buildMessages(task);

      const started = nowMs();
      try {
        const response = await LLMClient.chat(messages, modelConfig, null, task?.chatOptions || options.chatOptions || {});
        const output = response?.content || '';
        const durationMs = nowMs() - started;
        const tokens = estimateTokens(output);
        const scoring = scoreOutput(task, output, modelId, options);

        return {
          taskId,
          modelId,
          output,
          score: scoring.score,
          valid: scoring.valid,
          errors: scoring.errors,
          durationMs,
          tokens
        };
      } catch (err) {
        const durationMs = nowMs() - started;
        return {
          taskId,
          modelId,
          output: '',
          score: 0,
          valid: false,
          errors: [err?.message || String(err)],
          durationMs,
          tokens: 0,
          error: err?.message || String(err)
        };
      }
    };

    const runWithConcurrency = async (items, concurrency, worker) => {
      const results = new Array(items.length);
      let cursor = 0;

      const runNext = async () => {
        const idx = cursor++;
        if (idx >= items.length) return;
        results[idx] = await worker(items[idx], idx);
        await runNext();
      };

      const runners = Array.from(
        { length: Math.max(1, Math.min(concurrency, items.length)) },
        () => runNext()
      );

      await Promise.all(runners);
      return results;
    };

    const evaluate = async (tasks = [], modelConfigs = [], options = {}) => {
      if (!Array.isArray(tasks) || tasks.length === 0) {
        throw new Errors.ValidationError('Task list required');
      }
      if (!Array.isArray(modelConfigs) || modelConfigs.length === 0) {
        throw new Errors.ValidationError('Model configs required');
      }

      const runId = options.runId || generateId('mmeval');
      const startedAt = Date.now();
      const totalRuns = tasks.length * modelConfigs.length;
      let completed = 0;

      emit('multi-model:eval:start', {
        runId,
        tasks: tasks.length,
        models: modelConfigs.length,
        totalRuns
      });

      const modelConcurrency = options.modelConcurrency || DEFAULT_MODEL_CONCURRENCY;

      const modelResults = await runWithConcurrency(modelConfigs, modelConcurrency, async (modelConfig) => {
        const modelId = modelConfig?.id || modelConfig?.modelId || modelConfig?.provider || 'unknown';
        const results = [];

        for (const task of tasks) {
          const result = await runTask(task, modelConfig, options);
          results.push(result);
          completed += 1;

          emit('multi-model:eval:progress', {
            runId,
            modelId,
            taskId: result.taskId,
            completed,
            totalRuns
          });
        }

        return {
          modelId,
          results,
          summary: summarizeResults(results)
        };
      });

      const finishedAt = Date.now();
      const summary = modelResults.map((entry) => ({
        modelId: entry.modelId,
        ...entry.summary
      }));

      emit('multi-model:eval:complete', {
        runId,
        durationMs: finishedAt - startedAt,
        summary
      });

      return {
        runId,
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
        totals: {
          tasks: tasks.length,
          models: modelConfigs.length,
          totalRuns
        },
        summary,
        models: modelResults
      };
    };

    return {
      evaluate
    };
  }
};

export default MultiModelEvaluator;
