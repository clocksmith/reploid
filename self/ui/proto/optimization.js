/**
 * @fileoverview Doppler runtime-profile search and promotion panel.
 */

const DEFAULT_CONTRACT = Object.freeze({
  schema: 'doppler.runtime-optimization-contract/v1',
  contractId: 'reploid-qwen35-2b-decode-grid-v1',
  kind: 'runtime_profile',
  model: {
    modelId: 'qwen-3-5-2b-q4k-ehaf16',
    modelUrl: null,
    expectedExecutionContractHash: null
  },
  baseline: {
    runtimeProfile: null,
    runtimeConfig: {
      inference: {
        session: {
          decodeLoop: {
            batchSize: 4,
            stopCheckMode: 'batch',
            readbackInterval: 4,
            readbackMode: 'sequential',
            ringTokens: 1,
            ringStop: 1,
            ringStaging: 1,
            disableCommandBatching: false
          }
        }
      }
    }
  },
  workload: {
    type: 'inference',
    request: {
      inferenceInput: {
        prompt: 'Explain why deterministic evidence matters in one sentence.',
        maxTokens: 32,
        temperature: 0
      },
      cacheMode: 'warm',
      loadMode: 'opfs'
    }
  },
  mutationPolicy: {
    dimensions: [
      {
        path: '/inference/session/decodeLoop/batchSize',
        values: [2, 4, 8]
      }
    ],
    maxCandidates: 3
  },
  verification: {
    comparisons: [
      { path: 'result.output', mode: 'canonical_exact' }
    ]
  },
  measurement: {
    metricPath: 'result.metrics.decodeTokensPerSec',
    direction: 'maximize',
    pairCount: 5,
    minValidPairs: 5,
    minImprovementPercent: 1,
    requirePositiveConfidence: true,
    maxRelativeStdDevPercent: 8
  }
});

export const createDefaultDopplerOptimizationContract = () => (
  JSON.parse(JSON.stringify(DEFAULT_CONTRACT))
);

