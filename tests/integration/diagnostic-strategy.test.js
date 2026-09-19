import { it, expect, vi } from 'vitest';
import { createDiagnosticInvestigation } from '../../packages/reploid/src/agent/diagnostic-strategy.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';
import { diagnosticModel as model, diagnosticPolicy as policy, observeSynthetic } from '../fixtures/diagnostic-model.js';

const options = (ports = {}, overrides = {}) => ({ model, policy,
  config: resolveConfig({ overrides: { tools: { allowed: ['MeasureDiagnostic'] } } }),
  ports: { instanceId: 'diagnostic-test', authorize: () => true,
    executeTool: async (_, { actionId }) => ({ outcomeId: observeSynthetic({ cause: 'memory', label: 2 }, actionId), evidenceId: `measured:${actionId}` }),
    ...ports }, ...overrides });

it('runs through the shared engine, retains predictions, and only recommends a repair', async () => {
  const authorize = vi.fn(() => true);
  const investigation = createDiagnosticInvestigation(options({ authorize }));
  expect(investigation.getExecutionEvents()).toEqual([]);
  const result = await investigation.run();
  expect(result.recommendation).toEqual({ decisionId: 'memory', expectedUtility: 1 });
  expect(result.attempted).toEqual(['reference', 'reduced-input']);
  expect(result.spent).toBeCloseTo(0.11);
  expect(result.history.every(entry => entry.status === 'observed')).toBe(true);
  expect(authorize.mock.calls.map(([r]) => r.action)).toEqual(['agent.execute', 'tool.execute', 'tool.execute']);
  expect(investigation.getExecutionEvents().filter(e => e.type === 'tool.completed')).toHaveLength(2);
  result.belief.fill(0);
  expect(investigation.checkpoint().state.recommendation.expectedUtility).toBe(1);
  await investigation.close();
  await expect(investigation.run()).rejects.toThrow('closed');
});

it('preserves host and configuration gates without updating belief on denial', async () => {
  const executeTool = vi.fn();
  for (const extra of [options({ executeTool, authorize: r => r.action !== 'tool.execute' }),
    options({ executeTool }, { config: resolveConfig() })]) {
    const investigation = createDiagnosticInvestigation(extra);
    const result = await investigation.run();
    expect(result.status).toBe('blocked');
    expect(result.belief).toEqual(model.prior);
    expect(result.history[0].status).toBe('denied');
    await investigation.close();
  }
  expect(executeTool).not.toHaveBeenCalled();
});

it('retains rejected observations and failure costs without fabricating a posterior', async () => {
  const investigation = createDiagnosticInvestigation(options({ executeTool: async () => ({ outcomeId: 'unknown', evidenceId: 'bad-outcome' }) }));
  await expect(investigation.run()).rejects.toThrow('unknown observation');
  expect(investigation.getSnapshot()).toMatchObject({ belief: model.prior, spent: 0.05, history: [{ status: 'rejected', observation: { outcomeId: 'unknown' } }] });
  await investigation.close();
});

it('rejects duplicate evidence across otherwise distinct probes', async () => {
  const investigation = createDiagnosticInvestigation(options({ executeTool: async (_, { actionId }) => ({
    outcomeId: observeSynthetic({ cause: 'memory', label: 2 }, actionId), evidenceId: 'same-source-record'
  }) }));
  await expect(investigation.run()).rejects.toThrow('fresh bounded evidenceId');
  expect(investigation.getSnapshot().recommendation.expectedUtility).toBe(0.5);
  expect(investigation.getSnapshot().history[1].status).toBe('rejected');
  await investigation.close();
});

it('cancels promptly, suppresses late observations, and waits for borrowed work on close', async () => {
  let finish;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const investigation = createDiagnosticInvestigation(options({ executeTool: () => {
    started(); return new Promise(resolve => { finish = resolve; });
  } }));
  const run = investigation.run();
  expect(investigation.run()).toBe(run);
  await ready;
  expect(() => investigation.checkpoint()).toThrow();
  investigation.cancel();
  await expect(run).rejects.toThrow('cancelled');
  let closed = false;
  const closing = investigation.close().then(() => { closed = true; });
  await Promise.resolve();
  expect(closed).toBe(false);
  finish({ outcomeId: 'match', evidenceId: 'late' });
  await closing;
  expect(investigation.getSnapshot().belief).toEqual(model.prior);
  expect(investigation.getSnapshot().history[0].status).toBe('cancelled');
});

it('obeys the tighter engine cycle budget and keeps failure attempts charged', async () => {
  const investigation = createDiagnosticInvestigation(options({}, {
    config: resolveConfig({ overrides: { agent: { maxCycles: 1 }, tools: { allowed: ['MeasureDiagnostic'] } } })
  }));
  expect((await investigation.run()).attempted).toHaveLength(1);
  expect((await investigation.run()).attempted).toHaveLength(1);
  await investigation.close();
  const failure = createDiagnosticInvestigation(options({ executeTool() { throw new Error('measurement failed'); } }));
  expect(await failure.run()).toMatchObject({ status: 'blocked', spent: 0.05, belief: model.prior });
  await failure.close();
});

it('handles cancellation before dispatch and enforces checkpoint byte limits', async () => {
  const executeTool = vi.fn();
  const investigation = createDiagnosticInvestigation(options({ executeTool }));
  const run = investigation.run();
  investigation.cancel();
  await expect(run).rejects.toThrow('cancelled');
  expect(investigation.getSnapshot().status).toBe('cancelled');
  expect(executeTool).not.toHaveBeenCalled();
  await investigation.close();
  const bounded = createDiagnosticInvestigation(options({}, {
    config: resolveConfig({ overrides: { memory: { maxCheckpointBytes: 1 } } })
  }));
  expect(() => bounded.checkpoint()).toThrow('byte limit');
  await bounded.close();
});
