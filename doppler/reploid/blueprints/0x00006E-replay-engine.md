# Blueprint 0x000085: Replay Engine

**Objective:** Replay timeline events from exported run files with speed control for debugging and analysis.

**Target Module:** `ReplayEngine` (RPLY)

**Implementation:** `/infrastructure/replay-engine.js`

**Prerequisites:** `0x000003` (Core Utilities), `0x000058` (Event Bus), `0x000086` (Telemetry Timeline)

**Category:** Infrastructure

**Genesis:** tabula

---

### 1. The Strategic Imperative

Debugging agent behavior requires the ability to replay past sessions. Without replay capabilities:
- **No post-mortem analysis** of agent decisions and tool executions
- **No way to reproduce** issues from exported run files
- **No controlled stepping** through complex multi-turn interactions
- **No speed control** for rapid navigation through long sessions

The Replay Engine provides a VCR-like interface for replaying previously recorded agent sessions, enabling detailed forensic analysis of agent behavior.

### 2. The Architectural Solution

The `/infrastructure/replay-engine.js` implements a **timeline-based replay system** with playback controls and EventBus integration.

#### Module Structure

```javascript
const ReplayEngine = {
  metadata: {
    id: 'ReplayEngine',
    version: '1.0.0',
    dependencies: ['Utils', 'EventBus'],
    async: false,
    type: 'infrastructure',
    genesis: 'tabula'
  },

  factory: (deps) => {
    const { Utils, EventBus } = deps;
    const { logger } = Utils;

    // Private state
    let _runData = null;
    let _events = [];
    let _currentIndex = 0;
    let _isPlaying = false;
    let _speed = 1;
    let _playbackTimer = null;

    const SPEED_PRESETS = [1, 2, 5, 10, 50];

    /**
     * Load a run file for playback
     */
    const loadRun = (runData) => {
      _runData = runData;
      _events = runData.events || [];
      _currentIndex = 0;
      _isPlaying = false;
      clearTimeout(_playbackTimer);

      EventBus.emit('replay:loaded', {
        eventCount: _events.length,
        duration: _events.length > 0
          ? _events[_events.length - 1].ts - _events[0].ts
          : 0,
        metadata: runData.metadata
      });

      logger.info(`[ReplayEngine] Loaded run with ${_events.length} events`);
      return { success: true, eventCount: _events.length };
    };

    /**
     * Start or resume playback
     */
    const play = () => {
      if (!_runData || _events.length === 0) {
        logger.warn('[ReplayEngine] No run loaded');
        return { success: false, error: 'No run loaded' };
      }

      if (_currentIndex >= _events.length) {
        _currentIndex = 0; // Restart from beginning
      }

      _isPlaying = true;
      EventBus.emit('replay:started', { index: _currentIndex, speed: _speed });
      _scheduleNextEvent();
      return { success: true };
    };

    /**
     * Pause playback
     */
    const pause = () => {
      _isPlaying = false;
      clearTimeout(_playbackTimer);
      EventBus.emit('replay:paused', { index: _currentIndex });
      return { success: true };
    };

    /**
     * Stop playback and reset to beginning
     */
    const stop = () => {
      _isPlaying = false;
      clearTimeout(_playbackTimer);
      _currentIndex = 0;
      EventBus.emit('replay:stopped', {});
      return { success: true };
    };

    /**
     * Step forward one event
     */
    const step = () => {
      if (!_runData || _events.length === 0) {
        return { success: false, error: 'No run loaded' };
      }

      if (_currentIndex >= _events.length) {
        return { success: false, error: 'End of timeline' };
      }

      _isPlaying = false;
      clearTimeout(_playbackTimer);
      _emitCurrentEvent();
      _currentIndex++;

      EventBus.emit('replay:stepped', { index: _currentIndex });
      return { success: true, index: _currentIndex };
    };

    /**
     * Seek to specific position
     */
    const seek = (index) => {
      if (!_runData || _events.length === 0) {
        return { success: false, error: 'No run loaded' };
      }

      const targetIndex = Math.max(0, Math.min(index, _events.length - 1));
      _currentIndex = targetIndex;

      EventBus.emit('replay:seeked', {
        index: _currentIndex,
        event: _events[_currentIndex]
      });

      return { success: true, index: _currentIndex };
    };

    /**
     * Set playback speed
     */
    const setSpeed = (speed) => {
      if (!SPEED_PRESETS.includes(speed)) {
        logger.warn(`[ReplayEngine] Invalid speed: ${speed}, using closest preset`);
        speed = SPEED_PRESETS.reduce((prev, curr) =>
          Math.abs(curr - speed) < Math.abs(prev - speed) ? curr : prev
        );
      }

      _speed = speed;
      EventBus.emit('replay:speed-changed', { speed: _speed });

      // Reschedule if playing
      if (_isPlaying) {
        clearTimeout(_playbackTimer);
        _scheduleNextEvent();
      }

      return { success: true, speed: _speed };
    };

    /**
     * Get current playback state
     */
    const getState = () => ({
      isLoaded: _runData !== null,
      isPlaying: _isPlaying,
      currentIndex: _currentIndex,
      totalEvents: _events.length,
      speed: _speed,
      speedPresets: SPEED_PRESETS,
      progress: _events.length > 0 ? _currentIndex / _events.length : 0,
      currentEvent: _events[_currentIndex] || null,
      metadata: _runData?.metadata || null
    });

    // Private methods
    const _emitCurrentEvent = () => {
      const event = _events[_currentIndex];
      if (event) {
        EventBus.emit('replay:event', {
          index: _currentIndex,
          event: event,
          type: event.type,
          payload: event.payload
        });

        // Re-emit the original event with replay prefix
        EventBus.emit(`replay:${event.type}`, event.payload);
      }
    };

    const _scheduleNextEvent = () => {
      if (!_isPlaying || _currentIndex >= _events.length) {
        if (_currentIndex >= _events.length) {
          _isPlaying = false;
          EventBus.emit('replay:completed', { totalEvents: _events.length });
        }
        return;
      }

      _emitCurrentEvent();
      _currentIndex++;

      if (_currentIndex < _events.length) {
        const currentEvent = _events[_currentIndex - 1];
        const nextEvent = _events[_currentIndex];
        const delay = (nextEvent.ts - currentEvent.ts) / _speed;

        _playbackTimer = setTimeout(_scheduleNextEvent, Math.max(delay, 10));
      } else {
        _isPlaying = false;
        EventBus.emit('replay:completed', { totalEvents: _events.length });
      }
    };

    return {
      loadRun,
      play,
      pause,
      stop,
      step,
      seek,
      setSpeed,
      getState,
      SPEED_PRESETS
    };
  }
};
```

