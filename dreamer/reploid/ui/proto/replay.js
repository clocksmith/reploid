/**
 * Proto Replay - Replay panel logic
 */

import { formatTimestamp } from './utils.js';

const MAX_EVENT_LOG_ENTRIES = 100;

export const createReplayManager = (deps) => {
  const { logger, escapeHtml, EventBus } = deps;

  let _replayEngineSvc = null;
  let _eventLogEntries = [];

  const resolveReplayEngine = async () => {
    if (_replayEngineSvc) return _replayEngineSvc;
    try {
      _replayEngineSvc = window.REPLOID?.replayEngine
        || (await window.REPLOID_DI?.resolve?.('ReplayEngine'));
    } catch (e) {
      logger.warn('[Proto] ReplayEngine unavailable', e?.message || e);
    }
    return _replayEngineSvc;
  };

  const updateUI = (state) => {
    const statusEl = document.getElementById('replay-status');
    const progressFill = document.getElementById('replay-progress-fill');
    const progressText = document.getElementById('replay-progress-text');
    const playBtn = document.getElementById('replay-play');
    const pauseBtn = document.getElementById('replay-pause');

    if (statusEl) {
      if (!state.metadata) {
        statusEl.textContent = 'No run loaded';
      } else if (state.isPlaying) {
        statusEl.textContent = 'Playing...';
      } else if (state.isPaused) {
        statusEl.textContent = 'Paused';
      } else {
        statusEl.textContent = 'Ready';
      }
    }

    if (progressFill) {
      progressFill.style.width = `${state.percent}%`;
    }

    if (progressText) {
      progressText.textContent = `${state.currentIndex} / ${state.totalEvents}`;
    }

    if (playBtn) {
      playBtn.disabled = state.isPlaying;
    }

    if (pauseBtn) {
      pauseBtn.disabled = !state.isPlaying;
    }
  };

  const renderMetadata = (metadata) => {
    const metadataEl = document.getElementById('replay-metadata');
    const controlsEl = document.getElementById('replay-controls');
    const exportedEl = document.getElementById('replay-exported');
    const cyclesEl = document.getElementById('replay-cycles');
    const eventsEl = document.getElementById('replay-events');
    const filesEl = document.getElementById('replay-files');

    if (metadataEl) metadataEl.classList.remove('hidden');
    if (controlsEl) controlsEl.classList.remove('hidden');

    if (exportedEl) {
      exportedEl.textContent = metadata.exportedAt
        ? new Date(metadata.exportedAt).toLocaleString()
        : '-';
    }
    if (cyclesEl) cyclesEl.textContent = metadata.totalCycles || 0;
    if (eventsEl) eventsEl.textContent = metadata.eventCount || 0;
    if (filesEl) filesEl.textContent = metadata.fileCount || 0;
  };

  const addEventToLog = (event) => {
    _eventLogEntries.push(event);
    if (_eventLogEntries.length > MAX_EVENT_LOG_ENTRIES) {
      _eventLogEntries.shift();
    }
    renderEventLog();
  };

  const clearEventLog = () => {
    _eventLogEntries = [];
    renderEventLog();
  };

  const renderEventLog = () => {
    const logEl = document.getElementById('replay-event-log');
    if (!logEl) return;

    if (_eventLogEntries.length === 0) {
      logEl.innerHTML = '<div class="text-muted">Events will appear here during replay...</div>';
      return;
    }

    const html = _eventLogEntries.slice().reverse().map(event => {
      const typeClass = event.type.startsWith('agent:') ? 'agent'
        : event.type.startsWith('tool:') ? 'tool'
        : event.severity === 'error' ? 'error' : '';

      const activity = event.payload?.activity || event.payload?.state || '';

      return `
        <div class="replay-event ${typeClass}">
          <span class="replay-event-time">${formatTimestamp(event.ts)}</span>
          <span class="replay-event-type">${escapeHtml(event.type)}</span>
          <span class="replay-event-content">${escapeHtml(activity)}</span>
        </div>
      `;
    }).join('');

    logEl.innerHTML = html;
  };

  const loadRunFile = async (file) => {
    const engine = await resolveReplayEngine();
    if (!engine) {
      logger.error('[Replay] ReplayEngine not available');
      return;
    }

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      const { metadata } = engine.loadRun(data);
      renderMetadata(metadata);
      clearEventLog();

      const filenameEl = document.getElementById('replay-filename');
      if (filenameEl) filenameEl.textContent = file.name;

      updateUI(engine.getState());
    } catch (e) {
      logger.error('[Replay] Failed to load run file:', e.message);
    }
  };

  const wireEvents = () => {
    // File input
    const fileInput = document.getElementById('replay-file-input');
    if (fileInput) {
      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) await loadRunFile(file);
      });
    }

    // Playback controls
    const playBtn = document.getElementById('replay-play');
    const pauseBtn = document.getElementById('replay-pause');
    const stepBtn = document.getElementById('replay-step');
    const stopBtn = document.getElementById('replay-stop');
    const speedSelect = document.getElementById('replay-speed-select');

    playBtn?.addEventListener('click', async () => {
      const engine = await resolveReplayEngine();
      if (engine) engine.play();
    });

    pauseBtn?.addEventListener('click', async () => {
      const engine = await resolveReplayEngine();
      if (engine) engine.pause();
    });

    stepBtn?.addEventListener('click', async () => {
      const engine = await resolveReplayEngine();
      if (engine) engine.step();
    });

    stopBtn?.addEventListener('click', async () => {
      const engine = await resolveReplayEngine();
      if (engine) {
        engine.stop();
        clearEventLog();
      }
    });

    speedSelect?.addEventListener('change', async (e) => {
      const engine = await resolveReplayEngine();
      if (engine) engine.setSpeed(parseInt(e.target.value, 10));
    });

    // EventBus listeners for replay events
    if (EventBus) {
      EventBus.on('replay:event', (event) => {
        addEventToLog(event);
      });

      EventBus.on('replay:progress', async () => {
        const engine = await resolveReplayEngine();
        if (engine) updateUI(engine.getState());
      });

      EventBus.on('replay:started', async () => {
        const engine = await resolveReplayEngine();
        if (engine) updateUI(engine.getState());
      });

      EventBus.on('replay:paused', async () => {
        const engine = await resolveReplayEngine();
        if (engine) updateUI(engine.getState());
      });

      EventBus.on('replay:stopped', async () => {
        const engine = await resolveReplayEngine();
        if (engine) updateUI(engine.getState());
      });

      EventBus.on('replay:completed', async () => {
        const engine = await resolveReplayEngine();
        if (engine) updateUI(engine.getState());
        const statusEl = document.getElementById('replay-status');
        if (statusEl) statusEl.textContent = 'Completed';
      });
    }
  };

  return {
    wireEvents,
    loadRunFile,
    updateUI,
    renderEventLog
  };
};
