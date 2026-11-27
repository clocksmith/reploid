import { describe, expect, it } from 'vitest';

import {
  analyzeZeroModule,
  compareWithRecord,
  pruneRecord,
  RECORD_SCHEMA,
  zeroHostToolNames
} from '../../scripts/verify-x-extends-zero.js';

const inClosure = served => served.startsWith('zero/');
const kinds = source => analyzeZeroModule('zero/probe.js', source, inClosure).map(item => item.kind);

describe('X extends Zero check', () => {
  it('allows references that treat X and Zero alike', () => {
    expect(kinds(`export const lab = mode => mode === 'zero' || mode === 'x';
export const ids = ['zero', 'x'];
export function surface(path) {
  if (path.startsWith('/zero')) return 'zero';
  if (path.startsWith('/x')) return 'x';
  return 'poolday';
}
export const boot = () => import('/zero/main.js');`)).toEqual([]);
  });

  it('rejects an X-only branch, an X upgrade name and a module outside the closure', () => {
    expect(kinds(`export const only = mode => (mode === 'x' ? 1 : 0);`)).toEqual(['x-branch-in-zero-module']);
    expect(kinds(`export const level = value => value === 'cognition';`)).toEqual(['x-upgrade-in-zero-module']);
    expect(kinds('export const legacy = load => load(`/kernel/boot.js?v=${Date.now()}`);'))
      .toEqual(['zero-imports-outside-closure']);
    expect(kinds(`export const lab = () => import('/lab/profiles.js' + '?v=1');`)).toEqual(['zero-imports-outside-closure']);
  });

  it('reads the tools Zero registers from its host', () => {
    expect(zeroHostToolNames(`registry.registerToolSchema('CreateTool', {})`)).toEqual(['CreateTool']);
  });

  it('fails on a new divergence and on a fixed one still recorded, and prunes only fixed ones', () => {
    const record = { schema: RECORD_SCHEMA, divergences: [
      { kind: 'zero-module-not-in-x', reason: 'r', evidence: ['e'], keys: ['zero/a.js', 'zero/b.js'] }
    ] };
    const found = [
      { rule: 'c', kind: 'zero-module-not-in-x', key: 'zero/a.js' },
      { rule: 'd', kind: 'x-base-module-not-in-zero', key: 'core/fork.js' }
    ];
    expect(compareWithRecord(found, record)).toEqual([
      'new divergence (d) x-base-module-not-in-zero: core/fork.js',
      'recorded divergence no longer exists; remove it from docs/x/zero-extension.json: zero-module-not-in-x|zero/b.js'
    ]);
    const pruned = pruneRecord(found, record);
    expect(pruned.divergences[0].keys).toEqual(['zero/a.js']);
    expect(compareWithRecord(found, pruned)).toEqual(['new divergence (d) x-base-module-not-in-zero: core/fork.js']);
  });
});
