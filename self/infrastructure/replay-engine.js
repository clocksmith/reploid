/**
 * @fileoverview Replay Engine
 * Imported traces have passive, namespaced playback only.
 * Explicit internal audit-session re-execution remains a separate legacy API.
 */

import { importRunTrace } from '../core/run-replay-bundle.js';

export const REPLAY_SPEEDS = Object.freeze([1, 8, 64, 256]);

// Playback has no execution ports and never dispatches imported event names.
// Advance every event in order, then render once per scheduling frame.
export function createTimelinePlayback({ onEvent = () => {}, onReset = () => {}, onUpdate = () => {},
  now = () => performance.now(), schedule = callback => setTimeout(callback, 16), cancel = clearTimeout } = {}) {
  let trace = null;
  let index = 0;
  let speed = 1;
  let playing = false;
  let elapsed = 0;
  let anchor = 0;
  let timer = null;
  const duration = () => trace?.events.length ? trace.events.at(-1).ts - trace.startedAt : 0;
  const position = () => Math.min(duration(), elapsed + (playing ? Math.max(0, now() - anchor) * speed : 0));
  const getState = () => ({ isPlaying: playing, isPaused: !!trace && !playing, speed,
    currentIndex: index, totalEvents: trace?.events.length || 0,
    elapsedMs: position(), durationMs: duration(), replay: true,
    percent: trace?.events.length ? Math.round(index / trace.events.length * 100) : 0,
    metadata: trace ? { eventCount: trace.events.length, droppedEvents: trace.droppedEvents,
      provenance: structuredClone(trace.provenance) } : null });
  const update = () => onUpdate(getState());
  const cancelTimer = () => { if (timer !== null) cancel(timer); timer = null; };
  const apply = () => { const event = trace.events[index++]; onEvent(structuredClone(event)); };
  const tick = () => {
    timer = null;
    if (!playing) return;
    const target = position();
    while (index < trace.events.length && trace.events[index].ts - trace.startedAt <= target) apply();
    if (index === trace.events.length) { elapsed = duration(); playing = false; }
    update();
    if (playing) timer = schedule(tick);
  };
  const pause = () => { elapsed = position(); playing = false; cancelTimer(); update(); };
  const seek = next => {
    if (!trace || !Number.isInteger(next) || next < 0 || next > trace.events.length) throw new Error('Invalid replay position.');
    pause();
    index = 0;
    onReset();
    while (index < next) apply();
    elapsed = index ? trace.events[index - 1].ts - trace.startedAt : 0;
    update();
  };
  const play = () => {
    if (!trace || playing || index === trace.events.length) return;
    anchor = now(); playing = true; tick();
  };
  const loadRun = input => {
    const next = importRunTrace(input); // Validate before replacing a currently loaded trace.
    pause(); trace = next; index = 0; elapsed = 0; onReset(); update();
    return { events: structuredClone(trace.events), metadata: getState().metadata };
  };
  return { loadRun, play, pause, seek, getState,
    stop: () => { if (trace) seek(0); },
    step: () => { pause(); if (trace && index < trace.events.length) { apply(); elapsed = trace.events[index - 1].ts - trace.startedAt; update(); } },
    setSpeed(next) {
      if (!REPLAY_SPEEDS.includes(next)) throw new Error('Unsupported replay speed.');
      elapsed = position(); anchor = now(); speed = next; update();
    },
    getSpeeds: () => [...REPLAY_SPEEDS],
    dispose: () => { cancelTimer(); playing = false; trace = null; }
  };
}

