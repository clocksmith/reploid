import { describe, expect, it } from 'vitest';

import {
  POOLDAY_NAV_ROUTES,
  POOLDAY_ROUTE_DEFINITIONS,
  PRODUCT_ROUTES,
  ROUTE_COPY
} from '../../self/ui/pool-home/constants.js';
import {
  renderContributionStatusBar,
  renderNav,
  renderRouteDetail,
  renderRoutePanel
} from '../../self/ui/pool-home/view.js';

describe('poolday home navigation', () => {
  it('derives visible nav buttons and page copy from one route list', () => {
    expect(POOLDAY_ROUTE_DEFINITIONS.map((route) => route.id)).toEqual([
      'home',
      'ask',
      'compute',
      'history',
      'network'
    ]);
    expect(POOLDAY_NAV_ROUTES).toEqual([
      { id: 'home', path: '/', label: 'Home' },
      { id: 'ask', path: '/ask', label: 'Ask' },
      { id: 'compute', path: '/compute', label: 'Compute' },
      { id: 'history', path: '/history', label: 'History' },
      { id: 'network', path: '/network', label: 'Network' }
    ]);
    expect(PRODUCT_ROUTES).toEqual({
      '/': 'home',
      '/ask': 'ask',
      '/compute': 'compute',
      '/history': 'history',
      '/network': 'network'
    });
    expect(PRODUCT_ROUTES['/run']).toBeUndefined();
    expect(PRODUCT_ROUTES['/mesh']).toBeUndefined();
    expect(PRODUCT_ROUTES['/record']).toBeUndefined();
    expect(PRODUCT_ROUTES['/agents']).toBeUndefined();
    expect(ROUTE_COPY.compute).toEqual({
      eyebrow: 'Compute',
      title: 'Compute',
      body: 'Let this tab help answer prompts for the current room.'
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
    expect(html).toContain('href="/" data-pool-route-link="/"');
    expect(html).toContain('href="/ask" data-pool-route-link="/ask"');
    expect(html).toContain('href="/compute" data-pool-route-link="/compute" aria-current="page"');
    expect(html).toContain('href="/history" data-pool-route-link="/history"');
    expect(html).toContain('href="/network" data-pool-route-link="/network"');
    expect(html).toContain('href="/zero" data-pool-substrate-route="/zero"');
    expect(html).toContain('href="/x" data-pool-substrate-route="/x"');
    expect(html).not.toContain('aria-pressed');
    expect(html).not.toContain('href="/run"');
    expect(html).not.toContain('href="/mesh"');
    expect(html).not.toContain('href="/record"');
  });

  it('renders the main home calls to action', () => {
    const html = renderRoutePanel('home');

    expect(html).toContain('class="pool-home-cta-row"');
    expect(html).toContain('href="/ask"');
    expect(html).toContain('data-pool-route="/ask"');
    expect(html).toContain('>Ask</a>');
    expect(html).toContain('href="/network"');
    expect(html).toContain('data-pool-route="/network"');
    expect(html).toContain('>See the Network</a>');
  });

  it('renders Qwen as the visible default model on Ask and Compute', () => {
    const askHtml = renderRouteDetail('ask');
    const computeHtml = renderRouteDetail('compute');

    expect(askHtml).toContain('<option value="qwen-3-5-0-8b-q4k-ehaf16" selected>Qwen 3.5 0.8B</option>');
    expect(computeHtml).toContain('<option value="qwen-3-5-0-8b-q4k-ehaf16" selected>Qwen 3.5 0.8B</option>');
    expect(askHtml).not.toContain('<option value="gemma-3-270m-it-q4k-ehf16-af32" selected>');
    expect(computeHtml).not.toContain('<option value="gemma-3-270m-it-q4k-ehf16-af32" selected>');
  });

  it('renders a network route call to action for compute sharing', () => {
    const html = renderRouteDetail('network');

    expect(html).toContain('class="pool-route-cta-row"');
    expect(html).toContain('href="/compute"');
    expect(html).toContain('data-pool-route="/compute"');
    expect(html).toContain('>Share Compute</a>');
  });

  it('renders a compact global compute contribution status', () => {
    const html = renderContributionStatusBar({
      state: 'inactive',
      label: 'Not active',
      tokens24h: 0,
      tokensHour: 0,
      recent: []
    });

    expect(html).toContain('id="pool-contribution-status"');
    expect(html).toContain('data-contribution-state="inactive"');
    expect(html).toContain('Not active');
    expect(html).toContain('<b>24h</b> 0');
    expect(html).toContain('<b>1h</b> 0/hr');
    expect(html).toContain('<b>Last</b> none');
  });
});
