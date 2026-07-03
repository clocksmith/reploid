import { describe, expect, it } from 'vitest';

import {
  POOLDAY_NAV_ROUTES,
  POOLDAY_ROUTE_DEFINITIONS,
  PRODUCT_ROUTES,
  ROUTE_COPY
} from '../../self/ui/pool-home/constants.js';
import { renderNav } from '../../self/ui/pool-home/view.js';

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
      { id: 'home', path: '/', label: 'Reploid' },
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
      body: 'Use this browser as a worker for the current room.'
    });
  });

  it('renders collapsed active route links from the shared nav route list', () => {
    const html = renderNav('compute');

    expect(html).toContain('<details class="pool-nav-rail"');
    expect(html).toContain('<summary class="pool-nav-trigger"');
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
});
