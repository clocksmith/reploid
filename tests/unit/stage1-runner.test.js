// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runStage1Phases } from '../../scripts/stage1/runner.js';
import { STAGE1_PHASES } from '../../scripts/stage1/receipt-check.js';
import { measureDirectoryBytes, measureHeldRanges, observeInventory, rangesDigest, summarizeRanges } from '../../scripts/stage1/inventory.js';
import { loadStage1Expectations, STAGE1_PINS } from '../../scripts/stage1/expectations.js';

const limits = { maxRunMs: 5000, phaseMs: 1000, abortGraceMs: 50, hardStopMs: 200 };
const expectations = { workload: {} };

function adapter(overrides = {}) {
  const calls = [];
  const step = (name, value) => vi.fn(async () => { calls.push(name); return value; });
  return { calls, describe: () => ({ runtimeClass: 'fake-runtime' }),
    preflight: step('preflight', { requester: { participantId: 'r', preflight: {} }, hosts: [{ label: 'host-a', inventory: {} }, { label: 'host-b', inventory: {} }] }),
    soloControl: vi.fn(async label => { calls.push(`solo:${label}`); return { outcome: 'completed' }; }),
    splitAnswer: step('split', { workload: {}, split: {}, requesterAfterSplit: {}, inventoryBeforeSplit: { 'host-a': {}, 'host-b': {} }, inventoryAfterSplit: { 'host-a': {}, 'host-b': {} } }),
    cancelAnswer: step('cancel', { settlement: {} }), cleanup: step('cleanup', { processesExited: true }),
    hardStop: step('hardStop'), ...overrides };
}
const statuses = receipt => Object.fromEntries(STAGE1_PHASES.map(name => [name, receipt.phases[name].status]));
const run = (ports, options = {}) => runStage1Phases({ adapter: ports, expectations, limits, ...options });
const never = () => new Promise(() => {});
const untilAborted = ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));

describe('runStage1Phases', () => {
  it('runs every phase once, in order, and hard-stops nothing', async () => {
    const ports = adapter(), receipt = await run(ports);
    expect(ports.calls).toEqual(['preflight', 'solo:host-a', 'solo:host-b', 'split', 'cancel', 'cleanup']);
    expect(Object.values(statuses(receipt)).every(status => status === 'completed')).toBe(true);
    expect(receipt.hardStop).toBeNull();
  });

  it('records later phases as skipped after a failure, and still cleans up', async () => {
    const ports = adapter({ splitAnswer: vi.fn(async () => { throw Error('route lost'); }) }), receipt = await run(ports);
    expect(statuses(receipt)).toEqual({ preflight: 'completed', 'solo-a': 'completed', 'solo-b': 'completed', split: 'failed', cancel: 'skipped', cleanup: 'completed' });
    expect(receipt.phases.split.reason).toBe('route lost');
    expect(ports.cancelAnswer).not.toHaveBeenCalled();
    expect(ports.cleanup).toHaveBeenCalledOnce();
    expect(ports.hardStop).not.toHaveBeenCalled();
  });

  it('keeps a solo control that timed out as inconclusive and continues', async () => {
    const ports = adapter({ soloControl: vi.fn(async (label, context) => (label === 'host-a' ? untilAborted(context) : { outcome: 'completed' })) });
    const receipt = await run(ports, { limits: { ...limits, phaseMs: 30 } });
    expect(receipt.soloControls['host-a']).toEqual({ outcome: 'inconclusive', reason: 'timeout' });
    expect(receipt.phases['solo-a']).toEqual({ status: 'completed', result: 'inconclusive' });
    expect(ports.splitAnswer).toHaveBeenCalledOnce();
  });

  it('keeps a solo control that threw as inconclusive, never as a memory failure', async () => {
    const ports = adapter({ soloControl: vi.fn(async () => { throw Error('out of memory'); }) }), receipt = await run(ports);
    expect(receipt.soloControls['host-b']).toEqual({ outcome: 'inconclusive', reason: 'out of memory' });
  });

  it('hard-stops when a phase ignores its abort, and marks the rest skipped', async () => {
    const ports = adapter({ splitAnswer: vi.fn(never) });
    const receipt = await run(ports, { limits: { ...limits, phaseMs: 20 } });
    expect(statuses(receipt)).toMatchObject({ split: 'stopped', cancel: 'skipped', cleanup: 'skipped' });
    expect(receipt.hardStop).toMatchObject({ confirmed: true });
    expect(receipt.hardStop.reason).toContain('split');
    expect(ports.hardStop).toHaveBeenCalledOnce();
    expect(ports.cleanup).not.toHaveBeenCalled();
  });

  it('enforces the whole-run limit', async () => {
    const ports = adapter({ soloControl: vi.fn(untilAbortedSolo) });
    const receipt = await run(ports, { limits: { ...limits, maxRunMs: 30 } });
    expect(receipt.hardStop.reason).toContain('limit');
    expect(statuses(receipt)).toMatchObject({ 'solo-a': 'stopped', 'solo-b': 'skipped', split: 'skipped', cancel: 'skipped', cleanup: 'skipped' });
    expect(ports.hardStop).toHaveBeenCalledOnce();
  });

  it('stops from outside, including before the first phase', async () => {
    const controller = new AbortController();
    controller.abort(Error('operator stop'));
    const ports = adapter(), receipt = await run(ports, { signal: controller.signal });
    expect(ports.calls).toEqual(['hardStop']);
    expect(receipt.hardStop.reason).toBe('operator stop');
    expect(Object.values(statuses(receipt)).every(status => status === 'skipped')).toBe(true);
  });

  it('stops before a phase its guard refuses', async () => {
    const ports = adapter({ guard: vi.fn(async phase => { if (phase === 'split') throw Error('memory pressure'); }) });
    const receipt = await run(ports);
    expect(ports.splitAnswer).not.toHaveBeenCalled();
    expect(receipt.hardStop.reason).toContain('memory pressure');
    expect(statuses(receipt)).toMatchObject({ split: 'skipped', cancel: 'skipped', cleanup: 'skipped' });
  });

  it('hard-stops when cleanup fails', async () => {
    const ports = adapter({ cleanup: vi.fn(async () => { throw Error('process remained'); }) }), receipt = await run(ports);
    expect(receipt.phases.cleanup).toMatchObject({ status: 'failed' });
    expect(ports.hardStop).toHaveBeenCalledOnce();
    expect(receipt.hardStop.reason).toContain('Cleanup');
  });

  it('reports a hard stop that could not be confirmed', async () => {
    const ports = adapter({ guard: async () => { throw Error('stop'); }, hardStop: vi.fn(async () => { throw Error('kill failed'); }) });
    expect((await run(ports)).hardStop).toMatchObject({ confirmed: false, error: 'kill failed' });
  });

  it('refuses an adapter missing a phase', async () => {
    const ports = adapter(); delete ports.cancelAnswer;
    await expect(run(ports)).rejects.toThrow('cancelAnswer');
  });
});
function untilAbortedSolo(_label, context) { return untilAborted(context); }

