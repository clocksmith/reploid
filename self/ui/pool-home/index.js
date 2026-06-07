/**
 * @fileoverview Public product home for the verified browser inference pool.
 */

import { createPoolSdk, verifyReceiptRecord } from '../../pool/sdk.js';
import { createDopplerRuntime } from '../../pool/doppler-runtime.js';
import { createAgentClient } from '../../pool/agent-client.js';
import { createProviderClient } from '../../pool/provider-client.js';
import { createRequesterClient } from '../../pool/requester-client.js';
import { LAUNCH_MODEL, buildLaunchProviderModel, getEnabledPoolModelContract, listPoolModels } from '../../pool/model-contract.js';
import { createPoolIdentity } from '../../pool/identity.js';
import { FASTEST_RECEIPT_POLICY_ID, listPolicies } from '../../pool/policy-router.js';

const PRODUCT_ROUTES = Object.freeze({
  '/': 'home',
  '/run': 'run',
  '/contribute': 'contribute',
  '/agents': 'agents',
  '/receipts': 'receipts',
  '/reputation': 'reputation'
});

const PROVIDER_WORKER_INTERVAL_MS = 3000;

const ROUTE_COPY = Object.freeze({
  home: {
    eyebrow: 'Reploid pool',
    title: 'Pool',
    body: ''
  },
  run: {
    eyebrow: 'Submit',
    title: 'Text job',
    body: 'Send text to a browser provider and review the result.'
  },
  contribute: {
    eyebrow: 'Provider',
    title: 'Register a model',
    body: 'Load the launch model in this browser and accept jobs.'
  },
  agents: {
    eyebrow: 'API',
    title: 'SDK calls',
    body: 'Submit jobs, poll status, and accept results from code.'
  },
  receipts: {
    eyebrow: 'Receipt',
    title: 'Receipt lookup',
    body: 'Look up one receipt hash.'
  },
  reputation: {
    eyebrow: 'History',
    title: 'Provider history',
    body: 'Look up points, receipts, failures, and deployment status.'
  }
});

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const getRouteId = () => PRODUCT_ROUTES[window.location.pathname] || 'home';
const isProductPath = (path) => Object.prototype.hasOwnProperty.call(PRODUCT_ROUTES, path);

const firstPresent = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');

const compactHash = (value) => {
  const normalized = String(value || '');
  if (normalized.length <= 24) return normalized;
  return `${normalized.slice(0, 16)}...${normalized.slice(-8)}`;
};

const extractResultSummary = (value = {}) => {
  const job = value.job || value;
  const record = value.receipt || value.record || value;
  const receipt = record.receipt || value.receipt?.receipt || value.receipt || {};
  const verifier = record.verifierDecision || value.verifierDecision || value.localVerification || null;
  const acceptance = record.requesterAcceptance || value.requesterAcceptance || value.acceptance || null;
  const agreement = job.agreement || acceptance?.agreement || value.agreement || null;
  const ring = receipt?.verification?.ring || job.ring || agreement?.ring || null;
  const fields = [
    ['Job', firstPresent(job.jobId, record.jobId, receipt.jobId)],
    ['Receipt', firstPresent(job.receiptHash, record.receiptHash, verifier?.receiptHash, acceptance?.receiptHash)],
    ['Status', firstPresent(job.status, agreement?.status, verifier?.accepted === true ? 'accepted' : verifier?.accepted === false ? 'rejected' : null)],
    ['Trust', firstPresent(job.trustTier, job.effectiveTrustTier, agreement?.effectiveTrustTier, ring?.effectiveTrustTier, receipt?.trustTier)],
    ['Agreement', agreement ? `${agreement.status || 'pending'} ${Number(agreement.requiredAgreement || agreement.requiredProviders || 1)}-of-${Number(agreement.providerCount || agreement.providerIds?.length || 1)}` : null],
    ['Spend', firstPresent(acceptance?.pointSpend, value.pointSpend)],
    ['Runtime', firstPresent(receipt?.verification?.runtimeProfileHash, job.runtimeProfileHash, record.runtimeProfileHash)],
    ['Output', firstPresent(receipt?.outputHash, record.outputHash, job.outputHash)],
    ['Tokens', firstPresent(receipt?.tokenIdsHash, record.tokenIdsHash, job.tokenIdsHash)],
    ['Verifier', verifier ? (verifier.ok === true || verifier.accepted === true ? 'accepted' : verifier.reasons?.length ? verifier.reasons.join('; ') : 'rejected') : null]
  ].filter(([, fieldValue]) => fieldValue !== undefined && fieldValue !== null && fieldValue !== '');
  return fields.slice(0, 10);
};

const renderSummaryRows = (summary) => summary.map(([label, value]) => `
  <span class="pool-summary-item">
    <span class="rgr-status-label">${escapeHtml(label)}</span>
    <span class="rgr-status-value">${escapeHtml(compactHash(value))}</span>
  </span>
`).join('');

const renderResultBox = (id) => `
  <div class="boot-status-strip pool-summary" id="${id}-summary" aria-live="polite"></div>
  <pre class="pool-result" id="${id}" aria-live="polite">{}</pre>
`;

const setResult = (id, value) => {
  const el = document.getElementById(id);
  const summaryEl = document.getElementById(`${id}-summary`);
  if (summaryEl) {
    const summary = value && typeof value === 'object' ? extractResultSummary(value) : [];
    summaryEl.innerHTML = summary.length > 0 ? renderSummaryRows(summary) : '';
  }
  if (el) el.textContent = JSON.stringify(value, null, 2);
};

const renderNav = (activeRoute) => {
  const items = [
    ['/', 'Home'],
    ['/run', 'Submit'],
    ['/contribute', 'Provider'],
    ['/reputation', 'History']
  ];
  return `
    <div class="pool-topbar">
      <nav class="segmented-control pool-nav" aria-label="Pool route toggles">
        ${items.map(([href, label]) => {
          const isActive = activeRoute === PRODUCT_ROUTES[href];
          return `<button class="btn segmented-btn pool-nav-toggle${isActive ? ' is-active' : ''}" type="button" data-pool-route="${href}" aria-pressed="${isActive ? 'true' : 'false'}">${escapeHtml(label)}</button>`;
        }).join('')}
      </nav>
      <a class="pool-zero-link link-secondary" href="/0" title="Open Reploid zero boot console and substrate diagnostics route safely.">Zero</a>
    </div>
  `;
};

