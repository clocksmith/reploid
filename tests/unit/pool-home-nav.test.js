import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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
  resolvePoolNetworkVisualState,
  renderRouteDetail,
  renderRoutePanel,
  setPoolRunVisualState
} from '../../self/ui/pool-home/view.js';

describe('poolday home navigation', () => {
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
      'records'
    ]);
    expect(POOLDAY_NAV_ROUTES).toEqual([
      { id: 'home', path: '/', label: 'Home' },
      { id: 'ask', path: '/ask', label: 'Run' },
      { id: 'compute', path: '/compute', label: 'Contribute' },
      { id: 'records', path: '/records', label: 'Records' }
    ]);
    expect(PRODUCT_ROUTES).toEqual({
      '/': 'home',
      '/ask': 'ask',
      '/compute': 'compute',
      '/records': 'records',
      '/history': 'records',
      '/network': 'records'
    });
    expect(PRODUCT_ROUTES['/run']).toBeUndefined();
    expect(PRODUCT_ROUTES['/mesh']).toBeUndefined();
    expect(PRODUCT_ROUTES['/record']).toBeUndefined();
    expect(PRODUCT_ROUTES['/agents']).toBeUndefined();
    expect(ROUTE_COPY.compute).toEqual({
      eyebrow: 'Contribute',
      title: 'Contribute',
      body: 'Let this tab embed compatible protein sequences. Stop at any time.'
    });
  });

  it('renders collapsed active route links from the shared nav route list', () => {
    const html = renderNav('compute');

    expect(html).toContain('<nav class="pool-nav-rail"');
    expect(html).toContain('<button class="pool-nav-toggle"');
    expect(html).toContain('pool-nav-mark');
    expect(html).toContain('pool-nav-mark-seven-top');
    expect(html).toContain('class="pool-nav-top"');
    expect(html).toContain('class="pool-nav-bottom"');
    expect(html).not.toContain('pool-nav-view-context');
    expect(html).not.toContain('Current view');
    expect(html).not.toContain('<details class="pool-nav-more">');
    expect(html).not.toContain('<summary class="pool-nav-more-summary">');
    expect(html).not.toContain('<span class="pool-nav-label">More</span>');
    expect(html).not.toContain('☰');
    expect(html).toContain('data-pool-nav-tooltip="Open the navigation details from the left"');
    expect(html).toContain('data-pool-nav-tooltip="Submit a prompt to browser model contributors"');
    expect(html).toContain('data-pool-nav-tooltip="Share this tab as browser compute"');
    expect(html).toContain('href="/" data-pool-route-link="/"');
    expect(html).toContain('href="/ask" data-pool-route-link="/ask"');
    expect(html).toMatch(/href="\/compute"[\s\S]*data-pool-route-link="\/compute"[\s\S]*aria-current="page"/);
    expect(html).toContain('href="/records" data-pool-route-link="/records"');
    expect(html).toContain('href="/zero" data-pool-substrate-route="/zero"');
    expect(html).not.toContain('href="/x" data-pool-substrate-route="/x"');
    expect(html).toContain('aria-label="Zero"');
    expect(html).not.toContain('aria-label="X"');
    expect(html).not.toContain('pool-nav-badge">Experimental</span>');
    expect(html).toContain('class="pool-room-context"');
    expect(html).toContain('data-pool-room-id');
    expect((html.match(/data-pool-nav-tooltip=/g) || []).length).toBeGreaterThanOrEqual(6);
    expect(html).toContain('data-pool-drawer-section="participation"');
    expect(html).toContain('data-pool-participation-surface="navigation"');
    expect(html).toContain('data-pool-navigation-participation');
    expect(html).toContain('data-pool-participation-mode="request"');
    expect(html).not.toContain('href="/run"');
    expect(html).not.toContain('href="/mesh"');
    expect(html).not.toContain('href="/record"');
  });

  it('renders expanded navigation as an informative persistent sidebar', () => {
    const html = renderNav('records', { open: true });

    expect(html).toContain('<nav class="pool-nav-rail is-open"');
    expect(html).toContain('aria-label="Close navigation"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain('pool-nav-view-context');
    expect(html).not.toContain('Current view');
    expect(html).toMatch(/aria-label="Records"[\s\S]*aria-current="page"/);
    expect(html).toContain('<span class="pool-nav-description">Answers, work, rooms, and receipts</span>');
    expect(html).toContain('<span class="pool-nav-description">Prompt peers and inspect the proof</span>');
    expect(html).toContain('<span class="pool-nav-description">Blank local substrate</span>');
    expect(html).not.toContain('<span class="pool-nav-description">Self-modifying workspace</span>');
    expect(html).toContain('<div class="pool-room-context-heading">');
  });

  it('renders the main home calls to action', () => {
    const html = renderRoutePanel('home');
    expect(html).toContain('class="pool-home-stage"');
    expect(html).toContain('class="pool-home-toolbar"');
    expect(html).toContain('class="pool-home-toolbar-leading pool-home-overlay"');
    expect(html).toContain('class="pool-home-ask-dock pool-home-cta-row pool-home-ask-form"');
    expect(html).not.toContain('class="pool-home-toolbar-right"');
    expect(html).toContain('class="pool-simulation-shell"');
    expect(html).toContain('data-pool-simulation');
    expect(html).toContain('data-pool-home-purpose');
    expect(html).toContain('Turn a public protein sequence into a reusable representation.');
    expect(html).toContain('Submit</strong> one explicitly public protein sequence.');
    expect(html).toContain('Embed</strong> it in a participating browser with ESM-2.');
    expect(html).toContain('Use</strong> the 480-dimensional result to compare compatible sequences.');
    expect(html).toContain('not a biological interpretation or diagnosis');
    expect(html).toContain('This is a 480-number representation for software, not a result to read manually.');
    expect(html).toContain('Use it with embeddings made by the same ESM-2 model and contract when comparing sequences.');
    expect(html).toContain('Poolday records how it was produced and accepted, but does not yet provide search, interpretation, or diagnosis.');
    expect(html).toContain('data-pool-copy-embedding');
    expect(html).not.toContain('data-pool-hot-path');
    expect(html).toContain('class="pool-home-title-lockup"');
    expect(html).toContain('<h1 class="type-h1 pool-home-brand-word">REPLOID</h1>');
    expect(html).toContain('Run protein models together.');
    expect(html).toContain('pool-home-cta-row pool-home-ask-form');
    expect(html).toContain('id="pool-home-ask-form"');
    expect(html).toContain('class="pool-home-composer-bar"');
    expect(html).toContain('aria-label="Input type"');
    expect(html).toContain('<span class="pool-lane-chip is-active" data-pool-lane="sequence" aria-current="true">Protein</span>');
    expect(html).not.toContain('data-pool-lane="text"');
    expect(html).not.toContain('data-pool-composer-adapter-lane');
    expect(html).toContain('class="pool-home-ask-pill"');
    expect(html).toContain('id="pool-home-ask-prompt"');
    expect(html).toContain('id="pool-home-sequence-public"');
    expect(html).toContain('I confirm this protein sequence is public.');
    expect(html).toContain('data-pool-sequence-consent-saved hidden');
    expect(html).toContain('id="pool-home-adapter"');
    expect(html).not.toContain('pool-home-ask-label');
    const placeholder = html.match(/placeholder="([^"]+)"/)?.[1];
    expect(POOLDAY_ASK_PLACEHOLDERS).toContain(`Sequence: ${placeholder}`);
    expect(placeholder).not.toBe('Ask the network...');
    expect(html).toContain(`data-pool-suggested-prompt="${placeholder}"`);
    expect(html).not.toContain('placeholder="Ask the network..."');
    expect(html).toContain('pool-shape-action--circle pool-shape-action--ask pool-home-ask-submit');
    expect(html).toContain('type="submit"');
    expect(html).toContain('<span class="pool-shape-action-glyph" aria-hidden="true">↑</span>');
    expect(html).not.toContain('<span class="pool-shape-action-label">Run</span>');
    expect(html).toMatch(/class="pool-home-ask-pill"[\s\S]*id="pool-home-ask-prompt"[\s\S]*pool-home-ask-submit/);
    expect(html).not.toContain('href="/network"');
    expect(html).not.toContain('pool-home-network-cta');
    expect(html).not.toContain('Live Network</span>');
    expect(html).toContain('data-pool-network-state');
    expect(html).toContain('data-pool-run-surface="home"');
    expect(html).toContain('id="pool-home-run-result-stream"');
    expect(html).toContain('data-pool-run-output hidden');
    expect(html).not.toContain('pool-home-network-panel');
    expect(html).not.toContain('Open records');
    expect(html).not.toContain('class="pool-home-status"');
    expect(html).not.toContain('aria-label="Current room and model"');
    expect(html.indexOf('class="pool-home-toolbar"')).toBeLessThan(html.indexOf('class="pool-simulation-shell"'));
    expect(html).toMatch(/class="pool-home-toolbar"[\s\S]*pool-home-toolbar-leading[\s\S]*class="pool-simulation-shell"[\s\S]*class="pool-home-ask-dock/);
    expect(html).not.toContain('data-pool-dashboard-inspector');
    expect(html).not.toContain('pool-dashboard-inspector');
    expect(html).not.toContain('Ask browser models.<br>Share compute. Or both.');
  });

  it('clusters all five Home control sections and both substrate links in one left rail', () => {
    const html = renderNav('home', { dashboard: true, dashboardView: 'compute' });

    expect(html).toContain('class="pool-nav-rail pool-control-drawer"');
    expect(html).toContain('aria-label="Reploid controls"');
    expect(html).toContain('<strong>Reploid</strong><small>Peer inference</small>');
    expect(html).not.toContain('pool-dashboard-inspector');
    expect(html).not.toContain('data-pool-drawer-section="request-task"');
    expect(html).toContain('data-pool-drawer-section="request-model"');
    expect(html).toContain('data-pool-drawer-section="request-checks"');
    expect(html).toContain('data-pool-drawer-section="network-connection"');
    expect(html).toContain('data-pool-drawer-section="network-device" open');
    expect(html).toContain('data-pool-drawer-section="network-activity"');
    expect((html.match(/data-pool-drawer-section=/g) || [])).toHaveLength(5);
    expect(html).toContain('id="pool-home-request-model"');
    expect(html).toContain('id="pool-home-request-policy"');
    expect(html).toContain('data-pool-capability-profile');
    expect(html).not.toContain('data-pool-lane="sequence"');
    expect(html).not.toContain('data-pool-sequence-options');
    expect(html).not.toContain('id="pool-home-sequence-public"');
    expect(html).not.toContain('data-pool-drawer-section="request-participation"');
    expect(html).not.toContain('data-pool-dashboard-view');
    expect(html).toMatch(/pool-nav-bottom[\s\S]*pool-zero-link/);
    expect(html).toMatch(/pool-nav-bottom[\s\S]*pool-x-link/);
    expect(html).not.toContain('href="/records"');
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

  it('keeps one primary action on Run and Contribute', () => {
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
    expect(syntheticSmoke).toContain('.pool-lane-chip[data-pool-lane="sequence"]');
    expect(syntheticSmoke).toContain('.pool-home-stage[data-pool-lane="sequence"]');
    expect(syntheticSmoke).not.toContain('data-pool-lane="text"');
    expect(syntheticSmoke).not.toContain('data-pool-dashboard-view');
    expect(syntheticSmoke).toContain("const SYNTHETIC_MODEL_ID = 'esm2-t12-35m-ur50d-f32-af32'");
    expect(syntheticSmoke).toContain("url.searchParams.set('relay', 'local')");
    expect(syntheticSmoke).toContain("window.REPLOID_POOL_RELAY = 'local'");
    expect(syntheticSmoke).toContain("'--use-angle=swiftshader'");
    expect(syntheticSmoke).toContain('maxComputeInvocationsPerWorkgroup: 256');
  });

  it('renders ESM-2 as the only visible model on Run and Contribute', () => {
    const askHtml = renderRouteDetail('ask');
    const computeHtml = renderRouteDetail('compute');

    expect(askHtml).toContain('<option value="esm2-t12-35m-ur50d-f32-af32" data-workload="sequence.embedding.v1" selected>ESM-2 35M (Protein)</option>');
    expect(computeHtml).toContain('<option value="esm2-t12-35m-ur50d-f32-af32" data-workload="sequence.embedding.v1" selected>ESM-2 35M (Protein) · sequence.embedding.v1</option>');
    expect(askHtml).toContain('id="pool-run-sequence-public"');
    expect(askHtml).not.toContain('qwen-3-5-0-8b-q4k-ehaf16');
    expect(computeHtml).not.toContain('qwen-3-5-0-8b-q4k-ehaf16');
    expect(computeHtml).not.toMatch(/<option[^>]+disabled/);
  });

  it('renders Run as answer-first with proof and raw-result layers', () => {
    const html = renderRouteDetail('ask');

    expect(html).toContain('<span data-pool-run-prompt-label>Protein sequence</span>');
    expect(html).toContain('I confirm this protein sequence is public.');
    expect(html).toContain('<summary>Settings</summary>');
    expect(html).toContain('data-pool-run-output hidden');
    expect(html).toContain('Protein representation');
    expect(html).toContain('Ready for compatible comparison');
    expect(html).toContain('id="pool-run-result-evidence"');
    expect(html).toContain('<summary>Proof</summary>');
    expect(html).toContain('<summary>View embedding vector</summary>');
    expect(html).toContain('<summary>Raw result</summary>');
    expect(html).toContain('pool-raw-details-full');
  });

  it('renders Contribute as a live contributor tab dashboard', () => {
    const html = renderRouteDetail('compute');

    expect(html).toContain('data-pool-provider');
    expect(html).toContain('id="pool-provider-node-stats"');
    expect(html).toContain('id="pool-provider-worker-toggle"');
    expect(html).toContain('Readiness');
    expect(html).toContain('Recent receipts');
    expect(html).toContain('id="pool-provider-node-history"');
    expect(html).toContain('data-pool-contribution-history hidden');
    expect(html).toContain('<summary>Details</summary>');
    expect(html).toContain('<summary>Debug event</summary>');
  });

  it('renders a records route with room activity and contributor scores', () => {
    const html = renderRouteDetail('records');

    expect(html).toContain('id="pool-record-ledger"');
    expect(html).toContain('No records yet. Completed runs and contributions will appear here.');
    expect(html).toContain('<summary>Technical tools</summary>');
    expect(html).toContain('Room activity');
    expect(html).toContain('Contributor scores');
    expect(html).toContain('Saved answer receipts');
    expect(html).not.toContain('class="pool-route-cta-row"');
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
