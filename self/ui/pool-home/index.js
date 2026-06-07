/**
 * @fileoverview Public product home for the verified browser inference pool.
 */

import { createPoolSdk, verifyReceiptRecord } from '../../pool/sdk.js';
import { createDopplerRuntime } from '../../pool/doppler-runtime.js';
import { createAgentClient } from '../../pool/agent-client.js';
import { createProviderClient } from '../../pool/provider-client.js';
import { createRequesterClient } from '../../pool/requester-client.js';
import { LAUNCH_MODEL, buildLaunchProviderModel } from '../../pool/model-contract.js';
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
    title: 'A browser tab runs the model and signs the result.',
    body: 'The coordinator assigns a provider, verifies hashes and signatures, and records points after acceptance.'
  },
  run: {
    eyebrow: 'Requester mode',
    title: 'Submit a prompt to a specific model.',
    body: 'The coordinator matches model id, manifest hash, runtime, backend, and policy before assigning a provider.'
  },
  contribute: {
    eyebrow: 'Provider mode',
    title: 'Run the launch model in this tab.',
    body: 'The tab loads Doppler, registers its runtime profile, executes assignments, and signs receipts.'
  },
  agents: {
    eyebrow: 'Agent mode',
    title: 'Call the same job flow from code.',
    body: 'The SDK submits the job, polls status, verifies the receipt, and signs acceptance.'
  },
  receipts: {
    eyebrow: 'Receipt explorer',
    title: 'Inspect one receipt.',
    body: 'The receipt shows assignment id, policy id, model hash, input hash, output hash, token hash, signatures, and verifier decision.'
  },
  reputation: {
    eyebrow: 'Provider reputation',
    title: 'Inspect one provider.',
    body: 'The page shows accepted receipts, rejected receipts, timeouts, audit events, and point ledger entries.'
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
    ['/run', 'Run'],
    ['/contribute', 'Contribute'],
    ['/agents', 'Agents'],
    ['/receipts', 'Receipts'],
    ['/reputation', 'Reputation']
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

const renderHomeFacts = () => `
  <section class="panel pool-panel" aria-label="Pool job flow">
    <h2 class="type-h2">How a job moves</h2>
    <ol class="pool-fact-list">
      <li>The requester submits prompt, model requirement, policy, and generation config.</li>
      <li>The coordinator assigns a provider that registered the exact model contract.</li>
      <li>The provider tab runs Doppler, hashes the output, and signs the receipt.</li>
      <li>The verifier checks assignment fields, hashes, signatures, and acceptance before points change.</li>
    </ol>
  </section>
`;

const renderRoutePanel = (routeId) => {
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
        <h2 class="type-h2">Requester</h2>
        <p class="type-caption">Submit a prompt, poll the assigned job, then sign the acceptance decision.</p>
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
        <p class="type-caption">This tab loads the launch model, executes assigned prompts, and submits receipts.</p>
        <div class="pool-form" data-pool-provider>
          <label class="pool-field">
            <span>Model id</span>
            <input id="pool-provider-model" value="${escapeHtml(LAUNCH_MODEL.modelId)}" />
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
              <button class="btn btn-ghost" id="pool-provider-register" type="button">Register browser provider</button>
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
        <h2 class="type-h2">Reputation</h2>
        <p class="type-caption">Look up provider history and deployment status.</p>
        <div class="pool-form" data-pool-reputation>
          <label class="pool-field">
            <span>Provider id</span>
            <input id="pool-reputation-provider" placeholder="provider_..." />
          </label>
          <button class="btn btn-primary" id="pool-reputation-lookup" type="button">Lookup reputation</button>
          <button class="btn btn-ghost" id="pool-status-lookup" type="button">Pool status</button>
          <button class="btn btn-ghost" id="pool-metrics-lookup" type="button">Pool metrics</button>
          <button class="btn btn-ghost" id="pool-deployment-check" type="button">Deployment check</button>
          ${renderResultBox('pool-reputation-result')}
        </div>
      </section>
    `;
  }
  return renderHomeFacts();
};

const renderTrustNote = () => `
  <section class="panel pool-panel pool-trust-note">
    <h2 class="type-h2">Trust boundary</h2>
    <p class="type-caption">The receipt proves that a provider identity signed specific hashes for a specific assignment. Browser execution still requires audits, redundancy, and reputation checks.</p>
  </section>
`;

const bindRunControls = (sdk) => {
  const button = document.getElementById('pool-run-submit');
  const pollButton = document.getElementById('pool-run-poll');
  const acceptButton = document.getElementById('pool-run-accept');
  const rejectButton = document.getElementById('pool-run-reject');
  const prompt = document.getElementById('pool-run-prompt');
  const policySelect = document.getElementById('pool-run-policy');
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
    ...buildLaunchProviderModel(),
    modelId: modelInput.value || LAUNCH_MODEL.modelId
  });
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
      setResult('pool-provider-result', await runtime.loadModel(getProviderModel()));
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
      const providerIdentityState = await providerIdentity.resolve();
      setResult('pool-provider-result', { status: 'registering', providerId: providerIdentityState.roleId, identity: providerIdentityState });
      const result = await providerClient.register({
        models: [getProviderModel()],
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
      setResult('pool-provider-result', result);
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
    workerRunning = true;
    syncWorkerButtons();
    setResult('pool-provider-result', { worker: 'starting' });
    await runWorkerLoop();
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
    const secondaryContent = routeId === 'home'
      ? renderRouteDetail(routeId)
      : `${renderPolicyStrip()}${renderRouteDetail(routeId)}${renderTrustNote()}`;
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
