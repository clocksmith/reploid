# Blueprint 0x000085: Replay Engine

**Objective:** Replay timeline events from exported run files with speed control for debugging and analysis.

**Target Module:** ReplayEngine (`infrastructure/replay-engine.js`)

**Prerequisites:** Utils, EventBus

**Affected Artifacts:** `/infrastructure/replay-engine.js`

---

### 1. The Strategic Imperative

Agent sessions generate timeline events that capture tool executions, state changes, and decisions. The ReplayEngine enables:

- Post-mortem debugging of failed sessions
- Step-by-step analysis of agent behavior
- Variable-speed playback (1x to 50x)
- Pause/resume/seek controls

### 2. The Architectural Solution

The ReplayEngine loads exported run files and re-emits timeline events at controllable speeds:

**Module Structure:**
```javascript
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
    let _events = [];
    let _currentIndex = 0;
    let _speed = 1;
    let _isPlaying = false;
    let _isPaused = false;

    const SPEEDS = [1, 2, 5, 10, 50];

    return {
      loadRun,      // Load exported run data
      play,         // Start/resume playback
      pause,        // Pause playback
      stop,         // Stop and reset
      seek,         // Jump to event index
      setSpeed,     // Change playback speed
      getState      // Get current playback state
    };
  }
};
```

### 3. Run File Format

The ReplayEngine expects exported run files containing:
```javascript
{
  exportedAt: '2024-01-01T00:00:00Z',
  state: { totalCycles: 42, ... },
  vfs: {
    '/.logs/timeline/2024-01-01.jsonl': '...events...',
    // ... other VFS files
  }
}
```

### 4. Event Emission

During playback, events are re-emitted via EventBus:
- `replay:loaded` - Run file parsed, metadata available
- `replay:started` - Playback began
- `replay:paused` - Playback paused
- `replay:stopped` - Playback stopped/completed
- `replay:event` - Each timeline event during playback
- `replay:seek` - Position changed via seek

### 5. API Surface

| Method | Description |
|--------|-------------|
| `loadRun(runData)` | Parse exported run, extract timeline events |
| `play()` | Start or resume playback |
| `pause()` | Pause playback |
| `stop()` | Stop playback, reset to beginning |
| `seek(index)` | Jump to specific event index |
| `setSpeed(multiplier)` | Set playback speed (1, 2, 5, 10, 50) |
| `getState()` | Get current state: `{isPlaying, isPaused, index, total, speed}` |

### 6. Genesis Level

**FULL** - Advanced debugging capability, not required for basic operation.

---

### 7. Speed Control

Events are replayed with timing based on original timestamps:
- `delay = (nextEvent.ts - currentEvent.ts) / speed`
- At 50x speed, a 1-second gap becomes 20ms
- Minimum delay of 10ms to prevent browser blocking