const ReplayEngine = {
  metadata: {
    id: 'ReplayEngine',
    version: '2.0.0',
    genesis: { introduced: 'substrate' },
    dependencies: [
      'Utils', 'EventBus', 'VFS',
      'AuditLogger?', 'VFSSandbox?', 'ToolRunner?', 'LLMClient?'
    ],
    async: true,
    type: 'infrastructure'
  },

  factory: (deps) => {
    const { Utils, EventBus, VFS, AuditLogger, VFSSandbox, ToolRunner, LLMClient } = deps;
    const { logger, generateId } = Utils;

    let _events = [];
    let _runMetadata = null;
    let _currentIndex = 0;
    let _importedSession = false;
    const playback = createTimelinePlayback({
      onEvent: event => EventBus.emit('replay:event', event),
      onReset: () => EventBus.emit('replay:reset'),
      onUpdate: state => {
        _currentIndex = state.currentIndex;
        EventBus.emit('replay:progress', state);
        if (!state.isPlaying && state.totalEvents && state.currentIndex === state.totalEvents) EventBus.emit('replay:completed');
      }
    });

    // Re-execution state
    let _isExecuting = false;
    let _executionAbort = null;
    let _recordedResponses = new Map(); // iteration -> LLM response
    let _recordedToolResults = new Map(); // iteration:toolName -> result
    let _vfsCheckpoints = []; // { index, snapshot }
    let _comparisonResults = []; // { iteration, expected, actual, match }

    const loadRun = runData => {
      if (_isExecuting) throw new Error('Stop session execution before importing a trace.');
      importRunTrace(runData);
      _importedSession = true;
      _recordedResponses.clear();
      _recordedToolResults.clear();
      _vfsCheckpoints = [];
      const result = playback.loadRun(runData);
      _events = result.events;
      _runMetadata = result.metadata;
      _importedSession = true;
      EventBus.emit('replay:loaded', _runMetadata);
      return result;
    };
    const { play, pause, stop, step, setSpeed, seek, getState, getSpeeds } = playback;

    // =========================================================================
    // SESSION RE-EXECUTION (New in v2.0)
    // =========================================================================

    /**
     * Load a session from audit logs for re-execution
     * @param {string} startDate - YYYY-MM-DD
     * @param {string} [endDate] - YYYY-MM-DD (default: startDate)
     * @returns {Promise<Object>} Session data with recorded events
     */
    const loadSession = async (startDate, endDate = null) => {
      if (!AuditLogger) {
        throw new Error('AuditLogger not available for session loading');
      }

      const entries = await AuditLogger.getEntries(startDate, endDate);
      if (entries.length === 0) {
        throw new Error(`No audit entries found for ${startDate}`);
      }

      _importedSession = false;
      // Extract LLM responses and tool results
      _recordedResponses.clear();
      _recordedToolResults.clear();
      _comparisonResults = [];

      let goalEntry = null;
      let iteration = 0;

      for (const entry of entries) {
        if (entry.type === 'AGENT_ACTION' && entry.data?.action === 'goal_set') {
          goalEntry = entry;
        }

        if (entry.type === 'AGENT_ACTION' && entry.data?.action === 'llm_response') {
          iteration++;
          _recordedResponses.set(iteration, {
            content: entry.data.content,
            toolCalls: entry.data.toolCalls || [],
            ts: entry.ts
          });
        }

        if (entry.type === 'AGENT_ACTION' && entry.data?.action === 'tool_result') {
          const key = `${iteration}:${entry.data.tool}`;
          _recordedToolResults.set(key, {
            result: entry.data.result,
            args: entry.data.args,
            ts: entry.ts
          });
        }
      }

      const sessionData = {
        id: generateId('session'),
        startDate,
        endDate: endDate || startDate,
        goal: goalEntry?.data?.goal || 'Unknown goal',
        totalIterations: iteration,
        entryCount: entries.length,
        llmResponses: _recordedResponses.size,
        toolResults: _recordedToolResults.size,
        entries
      };

      logger.info(`[ReplayEngine] Session loaded: ${sessionData.llmResponses} LLM responses, ${sessionData.toolResults} tool results`);
      EventBus.emit('replay:session_loaded', sessionData);

      return sessionData;
    };

    /**
     * Load session from exported run file (with VFS snapshot)
     * @param {Object} runData - Exported run JSON with vfs and state
     * @returns {Object} Session data
     */
    const loadSessionFromRun = (runData) => {
      if (!runData?.vfs) {
        throw new Error('Invalid run data: missing vfs');
      }

      // Also load timeline events for visualization
      loadRun(runData);

      // Extract agent history from timeline
      _recordedResponses.clear();
      _recordedToolResults.clear();
      _comparisonResults = [];

      let iteration = 0;
      for (const event of _events) {
        if (event.type === 'agent:history') {
          if (event.payload?.type === 'llm_response') {
            iteration++;
            _recordedResponses.set(iteration, {
              content: event.payload.content,
              cycle: event.payload.cycle,
              ts: event.ts
            });
          }
          if (event.payload?.type === 'tool_result') {
            const key = `${iteration}:${event.payload.tool}`;
            _recordedToolResults.set(key, {
              result: event.payload.result,
              args: event.payload.args,
              ts: event.ts
            });
          }
        }
      }

      const sessionData = {
        id: generateId('session'),
        goal: runData.state?.goal || 'Unknown goal',
        totalIterations: iteration,
        llmResponses: _recordedResponses.size,
        toolResults: _recordedToolResults.size,
        hasVFS: true,
        vfsFileCount: Object.keys(runData.vfs).length
      };

      logger.info(`[ReplayEngine] Session loaded from run: ${sessionData.llmResponses} responses`);
      EventBus.emit('replay:session_loaded', sessionData);

      return sessionData;
    };

    /**
     * Create a VFS checkpoint at current state
     * @returns {Promise<number>} Checkpoint index
     */
    const createCheckpoint = async () => {
      if (!VFSSandbox) {
        logger.warn('[ReplayEngine] VFSSandbox not available, skipping checkpoint');
        return -1;
      }

      const snapshot = await VFSSandbox.createSnapshot();
      const index = _vfsCheckpoints.length;
      _vfsCheckpoints.push({
        index,
        snapshot,
        iteration: _currentIndex,
        timestamp: Date.now()
      });

      logger.debug(`[ReplayEngine] Checkpoint ${index} created at iteration ${_currentIndex}`);
      return index;
    };

    /**
     * Restore VFS to a checkpoint
     * @param {number} checkpointIndex - Checkpoint to restore
     */
    const restoreCheckpoint = async (checkpointIndex) => {
      if (_importedSession) throw new Error('Imported traces are read-only playback, not execution.');
      if (!VFSSandbox) {
        throw new Error('VFSSandbox not available for checkpoint restore');
      }

      const checkpoint = _vfsCheckpoints[checkpointIndex];
      if (!checkpoint) {
        throw new Error(`Checkpoint ${checkpointIndex} not found`);
      }

      await VFSSandbox.restoreSnapshot(checkpoint.snapshot);
      _currentIndex = checkpoint.iteration;

      logger.info(`[ReplayEngine] Restored to checkpoint ${checkpointIndex}`);
      EventBus.emit('replay:checkpoint_restored', { index: checkpointIndex });
    };

    /**
     * Get mocked LLM response for deterministic replay
     * @param {number} iteration - Current iteration
     * @returns {Object|null} Recorded response or null
     */
    const getMockedResponse = (iteration) => {
      return _recordedResponses.get(iteration) || null;
    };

    /**
     * Execute a single iteration with mocked LLM
     * @param {number} iteration - Iteration number
     * @param {Array} context - Current context
     * @param {Object} modelConfig - Model config (ignored in mock mode)
     * @returns {Promise<Object>} Response object
     */
    const executeIteration = async (iteration, context, modelConfig) => {
      if (_importedSession) throw new Error('Imported traces are read-only playback, not execution.');
      const recorded = getMockedResponse(iteration);

      if (recorded) {
        logger.debug(`[ReplayEngine] Using mocked response for iteration ${iteration}`);
        EventBus.emit('replay:iteration', {
          iteration,
          mode: 'mocked',
          content: recorded.content?.substring(0, 100) + '...'
        });

        return {
          content: recorded.content,
          toolCalls: recorded.toolCalls || [],
          mocked: true
        };
      }

      // No recorded response - use live LLM if available
      if (LLMClient) {
        logger.info(`[ReplayEngine] No recorded response for iteration ${iteration}, using live LLM`);
        EventBus.emit('replay:iteration', { iteration, mode: 'live' });

        const response = await LLMClient.chat(context, modelConfig);
        return { ...response, mocked: false };
      }

      throw new Error(`No recorded response for iteration ${iteration} and LLMClient not available`);
    };

    /**
     * Compare tool result against recorded result
     * @param {number} iteration - Current iteration
     * @param {string} toolName - Tool name
     * @param {string} actualResult - Actual result from re-execution
     * @returns {Object} Comparison result
     */
    const compareToolResult = (iteration, toolName, actualResult) => {
      const key = `${iteration}:${toolName}`;
      const recorded = _recordedToolResults.get(key);

      const comparison = {
        iteration,
        tool: toolName,
        expected: recorded?.result || null,
        actual: actualResult,
        match: false,
        diff: null
      };

      if (!recorded) {
        comparison.diff = 'No recorded result';
      } else if (recorded.result === actualResult) {
        comparison.match = true;
      } else {
        // Simple diff - first difference location
        const expected = recorded.result || '';
        const actual = actualResult || '';
        let diffPos = 0;
        while (diffPos < expected.length && diffPos < actual.length && expected[diffPos] === actual[diffPos]) {
          diffPos++;
        }
        comparison.diff = `Mismatch at position ${diffPos}: expected "${expected.substring(diffPos, diffPos + 50)}..." got "${actual.substring(diffPos, diffPos + 50)}..."`;
      }

      _comparisonResults.push(comparison);
      EventBus.emit('replay:comparison', comparison);

      return comparison;
    };

    /**
     * Run full session re-execution
     * @param {Object} options - Execution options
     * @param {string} [options.mode='mocked'] - 'mocked' (deterministic) or 'live' (fresh LLM)
     * @param {boolean} [options.compareResults=true] - Compare tool results
     * @param {boolean} [options.checkpointInterval=5] - Create checkpoint every N iterations
     * @param {Function} [options.onIteration] - Callback per iteration
     * @returns {Promise<Object>} Execution report
     */
    const executeSession = async (options = {}) => {
      if (_importedSession) throw new Error('Imported traces are read-only playback, not execution.');
      const {
        mode = 'mocked',
        compareResults = true,
        checkpointInterval = 5,
        onIteration = null
      } = options;

      if (_isExecuting) {
        throw new Error('Session execution already in progress');
      }

      if (_recordedResponses.size === 0) {
        throw new Error('No session loaded - call loadSession() or loadSessionFromRun() first');
      }

      _isExecuting = true;
      _executionAbort = new AbortController();
      _comparisonResults = [];
      _vfsCheckpoints = [];

      const report = {
        id: generateId('replay'),
        startTime: Date.now(),
        mode,
        iterations: 0,
        toolCalls: 0,
        matches: 0,
        mismatches: 0,
        errors: []
      };

      logger.info(`[ReplayEngine] Starting session execution (mode: ${mode})`);
      EventBus.emit('replay:execution_started', { mode });

      try {
        // Initial checkpoint
        await createCheckpoint();

        const totalIterations = _recordedResponses.size;

        for (let i = 1; i <= totalIterations; i++) {
          if (_executionAbort.signal.aborted) {
            logger.info('[ReplayEngine] Execution aborted');
            break;
          }

          report.iterations++;

          // Checkpoint at intervals
          if (i % checkpointInterval === 0) {
            await createCheckpoint();
          }

          // Get recorded response
          const recorded = _recordedResponses.get(i);
          if (!recorded) {
            report.errors.push({ iteration: i, error: 'No recorded response' });
            continue;
          }

          // Emit iteration event
          EventBus.emit('replay:execution_iteration', {
            iteration: i,
            total: totalIterations,
            percent: Math.round((i / totalIterations) * 100)
          });

          // Execute tool calls from recorded response
          if (ToolRunner && recorded.toolCalls) {
            for (const call of recorded.toolCalls) {
              try {
                report.toolCalls++;
                const result = await ToolRunner.execute(call.name, call.args);
                const resultStr = typeof result === 'string' ? result : JSON.stringify(result);

                if (compareResults) {
                  const comparison = compareToolResult(i, call.name, resultStr);
                  if (comparison.match) {
                    report.matches++;
                  } else {
                    report.mismatches++;
                  }
                }
              } catch (e) {
                report.errors.push({
                  iteration: i,
                  tool: call.name,
                  error: e.message
                });
              }
            }
          }

          if (onIteration) {
            await onIteration(i, recorded);
          }
        }
      } catch (e) {
        report.errors.push({ error: e.message, fatal: true });
        logger.error('[ReplayEngine] Execution error:', e);
      } finally {
        _isExecuting = false;
        _executionAbort = null;
      }

      report.endTime = Date.now();
      report.durationMs = report.endTime - report.startTime;
      report.checkpoints = _vfsCheckpoints.length;
      report.comparisons = _comparisonResults;

      logger.info(`[ReplayEngine] Execution complete: ${report.iterations} iterations, ${report.matches}/${report.toolCalls} matches`);
      EventBus.emit('replay:execution_complete', report);

      return report;
    };

    /**
     * Abort running session execution
     */
    const abortExecution = () => {
      if (_executionAbort) {
        _executionAbort.abort();
        logger.info('[ReplayEngine] Execution abort requested');
      }
    };

    /**
     * Get comparison results from last execution
     * @returns {Array} Comparison results
     */
    const getComparisonResults = () => [..._comparisonResults];

    /**
     * Get checkpoint list
     * @returns {Array} Checkpoints
     */
    const getCheckpoints = () => _vfsCheckpoints.map(c => ({
      index: c.index,
      iteration: c.iteration,
      timestamp: c.timestamp,
      fileCount: Object.keys(c.snapshot.files).length
    }));

    /**
     * Get execution state
     */
    const getExecutionState = () => ({
      isExecuting: _isExecuting,
      recordedResponses: _recordedResponses.size,
      recordedToolResults: _recordedToolResults.size,
      checkpoints: _vfsCheckpoints.length,
      comparisons: _comparisonResults.length
    });

    /**
     * Clear all replay state
     */
    const clear = () => {
      stop();
      _recordedResponses.clear();
      _recordedToolResults.clear();
      _vfsCheckpoints = [];
      _comparisonResults = [];
      _events = [];
      _runMetadata = null;
      logger.info('[ReplayEngine] State cleared');
    };

    return {
      init: async () => {
        logger.info('[ReplayEngine] Initialized (v2.0 with re-execution)');
        return true;
      },
      // Timeline playback (v1.0)
      loadRun,
      play,
      pause,
      stop,
      step,
      setSpeed,
      seek,
      getState,
      getSpeeds,
      // Session re-execution (v2.0)
      loadSession,
      loadSessionFromRun,
      createCheckpoint,
      restoreCheckpoint,
      getMockedResponse,
      executeIteration,
      compareToolResult,
      executeSession,
      abortExecution,
      getComparisonResults,
      getCheckpoints,
      getExecutionState,
      clear
    };
  }
};

export default ReplayEngine;