const renderPolicyStrip = () => `
  <div class="boot-status-strip pool-policy-strip" aria-label="Launch policy">
    <span class="rgr-status-metric"><span class="rgr-status-label">Model</span><span class="rgr-status-value">${escapeHtml(LAUNCH_MODEL.modelId)}</span></span>
    <span class="rgr-status-metric"><span class="rgr-status-label">Trust</span><span class="rgr-status-value">receipt-backed</span></span>
  </div>
`;

const renderPolicyTrustLabel = (policy) => (
  policy.adaptiveRing ? 'adaptive T1-T4 ring quorum' : policy.trustTier
);

const renderPolicyOptions = () => listPolicies().map((policy) => `
  <option value="${escapeHtml(policy.policyId)}">${escapeHtml(policy.policyId)} - ${escapeHtml(renderPolicyTrustLabel(policy))}</option>
`).join('');

const renderModelOptions = () => listPoolModels().map((model) => {
  const enabled = model.enabled !== false && model.modelHash && model.manifestHash;
  const label = model.label || model.modelId;
  const suffix = enabled ? '' : ` - ${model.unavailableReason || 'not enabled'}`;
  return `<option value="${escapeHtml(model.modelId)}"${enabled ? '' : ' disabled'}>${escapeHtml(`${label}${suffix}`)}</option>`;
}).join('');

const renderHomeSimulation = () => `
  <section class="pool-simulation-shell" aria-label="Browser inference pool simulation">
    <canvas class="pool-simulation-canvas" data-pool-simulation width="1200" height="680"></canvas>
    <div class="pool-simulation-labels" aria-hidden="true">
      <span style="--x: 9%; --y: 46%;" title="The requester sends a text job to the pool.">requester</span>
      <span style="--x: 31%; --y: 34%;" title="The coordinator assigns jobs to matching provider tabs.">coordinator</span>
      <span style="--x: 52%; --y: 18%;" title="The verifier checks receipt hashes and signatures.">verifier</span>
      <span style="--x: 68%; --y: 58%;" title="The ledger records accepted work and points.">ledger</span>
      <span style="--x: 84%; --y: 34%;" title="Provider tabs run local models and return receipts.">provider tabs</span>
    </div>
    <div class="pool-simulation-readout" aria-label="Simulation state">
      <span>tokens</span>
      <span>receipts</span>
      <span><b data-pool-peer-count>0</b> peers online</span>
    </div>
  </section>
`;

const renderRoutePanel = (routeId) => {
  if (routeId === 'home') return renderHomeSimulation();
  const copy = ROUTE_COPY[routeId] || ROUTE_COPY.home;
  return `
    <section class="pool-hero${routeId === 'home' ? ' pool-hero-home' : ''}">
      <div class="pool-hero-copy">
        <p class="pool-eyebrow">${escapeHtml(copy.eyebrow)}</p>
        <h1 class="type-h1">${escapeHtml(copy.title)}</h1>
        <p class="type-caption pool-hero-body">${escapeHtml(copy.body)}</p>
      </div>
    </section>
  `;
};