#### Core Responsibilities

1. **Run File Loading**: Parse and validate exported JSON run files
2. **Playback Control**: Play, pause, stop, step-by-step navigation
3. **Speed Control**: Adjustable playback speed (1x, 2x, 5x, 10x, 50x)
4. **Seeking**: Jump to any position in the timeline
5. **Event Re-emission**: Replay events through EventBus with `replay:*` prefix
6. **State Management**: Track playback position, speed, and status

### 3. The Implementation Pathway

#### Step 1: Initialize Private State

```javascript
let _runData = null;      // Loaded run file
let _events = [];         // Event timeline
let _currentIndex = 0;    // Current playback position
let _isPlaying = false;   // Playback state
let _speed = 1;           // Playback multiplier
let _playbackTimer = null; // Scheduled next event

const SPEED_PRESETS = [1, 2, 5, 10, 50];
```

#### Step 2: Implement Run Loading

```javascript
const loadRun = (runData) => {
  // 1. Store run data
  _runData = runData;
  _events = runData.events || [];

  // 2. Reset playback state
  _currentIndex = 0;
  _isPlaying = false;
  clearTimeout(_playbackTimer);

  // 3. Emit loaded event with metadata
  EventBus.emit('replay:loaded', {
    eventCount: _events.length,
    duration: calculateDuration(_events),
    metadata: runData.metadata
  });

  return { success: true, eventCount: _events.length };
};
```

#### Step 3: Implement Playback Controls

