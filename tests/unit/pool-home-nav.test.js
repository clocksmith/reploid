import { describe, expect, it } from 'vitest';

import {
  POOLDAY_NAV_ROUTES,
  POOLDAY_ASK_PLACEHOLDERS,
  POOLDAY_HOT_PATH_STEPS,
  POOLDAY_ROUTE_DEFINITIONS,
  PRODUCT_ROUTES,
  ROUTE_COPY,
  choosePooldayAskPlaceholder
} from '../../self/ui/pool-home/constants.js';
import {
  renderContributionStatusBar,
  renderNav,
  renderRouteDetail,
  renderRoutePanel
} from '../../self/ui/pool-home/view.js';

describe('poolday home navigation', () => {
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
      body: 'Share this tab as browser compute with signed receipts.'
    });
  });

  it('renders collapsed active route links from the shared nav route list', () => {
    const html = renderNav('compute');

    expect(html).toContain('<nav class="pool-nav-rail"');
    expect(html).toContain('<button class="pool-nav-toggle"');
    expect(html).toContain('pool-nav-mark');
    expect(html).toContain('pool-nav-mark-seven-top');
    expect(html).not.toContain('<details');
    expect(html).not.toContain('<summary');
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
    expect(html.match(/data-pool-nav-tooltip=/g)).toHaveLength(7);
    expect(html).not.toContain('aria-pressed');
    expect(html).not.toContain('href="/run"');
    expect(html).not.toContain('href="/mesh"');
    expect(html).not.toContain('href="/record"');
  });

  it('renders the main home calls to action', () => {
    const html = renderRoutePanel('home');

    expect(POOLDAY_HOT_PATH_STEPS.map((step) => step.id)).toEqual([
      'prompt',
      'policy',
      'match',
      'infer',
      'verify',
      'answer'
    ]);
    expect(html).toContain('class="pool-home-stage"');
    expect(html).toContain('class="pool-home-toolbar"');
    expect(html).toContain('class="pool-home-toolbar-leading pool-home-overlay"');
    expect(html).toContain('class="pool-home-toolbar-center pool-home-cta-row pool-home-ask-form"');
    expect(html).toContain('class="pool-home-toolbar-right"');
    expect(html).toContain('class="pool-simulation-shell"');
    expect(html).toContain('data-pool-simulation');
    expect(html).toContain('data-pool-hot-path');
    for (const step of POOLDAY_HOT_PATH_STEPS) {
      expect(html).toContain(`data-pool-hot-path-step="${step.id}"`);
    }
    expect(html).toContain('Explain battery safety for a school robotics...');
    expect(html).toContain('Use fire safe charging inspect swollen packs');
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
    expect(html).toContain('<span class="pool-shape-action-label">Ask</span>');
    expect(html).toMatch(/class="pool-home-ask-pill"[\s\S]*id="pool-home-ask-prompt"[\s\S]*pool-home-ask-submit/);
    expect(html).toContain('href="/network"');
    expect(html).toContain('data-pool-route="/network"');
    expect(html).toContain('pool-shape-action--circle pool-shape-action--network pool-home-network-cta');
    expect(html).toContain('aria-label="Live Network"');
    expect(html).toContain('<span class="pool-shape-action-label">Live Network</span>');
    expect(html).toContain('class="pool-home-network-panel pool-home-overlay"');
    expect(html).toContain('Live room');
    expect(html).toContain('Open records');
    expect(html).not.toContain('class="pool-home-status"');
    expect(html).not.toContain('aria-label="Current room and model"');
    expect(html.indexOf('class="pool-home-toolbar"')).toBeLessThan(html.indexOf('class="pool-simulation-shell"'));
    expect(html).toMatch(/class="pool-home-toolbar"[\s\S]*pool-home-toolbar-leading[\s\S]*pool-home-toolbar-center[\s\S]*pool-home-toolbar-right[\s\S]*class="pool-simulation-shell"/);
  });

  it('renders route actions as Poolday shape components', () => {
    const html = renderRouteDetail('records');

    expect(html).toContain('pool-shape-action--square pool-shape-action--compute');
    expect(html).toContain('<span class="pool-shape-action-label">Contribute</span>');
  });

  it('renders Qwen as the visible default model on Ask and Compute', () => {
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

  it('renders Ask as answer-first with contributor and full-result layers', () => {
    const html = renderRouteDetail('ask');

    expect(html).toContain('Submit a run');
    expect(html).toContain('Clean output first');
    expect(html).toContain('id="pool-run-result-evidence"');
    expect(html).toContain('<summary>Contributors</summary>');
    expect(html).toContain('<summary>Full result</summary>');
    expect(html).toContain('pool-raw-details-full');
  });

  it('renders Contribute as a live contributor tab dashboard', () => {
    const html = renderRouteDetail('compute');

    expect(html).toContain('This tab');
    expect(html).toContain('id="pool-provider-node-stats"');
    expect(html).toContain('Readiness');
    expect(html).toContain('Contribution receipts');
    expect(html).toContain('id="pool-provider-node-history"');
    expect(html).toContain('<summary>Debug event</summary>');
  });

  it('renders a records route with room activity and contributor scores', () => {
    const html = renderRouteDetail('records');

    expect(html).toContain('Saved answers');
    expect(html).toContain('Live room');
    expect(html).toContain('Contributor scores');
    expect(html).toContain('class="pool-route-cta-row"');
    expect(html).toContain('href="/compute"');
    expect(html).toContain('data-pool-route="/compute"');
    expect(html).toContain('pool-shape-action--square pool-shape-action--compute');
    expect(html).toContain('<span class="pool-shape-action-label">Contribute</span>');
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
    expect(html).toContain('<b>24h</b> 0');
    expect(html).toContain('<b>1h</b> 0/hr');
    expect(html).toContain('<b>Last</b> none');
  });
});