const renderRouteDetail = (routeId) => {
  if (routeId === 'run') {
    return `
      <section class="panel pool-panel">
        <h2 class="type-h2">Submit text</h2>
        <p class="type-caption">Enter text. The pool assigns a matching provider.</p>
        <div class="pool-form" data-pool-run>
          <label class="pool-field">
            <span>Prompt</span>
            <textarea id="pool-run-prompt" rows="5">Summarize the launch policy in one paragraph.</textarea>
          </label>
          <label class="pool-field">
            <span>Policy</span>
            <select id="pool-run-policy">${renderPolicyOptions()}</select>
          </label>
          <label class="pool-field">
            <span>Model</span>
            <select id="pool-run-model">${renderModelOptions()}</select>
          </label>
          <label class="pool-field">
            <span>Max point spend</span>
            <input id="pool-run-max-spend" type="number" min="0" step="1" placeholder="optional" />
          </label>
          <button class="btn btn-primary" id="pool-run-submit" type="button">Submit job</button>
          <button class="btn btn-ghost" id="pool-run-poll" type="button">Poll job</button>
          <button class="btn btn-ghost" id="pool-run-accept" type="button">Accept receipt</button>
          <button class="btn btn-ghost" id="pool-run-reject" type="button">Reject receipt</button>
          ${renderResultBox('pool-run-result')}
        </div>
      </section>
    `;
  }
  if (routeId === 'contribute') {
    return `
      <section class="panel pool-panel">
        <h2 class="type-h2">Provider</h2>
        <p class="type-caption">Register this browser for the launch model.</p>
        <div class="pool-form" data-pool-provider>
          <label class="pool-field">
            <span>Model</span>
            <select id="pool-provider-model">${renderModelOptions()}</select>
          </label>
          <div class="pool-control-row" aria-label="Provider worker controls">
            <button class="btn btn-primary" id="pool-provider-worker-start" type="button">Start provider tab</button>
            <button class="btn btn-ghost" id="pool-provider-worker-stop" type="button" disabled>Stop</button>
          </div>
          <details class="pool-advanced">
            <summary>Advanced provider controls</summary>
            <div class="pool-control-row" aria-label="Manual provider controls">
              <button class="btn btn-ghost" id="pool-provider-load" type="button">Load Doppler model</button>
              <button class="btn btn-ghost" id="pool-provider-profile" type="button">Runtime profile</button>
              <button class="btn btn-ghost" id="pool-provider-register" type="button">Register provider</button>
              <button class="btn btn-ghost" id="pool-provider-next" type="button">Poll assignment</button>
              <button class="btn btn-ghost" id="pool-provider-execute" type="button">Execute assignment</button>
              <button class="btn btn-ghost" id="pool-provider-step" type="button">Run one provider step</button>
              <button class="btn btn-ghost" id="pool-provider-points" type="button">Provider points</button>
              <button class="btn btn-ghost" id="pool-provider-reputation" type="button">Provider reputation</button>
            </div>
          </details>
          ${renderResultBox('pool-provider-result')}
        </div>
      </section>
    `;
  }
  if (routeId === 'agents') {
    return `
      <section class="panel pool-panel">
        <h2 class="type-h2">Agent</h2>
        <p class="type-caption">The agent client submits jobs, polls status, verifies receipts, and signs acceptance.</p>
        <div class="pool-form" data-pool-agent>
          <label class="pool-field">
            <span>Agent prompt</span>
            <textarea id="pool-agent-prompt" rows="5">Return one concise sentence about receipt-backed browser inference.</textarea>
          </label>
          <label class="pool-field">
            <span>Policy</span>
            <select id="pool-agent-policy">${renderPolicyOptions()}</select>
          </label>
          <label class="pool-field">
            <span>Agent max point spend</span>
            <input id="pool-agent-max-spend" type="number" min="0" step="1" placeholder="optional" />
          </label>
          <button class="btn btn-primary" id="pool-agent-submit" type="button">Submit agent job</button>
          <button class="btn btn-ghost" id="pool-agent-poll" type="button">Poll agent job</button>
          <button class="btn btn-ghost" id="pool-agent-accept" type="button">Accept receipt</button>
          <button class="btn btn-ghost" id="pool-agent-reject" type="button">Reject receipt</button>
          <code>submitJob({ policyId, prompt, modelRequirements })</code>
          <code>pollJob(jobId)</code>
          <code>verifyReceiptRecord(record)</code>
          <code>acceptReceipt(receiptHash)</code>
          ${renderResultBox('pool-agent-result')}
        </div>
      </section>
    `;
  }
  if (routeId === 'receipts') {
    return `
      <section class="panel pool-panel">
        <h2 class="type-h2">Receipt</h2>
        <p class="type-caption">Look up a receipt and verify what the coordinator accepted.</p>
        <div class="pool-form" data-pool-receipts>
          <label class="pool-field">
            <span>Receipt hash</span>
            <input id="pool-receipt-hash" placeholder="sha256:..." />
          </label>
          <button class="btn btn-primary" id="pool-receipt-lookup" type="button">Lookup receipt</button>
          ${renderResultBox('pool-receipt-result')}
        </div>
      </section>
    `;
  }
  if (routeId === 'reputation') {
    return `
      <section class="panel pool-panel">
        <h2 class="type-h2">History</h2>
        <p class="type-caption">Look up provider points, failures, status, and deployment checks.</p>
        <div class="pool-form" data-pool-reputation>
          <label class="pool-field">
            <span>Provider id</span>
            <input id="pool-reputation-provider" placeholder="provider_..." />
          </label>
          <button class="btn btn-primary" id="pool-reputation-lookup" type="button">Lookup provider history</button>
          <button class="btn btn-ghost" id="pool-status-lookup" type="button">Pool status</button>
          <button class="btn btn-ghost" id="pool-metrics-lookup" type="button">Pool metrics</button>
          <button class="btn btn-ghost" id="pool-deployment-check" type="button">Deployment check</button>
          ${renderResultBox('pool-reputation-result')}
        </div>
      </section>
    `;
  }
  return '';
};

const bindRunControls = (sdk) => {
  const button = document.getElementById('pool-run-submit');
  const pollButton = document.getElementById('pool-run-poll');
  const acceptButton = document.getElementById('pool-run-accept');
  const rejectButton = document.getElementById('pool-run-reject');
  const prompt = document.getElementById('pool-run-prompt');
  const policySelect = document.getElementById('pool-run-policy');
  const modelSelect = document.getElementById('pool-run-model');
  const maxSpendInput = document.getElementById('pool-run-max-spend');
  if (!button || !prompt) return;
  const requesterIdentity = createPoolIdentity('requester');
  const requesterClient = createRequesterClient({
    sdk,
    identity: requesterIdentity
  });
  let lastJobId = null;
  let lastReceiptHash = null;
  button.addEventListener('click', async () => {
    button.disabled = true;
    setResult('pool-run-result', { status: 'submitting' });
    try {
      const result = await requesterClient.submitJob({
        prompt: prompt.value,
        policyId: policySelect?.value || FASTEST_RECEIPT_POLICY_ID,
        modelRequirements: getEnabledPoolModelContract(modelSelect?.value || LAUNCH_MODEL.modelId) || LAUNCH_MODEL,
        maxPointSpend: maxSpendInput?.value ? Number(maxSpendInput.value) : null,
        generationConfig: {
          mode: 'greedy',
          temperature: 0,
          topK: 1,
          topP: 1,
          maxOutputTokens: 128,
          seed: '0000000000000000'
        }
      });
      lastJobId = result?.job?.jobId || null;
      lastReceiptHash = result?.job?.receiptHash || null;
      setResult('pool-run-result', result);
    } catch (error) {
      setResult('pool-run-result', { error: error.message, payload: error.payload || null });
    } finally {
      button.disabled = false;
    }
  });
  pollButton?.addEventListener('click', async () => {
    if (!lastJobId) {
      setResult('pool-run-result', { error: 'No submitted job to poll' });
      return;
    }
    pollButton.disabled = true;
    try {
      const result = await requesterClient.pollJob(lastJobId);
      lastReceiptHash = result?.job?.receiptHash || lastReceiptHash;
      setResult('pool-run-result', result);
    } catch (error) {
      setResult('pool-run-result', { error: error.message, payload: error.payload || null });
    } finally {
      pollButton.disabled = false;
    }
  });
  acceptButton?.addEventListener('click', async () => {
    if (!lastReceiptHash) {
      setResult('pool-run-result', { error: 'No verifier-accepted receipt to accept' });
      return;
    }
    acceptButton.disabled = true;
    try {
      setResult('pool-run-result', await requesterClient.acceptReceipt(lastReceiptHash, true));
    } catch (error) {
      setResult('pool-run-result', { error: error.message, payload: error.payload || null });
    } finally {
      acceptButton.disabled = false;
    }
  });
  rejectButton?.addEventListener('click', async () => {
    if (!lastReceiptHash) {
      setResult('pool-run-result', { error: 'No verifier-accepted receipt to reject' });
      return;
    }
    rejectButton.disabled = true;
    try {
      setResult('pool-run-result', await requesterClient.acceptReceipt(lastReceiptHash, false));
    } catch (error) {
      setResult('pool-run-result', { error: error.message, payload: error.payload || null });
    } finally {
      rejectButton.disabled = false;
    }
  });
};

