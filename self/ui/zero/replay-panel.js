/** Read-only run playback and explicit export review, confined to Inspect. */
import { RUN_TRACE_LIMITS, importRunTrace, formatRunReplayFilename } from '../../core/run-replay-bundle.js';
import { listSavedRunTraces, readSavedRunTrace } from '../../infrastructure/telemetry-timeline.js';
import { createTimelinePlayback, REPLAY_SPEEDS } from '../../infrastructure/replay-engine.js';

export function createRunReplayPanel({ escapeHtml, downloadJson, VFS = null }) {
  let root = null;
  let generation = 0;
  let pendingExport = null;
  let pendingFilename = null;
  let displayed = [];
  let renderRevision = 0;
  let renderedRevision = -1;
  const player = createTimelinePlayback({
    onReset: () => { displayed = []; renderRevision++; },
    onEvent: event => { displayed.push(event); renderRevision++; },
    onUpdate: state => {
      if (!root) return;
      root.querySelector('[data-replay-status]').textContent = state.totalEvents
        ? `Replay only: ${state.currentIndex}/${state.totalEvents} events. ${state.isPlaying ? 'Playing' : 'Paused'}. ${state.metadata?.droppedEvents || 0} events omitted by recording limits.`
        : 'Replay only. Import a recorded trace. No model requests or tools run.';
      const seek = root.querySelector('[data-replay-seek]');
      seek.max = state.totalEvents;
      seek.value = state.currentIndex;
      if (renderedRevision !== renderRevision) {
        const open = new Set([...root.querySelectorAll('[data-replay-event][open]')].map(row => row.dataset.replayEvent));
        root.querySelector('[data-replay-events]').innerHTML = displayed.slice(-80).map(event =>
          `<details class="zero-trace-details" data-replay-event="${event.seq}" ${open.has(String(event.seq)) ? 'open' : ''}><summary>${event.seq + 1}. ${escapeHtml(event.type)}${event.data.tool ? `: ${escapeHtml(event.data.tool)}` : ''}</summary><pre>${escapeHtml(JSON.stringify(event, null, 2))}</pre></details>`).join('');
        renderedRevision = renderRevision;
      }
      root.querySelector('[data-replay-provenance]').textContent = JSON.stringify(state.metadata?.provenance || {}, null, 2);
    }
  });
  const message = text => { if (root) root.querySelector('[data-replay-error]').textContent = text; };
  const closePreview = () => {
    pendingExport = null;
    pendingFilename = null;
    if (root) { root.querySelector('[data-replay-preview]').hidden = true; root.querySelector('[data-replay-preview-json]').textContent = ''; }
  };
  const savedRecording = async action => {
    const current = ++generation;
    try {
      if (action === 'refresh-saved') {
        const paths = await listSavedRunTraces(VFS);
        if (!root || current !== generation) return;
        const select = root.querySelector('[data-replay-saved]');
        const selected = select.value;
        select.innerHTML = paths.map(path =>
          `<option value="${escapeHtml(path)}">${escapeHtml(path.split('/').at(-1))}</option>`).join('');
        select.value = paths.includes(selected) ? selected : paths[0] || '';
        message(paths.length ? `${paths.length} saved recordings in this instance. Choose one and load it for playback.` : 'No saved recordings in this instance.');
      } else {
        const path = root.querySelector('[data-replay-saved]').value;
        if (!path) { message('Refresh and choose a saved recording first.'); return; }
        const trace = await readSavedRunTrace(VFS, path);
        if (!root || current !== generation) return;
        player.loadRun(trace);
        message('Saved recording loaded for read-only playback. No model or tool is started.');
      }
    } catch (error) { if (root && current === generation) message(error.message); }
  };
  const click = event => {
    const action = event.target.closest('[data-replay-action]')?.dataset.replayAction;
    if (!action) return;
    event.preventDefault();
    try {
      if (action === 'refresh-saved' || action === 'load-saved') void savedRecording(action);
      if (action === 'play') player.play();
      if (action === 'pause') player.pause();
      if (action === 'restart') player.stop();
      if (action === 'step') player.step();
      if (action === 'cancel-export') closePreview();
      if (action === 'confirm-export' && pendingExport) {
        downloadJson(pendingExport, pendingFilename, { compact: true });
        closePreview();
      }
    } catch (error) { message(error.message); }
  };
  const change = async event => {
    if (event.target.matches('[data-replay-speed]')) { player.setSpeed(Number(event.target.value)); return; }
    if (event.target.matches('[data-replay-seek]')) { player.seek(Number(event.target.value)); return; }
    if (!event.target.matches('[data-replay-import]')) return;
    const file = event.target.files?.[0];
    const current = ++generation;
    event.target.value = '';
    if (!file) return;
    try {
      if (file.size > RUN_TRACE_LIMITS.bytes) throw new Error('Run trace exceeds the 4 MiB import limit.');
      const input = await file.text();
      if (!root || current !== generation) return;
      player.loadRun(input);
      message('Imported for read-only playback. Live conversation and approvals are unchanged.');
    } catch (error) { if (root && current === generation) message(error.message); }
  };
  return {
    mount(element) {
      root = element;
      renderedRevision = -1;
      root.innerHTML = `<div class="zero-label">Recorded playback</div>
        <p data-replay-status role="status">Replay only. Import a recorded trace. No model requests or tools run.</p>
        <label>Import trace JSON <input type="file" accept="application/json,.json" data-replay-import></label>
        ${VFS ? '<div class="zero-actions"><button class="btn" data-replay-action="refresh-saved">Refresh saved</button><label>Saved in this instance <select data-replay-saved aria-label="Saved recording"></select></label><button class="btn" data-replay-action="load-saved">Load saved</button></div><p>Up to 8 recordings are saved locally. A new run never replaces an older recording. Export the current run if storage is full or saving fails.</p>' : ''}
        <div class="zero-actions"><button class="btn" data-replay-action="play">Play</button><button class="btn" data-replay-action="pause">Pause</button><button class="btn" data-replay-action="restart">Restart</button><button class="btn" data-replay-action="step">Step</button>
        <label>Speed <select data-replay-speed>${REPLAY_SPEEDS.map(speed => `<option value="${speed}">${speed}x</option>`).join('')}</select></label></div>
        <label>Seek by event <input type="range" min="0" max="0" value="0" step="1" data-replay-seek></label>
        <p data-replay-error role="status"></p>
        <details><summary>Recorded provenance</summary><pre data-replay-provenance>{}</pre></details>
        <div data-replay-events></div>
        <section data-replay-preview hidden><p>Review before downloading. Visible generated text, tool arguments, results and errors may contain private information. Known credential patterns are redacted; automatic detection is incomplete. Hidden reasoning, system prompts, private request context and raw VFS files are excluded.</p>
        <details><summary>Preview full export JSON</summary><pre data-replay-preview-json></pre></details>
        <button class="btn" data-replay-action="confirm-export">Download reviewed JSON</button><button class="btn" data-replay-action="cancel-export">Cancel</button></section>`;
      root.addEventListener('click', click);
      root.addEventListener('change', change);
    },
    preview(bundle) {
      if (!root) return;
      const trace = importRunTrace(bundle);
      // Export only the reviewed, versioned trace envelope and safe display labels.
      pendingExport = trace;
      pendingFilename = formatRunReplayFilename({ mode: bundle.mode, exportedAt: Date.now() });
      root.querySelector('[data-replay-preview-json]').textContent = JSON.stringify(pendingExport, null, 2);
      root.querySelector('[data-replay-preview]').hidden = false;
      root.querySelector('[data-replay-preview] details').open = true;
      root.querySelector('[data-replay-preview]').scrollIntoView?.({ block: 'nearest' });
    },
    pause: player.pause,
    dispose() {
      generation++;
      player.dispose();
      root?.removeEventListener('click', click);
      root?.removeEventListener('change', change);
      closePreview(); root = null;
    }
  };
}
