/**
 * @fileoverview Arena Results - Competition history and score breakdown UI
 */

const ArenaResults = {
  metadata: {
    id: 'ArenaResults',
    version: '1.0.0',
    dependencies: ['Utils', 'EventBus', 'ArenaHarness?'],
    async: false,
    type: 'ui'
  },

  factory: (deps) => {
    const { Utils, EventBus, ArenaHarness } = deps;
    const { logger, escapeHtml, generateId } = Utils;

    const MAX_HISTORY = 20;
    const _history = [];
    let _container = null;
    let _subscriptions = [];

    const formatTime = (ts) => {
      try {
        return new Date(ts).toLocaleTimeString();
      } catch {
        return '';
      }
    };

    const addEntry = (entry) => {
      _history.unshift(entry);
      if (_history.length > MAX_HISTORY) {
        _history.pop();
      }
      render();
    };

    const toAgentEntry = (result) => {
      const solutions = Array.isArray(result?.solutions) ? [...result.solutions] : [];
      solutions.sort((a, b) => (b.score || 0) - (a.score || 0));
      return {
        id: generateId('arena'),
        source: 'agent',
        cycle: result?.cycle || null,
        mode: result?.mode || 'arena',
        winner: result?.winner?.model || solutions[0]?.model || null,
        solutions,
        timestamp: Date.now()
      };
    };

    const toHarnessEntry = (payload) => {
      const results = Array.isArray(payload?.results) ? payload.results : [];
      return {
        id: payload?.runId || generateId('arena'),
        source: 'harness',
        cycle: null,
        mode: 'arena',
        winner: payload?.winner || payload?.summary?.fastestPassing || null,
        summary: payload?.summary || null,
        results,
        timestamp: Date.now()
      };
    };

    const getDiffPair = (entry) => {
      if (entry?.solutions?.length >= 2) {
        const winner = entry.solutions[0];
        const runnerUp = entry.solutions[1];
        return {
          winnerLabel: winner?.model || 'winner',
          winnerContent: winner?.code || winner?.content || '',
          runnerLabel: runnerUp?.model || 'runner-up',
          runnerContent: runnerUp?.code || runnerUp?.content || ''
        };
      }

      if (entry?.results?.length >= 2) {
        const withSolutions = entry.results.filter(r => r.solution);
        if (withSolutions.length >= 2) {
          const winner = withSolutions[0];
          const runnerUp = withSolutions[1];
          return {
            winnerLabel: winner?.competitorName || 'winner',
            winnerContent: winner?.solution || '',
            runnerLabel: runnerUp?.competitorName || 'runner-up',
            runnerContent: runnerUp?.solution || ''
          };
        }
      }

      return null;
    };

    const renderScoreBreakdown = (entry) => {
      if (entry?.solutions?.length) {
        return `
          <div class="arena-score-grid">
            <div class="arena-score-row arena-score-header">
              <span>Model</span>
              <span>Score</span>
              <span>Quality</span>
              <span>Tokens</span>
            </div>
            ${entry.solutions.map(sol => `
              <div class="arena-score-row ${sol.model === entry.winner ? 'winner' : ''}">
                <span>${escapeHtml(sol.model || 'unknown')}</span>
                <span>${(sol.score || 0).toFixed(2)}</span>
                <span>${Number.isFinite(sol.quality) ? sol.quality.toFixed(2) : 'n/a'}</span>
                <span>${Number.isFinite(sol.tokens) ? sol.tokens : 'n/a'}</span>
              </div>
            `).join('')}
          </div>
        `;
      }

      if (entry?.results?.length) {
        return `
          <div class="arena-score-grid">
            <div class="arena-score-row arena-score-header">
              <span>Competitor</span>
              <span>Status</span>
              <span>Time</span>
              <span>Tokens</span>
            </div>
            ${entry.results.map(res => `
              <div class="arena-score-row ${res.competitorName === entry.winner ? 'winner' : ''}">
                <span>${escapeHtml(res.competitorName || 'unknown')}</span>
                <span>${escapeHtml(res.status || 'UNKNOWN')}</span>
                <span>${Number.isFinite(res.executionMs) ? `${res.executionMs}ms` : 'n/a'}</span>
                <span>${Number.isFinite(res.tokenCount) ? res.tokenCount : 'n/a'}</span>
              </div>
            `).join('')}
          </div>
        `;
      }

      return '<div class="arena-empty muted">No score data available</div>';
    };

    const renderDiff = (entry) => {
      const pair = getDiffPair(entry);
      if (!pair) {
        return '<div class="arena-empty muted">Diff unavailable for this run</div>';
      }

      return `
        <div class="arena-diff">
          <div class="arena-diff-column">
            <div class="arena-diff-header">Winner: ${escapeHtml(pair.winnerLabel)}</div>
            <pre>${escapeHtml(pair.winnerContent)}</pre>
          </div>
          <div class="arena-diff-column">
            <div class="arena-diff-header">Runner-up: ${escapeHtml(pair.runnerLabel)}</div>
            <pre>${escapeHtml(pair.runnerContent)}</pre>
          </div>
        </div>
      `;
    };

    const renderEntry = (entry, index) => {
      const canRerun = entry.source === 'harness' && index === 0 && ArenaHarness?.rerunLast;
      const winnerLabel = entry.winner ? escapeHtml(entry.winner) : 'unknown';

      return `
        <div class="arena-entry" data-entry-id="${entry.id}">
          <div class="arena-entry-header">
            <div>
              <div class="arena-entry-title">Run ${entry.cycle ? `#${entry.cycle}` : 'summary'} (${escapeHtml(entry.mode)})</div>
              <div class="arena-entry-meta">Winner: ${winnerLabel} - ${formatTime(entry.timestamp)}</div>
            </div>
            <div class="arena-entry-actions">
              <button class="btn-small" data-action="rerun" data-entry-id="${entry.id}" ${canRerun ? '' : 'disabled'}>
                Re-run
              </button>
            </div>
          </div>
          <div class="arena-entry-body">
            <div class="arena-section">
              <div class="arena-section-title">Score Breakdown</div>
              ${renderScoreBreakdown(entry)}
            </div>
            <div class="arena-section">
              <div class="arena-section-title">Winner and Runner-up</div>
              ${renderDiff(entry)}
            </div>
          </div>
        </div>
      `;
    };

    const render = () => {
      if (!_container) return;
      const count = _history.length;

      _container.innerHTML = `
        <div class="arena-panel-header">
          <div class="arena-title">
            <strong>Arena Results</strong>
            <span class="arena-count">${count} run${count === 1 ? '' : 's'}</span>
          </div>
          <div class="arena-controls">
            <button class="btn-small" data-action="refresh">Refresh</button>
            <button class="btn-small" data-action="clear">Clear</button>
          </div>
        </div>
        <div class="arena-list">
          ${count === 0
            ? '<div class="arena-empty muted">No arena runs yet</div>'
            : _history.map(renderEntry).join('')}
        </div>
      `;
    };

    const handleAction = async (event) => {
      const actionBtn = event.target.closest('[data-action]');
      if (!actionBtn) return;
      const action = actionBtn.dataset.action;
      const entryId = actionBtn.dataset.entryId;
      const entry = _history.find(item => item.id === entryId);

      if (action === 'refresh') {
        render();
        return;
      }

      if (action === 'clear') {
        _history.length = 0;
        render();
        return;
      }

      if (action === 'rerun') {
        if (entry?.source === 'harness' && ArenaHarness?.rerunLast) {
          try {
            await ArenaHarness.rerunLast();
          } catch (err) {
            logger.warn('[ArenaResults] Re-run failed', err.message);
          }
        } else {
          EventBus.emit('arena:rerun-requested', { entryId, source: entry?.source || 'unknown' });
        }
      }
    };

    const init = (containerId) => {
      _container = typeof containerId === 'string'
        ? document.getElementById(containerId)
        : containerId;

      if (!_container) {
        logger.warn('[ArenaResults] Container not found');
        return false;
      }

      _subscriptions.push(EventBus.on('agent:arena-result', (result) => {
        addEntry(toAgentEntry(result));
      }, 'ArenaResults'));

      _subscriptions.push(EventBus.on('arena:complete', (payload) => {
        addEntry(toHarnessEntry(payload));
      }, 'ArenaResults'));

      _container.addEventListener('click', handleAction);

      render();
      logger.info('[ArenaResults] Initialized');
      return true;
    };

    const cleanup = () => {
      _subscriptions.forEach(unsub => {
        if (typeof unsub === 'function') unsub();
      });
      _subscriptions = [];
      if (_container) {
        _container.removeEventListener('click', handleAction);
      }
    };

    return { init, cleanup };
  }
};

export default ArenaResults;
