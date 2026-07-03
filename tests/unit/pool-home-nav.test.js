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
      'contribute',
      'receipts',
      'reputation'
    ]);
    expect(POOLDAY_NAV_ROUTES).toEqual([
      { id: 'home', path: '/', label: 'Reploid' },
      { id: 'ask', path: '/ask', label: 'Ask' },
      { id: 'contribute', path: '/contribute', label: 'Contribute' },
      { id: 'receipts', path: '/receipts', label: 'Receipts' },
      { id: 'reputation', path: '/reputation', label: 'Reputation' }
    ]);
    expect(PRODUCT_ROUTES).toEqual({
      '/': 'home',
      '/ask': 'ask',
      '/contribute': 'contribute',
      '/receipts': 'receipts',
      '/reputation': 'reputation'
    });
    expect(PRODUCT_ROUTES['/run']).toBeUndefined();
    expect(PRODUCT_ROUTES['/mesh']).toBeUndefined();
    expect(PRODUCT_ROUTES['/record']).toBeUndefined();
    expect(PRODUCT_ROUTES['/agents']).toBeUndefined();
    expect(ROUTE_COPY.contribute).toEqual({
      eyebrow: 'Contribute',
      title: 'Contribute compute',
      body: 'Load a model in this browser and answer pool requests for signed receipt credit.'
    });
  });

  it('renders active poolday route links from the shared nav route list', () => {
    const html = renderNav('contribute');

    expect(html).toContain('href="/" data-pool-route-link="/"');
    expect(html).toContain('href="/ask" data-pool-route-link="/ask"');
    expect(html).toContain('href="/contribute" data-pool-route-link="/contribute" aria-current="page"');
    expect(html).toContain('href="/receipts" data-pool-route-link="/receipts"');
    expect(html).toContain('href="/reputation" data-pool-route-link="/reputation"');
    expect(html).toContain('href="/zero" data-pool-substrate-route="/zero"');
    expect(html).toContain('href="/x" data-pool-substrate-route="/x"');
    expect(html).not.toContain('aria-pressed');
    expect(html).not.toContain('href="/run"');
    expect(html).not.toContain('href="/mesh"');
    expect(html).not.toContain('href="/record"');
  });
});
