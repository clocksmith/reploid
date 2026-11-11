// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { planFleetPlacement } from '../../server/fleet/placement.js';
const hash = 'sha256:' + 'a'.repeat(64), planId = 'sha256:' + 'b'.repeat(64);
const model = { id: 'qwen', identity: hash, plans: [{ id: planId, stageCount: 2, activationBytesPerToken: 4096 }] };
const demand = [{ id: model.id, identity: hash, queued: 1, since: 9000, promptTokens: 30, outputTokens: 10 }];
const policy = { maxMeasurementAgeMs: 60000, maxObservationAgeMs: 2000, minResidencyMs: 100, maxRouteCandidates: 100, queuedRequestsPerReplica: 2 };
const measurement = (mode = 'whole-model', stageIndex = null) => ({ modelIdentity: hash, mode, stageIndex,
  planId: stageIndex === null ? null : planId, softwareIdentity: hash, qualified: true, receipt: 'actual-envelope-receipt', observedAt: 9990,
  maxPromptTokens: 30, maxOutputTokens: 10,
  prefillTokensPerSecond: 30, decodeTokensPerSecond: 10, loadMs: 100, requiredGpuBytes: 80, requiredHostBytes: 20, largestBindingBytes: 40 });
const computer = id => ({ id, softwareIdentity: hash, participantId: `peer:${id}`, observedAt: 9990, activeRequests: 0, resident: null,
  freeGpuBytes: 100, freeHostBytes: 100, maxStorageBufferBindingSize: 50,
  preferences: { enabled: true, models: [{ id: model.id, identity: hash }], maxGpuBytes: 100, maxHostBytes: 100 },
  measurements: [measurement()] });
const run = (computers, extra = {}) => planFleetPlacement({ computers, demand, models: [model], links: [], policy, now: 10000, ...extra });
describe('fleet placement', () => {
  it('prefers warm whole-model capacity over another download', () => {
    const a = computer('a'), b = computer('b');
    b.resident = { modelIdentity: hash, mode: 'whole-model', preparedAt: 100, gpuBytes: 80, hostBytes: 20 };
    expect(run([a, b]).routes[0].computers).toEqual(['b']);
  });
  it('rejects insufficient binding size even when total RAM fits', () => {
    const a = computer('a'); a.maxStorageBufferBindingSize = 32;
    expect(run([a]).routes).toEqual([]);
  });
  it('respects owner opt-out, allowed models, resource ceilings and expired observations', () => {
    for (const change of [a => { a.preferences.enabled = false; }, a => { a.preferences.models = []; },
      a => { a.preferences.maxGpuBytes = 79; }, a => { a.observedAt = 1; }, a => { a.measurements[0].qualified = false; }]) {
      const a = computer('a'); change(a); expect(run([a]).routes).toEqual([]);
    }
  });
  it('adds replicas only when queue demand justifies them', () => {
    expect(run([computer('a'), computer('b')]).routes).toHaveLength(1);
    expect(run([computer('a'), computer('b')], { demand: [{ ...demand[0], queued: 4 }] }).routes).toHaveLength(2);
  });
  it('does not move a busy provider or bypass minimum residency', () => {
    const a = computer('a'); a.activeRequests = 1;
    expect(run([a]).decisions).toEqual([expect.objectContaining({ action: 'retain', reason: 'active-requests' })]);
    a.activeRequests = 0; a.resident = { modelIdentity: 'other', preparedAt: 9999 };
    a.preferences.models.push({ id: 'other', identity: 'other' });
    expect(run([a]).decisions[0].reason).toBe('minimum-residency');
  });
  it('requires complete stage coverage and measured links across distinct computers', () => {
    const a = computer('a'), b = computer('b');
    a.measurements = [measurement('partition', 0)]; b.measurements = [measurement('partition', 1)];
    expect(run([a, b]).routes).toEqual([]);
    const result = run([a, b], { links: [{ from: 'a', to: 'b', bytesPerSecond: 1e7, latencyMs: 3, observedAt: 9990 }] });
    expect(result.routes[0]).toMatchObject({ mode: 'partition', computers: ['a', 'b'] });
    expect(result.routes[0].estimatedMs).toBeGreaterThan(4200);
  });
  it('retains idle caches when no request needs another model', () => {
    expect(run([computer('a')], { demand: [] }).decisions[0]).toMatchObject({ action: 'retain', reason: 'no-uncovered-demand' });
  });
  it('counts already resident buffers while a busy provider keeps serving the same model', () => {
    const a = computer('a'); a.activeRequests = 1; a.freeGpuBytes = 20;
    a.resident = { modelIdentity: hash, mode: 'whole-model', preparedAt: 100, gpuBytes: 80, hostBytes: 20 };
    expect(run([a]).routes[0]).toMatchObject({ computers: ['a'], busy: true });
    expect(run([a]).decisions).toHaveLength(1);
  });
  it('keeps a complete resident partition route during minimum residency and active work', () => {
    const a = computer('a'), b = computer('b');
    for (const [index, row] of [a, b].entries()) {
      row.measurements = [measurement('partition', index)];
      row.resident = { modelIdentity: hash, mode: 'partition', planId, stageIndex: index, preparedAt: 9999, gpuBytes: 80, hostBytes: 20 };
    }
    b.activeRequests = 1;
    const result = run([a, b], { links: [{ from: 'a', to: 'b', bytesPerSecond: 1e7, latencyMs: 3, observedAt: 9990 }] });
    expect(result.routes[0].computers).toEqual(['a', 'b']);
    expect(result.decisions).toHaveLength(2);
    expect(result.decisions.every(row => row.action === 'retain')).toBe(true);
  });
  it('rejects stale measurements, changed software, and demand outside the measured envelope', () => {
    for (const change of [a => { a.measurements[0].observedAt = -60000; }, a => { a.softwareIdentity = planId; },
      a => { a.measurements[0].maxPromptTokens = 29; }, a => { a.measurements[0].maxOutputTokens = 9; }]) {
      const a = computer('a'); change(a); expect(run([a]).routes).toEqual([]);
    }
  });
  it('stops opted-out idle residents but drains active requests before stopping', () => {
    const a = computer('a'); a.preferences.enabled = false;
    a.resident = { modelIdentity: hash, mode: 'whole-model', preparedAt: 9999 };
    expect(run([a]).decisions[0].action).toBe('stop');
    a.activeRequests = 1;
    expect(run([a]).decisions[0]).toMatchObject({ action: 'retain', reason: 'active-requests' });
  });
  it('reclaims resident host memory for the same model or idle replacement, but not while busy with another model', () => {
    const a = computer('a');
    a.freeHostBytes = 5;
    a.resident = { modelIdentity: hash, mode: 'whole-model', preparedAt: 100, gpuBytes: 80, hostBytes: 20 };
    expect(run([a]).routes[0]).toMatchObject({ computers: ['a'] });
    a.resident = { modelIdentity: 'sha256:' + 'e'.repeat(64), mode: 'whole-model', preparedAt: 100, gpuBytes: 80, hostBytes: 20 };
    a.preferences.models.push({ id: 'other', identity: a.resident.modelIdentity });
    a.activeRequests = 1;
    expect(run([a]).routes).toEqual([]);
  });
});
