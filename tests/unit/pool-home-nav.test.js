import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LAB_SURFACE_IDS, SURFACE_INTENTS } from '../../self/config/surface-intents.js';

import {
  POOLDAY_NAV_ROUTES,
  POOLDAY_ASK_PLACEHOLDERS,
  POOLDAY_SEQUENCE_ASK_PLACEHOLDERS,
  POOLDAY_TEXT_ASK_PLACEHOLDERS,
  POOLDAY_ROUTE_DEFINITIONS,
  PRODUCT_ROUTES,
  ROUTE_COPY,
  choosePooldayAskPlaceholder,
  choosePooldayAskPlaceholderForLane
} from '../../self/ui/pool-home/constants.js';
import {
  renderContributionStatusBar,
  renderNav,
  isProductPath,
  resolvePoolNetworkVisualState,
  renderRouteDetail,
  renderRoutePanel,
  setPoolRunVisualState
} from '../../self/ui/pool-home/view.js';

describe('poolday home navigation', () => {
  it('recognizes room-scoped local routes without intercepting external links', () => {
    for (const route of ['/records?room=example', '/?room=example&relay=server', '/compute/#limits']) {
      expect(isProductPath(route)).toBe(true);
    }
    expect(isProductPath('https://unrelated.invalid/records?room=example')).toBe(false);
    expect(isProductPath('/zero?room=example')).toBe(false);
    expect(isProductPath('javascript:alert(1)')).toBe(false);
  });
  it('links Zero and X from a homepage-only experiments footer, outside primary navigation', () => {
    const host = document.createElement('div');
    host.innerHTML = renderNav('home') + renderRoutePanel('home');
    const footer = host.querySelector('footer.pool-experiments-footer');
    expect(footer).not.toBeNull();
    expect(footer.querySelector('nav').getAttribute('aria-label')).toBe('Experiments');
    expect(footer.textContent).toContain('Experiments');
    const links = [...footer.querySelectorAll('a')];
    expect(links.map(link => link.textContent)).toEqual(['Zero', 'X']);
    expect(links.map(link => link.getAttribute('href'))).toEqual(
      LAB_SURFACE_IDS.map(id => SURFACE_INTENTS[id].route)
    );
    for (const link of links) {
      expect(link.hasAttribute('data-pool-substrate-route')).toBe(true);
      expect(link.hasAttribute('data-pool-route-link')).toBe(false);
      expect(link.closest('form, .pool-primary-nav')).toBeNull();
      expect(link.getAttribute('href')).not.toContain('?');
    }
    expect(footer.previousElementSibling.classList.contains('pool-home-task')).toBe(true);
    expect(host.querySelectorAll('.pool-primary-nav .pool-nav-link')).toHaveLength(3);
    for (const route of ['ask', 'compute', 'records', 'room-1']) {
      expect(renderRoutePanel(route) + renderRouteDetail(route)).not.toContain('pool-experiments-footer');
    }
  });

  it('uses Reploid publicly and keeps model evidence out of the main form', () => {
    for (const route of ['home', 'compute', 'records']) {
      const host = document.createElement('div');
      host.innerHTML = renderNav(route) + renderRoutePanel(route) + renderRouteDetail(route);
      expect(host.querySelector('.pool-primary-brand').textContent).toBe('Reploid');
      expect(host.textContent).not.toMatch(/\bpoolday\b/i);
      for (const node of host.querySelectorAll('[aria-label]')) expect(node.getAttribute('aria-label')).not.toMatch(/poolday/i);
      for (const summary of host.querySelectorAll('[data-pool-pack-summary]')) {
        expect(summary.closest('details').open).toBe(false);
      }
    }
  });
  it('keeps output behind the graph until a run reaches a terminal state', () => {
    document.body.innerHTML = `
      <section data-pool-run-surface data-run-state="idle">
        <p data-pool-run-status></p>
        <section data-pool-run-output hidden></section>
      </section>
    `;
    const output = document.querySelector('[data-pool-run-output]');

    setPoolRunVisualState({ state: 'running', phase: 'infer' });
    expect(output.hidden).toBe(true);
    setPoolRunVisualState({ state: 'complete', phase: 'answer' });
    expect(output.hidden).toBe(false);
    setPoolRunVisualState({ state: 'error', phase: 'error' });
    expect(output.hidden).toBe(false);
    setPoolRunVisualState({ state: 'idle' });
    expect(output.hidden).toBe(true);

    document.body.innerHTML = '';
  });

  it('does not reveal peer output while document search is selected', () => {
    document.body.innerHTML = `
      <section class="pool-home-task" data-pool-run-surface>
        <button data-pool-workflow="documents" aria-pressed="true">Document search</button>
        <section data-pool-run-output hidden></section>
      </section>
    `;
    const output = document.querySelector('[data-pool-run-output]');
    setPoolRunVisualState({ state: 'complete' });
    expect(output.hidden).toBe(true);
    document.querySelector('[data-pool-workflow]').setAttribute('aria-pressed', 'false');
    setPoolRunVisualState({ state: 'complete' });
    expect(output.hidden).toBe(false);
    document.body.innerHTML = '';
  });

  it('keeps the home protein hint pool finite and amino-acid-only', () => {
    expect(POOLDAY_ASK_PLACEHOLDERS).toHaveLength(13);
    expect(new Set(POOLDAY_ASK_PLACEHOLDERS).size).toBe(13);
    for (const prompt of POOLDAY_ASK_PLACEHOLDERS) {
      expect(prompt).toMatch(/^Sequence: [A-Z]+$/);
    }
    expect(choosePooldayAskPlaceholder(() => 0)).toBe(POOLDAY_ASK_PLACEHOLDERS[0]);
    expect(choosePooldayAskPlaceholder(() => 0.999)).toBe(POOLDAY_ASK_PLACEHOLDERS.at(-1));
    expect(POOLDAY_SEQUENCE_ASK_PLACEHOLDERS).toHaveLength(13);
    expect(POOLDAY_TEXT_ASK_PLACEHOLDERS).toHaveLength(0);
    expect(choosePooldayAskPlaceholderForLane('text', () => 0)).toBe('');
    expect(choosePooldayAskPlaceholderForLane('sequence', () => 0)).toBe('MRLGCSLAWLLLFLLLSVAA');
  });

  it('derives visible nav buttons and page copy from one route list', () => {
    expect(POOLDAY_ROUTE_DEFINITIONS.map((route) => route.id)).toEqual([
      'home',
      'ask',
      'compute',
      'records',
      'room-1'
    ]);
    expect(POOLDAY_NAV_ROUTES).toEqual([
      { id: 'home', path: '/', label: 'Run a model' },
      { id: 'compute', path: '/compute', label: 'Share compute' },
      { id: 'records', path: '/records', label: 'Recent jobs' }
    ]);
    expect(PRODUCT_ROUTES).toEqual({
      '/': 'home',
      '/ask': 'ask',
      '/compute': 'compute',
      '/records': 'records',
      '/room-1': 'room-1',
      '/history': 'records',
      '/network': 'records'
    });
    expect(PRODUCT_ROUTES['/run']).toBeUndefined();
    expect(PRODUCT_ROUTES['/mesh']).toBeUndefined();
    expect(PRODUCT_ROUTES['/record']).toBeUndefined();
    expect(PRODUCT_ROUTES['/agents']).toBeUndefined();
    expect(ROUTE_COPY.compute).toEqual({
      eyebrow: 'Browser AI',
      title: 'Share compute',
      body: 'Let this browser help with jobs.'
    });
  });

  it('renders exactly three primary destinations and a compact network state', () => {
    const html = renderNav('compute');

    expect(html).toContain('<nav class="pool-nav-rail pool-primary-nav" aria-label="Reploid">');
    expect(html).toContain('class="pool-primary-brand"');
    expect(html).toContain('>Reploid</a>');
    expect(html).toContain('>Run a model</a>');
    expect(html).toContain('>Share compute</a>');
    expect(html).toContain('>Recent jobs</a>');
    expect(html).toContain('data-pool-network-state="simulation"');
    expect(html).not.toContain('pool-nav-toggle');
    expect(html).not.toContain('pool-drawer-section');
    expect(html).not.toContain('Research Room');
    expect(html).toContain('href="/?room=reploid-default" data-pool-route-link="/?room=reploid-default"');
    expect(html).toMatch(/href="\/compute\?room=reploid-default"[\s\S]*data-pool-route-link="\/compute\?room=reploid-default"[\s\S]*aria-current="page"/);
    expect(html).toMatch(/href="\/records\?room=reploid-default"[\s\S]*data-pool-route-link="\/records\?room=reploid-default"/);
    expect(html).toContain('data-pool-network-label>Searching</span>');
    expect((html.match(/class="pool-nav-link/g) || [])).toHaveLength(3);
  });

  it('does not reintroduce drawer chrome when legacy open options are supplied', () => {
    const html = renderNav('records', { open: true });

    expect(html).toContain('class="pool-nav-link is-active"');
    expect(html).toContain('>Recent jobs</a>');
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain('is-open');
    expect(html).not.toContain('aria-expanded');
    expect(html).not.toContain('pool-nav-description');
  });

  it('renders the active room query on every compatibility navigation link', () => {
    const original = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState({}, '', '/records?room=canonical-room');
    try {
      const html = renderNav('records', { open: true });
      expect(html).toContain('href="/?room=canonical-room" data-pool-route-link="/?room=canonical-room"');
      expect(html).toMatch(/href="\/compute\?room=canonical-room"[\s\S]*data-pool-route-link="\/compute\?room=canonical-room"/);
      expect(html).toMatch(/href="\/records\?room=canonical-room"[\s\S]*data-pool-route-link="\/records\?room=canonical-room"/);
    } finally {
      window.history.replaceState({}, '', original || '/');
    }
  });

  it('renders the main home calls to action', () => {
    const html = renderRoutePanel('home');
    expect(html).toContain('class="pool-home-stage pool-home-stage--focused"');
    expect(html).toContain('class="pool-home-toolbar"');
    expect(html).toContain('class="pool-home-toolbar-leading pool-home-overlay"');
    expect(html).toContain('class="pool-home-ask-dock pool-home-cta-row pool-home-ask-form"');
    expect(html).not.toContain('class="pool-home-toolbar-right"');
    expect(html).not.toContain('class="pool-simulation-shell"');
    expect(html).not.toContain('data-pool-network-disclosure');
    expect(html).not.toContain('data-pool-simulation');
    expect(html).not.toContain('data-pool-home-purpose');
    expect(html).toContain('480 values for comparing sequences from this exact ESM-2 model and contract.');
    expect(html).toContain('Not a biological interpretation or diagnosis.');
    expect(html).toContain('data-pool-copy-embedding');
    expect(html).not.toContain('data-pool-hot-path');
    expect(html).toContain('class="pool-home-title-lockup"');
    expect(html).toContain('<h1 class="type-h1 pool-home-brand-word">Reploid</h1>');
    expect(html).toContain('Run AI with connected browsers.');
    expect(html).not.toContain('>View room</a>');
    expect(html).toContain('id="pool-home-request-model"');
    expect(html).toContain('<span>Model</span>');
    expect(html).not.toContain('id="pool-home-research-public"');
    expect(html).not.toContain('id="pool-home-intent-text"');
    expect(html).toContain('>Run a model</h2>');
    expect(html).not.toContain('placeholder="What do you want to learn?"');
    expect(html).toContain('pool-home-cta-row pool-home-ask-form');
    expect(html).toContain('id="pool-home-ask-form"');
    expect(html).not.toContain('class="pool-home-composer-bar"');
    expect(html).not.toContain('aria-label="Input type"');
    expect(html).toContain('id="pool-home-ask-prompt"');
    expect(html).toContain('id="pool-home-sequence-public"');
    expect(html).toContain('This input may be sent to selected peers');
    expect(html).not.toContain('Publish the question and result to the room');
    expect(html).toContain('<span>Verification</span>');
    expect(html).toContain('Two matching peers');
    expect(html).toContain('data-pool-pack-summary');
    expect(html).toContain('data-pool-sequence-consent-saved hidden');
    expect(html).toContain('id="pool-home-adapter"');
    expect(html).not.toContain('pool-home-ask-label');
    const placeholder = html.match(/id="pool-home-ask-prompt"[\s\S]*?placeholder="([^"]+)"/)?.[1];
    expect(POOLDAY_ASK_PLACEHOLDERS).toContain(`Sequence: ${placeholder}`);
    expect(placeholder).not.toBe('Ask the network...');
    expect(html).toContain(`data-pool-suggested-prompt="${placeholder}"`);
    expect(html).not.toContain('placeholder="Ask the network..."');
    expect(html).toContain('class="btn btn-primary pool-home-run-button"');
    expect(html).toContain('type="submit"');
    expect(html).toContain('>Run model</button>');
    expect(html).toContain('<summary>Options</summary>');
    expect((html.match(/<summary>Options<\/summary>/g) || [])).toHaveLength(1);
    expect(html).not.toContain('href="/network"');
    expect(html).not.toContain('pool-home-network-cta');
    expect(html).not.toContain('Live Network</span>');
    expect(html).toContain('data-pool-run-surface="home"');
    expect(html).toContain('id="pool-home-run-result-stream"');
    expect(html).toContain('data-pool-run-output hidden');
    expect(html).not.toContain('pool-home-network-panel');
    expect(html).not.toContain('Open records');
    expect(html).not.toContain('class="pool-home-status"');
    expect(html).not.toContain('aria-label="Current room and model"');
    expect(html).toMatch(/class="pool-home-toolbar"[\s\S]*pool-home-toolbar-leading[\s\S]*class="pool-home-ask-dock/);
    expect(html).not.toContain('data-pool-dashboard-inspector');
    expect(html).not.toContain('pool-dashboard-inspector');
    expect(html).not.toContain('Ask browser models.<br>Share compute. Or both.');
  });

  it('keeps the dashboard option on the same minimal primary navigation', () => {
    const html = renderNav('home', { dashboard: true, dashboardView: 'compute' });

    expect(html).toContain('class="pool-nav-rail pool-primary-nav"');
    expect((html.match(/class="pool-nav-link/g) || [])).toHaveLength(3);
    expect(html).toContain('>Run a model</a>');
    expect(html).toContain('>Share compute</a>');
    expect(html).toContain('>Recent jobs</a>');
    expect(html).not.toContain('pool-control-drawer');
    expect(html).not.toContain('data-pool-drawer-section');
    expect(PRODUCT_ROUTES['/ask']).toBe('ask');
    expect(PRODUCT_ROUTES['/compute']).toBe('compute');
    expect(PRODUCT_ROUTES['/records']).toBe('records');
  });

  it('maps room summaries to simulation, hybrid, and live graph modes', () => {
    expect(resolvePoolNetworkVisualState({
      messageCount: 0,
      peerCount: 0,
      providerCount: 0,
      peers: [],
      providers: [],
      recent: []
    })).toMatchObject({
      mode: 'simulation',
      liveParticipantCount: 0
    });

    const hybrid = resolvePoolNetworkVisualState({
      messageCount: 4,
      peerCount: 2,
      providerCount: 1,
      peers: ['peer-a', 'provider-a'],
      providers: [{ providerId: 'provider-a' }],
      recent: [{ type: 'provider-advert', fromPeerId: 'provider-a' }]
    });
    expect(hybrid).toMatchObject({
      mode: 'hybrid',
      liveParticipantCount: 2,
      peerCount: 2,
      providerCount: 1,
      messageCount: 4
    });
    expect(hybrid.participants).toEqual([
      { id: 'provider-a', provider: true },
      { id: 'peer-a', provider: false }
    ]);

    const live = resolvePoolNetworkVisualState({
      messageCount: 12,
      peerCount: 7,
      providerCount: 4,
      peers: ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
      providers: ['p0', 'p1', 'p2', 'p3'].map((providerId) => ({ providerId }))
    });
    expect(live.mode).toBe('live');
    expect(live.liveParticipantCount).toBe(6);
    expect(live.participants).toHaveLength(6);
  });

  it('keeps one primary action on Request and Share compute', () => {
    const runHtml = renderRouteDetail('ask');
    const contributeHtml = renderRouteDetail('compute');

    expect(runHtml.match(/id="pool-run-submit"/g)).toHaveLength(1);
    expect(runHtml).toContain('id="pool-run-submit" type="button">Run</button>');
    expect(contributeHtml.match(/id="pool-provider-worker-toggle"/g)).toHaveLength(1);
    expect(contributeHtml).not.toContain('pool-provider-worker-start');
    expect(contributeHtml).not.toContain('pool-provider-worker-stop');
  });

  it('keeps deployed browser smokes aligned with the stateful contribution control', () => {
    for (const script of ['scripts/pool-browser-smoke.js', 'scripts/pool-actual-browser-smoke.js']) {
      const source = readFileSync(script, 'utf8');
      expect(source).toContain('#pool-provider-worker-toggle');
      expect(source).not.toContain('#pool-provider-worker-start');
    }

    const syntheticSmoke = readFileSync('scripts/pool-browser-smoke.js', 'utf8');
    expect(syntheticSmoke).toContain('.pool-home-stage[data-pool-lane="sequence"]');
    expect(syntheticSmoke).toContain("'/': '#pool-home-ask-form'");
    expect(syntheticSmoke).toContain("'/ask': '#pool-run-prompt'");
    expect(syntheticSmoke).toContain("'/compute': '#pool-provider-worker-toggle'");
    expect(syntheticSmoke).toContain("'/room-1': '#pool-room-1-request'");
    expect(syntheticSmoke).not.toContain('data-pool-lane="text"');
    expect(syntheticSmoke).not.toContain('data-pool-dashboard-view');
    expect(syntheticSmoke).toContain("const SYNTHETIC_MODEL_ID = 'esm2-t12-35m-ur50d-f32-af32'");
    expect(syntheticSmoke).toContain("url.searchParams.set('relay', 'local')");
    expect(syntheticSmoke).toContain("window.REPLOID_POOL_RELAY = 'local'");
    expect(syntheticSmoke).toContain("'--use-angle=swiftshader'");
    expect(syntheticSmoke).toContain('maxComputeInvocationsPerWorkgroup: 256');
  });

  it('renders ESM-2 as the only visible model on Request and Share compute', () => {
    const askHtml = renderRouteDetail('ask');
    const computeHtml = renderRouteDetail('compute');

    expect(askHtml).toContain('<option value="esm2-t12-35m-ur50d-f32-af32" data-workload="sequence.embedding.v1" selected>ESM-2 35M (Protein)</option>');
    expect(computeHtml).toContain('<option value="esm2-t12-35m-ur50d-f32-af32" data-workload="sequence.embedding.v1" selected>ESM-2 35M (Protein) · sequence.embedding.v1</option>');
    expect(askHtml).toContain('id="pool-run-sequence-public"');
    expect(askHtml).not.toContain('qwen-3-5-0-8b-q4k-ehaf16');
    expect(computeHtml).not.toContain('qwen-3-5-0-8b-q4k-ehaf16');
    expect(computeHtml).not.toMatch(/<option[^>]+disabled/);
  });

  it('renders Request as answer-first with proof and raw-result layers', () => {
    const html = renderRouteDetail('ask');

    expect(html).toContain('<span data-pool-run-prompt-label>Protein sequence</span>');
    expect(html).toContain('This sequence is public');
    expect(html).toContain('<summary>Settings</summary>');
    expect(html).toContain('data-pool-run-output hidden');
    expect(html).toContain('Protein representation');
    expect(html).toContain('Embedding ready');
    expect(html).toContain('id="pool-run-result-evidence"');
    expect(html).toContain('<summary>Proof</summary>');
    expect(html).toContain('<summary>View embedding vector</summary>');
    expect(html).toContain('<summary>Raw result</summary>');
    expect(html).toContain('pool-raw-details-full');
  });

  it('renders Share compute as a live contributor tab dashboard', () => {
    const html = renderRouteDetail('compute');

    expect(html).toContain('data-pool-provider');
    expect(html).toContain('id="pool-provider-node-stats"');
    expect(html).toContain('id="pool-provider-worker-toggle"');
    expect(html).toContain('Readiness');
    expect(html).toContain('Recent receipts');
    expect(html).toContain('id="pool-provider-node-history"');
    expect(html).toContain('data-pool-contribution-history hidden');
    expect(html).toContain('<summary>Advanced details</summary>');
    expect(html).toContain('<summary>Debug event</summary>');
    expect(html).toContain('Before you share');
    expect(html).toContain('Runs until you stop sharing or close this tab');
    expect(html).toContain('data-pool-provider-notice');
    expect(html.indexOf('Before you share')).toBeLessThan(html.indexOf('id="pool-provider-worker-toggle"'));
  });

  it('keeps Recent jobs focused only on Poolday execution evidence', () => {
    const html = renderRouteDetail('records');

    expect(html).toContain('id="pool-record-ledger"');
    expect(html).toContain('No records yet. Requests, completed runs, and contributions will appear here.');
    expect(html).toContain('<summary>Advanced details</summary>');
    expect(html).toContain('Peer activity and retries');
    expect(html).toContain('Peer identities');
    expect(html).toContain('Saved answer receipts');
    expect(html).not.toContain('Open Research Room-1');
    expect(html).not.toContain('data-pool-research-room');
    expect(html).not.toContain('Research workspace');
    expect(html).not.toContain('class="pool-route-cta-row"');
  });

  it('renders Research Room-1 on its own non-primary route', () => {
    const html = renderRouteDetail('room-1');

    expect(html).toContain('data-pool-route-shell="room-1"');
    expect(html).toContain('data-pool-research-room');
    expect(html).toContain('Research workspace');
    expect(html).toContain('id="pool-room-1-request"');
    expect(html).toContain('id="pool-run-intent-text"');
  });

  it('hides global compute status for tabs that are not contributing', () => {
    const html = renderContributionStatusBar({
      state: 'inactive',
      optedIn: false,
      label: 'Not active',
      tokens24h: 0,
      tokensHour: 0,
      recent: []
    });

    expect(html).toBe('');
  });

  it('renders a compact global compute contribution status for contributor tabs', () => {
    const html = renderContributionStatusBar({
      state: 'idle',
      optedIn: true,
      label: 'Available',
      tokens24h: 0,
      tokensHour: 0,
      recent: []
    });

    expect(html).toContain('id="pool-contribution-status"');
    expect(html).toContain('data-contribution-state="idle"');
    expect(html).toContain('Available');
    expect(html).not.toContain('pool-contribution-dot');
    expect(html).not.toContain('<b>24h</b>');
    expect(html).not.toContain('<b>1h</b>');
    expect(html).not.toContain('<b>Last</b>');
  });
});
