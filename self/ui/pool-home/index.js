/**
 * @fileoverview Public product home for the verified browser inference pool.
 */

import { createPoolSdk } from '../../pool/sdk.js';
import { createProviderClient } from '../../pool/provider-client.js';

const PRODUCT_ROUTES = Object.freeze({
  '/': 'home',
  '/run': 'run',
  '/contribute': 'contribute',
  '/agents': 'agents',
  '/receipts': 'receipts',
  '/reputation': 'reputation'
});

const FLOW_CARDS = Object.freeze([
  {
    id: 'run',
    href: '/run',
    title: 'Run inference',
    label: 'Requester',
    body: 'Submit a prompt with fastest_receipt, then receive output plus a verifier-readable signed execution receipt.'
  },
  {
    id: 'contribute',
    href: '/contribute',
    title: 'Contribute compute',
    label: 'Provider',
    body: 'Keep a browser tab open, load a Doppler model, accept bounded jobs, sign receipts, and earn points from accepted work.'
  },
  {
    id: 'agents',
    href: '/agents',
    title: 'Budget agents',
    label: 'Agent',
    body: 'Give agents point budgets, fastest_receipt defaults, model requirements, receipt verification, and spend records.'
  },
  {
    id: 'receipts',
    href: '/receipts',
    title: 'Inspect receipts',
    label: 'Evidence',
    body: 'Review assignment, policy, model/runtime identity, prompt hash, output hash, verifier decision, and ledger effects.'
  }
]);

const ROUTE_COPY = Object.freeze({
  home: {
    eyebrow: 'Receipt-backed browser inference',
    title: 'Browser-local inference with signed receipts.',
    body: 'Requesters submit prompts through fastest_receipt. Providers keep a browser tab open, run Doppler locally, return signed assignment-bound receipts, and earn points when verification accepts the work.'
  },
  run: {
    eyebrow: 'Requester mode',
    title: 'Submit jobs with fastest_receipt.',
    body: 'The requester flow collects prompt, model requirement, and deterministic generation config. The coordinator assigns one eligible provider and returns output plus receipt status.'
  },
  contribute: {
    eyebrow: 'Provider mode',
    title: 'Turn an idle browser tab into verified supply.',
    body: 'The provider flow checks WebGPU, loads a Doppler model, registers capabilities, listens for assignments, signs receipts, and tracks points, reputation, and failures.'
  },
  agents: {
    eyebrow: 'Agent mode',
    title: 'Give agents a budgeted inference API.',
    body: 'Agents submit jobs, poll status, verify receipts, accept valid results, reject invalid receipts, and track spend through the launch SDK.'
  },
  receipts: {
    eyebrow: 'Receipt explorer',
    title: 'Make every result inspectable.',
    body: 'Receipt pages explain exactly what is proven, what is not proven, why the verifier accepted or rejected the result, and how points or reputation changed.'
  },
  reputation: {
    eyebrow: 'Provider reputation',
    title: 'Route work toward reliable browser providers.',
    body: 'Reputation summarizes accepted work, rejected receipts, timeouts, canary outcomes, model availability, and provider history.'
  }
});

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const getRouteId = () => PRODUCT_ROUTES[window.location.pathname] || 'home';

