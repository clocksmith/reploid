import { describe, expect, it } from 'vitest';

import {
  POOLDAY_NAV_ROUTES,
  POOLDAY_ASK_PLACEHOLDERS,
  POOLDAY_ROUTE_DEFINITIONS,
  PRODUCT_ROUTES,
  ROUTE_COPY,
  choosePooldayAskPlaceholder
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

  it('keeps the home Ask hint pool short, diverse, and finite', () => {
    expect(POOLDAY_ASK_PLACEHOLDERS).toHaveLength(64);
    expect(new Set(POOLDAY_ASK_PLACEHOLDERS).size).toBe(64);
    for (const prompt of POOLDAY_ASK_PLACEHOLDERS) {
      const words = prompt.trim().split(/\s+/);
      expect(words.length).toBeGreaterThanOrEqual(2);
      expect(words.length).toBeLessThanOrEqual(4);
    }
    expect(choosePooldayAskPlaceholder(() => 0)).toBe(POOLDAY_ASK_PLACEHOLDERS[0]);
    expect(choosePooldayAskPlaceholder(() => 0.999)).toBe(POOLDAY_ASK_PLACEHOLDERS.at(-1));
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
      body: 'Let this tab answer compatible runs. Stop at any time.'
    });
  });

  it('renders collapsed active route links from the shared nav route list', () => {
    const html = renderNav('compute');

    expect(html).toContain('<nav class="pool-nav-rail"');
    expect(html).toContain('<button class="pool-nav-toggle"');
    expect(html).toContain('pool-nav-mark');
    expect(html).toContain('pool-nav-mark-seven-top');
    expect(html).toContain('<details class="pool-nav-more">');
    expect(html).toContain('<summary class="pool-nav-more-summary">');
    expect(html).toContain('<span class="pool-nav-label">More</span>');
    expect(html).not.toContain('☰');
    expect(html).toContain('data-pool-nav-tooltip="Open the route drawer from the left"');
    expect(html).toContain('data-pool-nav-tooltip="Submit a prompt to browser model contributors"');
    expect(html).toContain('data-pool-nav-tooltip="Share this tab as browser compute"');
    expect(html).toContain('href="/" data-pool-route-link="/"');
    expect(html).toContain('href="/ask" data-pool-route-link="/ask"');
    expect(html).toMatch(/href="\/compute"[\s\S]*data-pool-route-link="\/compute"[\s\S]*aria-current="page"/);
    expect(html).toContain('href="/records" data-pool-route-link="/records"');
    expect(html).toContain('href="/zero" data-pool-substrate-route="/zero"');
    expect(html).toContain('href="/x" data-pool-substrate-route="/x"');
    expect(html).toContain('aria-label="Zero Experimental"');
    expect(html).toContain('aria-label="X Experimental"');
    expect(html).toContain('pool-nav-badge">Experimental</span>');
    expect(html).toContain('class="pool-room-context"');
    expect(html).toContain('data-pool-room-id');
    expect(html.match(/data-pool-nav-tooltip=/g)).toHaveLength(7);
    expect(html).not.toContain('aria-pressed');
    expect(html).not.toContain('href="/run"');
    expect(html).not.toContain('href="/mesh"');
    expect(html).not.toContain('href="/record"');
  });

  it('renders the main home calls to action', () => {
    const html = renderRoutePanel('home');

    expect(html).toContain('class="pool-home-stage"');
    expect(html).toContain('class="pool-home-toolbar"');
    expect(html).toContain('class="pool-home-toolbar-leading pool-home-overlay"');
    expect(html).toContain('class="pool-home-toolbar-center pool-home-cta-row pool-home-ask-form"');
    expect(html).not.toContain('class="pool-home-toolbar-right"');
    expect(html).toContain('class="pool-simulation-shell"');
    expect(html).toContain('data-pool-simulation');
    expect(html).not.toContain('data-pool-hot-path');
    expect(html).toContain('class="pool-home-title-lockup"');
    expect(html).toContain('<h1 class="type-h1 pool-home-brand-word">REPLOID</h1>');
    expect(html).toContain('Run browser models together.');
    expect(html).toContain('pool-home-cta-row pool-home-ask-form');
    expect(html).toContain('id="pool-home-ask-form"');
    expect(html).toContain('class="pool-home-ask-pill"');
    expect(html).toContain('id="pool-home-ask-prompt"');
    const value = html.match(/value="([^"]+)"/)?.[1];
    expect(POOLDAY_ASK_PLACEHOLDERS).toContain(value);
    expect(value).not.toBe('Ask the network...');
    expect(html).toContain(`data-pool-suggested-prompt="${value}"`);
    expect(html).not.toContain('placeholder="Ask the network..."');
    expect(html).toContain('pool-shape-action--circle pool-shape-action--ask pool-home-ask-submit');
    expect(html).toContain('type="submit"');
    expect(html).toContain('<span class="pool-shape-action-label">Run</span>');
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
    expect(html).toMatch(/class="pool-home-toolbar"[\s\S]*pool-home-toolbar-leading[\s\S]*pool-home-toolbar-center[\s\S]*class="pool-simulation-shell"/);
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

  it('renders Qwen as the visible default model on Run and Contribute', () => {
    const askHtml = renderRouteDetail('ask');
    const computeHtml = renderRouteDetail('compute');

    expect(askHtml).toContain('<option value="qwen-3-5-0-8b-q4k-ehaf16" selected>Qwen 3.5 0.8B</option>');
    expect(computeHtml).toContain('<option value="qwen-3-5-0-8b-q4k-ehaf16" selected>Qwen 3.5 0.8B</option>');
    expect(askHtml).toContain('<option value="gemma-4-e2b-it-q4k-ehf16-af32-int4ple">Gemma 4 E2B INT4 PLE</option>');
    expect(computeHtml).toContain('<option value="gemma-4-e2b-it-q4k-ehf16-af32-int4ple">Gemma 4 E2B INT4 PLE</option>');
    expect(askHtml).not.toContain('qwen-3-embedding-0-6b-q4k-ehf16-af32');
    expect(computeHtml).toContain('<option value="qwen-3-embedding-0-6b-q4k-ehf16-af32">Qwen3 Embedding 0.6B · embedding</option>');
    expect(askHtml).not.toContain('gemma-3-1b-it-q4k-ehf16-af32');
    expect(computeHtml).not.toContain('gemma-3-1b-it-q4k-ehf16-af32');
    expect(askHtml).not.toContain('<option value="gemma-3-270m-it-q4k-ehf16-af32" selected>');
    expect(computeHtml).not.toContain('<option value="gemma-3-270m-it-q4k-ehf16-af32" selected>');
    expect(askHtml).not.toMatch(/<option[^>]+disabled/);
    expect(computeHtml).not.toMatch(/<option[^>]+disabled/);
  });

  it('renders Run as answer-first with proof and raw-result layers', () => {
    const html = renderRouteDetail('ask');

    expect(html).toContain('<span>Prompt</span>');
    expect(html).toContain('<summary>Settings</summary>');
    expect(html).toContain('data-pool-run-output hidden');
    expect(html).toContain('id="pool-run-result-evidence"');
    expect(html).toContain('<summary>Proof</summary>');
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
    expect(html).not.toContain('<b>24h</b>');
    expect(html).not.toContain('<b>1h</b>');
    expect(html).not.toContain('<b>Last</b>');
  });
});