```javascript
const play = () => {
  // Validate state
  if (!_runData) return { success: false, error: 'No run loaded' };

  // Handle restart if at end
  if (_currentIndex >= _events.length) _currentIndex = 0;

  _isPlaying = true;
  EventBus.emit('replay:started', { index: _currentIndex, speed: _speed });
  _scheduleNextEvent();
  return { success: true };
};

const pause = () => {
  _isPlaying = false;
  clearTimeout(_playbackTimer);
  EventBus.emit('replay:paused', { index: _currentIndex });
  return { success: true };
};

const stop = () => {
  _isPlaying = false;
  clearTimeout(_playbackTimer);
  _currentIndex = 0;
  EventBus.emit('replay:stopped', {});
  return { success: true };
};
```

#### Step 4: Implement Step and Seek

```javascript
const step = () => {
  if (_currentIndex >= _events.length) {
    return { success: false, error: 'End of timeline' };
  }

  _isPlaying = false;
  clearTimeout(_playbackTimer);
  _emitCurrentEvent();
  _currentIndex++;

  EventBus.emit('replay:stepped', { index: _currentIndex });
  return { success: true, index: _currentIndex };
};

const seek = (index) => {
  const targetIndex = Math.max(0, Math.min(index, _events.length - 1));
  _currentIndex = targetIndex;

  EventBus.emit('replay:seeked', {
    index: _currentIndex,
    event: _events[_currentIndex]
  });

  return { success: true, index: _currentIndex };
};
```

#### Step 5: Implement Speed Control

```javascript
const setSpeed = (speed) => {
  // Snap to nearest preset if invalid
  if (!SPEED_PRESETS.includes(speed)) {
    speed = findClosestPreset(speed);
  }

  _speed = speed;
  EventBus.emit('replay:speed-changed', { speed: _speed });

  // Reschedule next event with new timing
  if (_isPlaying) {
    clearTimeout(_playbackTimer);
    _scheduleNextEvent();
  }

  return { success: true, speed: _speed };
};
```

#### Step 6: Implement Event Scheduling

```javascript
const _scheduleNextEvent = () => {
  if (!_isPlaying || _currentIndex >= _events.length) {
    if (_currentIndex >= _events.length) {
      _isPlaying = false;
      EventBus.emit('replay:completed', { totalEvents: _events.length });
    }
    return;
  }

  _emitCurrentEvent();
  _currentIndex++;

  if (_currentIndex < _events.length) {
    const delay = calculateDelay(_events, _currentIndex, _speed);
    _playbackTimer = setTimeout(_scheduleNextEvent, Math.max(delay, 10));
  }
};

const _emitCurrentEvent = () => {
  const event = _events[_currentIndex];
  if (event) {
    // Emit generic replay event
    EventBus.emit('replay:event', { index: _currentIndex, event });

    // Re-emit with replay prefix for type-specific listeners
    EventBus.emit(`replay:${event.type}`, event.payload);
  }
};
```

### 4. Speed Presets

| Speed | Delay Divisor | Use Case |
|-------|---------------|----------|
| 1x    | 1             | Real-time replay, detailed analysis |
| 2x    | 2             | Quick review of familiar sections |
| 5x    | 5             | Fast scan through events |
| 10x   | 10            | Rapid navigation to area of interest |
| 50x   | 50            | Jump to end, overview scanning |

### 5. Event Bus Integration

#### Emitted Events

| Event | Payload | Description |
|-------|---------|-------------|
| `replay:loaded` | `{ eventCount, duration, metadata }` | Run file loaded |
| `replay:started` | `{ index, speed }` | Playback started |
| `replay:paused` | `{ index }` | Playback paused |
| `replay:stopped` | `{}` | Playback stopped, reset to start |
| `replay:stepped` | `{ index }` | Single step forward |
| `replay:seeked` | `{ index, event }` | Jumped to position |
| `replay:speed-changed` | `{ speed }` | Speed changed |
| `replay:event` | `{ index, event, type, payload }` | Event replayed |
| `replay:completed` | `{ totalEvents }` | Reached end of timeline |
| `replay:{eventType}` | Original payload | Re-emitted original event |

### 6. Run File Format

