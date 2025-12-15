/**
 * @fileoverview Replay Engine
 * Replays timeline events from exported run files with speed control.
 */

const ReplayEngine = {
  metadata: {
    id: 'ReplayEngine',
    version: '1.0.0',
    genesis: { introduced: 'tabula' },
    dependencies: ['Utils', 'EventBus'],
    async: true,
    type: 'infrastructure'
  },

  factory: (deps) => {
    const { Utils, EventBus } = deps;
    const { logger } = Utils;

    // State
    let _isPlaying = false;
    let _isPaused = false;
    let _speed = 1;
    let _currentIndex = 0;
    let _events = [];
    let _runMetadata = null;
    let _playbackTimeout = null;

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

    return {
      init: async () => {
        logger.info('[ReplayEngine] Initialized');
        return true;
      },
      loadRun,
      play,
      pause,
      stop,
      step,
      setSpeed,
      seek,
      getState,
      getSpeeds
    };
  }
};

export default ReplayEngine;