const bindAgentControls = (sdk) => {
  const submitButton = document.getElementById('pool-agent-submit');
  const pollButton = document.getElementById('pool-agent-poll');
  const acceptButton = document.getElementById('pool-agent-accept');
  const rejectButton = document.getElementById('pool-agent-reject');
  const prompt = document.getElementById('pool-agent-prompt');
  const policySelect = document.getElementById('pool-agent-policy');
  const maxSpendInput = document.getElementById('pool-agent-max-spend');
  if (!submitButton || !prompt) return;
  const agentIdentity = createPoolIdentity('agent');
  const agentClient = createAgentClient({
    sdk,
    identity: agentIdentity,
    pointBudget: 0
  });
  let lastJobId = null;
  let lastReceiptHash = null;
  submitButton.addEventListener('click', async () => {
    submitButton.disabled = true;
    setResult('pool-agent-result', { status: 'submitting_agent_job' });
    try {
      const identity = await agentIdentity.resolve();
      const result = await agentClient.submitJob({
        prompt: prompt.value,
        policyId: policySelect?.value || FASTEST_RECEIPT_POLICY_ID,
        maxPointSpend: maxSpendInput?.value ? Number(maxSpendInput.value) : null
      });
      lastJobId = result?.job?.jobId || null;
      lastReceiptHash = result?.job?.receiptHash || null;
      setResult('pool-agent-result', { identity, ...result });
    } catch (error) {
      setResult('pool-agent-result', { error: error.message, payload: error.payload || null });
    } finally {
      submitButton.disabled = false;
    }
  });
  pollButton?.addEventListener('click', async () => {
    if (!lastJobId) {
      setResult('pool-agent-result', { error: 'No submitted agent job to poll' });
      return;
    }
    pollButton.disabled = true;
    try {
      const result = await agentClient.pollJob(lastJobId);
      lastReceiptHash = result?.job?.receiptHash || lastReceiptHash;
      setResult('pool-agent-result', result);
    } catch (error) {
      setResult('pool-agent-result', { error: error.message, payload: error.payload || null });
    } finally {
      pollButton.disabled = false;
    }
  });
  acceptButton?.addEventListener('click', async () => {
    if (!lastReceiptHash) {
      setResult('pool-agent-result', { error: 'No verifier-accepted receipt to accept' });
      return;
    }
    acceptButton.disabled = true;
    try {
      setResult('pool-agent-result', await agentClient.acceptReceipt(lastReceiptHash, true));
    } catch (error) {
      setResult('pool-agent-result', { error: error.message, payload: error.payload || null });
    } finally {
      acceptButton.disabled = false;
    }
  });
  rejectButton?.addEventListener('click', async () => {
    if (!lastReceiptHash) {
      setResult('pool-agent-result', { error: 'No verifier-accepted receipt to reject' });
      return;
    }
    rejectButton.disabled = true;
    try {
      setResult('pool-agent-result', await agentClient.acceptReceipt(lastReceiptHash, false));
    } catch (error) {
      setResult('pool-agent-result', { error: error.message, payload: error.payload || null });
    } finally {
      rejectButton.disabled = false;
    }
  });
};

