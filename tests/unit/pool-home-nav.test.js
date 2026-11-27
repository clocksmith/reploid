import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LAB_SURFACE_IDS, SURFACE_INTENTS } from '../../shared/config/surface-intents.js';

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
} from '../../apps/poolday/ui/pool-home/constants.js';

describe('poolday home navigation', () => {

  it('keeps the home protein hint pool finite and amino-acid-only', () => {
    expect(POOLDAY_ASK_PLACEHOLDERS).toHaveLength(13);
    expect(new Set(POOLDAY_ASK_PLACEHOLDERS).size).toBe(13);
    for (const prompt of POOLDAY_ASK_PLACEHOLDERS) {
      expect(prompt).toMatch(/^Sequence: [A-Z]+$/);
    }
    expect(choosePooldayAskPlaceholder(() => 0)).toBe(POOLDAY_ASK_PLACEHOLDERS[0]);
    expect(choosePooldayAskPlaceholder(() => 0.999)).toBe(POOLDAY_ASK_PLACEHOLDERS.at(-1));
    expect(POOLDAY_SEQUENCE_ASK_PLACEHOLDERS).toHaveLength(13);
    expect(POOLDAY_TEXT_ASK_PLACEHOLDERS.length).toBeGreaterThan(0);
    expect(choosePooldayAskPlaceholderForLane('text', () => 0).trim()).not.toBe('');
    expect(choosePooldayAskPlaceholderForLane('sequence', () => 0)).toBe('MRLGCSLAWLLLFLLLSVAA');
  });

  it('derives visible nav buttons and page copy from one route list', () => {
    expect(POOLDAY_ROUTE_DEFINITIONS.map((route) => route.id)).toEqual([
      'experiments',
      'home',
      'ask',
      'network',
      'compute',
      'improve',
      'examples',
      'records',
      'room-1'
    ]);
    expect(POOLDAY_NAV_ROUTES).toEqual([
      { id: 'improve', path: '/improve', label: 'Changes' }
    ]);
    expect(PRODUCT_ROUTES).toEqual({
      '/experiments': 'experiments',
      '/': 'home',
      '/ask': 'ask',
      '/network': 'network',
      '/compute': 'compute',
      '/improve': 'improve',
      '/examples': 'examples',
      '/records': 'records',
      '/room-1': 'room-1',
      '/history': 'records',
      '/work': 'home'
    });
    expect(PRODUCT_ROUTES['/run']).toBeUndefined();
    expect(PRODUCT_ROUTES['/mesh']).toBeUndefined();
    expect(PRODUCT_ROUTES['/record']).toBeUndefined();
    expect(PRODUCT_ROUTES['/agents']).toBeUndefined();
    expect(ROUTE_COPY.compute).toEqual({
      eyebrow: 'Browser AI',
      title: 'Sequence provider',
      body: 'Legacy sequence execution and artifact participation.'
    });
  });

  it('keeps the historical model smoke aligned with its stateful contribution control', () => {
    const source = readFileSync('scripts/pool-actual-browser-smoke.js', 'utf8');
    expect(source).toContain('#pool-provider-worker-toggle');
    expect(source).not.toContain('#pool-provider-worker-start');
  });
});