const formatPercent = (value) => (
  Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}%` : '-'
);

const formatConfidence = (value) => {
  const low = value?.low;
  const high = value?.high;
  return Number.isFinite(low) && Number.isFinite(high)
    ? `[${low.toFixed(2)}, ${high.toFixed(2)}]%`
    : '-';
};

const formatMagnitudePercent = (value) => (
  Number.isFinite(value) ? `${value.toFixed(2)}%` : '-'
);

const summarizePatch = (candidate) => {
  const patch = Array.isArray(candidate?.patch) ? candidate.patch : [];
  if (patch.length === 0) return '-';
  return patch.map((entry) => (
    `${entry.path.split('/').filter(Boolean).at(-1)}=${JSON.stringify(entry.value)}`
  )).join(', ');
};

export function createDopplerOptimizationManager({
  DopplerOptimizer,
  ToolRunner,
  EventBus,
  Toast,
  logger
}) {
  let root = null;
  let selectedRunId = null;
  let selectedCandidateId = null;
  let refreshQueued = false;
  let refreshEpoch = 0;
  let promotionPending = false;
  const subscriptions = [];

  const byId = (id) => root?.querySelector(`#${id}`) || null;

  const setContractError = (message = '') => {
    const textarea = byId('optimization-contract');
    const error = byId('optimization-contract-error');
    textarea?.classList.toggle('error', Boolean(message));
    if (error) error.textContent = message;
  };

  const selectCandidate = (candidateId) => {
    selectedCandidateId = candidateId || null;
    root?.querySelectorAll('[data-optimization-candidate]').forEach((row) => {
      const selected = row.dataset.optimizationCandidate === selectedCandidateId;
      row.classList.toggle('selected', selected);
      row.setAttribute('aria-selected', String(selected));
    });
  };

  const renderRuns = (runs) => {
    const select = byId('optimization-runs');
    if (!select) return;
    const previous = selectedRunId || select.value;
    select.replaceChildren();
    if (runs.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No runs';
      select.appendChild(option);
      select.disabled = true;
      selectedRunId = null;
      return;
    }
    select.disabled = false;
    for (const run of runs) {
      const option = document.createElement('option');
      option.value = run.runId;
      option.textContent = `${run.runId} | ${run.state}`;
      select.appendChild(option);
    }
    selectedRunId = runs.some((run) => run.runId === previous)
      ? previous
      : runs[0].runId;
    select.value = selectedRunId;
  };

  const renderReceipts = (run) => {
    const body = byId('optimization-candidates');
    const detail = byId('optimization-candidate-detail');
    const promote = byId('optimization-promote');
    if (!body || !detail || !promote) return;
    body.replaceChildren();
    const receipts = Array.isArray(run?.receipts) ? run.receipts : [];
    if (receipts.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 6;
      cell.className = 'muted';
      cell.textContent = run ? 'No completed candidates' : 'No run selected';
      row.appendChild(cell);
      body.appendChild(row);
      detail.textContent = 'Select a completed candidate.';
      promote.disabled = true;
      selectedCandidateId = null;
      return;
    }

    const preferred = selectedCandidateId
      || run?.decision?.selectedCandidateId
      || receipts[0].candidateId;
    if (!receipts.some((receipt) => receipt.candidateId === preferred)) {
      selectedCandidateId = receipts[0].candidateId;
    } else {
      selectedCandidateId = preferred;
    }

    for (const receipt of receipts) {
      const accepted = receipt.decision?.accepted === true;
      const row = document.createElement('tr');
      row.tabIndex = 0;
      row.dataset.optimizationCandidate = receipt.candidateId;
      row.className = accepted ? 'accepted' : 'rejected';
      row.setAttribute('role', 'button');
      row.setAttribute('aria-selected', 'false');
      const values = [
        receipt.candidateId,
        summarizePatch(receipt.candidate),
        accepted ? 'ACCEPT' : 'REJECT',
        formatPercent(receipt.measurement?.improvementPercent?.median),
        formatConfidence(receipt.measurement?.improvementPercent?.confidence95),
        formatMagnitudePercent(receipt.measurement?.candidate?.relativeStdDevPercent)
      ];
      for (const value of values) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.appendChild(cell);
      }
      const choose = () => {
        selectCandidate(receipt.candidateId);
        renderReceipts(run);
      };
      row.addEventListener('click', choose);
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          choose();
        }
      });
      body.appendChild(row);
    }

    selectCandidate(selectedCandidateId);
    const selected = receipts.find((receipt) => receipt.candidateId === selectedCandidateId);
    detail.textContent = JSON.stringify({
      patch: selected?.candidate?.patch || [],
      verification: selected?.verification || null,
      measurement: selected?.measurement || null,
      decision: selected?.decision || null,
      receiptPath: selected?.receiptPath || null
    }, null, 2);
    promote.disabled = promotionPending || selected?.decision?.accepted !== true;
  };

  const refresh = async () => {
    if (!root || !DopplerOptimizer) return;
    const epoch = ++refreshEpoch;
    try {
      const [state, runs, activeProfile] = await Promise.all([
        Promise.resolve(DopplerOptimizer.getState()),
        DopplerOptimizer.listRuns(),
        DopplerOptimizer.getActiveProfile()
      ]);
      if (!root || epoch !== refreshEpoch) return;
      if (state.running && state.runId) selectedRunId = state.runId;
      renderRuns(runs);
      const run = selectedRunId ? await DopplerOptimizer.getRun(selectedRunId) : null;
      if (!root || epoch !== refreshEpoch) return;
      renderReceipts(run);

      const status = byId('optimization-status');
      const active = byId('optimization-active-profile');
      const runButton = byId('optimization-run');
      const stopButton = byId('optimization-stop');
      if (status) {
        const progress = run?.status
          ? `${run.status.completedCandidates}/${run.status.candidateCount}`
          : '0/0';
        status.textContent = state.running
          ? `RUNNING ${progress}`
          : run?.status
            ? `${String(run.status.state).toUpperCase()} ${progress}`
            : 'IDLE';
      }
      if (active) {
        active.textContent = activeProfile?.state === 'active'
          ? `Active: ${activeProfile.candidateId}`
          : activeProfile?.state === 'canary'
            ? `Canary: ${activeProfile.candidateId}`
            : 'Active: base';
      }
      if (runButton) runButton.disabled = state.running;
      if (stopButton) stopButton.disabled = !state.running;
    } catch (error) {
      logger?.warn?.('[Optimization] Refresh failed', error?.message || error);
      const status = byId('optimization-status');
      if (status) status.textContent = 'ERROR';
    }
  };

  const scheduleRefresh = () => {
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(() => {
      refreshQueued = false;
      void refresh();
    });
  };

  const runSearch = async () => {
    const textarea = byId('optimization-contract');
    if (!textarea) return;
    let contract;
    try {
      contract = JSON.parse(textarea.value);
      setContractError('');
    } catch (error) {
      setContractError(`Invalid JSON: ${error.message}`);
      return;
    }
    try {
      const result = await DopplerOptimizer.run(contract);
      selectedRunId = result.runId;
      selectedCandidateId = result.decision?.selectedCandidateId || null;
      Toast?.success?.('Search Complete', `${result.decision?.acceptedCandidateCount || 0} candidates accepted`);
    } catch (error) {
      setContractError(error?.message || String(error));
      Toast?.error?.('Search Failed', error?.message || String(error));
    } finally {
      await refresh();
    }
  };

  const promoteSelected = async () => {
    if (!selectedRunId || !selectedCandidateId || promotionPending) return;
    promotionPending = true;
    const button = byId('optimization-promote');
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
    }
    try {
      const prepared = await DopplerOptimizer.preparePromotion(selectedRunId, selectedCandidateId);
      const promotion = await ToolRunner.execute('Promote', prepared.promoteArgs);
      if (promotion?.promoted !== true) {
        const reason = promotion?.rejected
          ? 'Promotion rejected by user'
          : promotion?.reasons?.join('; ') || promotion?.error || 'Promotion failed';
        throw new Error(reason);
      }
      const activation = await DopplerOptimizer.activatePromotedProfile(prepared, promotion);
      if (!activation.activated) {
        Toast?.error?.('Canary Rejected', activation.rollback?.reason || 'Profile rolled back');
      } else {
        Toast?.success?.('Profile Active', selectedCandidateId);
      }
    } catch (error) {
      Toast?.error?.('Promotion Failed', error?.message || String(error));
    } finally {
      promotionPending = false;
      if (button) button.removeAttribute('aria-busy');
      await refresh();
    }
  };

  const mount = async (container) => {
    root = container;
    const textarea = byId('optimization-contract');
    if (textarea && !textarea.value.trim()) {
      textarea.value = JSON.stringify(createDefaultDopplerOptimizationContract(), null, 2);
    }
    byId('optimization-run')?.addEventListener('click', () => void runSearch());
    byId('optimization-stop')?.addEventListener('click', () => {
      if (DopplerOptimizer.cancel()) Toast?.info?.('Search Stopping', 'Current command will settle first');
    });
    byId('optimization-refresh')?.addEventListener('click', () => void refresh());
    byId('optimization-promote')?.addEventListener('click', () => void promoteSelected());
    byId('optimization-runs')?.addEventListener('change', (event) => {
      selectedRunId = event.target.value || null;
      selectedCandidateId = null;
      void refresh();
    });
    const events = [
      'run-started',
      'candidate-started',
      'candidate-completed',
      'run-completed',
      'run-failed',
      'profile-activated',
      'profile-rolled-back'
    ];
    for (const event of events) {
      subscriptions.push(EventBus.on(`doppler:optimization:${event}`, (detail) => {
        if (detail?.runId) selectedRunId = detail.runId;
        scheduleRefresh();
      }));
    }
    await refresh();
  };

  const cleanup = () => {
    for (const unsubscribe of subscriptions.splice(0)) {
      try { unsubscribe?.(); } catch { /* no-op */ }
    }
    root = null;
    refreshEpoch += 1;
  };

  return { mount, refresh, cleanup };
}