const bindProviderControls = (sdk) => {
  const loadButton = document.getElementById('pool-provider-load');
  const profileButton = document.getElementById('pool-provider-profile');
  const registerButton = document.getElementById('pool-provider-register');
  const nextButton = document.getElementById('pool-provider-next');
  const executeButton = document.getElementById('pool-provider-execute');
  const stepButton = document.getElementById('pool-provider-step');
  const workerStartButton = document.getElementById('pool-provider-worker-start');
  const workerStopButton = document.getElementById('pool-provider-worker-stop');
  const pointsButton = document.getElementById('pool-provider-points');
  const reputationButton = document.getElementById('pool-provider-reputation');
  const modelInput = document.getElementById('pool-provider-model');
  if (!registerButton || !nextButton || !modelInput) return;
  const providerIdentity = createPoolIdentity('provider');
  const runtime = window.REPLOID_DOPPLER_RUNTIME || createDopplerRuntime();
  window.REPLOID_DOPPLER_RUNTIME = runtime;
  const providerClient = createProviderClient({
    sdk,
    runtime,
    identity: providerIdentity
  });
  const getProviderModel = () => ({
    ...buildLaunchProviderModel({ modelId: modelInput.value || LAUNCH_MODEL.modelId })
  });
  const modelMatchesLoadedRuntime = (model = {}) => {
    const loaded = typeof runtime?.getModelInfo === 'function' ? runtime.getModelInfo() : null;
    return !!loaded
      && loaded.modelId === model.modelId
      && loaded.modelHash === model.modelHash
      && loaded.manifestHash === model.manifestHash
      && loaded.runtime === model.runtime
      && loaded.backend === model.backend;
  };
  const loadSelectedProviderModel = async () => {
    const model = getEnabledPoolModelContract(modelInput.value || LAUNCH_MODEL.modelId);
    if (!model) throw new Error('Selected model is not enabled for provider registration');
    if (modelMatchesLoadedRuntime(model) && runtime.isReady?.()) {
      return {
        ok: true,
        status: 'model_loaded',
        model: runtime.getModelInfo()
      };
    }
    const loadResult = await runtime.loadModel(model);
    if (!loadResult?.ok || !runtime.isReady?.() || !modelMatchesLoadedRuntime(model)) {
      const reason = loadResult?.reason || 'Doppler runtime did not expose the selected model after load';
      const error = new Error(`Doppler model load failed: ${reason}`);
      error.payload = {
        model,
        loadResult,
        loadState: runtime.getLoadState?.() || null
      };
      throw error;
    }
    return {
      ...loadResult,
      status: 'model_loaded'
    };
  };
  const ensureProviderReady = async () => {
    const loaded = await loadSelectedProviderModel();
    const model = loaded.model || runtime.getModelInfo();
    const providerIdentityState = await providerIdentity.resolve();
    const result = await providerClient.register({
      models: [model],
      device: {
        hasWebGPU: !!navigator.gpu,
        browserSurface: 'pool_provider_ui'
      },
      availability: {
        maxConcurrentJobs: 1,
        maxTokensPerJob: 128,
        acceptedPolicies: listPolicies().map((policy) => policy.policyId)
      },
    });
    return {
      identity: providerIdentityState,
      registration: result
    };
  };
  let lastAssignment = null;
  let workerRunning = false;
  let workerTimer = null;
  const syncWorkerButtons = () => {
    if (workerStartButton) workerStartButton.disabled = workerRunning;
    if (workerStopButton) workerStopButton.disabled = !workerRunning;
  };
  const stopWorker = () => {
    workerRunning = false;
    if (workerTimer) window.clearTimeout(workerTimer);
    workerTimer = null;
    syncWorkerButtons();
  };
  const runWorkerLoop = async () => {
    if (!workerRunning) return;
    try {
      const result = await providerClient.runWorkerStep();
      lastAssignment = result?.status === 'executed_assignment' ? null : result?.assignment || lastAssignment;
      setResult('pool-provider-result', {
        worker: 'running',
        ...result
      });
      if (workerRunning) {
        workerTimer = window.setTimeout(runWorkerLoop, PROVIDER_WORKER_INTERVAL_MS);
      }
    } catch (error) {
      stopWorker();
      setResult('pool-provider-result', { worker: 'stopped', error: error.message, payload: error.payload || null });
    }
  };
  loadButton?.addEventListener('click', async () => {
    loadButton.disabled = true;
    setResult('pool-provider-result', { status: 'loading_model', model: getProviderModel() });
    try {
      setResult('pool-provider-result', await loadSelectedProviderModel());
    } catch (error) {
      setResult('pool-provider-result', { error: error.message, payload: error.payload || null });
    } finally {
      loadButton.disabled = false;
    }
  });
  profileButton?.addEventListener('click', async () => {
    profileButton.disabled = true;
    try {
      const runtimeProfile = typeof runtime.getRuntimeProfile === 'function'
        ? await runtime.getRuntimeProfile()
        : { error: 'runtime profile unavailable' };
      setResult('pool-provider-result', runtimeProfile);
    } catch (error) {
      setResult('pool-provider-result', { error: error.message, payload: error.payload || null });
    } finally {
      profileButton.disabled = false;
    }
  });
  registerButton.addEventListener('click', async () => {
    registerButton.disabled = true;
    try {
      setResult('pool-provider-result', { status: 'registering', model: getProviderModel() });
      setResult('pool-provider-result', await ensureProviderReady());
    } catch (error) {
      setResult('pool-provider-result', { error: error.message, payload: error.payload || null });
    } finally {
      registerButton.disabled = false;
    }
  });
  nextButton.addEventListener('click', async () => {
    nextButton.disabled = true;
    try {
      const result = await providerClient.nextAssignment();
      lastAssignment = result?.assignment || null;
      setResult('pool-provider-result', result);
    } catch (error) {
      setResult('pool-provider-result', { error: error.message, payload: error.payload || null });
    } finally {
      nextButton.disabled = false;
    }
  });
  executeButton?.addEventListener('click', async () => {
    if (!lastAssignment) {
      setResult('pool-provider-result', { error: 'No assignment to execute' });
      return;
    }
    executeButton.disabled = true;
    try {
      setResult('pool-provider-result', await providerClient.executeAssignment(lastAssignment, {
        commitReveal: 'auto'
      }));
      lastAssignment = null;
    } catch (error) {
      setResult('pool-provider-result', { error: error.message, payload: error.payload || null });
    } finally {
      executeButton.disabled = false;
    }
  });
  stepButton?.addEventListener('click', async () => {
    stepButton.disabled = true;
    try {
      const result = await providerClient.runWorkerStep();
      lastAssignment = result?.status === 'executed_assignment' ? null : result?.assignment || lastAssignment;
      setResult('pool-provider-result', result);
    } catch (error) {
      setResult('pool-provider-result', { error: error.message, payload: error.payload || null });
    } finally {
      stepButton.disabled = false;
    }
  });
  workerStartButton?.addEventListener('click', async () => {
    if (workerRunning) return;
    workerStartButton.disabled = true;
    setResult('pool-provider-result', { worker: 'registering', model: getProviderModel() });
    try {
      const ready = await ensureProviderReady();
      workerRunning = true;
      syncWorkerButtons();
      setResult('pool-provider-result', { worker: 'running', ...ready });
      await runWorkerLoop();
    } catch (error) {
      stopWorker();
      setResult('pool-provider-result', { worker: 'stopped', error: error.message, payload: error.payload || null });
    } finally {
      syncWorkerButtons();
    }
  });
  workerStopButton?.addEventListener('click', () => {
    stopWorker();
    setResult('pool-provider-result', { worker: 'stopped' });
  });
  pointsButton?.addEventListener('click', async () => {
    pointsButton.disabled = true;
    try {
      const identity = await providerIdentity.resolve();
      setResult('pool-provider-result', await sdk.points(identity.roleId));
    } catch (error) {
      setResult('pool-provider-result', { error: error.message, payload: error.payload || null });
    } finally {
      pointsButton.disabled = false;
    }
  });
  reputationButton?.addEventListener('click', async () => {
    reputationButton.disabled = true;
    try {
      const identity = await providerIdentity.resolve();
      setResult('pool-provider-result', await sdk.reputation(identity.roleId));
    } catch (error) {
      setResult('pool-provider-result', { error: error.message, payload: error.payload || null });
    } finally {
      reputationButton.disabled = false;
    }
  });
};

const bindReceiptControls = (sdk) => {
  const button = document.getElementById('pool-receipt-lookup');
  const input = document.getElementById('pool-receipt-hash');
  if (!button || !input) return;
  button.addEventListener('click', async () => {
    const receiptHash = input.value.trim();
    if (!receiptHash) {
      setResult('pool-receipt-result', { error: 'Receipt hash is required' });
      return;
    }
    button.disabled = true;
    try {
      const record = await sdk.getReceipt(receiptHash);
      setResult('pool-receipt-result', {
        ...record,
        localVerification: await verifyReceiptRecord(record)
      });
    } catch (error) {
      setResult('pool-receipt-result', { error: error.message, payload: error.payload || null });
    } finally {
      button.disabled = false;
    }
  });
};

