// @vitest-environment node
// Passive A1 sampler: counter deltas, explicit phase markers, report context and residency gates.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { harnessContext, ioDelta, phaseSnapshot, processSnapshot, residency } from '../../scripts/benchmarks/a1-resource-sampler.js';

let directory;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-resource-sampler-')); });
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

describe('a1 resource sampler', () => {
  it('refuses deltas for missing, reused or reset counters', () => {
    const old = { available: true, pid: 5, startTicks: '10', io: { read_bytes: 100, rchar: 200 } };
    const current = { ...old, io: { read_bytes: 130, rchar: 300 } };
    expect(ioDelta(old, current)).toEqual({ read_bytes: 30, rchar: 100 });
    expect(ioDelta(null, current)).toBeNull();
    expect(ioDelta(old, { ...current, startTicks: '11' })).toBeNull();
    expect(ioDelta(old, { ...current, io: { read_bytes: 1 } })).toBeNull();
  });

  it('attributes only explicit phase markers', () => {
    const marker = path.join(directory, 'phase.json');
    expect(phaseSnapshot(marker).available).toBe(false);
    fs.writeFileSync(marker, '{');
    expect(phaseSnapshot(marker).available).toBe(false);
    fs.writeFileSync(marker, JSON.stringify({ runId: 'r', armId: 'a', phase: 'open', eventId: '1' }));
    expect(phaseSnapshot(marker).phase).toBe('open');
  });

  it('does not report an unavailable process as zero I/O', () => {
    const result = processSnapshot(123, directory);
    expect(result.available).toBe(false);
    expect(result).not.toHaveProperty('io');
  });

  it('never claims request-phase attribution from the harness report', () => {
    const report = path.join(directory, 'report.json');
    fs.writeFileSync(report, JSON.stringify({ freezeSha256: 'a'.repeat(64), arms: [{}], stage: { kind: 'candidate' } }));
    const result = harnessContext(report, 'a'.repeat(64));
    expect(result.available).toBe(true);
    expect(result.requestPhaseAttribution).toBe(false);
    expect(result.completedArms).toBe(1);
    expect(harnessContext(report, 'b'.repeat(64)).available).toBe(false);
    fs.writeFileSync(report, '{');
    expect(harnessContext(report, 'a'.repeat(64)).available).toBe(false);
  });

  it('treats valid report JSON with the wrong shape as unavailable', () => {
    const report = path.join(directory, 'report');
    for (const value of [[], null, { freezeSha256: 'a'.repeat(64), arms: null }]) {
      fs.writeFileSync(report, JSON.stringify(value));
      expect(harnessContext(report, 'a'.repeat(64)).available).toBe(false);
    }
  });

  it('marks a PID reused during the snapshot as unavailable', () => {
    const first = '5 (worker name) ' + [...Array(19).fill('0'), '10'].join(' ');
    const second = '5 (worker name) ' + [...Array(19).fill('0'), '11'].join(' ');
    const reads = [first, 'read_bytes: 7', second][Symbol.iterator]();
    expect(processSnapshot(5, '/proc', { readText: () => reads.next().value }).reason).toBe('pid-reused-during-snapshot');
  });

  it('distinguishes the same phase name with a new event', () => {
    const marker = path.join(directory, 'marker');
    const value = { runId: 'r', armId: 'a', phase: 'request', eventId: '1' };
    fs.writeFileSync(marker, JSON.stringify(value));
    const before = phaseSnapshot(marker);
    value.eventId = '2';
    fs.writeFileSync(marker, JSON.stringify(value));
    expect(phaseSnapshot(marker)).not.toEqual(before);
  });

  it('rejects unowned files before any residency query', () => {
    const model = path.join(directory, 'model');
    fs.writeFileSync(model, 'test');
    let calls = 0;
    const result = residency([model], { geteuid: () => fs.statSync(model).uid + 1, run: () => { calls += 1; } });
    expect(result.available).toBe(false);
    expect(calls).toBe(0);
  });

  it('reports a missing residency tool explicitly', () => {
    const model = path.join(directory, 'model');
    fs.writeFileSync(model, 'test');
    let calls = 0;
    const missing = () => { calls += 1; throw Object.assign(new Error('spawn fincore ENOENT'), { code: 'ENOENT' }); };
    expect(residency([model], { run: missing }).available).toBe(false);
    expect(calls).toBe(1);
  });
});
