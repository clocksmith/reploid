/**
 * @fileoverview Replay Engine
 * Re-executes agent sessions from audit logs with deterministic LLM mocking.
 * Supports: timeline visualization, session re-execution, comparison testing.
 */

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

    // Timeline playback state
    let _isPlaying = false;
    let _isPaused = false;
    let _speed = 1;
    let _currentIndex = 0;
    let _events = [];
    let _runMetadata = null;
    let _playbackTimeout = null;

    // Re-execution state
    let _isExecuting = false;
    let _executionAbort = null;
    let _recordedResponses = new Map(); // iteration -> LLM response
    let _recordedToolResults = new Map(); // iteration:toolName -> result
    let _vfsCheckpoints = []; // { index, snapshot }
    let _comparisonResults = []; // { iteration, expected, actual, match }

    // Speed presets
    const SPEEDS = [1, 2, 5, 10, 50];

    /**
     * Load a run file and extract timeline events
     * @param {Object} runData - Exported run JSON
     * @returns {Object} { events, metadata }
     */
    const loadRun = (runData) => {
      if (!runData?.vfs) {
        throw new Error('Invalid run data: missing vfs');
      }

      // Find timeline files
      const timelineFiles = Object.keys(runData.vfs)
        .filter(path => path.startsWith('/.logs/timeline/') && path.endsWith('.jsonl'))
        .sort();

      // Parse all timeline events
      _events = [];
      for (const path of timelineFiles) {
        const content = runData.vfs[path];
        if (!content) continue;

        for (const line of content.split('\n').filter(Boolean)) {
          try {
            _events.push(JSON.parse(line));
          } catch {
            // Skip malformed lines
          }
        }
      }

      // Sort by timestamp
      _events.sort((a, b) => a.ts - b.ts);

      // Extract metadata
      _runMetadata = {
        exportedAt: runData.exportedAt,
        state: runData.state,
        totalCycles: runData.metadata?.totalCycles || runData.state?.totalCycles || 0,
        eventCount: _events.length,
        fileCount: Object.keys(runData.vfs).length,
        duration: _events.length > 1
          ? _events[_events.length - 1].ts - _events[0].ts
          : 0
      };

      _currentIndex = 0;
      _isPlaying = false;
      _isPaused = false;

      logger.info(`[ReplayEngine] Loaded run: ${_events.length} events, ${_runMetadata.totalCycles} cycles`);

      EventBus.emit('replay:loaded', _runMetadata);

      return { events: _events, metadata: _runMetadata };
    };

    /**
     * Start or resume playback
     */
    const play = () => {
      if (_events.length === 0) {
        logger.warn('[ReplayEngine] No events loaded');
        return;
      }

      _isPlaying = true;
      _isPaused = false;

      EventBus.emit('replay:started', { index: _currentIndex, speed: _speed });
      _scheduleNext();
    };

    /**
     * Pause playback
     */
    const pause = () => {
      _isPaused = true;
      _isPlaying = false;

      if (_playbackTimeout) {
        clearTimeout(_playbackTimeout);
        _playbackTimeout = null;
      }

      EventBus.emit('replay:paused', { index: _currentIndex });
    };

    /**
     * Stop playback and reset to beginning
     */
    const stop = () => {
      _isPlaying = false;
      _isPaused = false;
      _currentIndex = 0;

      if (_playbackTimeout) {
        clearTimeout(_playbackTimeout);
        _playbackTimeout = null;
      }

      EventBus.emit('replay:stopped');
    };

    /**
     * Step forward one event (manual stepping)
     */
    const step = () => {
      if (_currentIndex >= _events.length) {
        logger.info('[ReplayEngine] Reached end of events');
        return;
      }

      _emitEvent(_events[_currentIndex]);
      _currentIndex++;

      EventBus.emit('replay:progress', {
        index: _currentIndex,
        total: _events.length,
        percent: Math.round((_currentIndex / _events.length) * 100)
      });

      if (_currentIndex >= _events.length) {
        EventBus.emit('replay:completed');
      }
    };

    /**
     * Set playback speed
     * @param {number} speed - Speed multiplier (1, 2, 5, 10, 50)
     */
    const setSpeed = (speed) => {
      if (!SPEEDS.includes(speed)) {
        logger.warn(`[ReplayEngine] Invalid speed: ${speed}. Valid: ${SPEEDS.join(', ')}`);
        return;
      }
      _speed = speed;
      EventBus.emit('replay:speed', { speed });
    };

    /**
     * Seek to specific position
     * @param {number} index - Event index to seek to
     */
    const seek = (index) => {
      if (index < 0 || index >= _events.length) {
        logger.warn(`[ReplayEngine] Invalid seek index: ${index}`);
        return;
      }
      _currentIndex = index;

      EventBus.emit('replay:seek', {
        index: _currentIndex,
        percent: Math.round((_currentIndex / _events.length) * 100)
      });
    };

    /**
     * Schedule next event emission
     */
    const _scheduleNext = () => {
      if (!_isPlaying || _isPaused || _currentIndex >= _events.length) {
        if (_currentIndex >= _events.length) {
          _isPlaying = false;
          EventBus.emit('replay:completed');
        }
        return;
      }

      const event = _events[_currentIndex];
      const nextEvent = _events[_currentIndex + 1];

      // Emit current event
      _emitEvent(event);
      _currentIndex++;

      // Emit progress
      EventBus.emit('replay:progress', {
        index: _currentIndex,
        total: _events.length,
        percent: Math.round((_currentIndex / _events.length) * 100)
      });

      // Schedule next if available
      if (nextEvent) {
        const delay = Math.max(10, (nextEvent.ts - event.ts) / _speed);
        _playbackTimeout = setTimeout(_scheduleNext, delay);
      } else {
        _isPlaying = false;
        EventBus.emit('replay:completed');
      }
    };

    /**
     * Emit a timeline event to the EventBus
     */
    const _emitEvent = (event) => {
      // Re-emit the original event type with payload
      EventBus.emit(event.type, event.payload);

      // Also emit a replay-specific event for UI updates
      EventBus.emit('replay:event', event);
    };

    /**
     * Get current state
     */
    const getState = () => ({
      isPlaying: _isPlaying,
      isPaused: _isPaused,
      speed: _speed,
      currentIndex: _currentIndex,
      totalEvents: _events.length,
      metadata: _runMetadata,
      percent: _events.length > 0
        ? Math.round((_currentIndex / _events.length) * 100)
        : 0
    });

    /**
     * Get available speed presets
     */
    const getSpeeds = () => [...SPEEDS];

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
                const result = await ToolRunner.run(call.name, call.args);
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
