/**
 * @fileoverview Shared Recursive GEPA Ring cycle artifact writer.
 */

export const CYCLE_ARTIFACT_ROOT = '/cycles';

const MUTATING_TOOLS = new Set([
  'WriteFile',
  'EditFile',
  'DeleteFile',
  'CreateTool',
  'LoadModule',
  'Promote'
]);

export function getCycleId(iteration) {
  return `cycle-${String(iteration).padStart(6, '0')}`;
}

export function getCycleArtifactPath(iteration, name) {
  return `${CYCLE_ARTIFACT_ROOT}/${getCycleId(iteration)}/${name}`;
}

const buildCycleToolSummary = (results = []) => results.map((entry) => ({
  tool: entry.call?.name || 'unknown',
  args: entry.call?.args || {},
  path: entry.call?.args?.path || entry.call?.args?.file || entry.call?.args?.target || null,
  skipped: entry.skipped === true,
  aborted: entry.aborted === true,
  error: typeof entry.finalResult === 'string' && entry.finalResult.startsWith('Error:')
    ? entry.finalResult
    : null,
  resultPreview: typeof entry.finalResult === 'string'
    ? entry.finalResult.slice(0, 1000)
    : JSON.stringify(entry.finalResult ?? entry.result ?? null).slice(0, 1000),
  durationMs: entry.duration ?? null
}));

export function createCycleArtifactWriter({ VFS, EventBus, logger } = {}) {
  const writeCycleArtifact = async (iteration, name, payload = {}) => {
    if (!VFS?.write) return null;
    const cycleId = getCycleId(iteration);
    const path = getCycleArtifactPath(iteration, name);
    try {
      await VFS.write(path, JSON.stringify({
        schema: 'reploid/cycle-artifact/v1',
        cycleId,
        cycle: iteration,
        artifact: name,
        timestamp: Date.now(),
        ...payload
      }, null, 2));
      EventBus?.emit?.('cycle:artifact', { cycle: iteration, cycleId, path, artifact: name });
      return path;
    } catch (error) {
      logger?.warn?.(`[Agent] Failed to write cycle artifact ${path}: ${error?.message || error}`);
      return null;
    }
  };

  const writeCycleOutcomeArtifacts = async ({
    iteration,
    stateBefore,
    modelUsed = null,
    responseContent,
    callsToExecute = [],
    allResults = [],
    reason = '',
    done = false
  }) => {
    const toolSummary = buildCycleToolSummary(allResults);
    const errors = toolSummary.filter((entry) => entry.error).length;
    const mutationPaths = toolSummary
      .filter((entry) => entry.path && MUTATING_TOOLS.has(entry.tool))
      .map((entry) => entry.path);
    const promoteResult = allResults.find((entry) => entry.call?.name === 'Promote')?.result || null;
    const promotionDecision = promoteResult && typeof promoteResult === 'object'
      ? promoteResult
      : { promoted: false, reason: promoteResult ? String(promoteResult) : 'not requested' };
    const score = {
      passed: errors === 0,
      toolCallCount: callsToExecute.length,
      executedCount: toolSummary.length,
      errorCount: errors,
      mutationCount: mutationPaths.length,
      evidenceCount: mutationPaths.filter((path) => String(path).startsWith('/artifacts/') || String(path).startsWith('/cycles/')).length
    };

    const firstPassArtifacts = {
      toolcalls: ['toolcalls.json', {
        stateBefore,
        event: 'toolcalls',
        modelUsed,
        calls: callsToExecute.map((call) => ({
          name: call.name,
          args: call.args || {},
          error: call.error || null
        })),
        results: toolSummary
      }],
      score: ['score.json', {
        stateBefore,
        event: 'score',
        modelUsed,
        score
      }],
      mutation: ['mutation.json', {
        stateBefore,
        event: 'mutation',
        paths: mutationPaths,
        mutationCount: mutationPaths.length,
        toolCalls: toolSummary.filter((entry) => mutationPaths.includes(entry.path))
      }],
      decision: ['decision.json', {
        stateBefore,
        event: 'decision',
        modelUsed,
        stateAfter: done ? 'Complete' : 'Shadow',
        promotionDecision,
        done,
        reason
      }]
    };
    const paths = Object.fromEntries(await Promise.all(
      Object.entries(firstPassArtifacts).map(async ([key, [name, payload]]) => [
        key,
        await writeCycleArtifact(iteration, name, payload)
      ])
    ));
    paths.audit = await writeCycleArtifact(iteration, 'audit.json', {
      stateBefore,
      event: 'audit',
      modelUsed,
      stateAfter: done ? 'Complete' : 'Shadow',
      responsePreview: String(responseContent || '').slice(0, 2000),
      score,
      artifactPaths: paths
    });
    return paths;
  };

  return {
    getCycleId,
    getCycleArtifactPath,
    writeCycleArtifact,
    writeCycleOutcomeArtifacts
  };
}