const bindReputationControls = (sdk) => {
  const button = document.getElementById('pool-reputation-lookup');
  const statusButton = document.getElementById('pool-status-lookup');
  const metricsButton = document.getElementById('pool-metrics-lookup');
  const deploymentButton = document.getElementById('pool-deployment-check');
  const input = document.getElementById('pool-reputation-provider');
  if (!button || !input) return;
  const providerIdentity = createPoolIdentity('provider');
  providerIdentity.resolve().then((identity) => {
    input.value = identity.roleId;
  }).catch(() => {});
  button.addEventListener('click', async () => {
    const providerId = input.value.trim();
    if (!providerId) {
      setResult('pool-reputation-result', { error: 'Provider id is required' });
      return;
    }
    button.disabled = true;
    try {
      setResult('pool-reputation-result', await sdk.reputation(providerId));
    } catch (error) {
      setResult('pool-reputation-result', { error: error.message, payload: error.payload || null });
    } finally {
      button.disabled = false;
    }
  });
  metricsButton?.addEventListener('click', async () => {
    metricsButton.disabled = true;
    try {
      setResult('pool-reputation-result', await sdk.metrics());
    } catch (error) {
      setResult('pool-reputation-result', { error: error.message, payload: error.payload || null });
    } finally {
      metricsButton.disabled = false;
    }
  });
  statusButton?.addEventListener('click', async () => {
    statusButton.disabled = true;
    try {
      setResult('pool-reputation-result', await sdk.status());
    } catch (error) {
      setResult('pool-reputation-result', { error: error.message, payload: error.payload || null });
    } finally {
      statusButton.disabled = false;
    }
  });
  deploymentButton?.addEventListener('click', async () => {
    deploymentButton.disabled = true;
    try {
      setResult('pool-reputation-result', await sdk.deploymentCheck());
    } catch (error) {
      setResult('pool-reputation-result', { error: error.message, payload: error.payload || null });
    } finally {
      deploymentButton.disabled = false;
    }
  });
};

const compilePoolShader = (gl, type, source) => {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'unknown shader error';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
};

const createPoolProgram = (gl, vertexSource, fragmentSource) => {
  const vertex = compilePoolShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compilePoolShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'unknown program error';
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
};

const createPoolSimulationState = () => {
  const peers = Array.from({ length: 7 }, (_, index) => ({
    index,
    x: 0.78 + (index % 3) * 0.075,
    y: 0.18 + index * 0.105,
    phase: index * 1.7,
    size: 9 + (index % 3) * 2,
    presence: 1,
    targetOnline: true,
    lineDraw: 1,
    pulse: 0
  }));
  const particles = Array.from({ length: 72 }, (_, index) => ({
    index,
    offset: (index * 0.137) % 1,
    speed: 0.055 + (index % 5) * 0.012,
    route: index % 3,
    peerIndex: index % peers.length,
    size: 3 + (index % 4)
  }));
  return {
    peers,
    particles,
    pointer: { x: 0.5, y: 0.5, active: false, force: 0 },
    startedAt: performance.now()
  };
};

const resizePoolCanvas = (canvas) => {
  const box = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(box.width * ratio));
  const height = Math.max(1, Math.floor(box.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height, ratio };
};

const interpolatePoint = (a, b, amount) => ({
  x: a.x + (b.x - a.x) * amount,
  y: a.y + (b.y - a.y) * amount
});

const resolvePathPoint = (path, amount) => {
  if (path.length === 1) return path[0];
  const scaled = Math.max(0, Math.min(0.999, amount)) * (path.length - 1);
  const index = Math.floor(scaled);
  return interpolatePoint(path[index], path[index + 1], scaled - index);
};

const easeOutCubic = (value) => {
  const bounded = Math.max(0, Math.min(1, value));
  return 1 - Math.pow(1 - bounded, 3);
};

const makeSimulationLine = (from, to, alpha, draw = 1, pulse = 0) => [
  from,
  to,
  alpha,
  easeOutCubic(draw),
  pulse
];

