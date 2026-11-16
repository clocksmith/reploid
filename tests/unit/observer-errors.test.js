import { expect, it, vi } from 'vitest';
import { notifyObservers } from '../../packages/reploid/src/observation.js';
import { createReploid } from '../../packages/reploid/src/agent/index.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';

it('isolates snapshots and reports synchronous and asynchronous observer failures', async () => {
  const error = vi.fn(), seen = [];
  notifyObservers([
    value => { value.changed = true; throw Error('sync'); },
    async () => { throw Error('async'); },
    value => seen.push(value)
  ], () => ({ changed: false }), error);
  await Promise.resolve(); await Promise.resolve();
  expect(seen).toEqual([{ changed: false }]);
  expect(error.mock.calls.map(([cause]) => cause.message)).toEqual(['sync', 'async']);
});
it('keeps a failed diagnostic sink from breaking notification', () => {
  const fallback = vi.spyOn(console, 'error').mockImplementation(() => {}), next = vi.fn();
  try {
    notifyObservers([() => { throw Error('observer'); }, next], () => ({}), () => { throw Error('sink'); });
    expect(next).toHaveBeenCalledOnce(); expect(fallback).toHaveBeenCalledOnce();
  } finally { fallback.mockRestore(); }
});
it('allows the default agent parser to report malformed model tool arguments to its host', async () => {
  const warn = vi.fn(); let turn = 0;
  const agent = createReploid({ config: resolveConfig({ overrides: { models: { providerId: 'test' }, tools: { allowed: ['ReadFile'] } } }),
    ports: { instanceId: 'parser-diagnostic', authorize: () => true, logger: { warn },
      providers: { test: { generate: async () => ({ content: turn++ === 0 ? 'TOOL_CALL: ReadFile\nARGS: nope' : 'REPLOID/0\nIDLE: stopped' }) } } } });
  try { await agent.execute({ goal: 'Check malformed tool syntax' }); expect(warn).toHaveBeenCalled(); }
  finally { await agent.close(); }
});
