/**
 * Proto Workers - Worker management panel logic
 * Renders from WorkerManager which persists to VFS
 */

import { formatDuration, formatTimestamp, formatSince, summarizeText } from './utils.js';

export const createWorkerManager = (deps) => {
  const { escapeHtml, WorkerManager } = deps;

  let _lastWorkerUpdate = null;

  const renderWorkerCard = (worker) => {
    const status = worker.status || 'pending';
    const logs = worker.logs || [];
    const logEntries = logs.length === 0
      ? '<li class="worker-log-empty muted">No events yet</li>'
      : logs.map(log => `
          <li>
            <span class="worker-log-time">${formatTimestamp(log.timestamp)}</span>
            <span class="worker-log-text">${escapeHtml(log.message)}</span>
          </li>
        `).join('');
    const openAttr = status === 'running' ? 'open' : '';
    const iterations = worker.iterations ?? worker.result?.iterations ?? 0;
    const duration = status === 'running'
      ? formatDuration(Date.now() - (worker.startTime || Date.now()))
      : formatDuration(worker.duration || worker.result?.duration);
    const toolResults = worker.toolResults || worker.result?.toolResults || [];
    const successCount = toolResults.filter(r => r.success).length;
    const failureCount = toolResults.length - successCount;
    const toolSummary = toolResults.length
      ? `${successCount} success / ${failureCount} failed tool calls`
      : '';
    const output = worker.result?.output || worker.resultOutput;
    const outputBlock = output
      ? `<div class="worker-output">${escapeHtml(summarizeText(output, 220))}</div>`
      : '';
    const errorBlock = worker.error
      ? `<div class="worker-output worker-output-error">${escapeHtml(worker.error)}</div>`
      : '';
    const taskText = worker.task
      ? escapeHtml(summarizeText(worker.task, 200))
      : 'No task recorded';

    return `
      <div class="worker-card worker-${status}">
        <div class="worker-card-header">
          <div>
            <span class="worker-type worker-type-${worker.type || 'unknown'}">${escapeHtml((worker.type || 'unknown').toUpperCase())}</span>
            <span class="worker-id">${escapeHtml(worker.workerId)}</span>
          </div>
          <div class="worker-status">${escapeHtml(status.toUpperCase())}</div>
        </div>
        <div class="worker-task">${taskText}</div>
        <div class="worker-meta">
          <span>${iterations} iters</span>
          <span>${duration}</span>
          ${toolSummary ? `<span>${escapeHtml(toolSummary)}</span>` : ''}
        </div>
        ${outputBlock}
        ${errorBlock}
        <details class="worker-log" ${openAttr}>
          <summary>Events (${logs.length})</summary>
          <ul>
            ${logEntries}
          </ul>
        </details>
      </div>
    `;
  };

  const renderWorkersPanel = () => {
    const activeList = document.getElementById('workers-active-list');
    const completedList = document.getElementById('workers-completed-list');
    if (!activeList || !completedList) return;

    const activeCountEl = document.getElementById('workers-active-count');
    const completedCountEl = document.getElementById('workers-completed-count');
    const lastUpdateEl = document.getElementById('workers-last-update');
    const indicatorEl = document.getElementById('worker-indicator');
    const indicatorCountEl = document.getElementById('worker-indicator-count');
    const clearBtn = document.getElementById('workers-clear-completed');
    const tabBtn = document.getElementById('workers-tab-btn');

    // Get data from WorkerManager (single source of truth)
    const active = WorkerManager ? WorkerManager.list() : [];
    const completedResults = WorkerManager ? WorkerManager.getResults() : [];
    const completed = completedResults
      .sort((a, b) => (b.completedTime || 0) - (a.completedTime || 0));

    if (activeCountEl) activeCountEl.textContent = active.length;
    if (completedCountEl) completedCountEl.textContent = completed.length;
    if (lastUpdateEl) lastUpdateEl.textContent = _lastWorkerUpdate ? formatSince(_lastWorkerUpdate) : '-';
    if (indicatorCountEl) indicatorCountEl.textContent = active.length;
    if (indicatorEl) {
      indicatorEl.classList.toggle('has-workers', active.length > 0);
      indicatorEl.title = active.length > 0
        ? `${active.length} active worker(s) - click to view`
        : 'No active workers';
    }
    if (tabBtn) {
      tabBtn.title = `Workers (${active.length} active)`;
      tabBtn.dataset.count = active.length;
    }
    if (clearBtn) clearBtn.classList.toggle('hidden', completed.length === 0);

    activeList.innerHTML = active.length === 0
      ? '<div class="empty-state">No active workers</div>'
      : active.map(renderWorkerCard).join('');

    completedList.innerHTML = completed.length === 0
      ? '<div class="empty-state">No completed workers yet</div>'
      : completed.slice(0, 8).map(renderWorkerCard).join('');
  };

  const clearCompletedWorkers = async () => {
    if (WorkerManager) {
      await WorkerManager.clearHistory();
    }
    renderWorkersPanel();
  };

  // Event handlers just trigger re-render (WorkerManager is source of truth)
  const handleWorkerSpawned = (data = {}) => {
    _lastWorkerUpdate = Date.now();
    // Add log to WorkerManager
    if (WorkerManager && data.workerId) {
      WorkerManager.addLog(data.workerId, `Spawned ${data.type || 'worker'}`);
    }
    renderWorkersPanel();
  };

  const handleWorkerProgress = (data = {}) => {
    _lastWorkerUpdate = Date.now();
    if (WorkerManager && data.workerId && data.message) {
      WorkerManager.addLog(data.workerId, data.message);
    }
    renderWorkersPanel();
  };

  const handleWorkerCompleted = (data = {}) => {
    _lastWorkerUpdate = Date.now();
    renderWorkersPanel();
  };

  const handleWorkerError = (data = {}) => {
    _lastWorkerUpdate = Date.now();
    renderWorkersPanel();
  };

  const handleWorkerTerminated = (data = {}) => {
    _lastWorkerUpdate = Date.now();
    renderWorkersPanel();
  };

  return {
    renderWorkersPanel,
    clearCompletedWorkers,
    handleWorkerSpawned,
    handleWorkerProgress,
    handleWorkerCompleted,
    handleWorkerError,
    handleWorkerTerminated
  };
};