const buildPoolSimulationFrame = (state, width, height, timestamp) => {
  const time = (timestamp - state.startedAt) / 1000;
  state.pointer.force *= 0.94;
  const roles = {
    requester: { x: width * 0.12, y: height * 0.51, size: 16, alpha: 1 },
    coordinator: { x: width * 0.34, y: height * 0.42, size: 18, alpha: 1 },
    verifier: { x: width * 0.55, y: height * 0.30, size: 15, alpha: 1 },
    ledger: { x: width * 0.70, y: height * 0.60, size: 14, alpha: 1 }
  };
  const pointerX = state.pointer.x * width;
  const pointerY = state.pointer.y * height;
  const peers = state.peers.map((peer) => {
    const onlineWave = Math.sin(time * 0.55 + peer.phase);
    const targetOnline = onlineWave > -0.62;
    if (targetOnline !== peer.targetOnline) {
      peer.targetOnline = targetOnline;
      peer.pulse = 1;
    }
    peer.presence += ((targetOnline ? 1 : 0) - peer.presence) * 0.035;
    peer.lineDraw += ((peer.presence > 0.16 ? 1 : 0) - peer.lineDraw) * 0.045;
    peer.pulse *= 0.925;
    const baseX = width * peer.x;
    const baseY = height * peer.y;
    const dx = baseX - pointerX;
    const dy = baseY - pointerY;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const pointerLift = state.pointer.active || state.pointer.force > 0.02
      ? Math.max(0, 1 - distance / (width * 0.34)) * (18 + state.pointer.force * 30)
      : 0;
    return {
      ...peer,
      online: peer.presence > 0.22,
      x: baseX + Math.cos(time * 0.7 + peer.phase) * 8 + (dx / distance) * pointerLift,
      y: baseY + Math.sin(time * 0.6 + peer.phase) * 8 + (dy / distance) * pointerLift,
      alpha: 0.08 + peer.presence * 0.84,
      size: 5 + peer.presence * peer.size + Math.max(0, onlineWave) * 3 + peer.pulse * 8,
      presence: peer.presence,
      lineDraw: peer.lineDraw,
      pulse: peer.pulse
    };
  });
  const onlinePeers = peers.filter((peer) => peer.online);
  const peerFor = (index) => onlinePeers[index % Math.max(1, onlinePeers.length)] || peers[index % peers.length];
  const corePulse = (phase) => 0.14 + 0.18 * (Math.sin(time * 2.4 + phase) * 0.5 + 0.5);
  const lines = [
    makeSimulationLine(roles.requester, roles.coordinator, 0.28, 1, corePulse(0)),
    makeSimulationLine(roles.coordinator, roles.verifier, 0.18, 1, corePulse(1)),
    makeSimulationLine(roles.verifier, roles.ledger, 0.35, 1, corePulse(2)),
    makeSimulationLine(roles.verifier, roles.requester, 0.12, 1, corePulse(3)),
    ...peers.map((peer) => makeSimulationLine(
      roles.coordinator,
      peer,
      0.05 + peer.presence * 0.18,
      peer.lineDraw,
      peer.pulse
    )),
    ...peers.map((peer) => makeSimulationLine(
      peer,
      roles.verifier,
      0.04 + peer.presence * 0.14,
      peer.lineDraw,
      peer.pulse * 0.8
    ))
  ];
  const particles = state.particles.map((particle) => {
    const peer = peerFor(particle.peerIndex);
    const flowPulse = Math.sin(time * 7 + particle.index * 0.9) * 0.5 + 0.5;
    const progress = (particle.offset + time * particle.speed * (1 + peer.presence * 0.35) + state.pointer.force * 0.06) % 1;
    const path = particle.route === 0
      ? [roles.requester, roles.coordinator, peer]
      : particle.route === 1
        ? [peer, roles.coordinator, roles.requester]
        : [peer, roles.verifier, roles.ledger];
    const point = resolvePathPoint(path, progress);
    return {
      x: point.x,
      y: point.y,
      size: particle.size + (particle.route === 2 ? 2 : 0) + flowPulse * 2 + peer.pulse * 3,
      alpha: 0.05 + peer.presence * (0.42 + flowPulse * 0.36)
    };
  });
  return {
    lines,
    nodes: [roles.requester, roles.coordinator, roles.verifier, roles.ledger, ...peers],
    particles,
    peerCount: onlinePeers.length
  };
};

const drawPoolSimulation2D = (ctx, frame, width, height) => {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.lineWidth = 1;
  for (const [a, b, alpha, draw = 1, pulse = 0] of frame.lines) {
    const end = interpolatePoint(a, b, draw);
    ctx.strokeStyle = `rgba(0, 0, 0, ${alpha})`;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    if (pulse > 0.02) {
      const pulsePoint = interpolatePoint(a, end, 0.5 + Math.sin(pulse * Math.PI) * 0.34);
      ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(0.65, alpha + pulse * 0.32)})`;
      ctx.beginPath();
      ctx.arc(pulsePoint.x, pulsePoint.y, 3 + pulse * 9, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (const particle of frame.particles) {
    ctx.fillStyle = `rgba(0, 0, 0, ${particle.alpha})`;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const node of frame.nodes) {
    ctx.strokeStyle = `rgba(0, 0, 0, ${node.alpha})`;
    ctx.fillStyle = `rgba(0, 0, 0, ${node.alpha * 0.88})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.size, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(node.x, node.y, Math.max(2, node.size * 0.28), 0, Math.PI * 2);
    ctx.fill();
  }
};

const createPoolWebGLRenderer = (canvas) => {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false })
    || canvas.getContext('experimental-webgl', { antialias: true, alpha: false });
  if (!gl) return null;
  const lineProgram = createPoolProgram(gl, `
    attribute vec2 a_position;
    attribute float a_alpha;
    uniform vec2 u_resolution;
    varying float v_alpha;
    void main() {
      vec2 zeroToOne = a_position / u_resolution;
      vec2 clipSpace = zeroToOne * 2.0 - 1.0;
      gl_Position = vec4(clipSpace * vec2(1.0, -1.0), 0.0, 1.0);
      v_alpha = a_alpha;
    }
  `, `
    precision mediump float;
    varying float v_alpha;
    void main() {
      gl_FragColor = vec4(0.0, 0.0, 0.0, v_alpha);
    }
  `);
  const pointProgram = createPoolProgram(gl, `
    attribute vec2 a_position;
    attribute float a_alpha;
    attribute float a_size;
    uniform vec2 u_resolution;
    varying float v_alpha;
    void main() {
      vec2 zeroToOne = a_position / u_resolution;
      vec2 clipSpace = zeroToOne * 2.0 - 1.0;
      gl_Position = vec4(clipSpace * vec2(1.0, -1.0), 0.0, 1.0);
      gl_PointSize = a_size;
      v_alpha = a_alpha;
    }
  `, `
    precision mediump float;
    varying float v_alpha;
    void main() {
      vec2 coord = gl_PointCoord - vec2(0.5);
      float dist = length(coord);
      if (dist > 0.5) discard;
      float edge = smoothstep(0.5, 0.22, dist);
      gl_FragColor = vec4(0.0, 0.0, 0.0, v_alpha * edge);
    }
  `);
  const lineBuffer = gl.createBuffer();
  const pointBuffer = gl.createBuffer();
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  return (frame, width, height) => {
    gl.viewport(0, 0, width, height);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const lineData = [];
    const linePulseData = [];
    for (const [a, b, alpha, draw = 1, pulse = 0] of frame.lines) {
      const end = interpolatePoint(a, b, draw);
      lineData.push(a.x, a.y, alpha, end.x, end.y, alpha);
      if (pulse > 0.02) {
        const pulsePoint = interpolatePoint(a, end, 0.5 + Math.sin(pulse * Math.PI) * 0.34);
        linePulseData.push(pulsePoint.x, pulsePoint.y, Math.min(0.65, alpha + pulse * 0.32), 8 + pulse * 18);
      }
    }
    gl.useProgram(lineProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lineData), gl.DYNAMIC_DRAW);
    let location = gl.getAttribLocation(lineProgram, 'a_position');
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 12, 0);
    location = gl.getAttribLocation(lineProgram, 'a_alpha');
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 1, gl.FLOAT, false, 12, 8);
    gl.uniform2f(gl.getUniformLocation(lineProgram, 'u_resolution'), width, height);
    gl.drawArrays(gl.LINES, 0, lineData.length / 3);

    const pointData = [];
    for (const particle of frame.particles) pointData.push(particle.x, particle.y, particle.alpha, particle.size);
    pointData.push(...linePulseData);
    for (const node of frame.nodes) pointData.push(node.x, node.y, node.alpha, node.size * 2);
    gl.useProgram(pointProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, pointBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pointData), gl.DYNAMIC_DRAW);
    location = gl.getAttribLocation(pointProgram, 'a_position');
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 16, 0);
    location = gl.getAttribLocation(pointProgram, 'a_alpha');
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 1, gl.FLOAT, false, 16, 8);
    location = gl.getAttribLocation(pointProgram, 'a_size');
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 1, gl.FLOAT, false, 16, 12);
    gl.uniform2f(gl.getUniformLocation(pointProgram, 'u_resolution'), width, height);
    gl.drawArrays(gl.POINTS, 0, pointData.length / 4);
  };
};