```javascript
{
  "version": "1.0.0",
  "metadata": {
    "sessionId": "sess_abc123",
    "startTime": 1703500000000,
    "endTime": 1703503600000,
    "agentVersion": "0.1.0",
    "goal": "Implement feature X"
  },
  "events": [
    {
      "id": "evt_001",
      "ts": 1703500000000,
      "type": "agent:cycle-start",
      "payload": { "iteration": 1 }
    },
    {
      "id": "evt_002",
      "ts": 1703500001500,
      "type": "tool:executed",
      "payload": { "tool": "ReadFile", "path": "/core/vfs.js" }
    }
    // ... more events
  ]
}
```

### 7. Operational Safeguards

- **Null-Safe Access**: Check for loaded run before any operation
- **Bounded Index**: Clamp seek position to valid range
- **Timer Cleanup**: Clear timeout on pause/stop to prevent orphaned callbacks
- **Minimum Delay**: Enforce 10ms minimum delay to prevent browser freeze
- **Speed Validation**: Snap to nearest preset for invalid speed values
- **Completion Detection**: Auto-stop and emit event at timeline end

### 8. Widget Interface (Web Component)

```javascript
class ReplayEngineWidget extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this._interval = setInterval(() => this.render(), 250);
  }

  disconnectedCallback() {
    if (this._interval) clearInterval(this._interval);
  }

  set moduleApi(api) {
    this._api = api;
    this.render();
  }

  getStatus() {
    const state = this._api.getState();
    return {
      state: state.isPlaying ? 'active' : (state.isLoaded ? 'idle' : 'inactive'),
      primaryMetric: state.isLoaded ? `${state.currentIndex}/${state.totalEvents}` : 'No run',
      secondaryMetric: `${state.speed}x speed`,
      lastActivity: null
    };
  }

  render() {
    const state = this._api.getState();
    const progress = (state.progress * 100).toFixed(1);

    this.shadowRoot.innerHTML = `
      <style>/* Shadow DOM styles */</style>
      <div class="replay-panel">
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${progress}%"></div>
        </div>
        <div class="controls">
          <button id="play">${state.isPlaying ? '||' : '>'}</button>
          <button id="stop">[]</button>
          <button id="step">>|</button>
        </div>
        <div class="speed-presets">
          ${state.speedPresets.map(s =>
            `<button class="${s === state.speed ? 'active' : ''}" data-speed="${s}">${s}x</button>`
          ).join('')}
        </div>
        <div class="position">${state.currentIndex} / ${state.totalEvents}</div>
      </div>
    `;

    // Attach event listeners
    this.shadowRoot.getElementById('play')?.addEventListener('click', () => {
      state.isPlaying ? this._api.pause() : this._api.play();
    });
    this.shadowRoot.getElementById('stop')?.addEventListener('click', () => this._api.stop());
    this.shadowRoot.getElementById('step')?.addEventListener('click', () => this._api.step());
    this.shadowRoot.querySelectorAll('[data-speed]').forEach(btn => {
      btn.addEventListener('click', () => this._api.setSpeed(parseInt(btn.dataset.speed)));
    });
  }
}

customElements.define('replay-engine-widget', ReplayEngineWidget);
```

### 9. Verification Checklist

- [ ] `loadRun()` parses run file and resets state
- [ ] `play()` starts playback from current position
- [ ] `pause()` stops playback, preserves position
- [ ] `stop()` stops playback, resets to beginning
- [ ] `step()` advances one event without auto-play
- [ ] `seek()` jumps to specified index (clamped)
- [ ] `setSpeed()` changes playback speed, reschedules timer
- [ ] Events emitted through EventBus with `replay:*` prefix
- [ ] Playback respects timing between events
- [ ] Speed multiplier correctly affects delays
- [ ] Completion event emitted at end of timeline
- [ ] Timer cleaned up on pause/stop/component disconnect

### 10. Extension Opportunities

- Add reverse playback (play backwards through timeline)
- Add bookmarks for marking interesting positions
- Add filtering by event type during playback
- Add timeline visualization with event density
- Add comparison mode (side-by-side replay of two runs)
- Add export of replay segment as new run file
- Add keyboard shortcuts for playback controls
- Add event search/filter during playback

---

**Status:** Blueprint

Maintain this blueprint as the replay engine capabilities evolve or new playback features are introduced.