describe('stage inventories', () => {
  let directory;
  const piece = (name, offset, bytes) => ({ path: name, offset, size: bytes.length, identity: 'sha256:' + createHash('sha256').update(bytes).digest('hex') });
  beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'stage1-inventory-')); });
  afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

  it('counts a range as held only when its bytes hash to its identity', async () => {
    const first = Buffer.alloc(64, 1), second = Buffer.alloc(64, 2), third = Buffer.alloc(64, 3);
    const ranges = [piece('a.bin', 0, first), piece('a.bin', 64, second), piece('a.bin', 128, third), piece('absent.bin', 0, first)];
    // The second range is a hole in a sparse file and the third is past the end of a truncated one.
    const handle = await fs.open(path.join(directory, 'a.bin'), 'w');
    await handle.write(first, 0, 64, 0); await handle.truncate(160); await handle.close();
    expect(await measureHeldRanges({ directory, ranges })).toEqual([ranges[0]]);
  });

  it('refuses a piece path that leaves the directory', async () => {
    await expect(measureHeldRanges({ directory, ranges: [{ path: '../x', offset: 0, size: 1, identity: 'sha256:0' }] })).rejects.toThrow('plain file name');
  });

  it('reports ranges held outside the stage', () => {
    const inside = { path: 'a', offset: 0, size: 4, identity: 'i' }, outside = { path: 'b', offset: 0, size: 6, identity: 'o' };
    expect(observeInventory({ held: [inside, outside], stageRanges: [inside], source: 'hashed-on-host' }))
      .toMatchObject({ source: 'hashed-on-host', rangeCount: 2, bytes: 10, outsideStageRanges: 1, outsideStageBytes: 6 });
  });

  it('gives one digest for one set of ranges in any order', () => {
    const a = { path: 'a', offset: 0, size: 4, identity: 'i' }, b = { path: 'a', offset: 4, size: 4, identity: 'j' };
    expect(rangesDigest([a, b])).toBe(rangesDigest([b, a]));
    expect(rangesDigest([a])).not.toBe(rangesDigest([b]));
    expect(summarizeRanges([a, b])).toMatchObject({ rangeCount: 2, bytes: 8 });
  });

  it('measures what a requester directory holds, and nothing for one that is absent', async () => {
    await fs.mkdir(path.join(directory, 'nested'));
    await fs.writeFile(path.join(directory, 'nested', 'shard.bin'), Buffer.alloc(32));
    expect(await measureDirectoryBytes([directory, path.join(directory, 'absent')])).toEqual({ weightBytes: 32, fileCount: 1 });
    expect(await measureDirectoryBytes([path.join(directory, 'absent')])).toEqual({ weightBytes: 0, fileCount: 0 });
  });

  it('derives the pinned 27B stage inventories from the plan and piece index', async () => {
    const { expectations: frozen, stageRanges } = await loadStage1Expectations({ runtimeClass: 'fake-runtime' });
    expect(frozen.inventorySha256).toBe(STAGE1_PINS.inventorySha256);
    expect(frozen.stages.map(stage => [stage.layerRange, stage.rangeCount, stage.bytes])).toEqual([[[0, 0], 1051, 2759168448], [[1, 63], 4461, 14235183680]]);
    expect(frozen.totalWeight).toEqual({ rangeCount: 5512, bytes: 16994352128 });
    const assigned = new Set(stageRanges[0].map(range => `${range.path}:${range.offset}`));
    expect(stageRanges[1].some(range => assigned.has(`${range.path}:${range.offset}`))).toBe(false);
    expect(frozen.reference).toMatchObject({ outputIds: [17, 17, 248046], outputText: '22' });
    expect(frozen.inventorySource).toBe('fake-runtime-declared');
    await expect(loadStage1Expectations({ runtimeClass: 'other' })).rejects.toThrow('runtime class');
  }, 30000);
});