const bindHomeSimulation = (mount) => {
  const canvas = mount.querySelector('[data-pool-simulation]');
  if (!canvas) return;
  if (window.REPLOID_POOL_SIMULATION_STOP) {
    window.REPLOID_POOL_SIMULATION_STOP();
    window.REPLOID_POOL_SIMULATION_STOP = null;
  }
  const state = createPoolSimulationState();
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  let active = true;
  let frameId = null;
  let renderer = null;
  let ctx = null;
  try {
    renderer = createPoolWebGLRenderer(canvas);
  } catch {
    renderer = null;
  }
  if (!renderer) ctx = canvas.getContext('2d');
  const readout = mount.querySelector('.pool-simulation-readout');
  const draw = (timestamp = performance.now()) => {
    if (!active) return;
    const { width, height } = resizePoolCanvas(canvas);
    const frame = buildPoolSimulationFrame(state, width, height, timestamp);
    if (renderer) renderer(frame, width, height);
    else if (ctx) drawPoolSimulation2D(ctx, frame, width, height);
    if (readout) {
      readout.dataset.peers = String(frame.peerCount);
      readout.setAttribute('aria-label', `tokens, receipts, ${frame.peerCount} peers online`);
      const peerCount = readout.querySelector('[data-pool-peer-count]');
      if (peerCount) peerCount.textContent = String(frame.peerCount);
    }
    if (!reducedMotion) frameId = window.requestAnimationFrame(draw);
  };
  const movePointer = (event) => {
    const box = canvas.getBoundingClientRect();
    state.pointer.x = (event.clientX - box.left) / Math.max(1, box.width);
    state.pointer.y = (event.clientY - box.top) / Math.max(1, box.height);
    state.pointer.active = true;
    state.pointer.force = Math.min(1, state.pointer.force + 0.04);
  };
  const leavePointer = () => {
    state.pointer.active = false;
  };
  const pulsePointer = (event) => {
    movePointer(event);
    state.pointer.force = 1;
  };
  canvas.addEventListener('pointermove', movePointer);
  canvas.addEventListener('pointerdown', pulsePointer);
  canvas.addEventListener('pointerleave', leavePointer);
  window.REPLOID_POOL_SIMULATION_STOP = () => {
    active = false;
    if (frameId) window.cancelAnimationFrame(frameId);
    canvas.removeEventListener('pointermove', movePointer);
    canvas.removeEventListener('pointerdown', pulsePointer);
    canvas.removeEventListener('pointerleave', leavePointer);
  };
  draw();
};

const bindPoolRouteControls = (mount, render) => {
  mount.querySelectorAll('[data-pool-route], [data-pool-route-link]').forEach((control) => {
    control.addEventListener('click', (event) => {
      const path = control.dataset.poolRoute || control.dataset.poolRouteLink || control.getAttribute('href');
      if (!isProductPath(path)) return;
      event.preventDefault();
      if (window.location.pathname !== path) {
        window.history.pushState({ reploidPoolRoute: path }, '', path);
      }
      render();
    });
  });
};

export function initPoolHome(mount) {
  if (!mount) return;
  const sdk = createPoolSdk();
  const runtime = window.REPLOID_DOPPLER_RUNTIME || createDopplerRuntime();
  window.REPLOID_DOPPLER_RUNTIME = runtime;
  window.REPLOID_POOL_ATTACH_DOPPLER_HANDLE = (handle, model = null, runtimeInfo = null) => runtime.attachHandle(handle, model, runtimeInfo);
  window.REPLOID_POOL_SDK = sdk;
  mount.style.display = 'block';

  const render = () => {
    const routeId = getRouteId();
    if (routeId !== 'home' && window.REPLOID_POOL_SIMULATION_STOP) {
      window.REPLOID_POOL_SIMULATION_STOP();
      window.REPLOID_POOL_SIMULATION_STOP = null;
    }
    const secondaryContent = routeId === 'home'
      ? renderRouteDetail(routeId)
      : renderRouteDetail(routeId);
    document.title = routeId === 'home'
      ? 'Reploid - Browser Inference Pool'
      : `Reploid - ${ROUTE_COPY[routeId]?.eyebrow || 'Browser Inference Pool'}`;
    mount.innerHTML = `
      <main class="pool-home" data-pool-route-id="${routeId}">
        ${renderNav(routeId)}
        ${renderRoutePanel(routeId)}
        ${secondaryContent}
      </main>
    `;
    bindPoolRouteControls(mount, render);
    bindHomeSimulation(mount);
    bindRunControls(sdk);
    bindAgentControls(sdk);
    bindProviderControls(sdk);
    bindReceiptControls(sdk);
    bindReputationControls(sdk);
  };

  if (window.REPLOID_POOL_POPSTATE_HANDLER) {
    window.removeEventListener('popstate', window.REPLOID_POOL_POPSTATE_HANDLER);
  }
  window.REPLOID_POOL_POPSTATE_HANDLER = render;
  window.addEventListener('popstate', render);
  render();
}

export default {
  initPoolHome
};