const getBrowserIdentity = (kind) => {
  const key = `REPLOID_POOL_${kind.toUpperCase()}_ID`;
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const id = `${kind}_${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
    localStorage.setItem(key, id);
    return id;
  } catch {
    return `${kind}_${Math.random().toString(36).slice(2)}`;
  }
};

const renderResultBox = (id) => `
  <pre class="pool-result" id="${id}" aria-live="polite">{}</pre>
`;

const setResult = (id, value) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = JSON.stringify(value, null, 2);
};

const renderNav = (activeRoute) => {
  const items = [
    ['/', 'Home'],
    ['/run', 'Run'],
    ['/contribute', 'Contribute'],
    ['/agents', 'Agents'],
    ['/receipts', 'Receipts'],
    ['/reputation', 'Reputation'],
    ['/0', 'Substrate']
  ];
  return `
    <nav class="pool-nav" aria-label="Product navigation">
      ${items.map(([href, label]) => {
        const isActive = href === window.location.pathname || (href === '/' && activeRoute === 'home');
        return `<a class="pool-nav-link${isActive ? ' active' : ''}" href="${href}">${escapeHtml(label)}</a>`;
      }).join('')}
    </nav>
  `;
};

const renderPolicyStrip = () => `
  <div class="boot-status-strip pool-policy-strip" aria-label="Launch policy">
    <span class="rgr-status-metric"><span class="rgr-status-label">Launch policy</span><span class="rgr-status-value">fastest_receipt</span></span>
    <span class="rgr-status-metric"><span class="rgr-status-label">Next policies</span><span class="rgr-status-value">canary + redundancy later</span></span>
    <span class="rgr-status-metric"><span class="rgr-status-label">Claim</span><span class="rgr-status-value">receipt-backed</span></span>
  </div>
`;

const renderFlowCards = () => `
  <section class="pool-card-grid" aria-label="Critical journeys">
    ${FLOW_CARDS.map((card) => `
      <a class="pool-card" href="${card.href}">
        <span class="pool-card-label">${escapeHtml(card.label)}</span>
        <strong>${escapeHtml(card.title)}</strong>
        <span>${escapeHtml(card.body)}</span>
      </a>
    `).join('')}
  </section>
`;

const renderRoutePanel = (routeId) => {
  const copy = ROUTE_COPY[routeId] || ROUTE_COPY.home;
  const primaryHref = routeId === 'contribute' ? '/contribute' : '/run';
  const primaryLabel = routeId === 'contribute' ? 'Start contributing' : 'Run inference';
  return `
    <section class="pool-hero">
      <div class="pool-hero-copy">
        <p class="pool-eyebrow">${escapeHtml(copy.eyebrow)}</p>
        <h1 class="type-h1">${escapeHtml(copy.title)}</h1>
        <p class="type-caption pool-hero-body">${escapeHtml(copy.body)}</p>
        <div class="pool-actions">
          <a class="button-primary" href="${primaryHref}">${primaryLabel}</a>
          <a class="button-secondary" href="/contribute">Contribute compute</a>
          <a class="button-secondary" href="/receipts">Inspect receipts</a>
        </div>
      </div>
      <div class="pool-proof-card" aria-label="Receipt fields">
        <span class="pool-card-label">Pool receipt</span>
        <code>assignmentId</code>
        <code>policyId</code>
        <code>modelHash</code>
        <code>runtimeIdentity</code>
        <code>inputHash</code>
        <code>outputHash</code>
        <code>providerSignature</code>
        <code>verifierDecision</code>
      </div>
    </section>
  `;
};

const renderRouteDetail = (routeId) => {
  if (routeId === 'run') {
    return `
      <section class="pool-panel">
        <h2 class="type-h2">Requester journey</h2>
        <p class="type-caption">Prompt submission, fastest_receipt display, assignment tracking, receipt verification, requester acceptance, and point spend belong here.</p>
        <div class="pool-form" data-pool-run>
          <label class="pool-field">
            <span>Prompt</span>
            <textarea id="pool-run-prompt" rows="5">Summarize the launch policy in one paragraph.</textarea>
          </label>
          <button class="button-primary" id="pool-run-submit" type="button">Submit fastest_receipt job</button>
          ${renderResultBox('pool-run-result')}
        </div>
      </section>
    `;
  }
  if (routeId === 'contribute') {
    return `
      <section class="pool-panel">
        <h2 class="type-h2">Provider journey</h2>
        <p class="type-caption">WebGPU capability check, Doppler model load, provider registration, assignment listener, signed receipt submission, points, reputation, and audit status belong here.</p>
        <div class="pool-form" data-pool-provider>
          <label class="pool-field">
            <span>Model id</span>
            <input id="pool-provider-model" value="v0_default" />
          </label>
          <button class="button-primary" id="pool-provider-register" type="button">Register browser provider</button>
          <button class="button-secondary" id="pool-provider-next" type="button">Poll assignment</button>
          ${renderResultBox('pool-provider-result')}
        </div>
      </section>
    `;
  }
  if (routeId === 'agents') {
    return `
      <section class="pool-panel">
        <h2 class="type-h2">Agent journey</h2>
        <p class="type-caption">Agent API keys, point budgets, fastest_receipt defaults, outstanding jobs, receipt verification logs, and spend summaries belong here.</p>
        <div class="pool-form">
          <code>submitJob(request)</code>
          <code>pollJob(jobId)</code>
          <code>verifyReceipt(receipt)</code>
          <code>acceptReceipt(receiptHash)</code>
        </div>
      </section>
    `;
  }
  if (routeId === 'receipts') {
    return `
      <section class="pool-panel">
        <h2 class="type-h2">Receipt journey</h2>
        <p class="type-caption">Receipt lookup, trust tier, hashes, assignment, policy, provider, requester acceptance, verifier result, and ledger effects belong here.</p>
      </section>
    `;
  }
  if (routeId === 'reputation') {
    return `
      <section class="pool-panel">
        <h2 class="type-h2">Reputation journey</h2>
        <p class="type-caption">Provider score, accepted receipts, rejected work, timeouts, audit pass rate, scarce model availability, and routing eligibility belong here.</p>
      </section>
    `;
  }
  return renderFlowCards();
};

const renderTrustNote = () => `
  <section class="pool-panel pool-trust-note">
    <h2 class="type-h2">Trust boundary</h2>
    <p class="type-caption">The launch product is receipt-backed and policy-controlled browser inference. Audit-backed and reputation-backed routing are next trust layers. It is not hardware-attested inference, trustless compute, or proof of honest browser execution.</p>
  </section>
`;

const bindRunControls = (sdk) => {
  const button = document.getElementById('pool-run-submit');
  const prompt = document.getElementById('pool-run-prompt');
  if (!button || !prompt) return;
  button.addEventListener('click', async () => {
    button.disabled = true;
    setResult('pool-run-result', { status: 'submitting' });
    try {
      const result = await sdk.submitJob({
        requesterId: getBrowserIdentity('requester'),
        prompt: prompt.value,
        policyId: 'fastest_receipt',
        modelRequirements: { modelId: 'v0_default' },
        generationConfig: {
          mode: 'greedy',
          temperature: 0,
          topK: 1,
          topP: 1,
          maxOutputTokens: 128,
          seed: '0000000000000000'
        },
        verificationLevel: 'signed_receipt'
      });
      setResult('pool-run-result', result);
    } catch (error) {
      setResult('pool-run-result', { error: error.message, payload: error.payload || null });
    } finally {
      button.disabled = false;
    }
  });
};

const bindProviderControls = (sdk) => {
  const registerButton = document.getElementById('pool-provider-register');
  const nextButton = document.getElementById('pool-provider-next');
  const modelInput = document.getElementById('pool-provider-model');
  if (!registerButton || !nextButton || !modelInput) return;
  const providerId = getBrowserIdentity('provider');
  const providerClient = createProviderClient({ providerId, sdk });
  registerButton.addEventListener('click', async () => {
    registerButton.disabled = true;
    setResult('pool-provider-result', { status: 'registering', providerId });
    try {
      const result = await providerClient.register({
        models: [{
          modelId: modelInput.value || 'v0_default',
          modelHash: 'sha256:unknown',
          manifestHash: 'sha256:unknown',
          contextLength: 4096,
          quantization: 'unknown',
          runtime: 'doppler',
          backend: 'browser-webgpu'
        }],
        device: {
          hasWebGPU: !!navigator.gpu
        },
        availability: {
          maxConcurrentJobs: 1,
          maxTokensPerJob: 128,
          acceptedPolicies: ['fastest_receipt']
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
      setResult('pool-provider-result', await sdk.nextAssignment(providerId));
    } catch (error) {
      setResult('pool-provider-result', { error: error.message, payload: error.payload || null });
    } finally {
      nextButton.disabled = false;
    }
  });
};

export function initPoolHome(mount) {
  if (!mount) return;
  const routeId = getRouteId();
  document.title = routeId === 'home'
    ? 'Reploid - Browser Inference Pool'
    : `Reploid - ${ROUTE_COPY[routeId]?.eyebrow || 'Browser Inference Pool'}`;
  mount.style.display = 'block';
  mount.innerHTML = `
    <main class="pool-home">
      ${renderNav(routeId)}
      ${renderRoutePanel(routeId)}
      ${renderPolicyStrip()}
      ${renderRouteDetail(routeId)}
      ${renderTrustNote()}
    </main>
  `;
  const sdk = createPoolSdk();
  window.REPLOID_POOL_SDK = sdk;
  bindRunControls(sdk);
  bindProviderControls(sdk);
}

export default {
  initPoolHome
};
