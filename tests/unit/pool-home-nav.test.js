import { describe, expect, it } from 'vitest';

import {
  POOLDAY_NAV_ROUTES,
  POOLDAY_ROUTE_DEFINITIONS,
  PRODUCT_ROUTES,
  ROUTE_COPY
} from '../../self/ui/pool-home/constants.js';
import { renderNav } from '../../self/ui/pool-home/view.js';

describe('poolday home navigation', () => {
  it('derives route aliases, visible nav buttons, and page copy from one route list', () => {
    expect(POOLDAY_ROUTE_DEFINITIONS.map((route) => route.id)).toEqual([
      'home',
      'run',
      'mesh',
      'record'
    ]);
    expect(POOLDAY_NAV_ROUTES).toEqual([
      { id: 'home', path: '/', label: 'Home' },
      { id: 'run', path: '/run', label: 'Run' },
      { id: 'mesh', path: '/mesh', label: 'Mesh' },
      { id: 'record', path: '/record', label: 'Record' }
    ]);
    expect(PRODUCT_ROUTES).toMatchObject({
      '/': 'home',
      '/run': 'run',
      '/mesh': 'mesh',
      '/contribute': 'mesh',
      '/agents': 'mesh',
      '/record': 'record',
      '/receipts': 'record',
      '/reputation': 'record'
    });
    expect(ROUTE_COPY.mesh).toEqual({
      eyebrow: 'Mesh',
      title: 'Mesh',
      body: 'Start this browser as a provider for the current room.'
    });
  });

  it('renders active poolday route links from the shared nav route list', () => {
    const html = renderNav('mesh');

    expect(html).toContain('href="/" data-pool-route-link="/"');
    expect(html).toContain('href="/run" data-pool-route-link="/run"');
    expect(html).toContain('href="/mesh" data-pool-route-link="/mesh" aria-current="page"');
    expect(html).toContain('href="/record" data-pool-route-link="/record"');
    expect(html).toContain('href="/0" data-pool-substrate-route="/0"');
    expect(html).toContain('href="/x" data-pool-substrate-route="/x"');
    expect(html).not.toContain('aria-pressed');
    expect(html).not.toContain('Contribute');
    expect(html).not.toContain('Receipts');
  });
});
