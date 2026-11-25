// @vitest-environment node
// No model/GPU imports: verify the frozen comparison's lifecycle request contract.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssertionError } from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanEnvironment, lifecycleOutputs, nativeRequests, protocolRun, validateWorkloads }
  from '../fixtures/peers/pooled/compare-complete.js';

const WORKER_PRELUDE = `import readline from 'node:readline';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const reply = record => process.stdout.write('@q4-response ' + JSON.stringify(record) + '\\n');
`;

async function inTemporary(fn) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'native-lifecycle-'));
  try { return await fn(directory); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

afterEach(() => vi.unstubAllEnvs());

describe('compare-complete lifecycle contract', () => {
  it('includes owned startup and preflight in the setup clock before open', async () => {
    const script = WORKER_PRELUDE + `await sleep(50);
for await (const line of readline.createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.op === 'preflight') await sleep(20);
  if (request.op === 'open') await sleep(10);
  reply({ id: request.id, requestOp: request.op, value: {} });
  if (request.op === 'close') break;
}
process.stdin.destroy();`;
    const rows = await inTemporary(directory => protocolRun([process.execPath, '--input-type=module', '-e', script],
      ['preflight', 'open', 'close'].map(op => ({ op })), path.join(directory, 'worker.log'), 5));
    expect(rows[1].clientSetupScope).toBe('owned-worker-startup-preflight-open/v1');
    expect(rows[1].clientSetupWallMs).toBeGreaterThanOrEqual(70);
    expect(rows[1].clientSetupWallMs).toBeGreaterThan(rows[1].clientOpenWallMs);
    expect(rows[0]).not.toHaveProperty('clientSetupWallMs');
  });

  it('builds an explicit engine environment instead of inheriting one', () => {
    const ambient = { POOLED_FLASH_KV: 'f32', DOPPLER_DEBUG: '1', NODE_OPTIONS: 'ambient',
      DAWN_OPTS: 'ambient', UV_THREADPOOL_SIZE: '99', RN_DEBUG: '1' };
    for (const [key, value] of Object.entries(ambient)) vi.stubEnv(key, value);
    const clean = cleanEnvironment();
    for (const key of Object.keys(ambient)) expect(clean).not.toHaveProperty(key);
    expect(clean.PATH).toBe(process.env.PATH);
    expect(cleanEnvironment({ POOLED_FLASH_KV: 'f16' }).POOLED_FLASH_KV).toBe('f16');
    expect(cleanEnvironment({ POOLED_WIRE_DUP: '' }).POOLED_WIRE_DUP).toBe('');
    expect(() => cleanEnvironment({ POOLED_FLASH_KV: 16 })).toThrow(AssertionError);
  });

  it('passes only declared engine overrides to the owned worker', async () => {
    vi.stubEnv('POOLED_FLASH_KV', 'ambient');
    vi.stubEnv('DOPPLER_DEBUG', 'ambient');
    const script = WORKER_PRELUDE + `for await (const line of readline.createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  reply({ id: request.id, requestOp: request.op, value: {
    peer: process.env.POOLED_FLASH_KV ?? null, native: process.env.DOPPLER_DEBUG ?? null } });
  if (request.op === 'close') break;
}
process.stdin.destroy();`;
    const rows = await inTemporary(directory => protocolRun([process.execPath, '--input-type=module', '-e', script],
      [{ op: 'close' }], path.join(directory, 'worker.log'), 5, { POOLED_FLASH_KV: 'f16' }));
    expect(rows[0].peer).toBe('f16');
    expect(rows[0].native).toBeNull();
    expect(rows[0].ownedProcessExit.graceful).toBe(true);
  });

  it('keeps held-out inputs from repeating frozen cases or colliding on disk', () => {
    const frozen = { name: 'first', classification: 'frozen', prompt: 'first', promptIds: [1], maxNew: 2, stopIds: [9] };
    const heldout = { ...frozen, name: 'second', classification: 'heldout', prompt: 'second', promptIds: [2] };
    validateWorkloads([frozen, heldout]);
    for (const changed of [{ ...heldout, name: 'first' }, { ...heldout, promptIds: [1] },
      { ...heldout, name: '../outside' }, { ...heldout, classification: 'frozen' }]) {
      expect(() => validateWorkloads([frozen, changed])).toThrow(AssertionError);
    }
  });

  it('runs the lifecycle after timing and before receipts and close', () => {
    const workload = { prompt: 'held-out', promptIds: [1], maxNew: 3, stopIds: [9] };
    const requests = nativeRequests(workload, true);
    expect(requests.map(row => row.op)).toEqual(['preflight', 'open', 'request', 'request', 'request', 'lifecycle', 'receipts', 'close']);
    expect(requests.slice(2, 5).map(row => row.repeat)).toEqual([0, 1, 2]);
    expect(requests[5]).toEqual({ ...workload, op: 'lifecycle' });
    expect(workload).not.toHaveProperty('op');
  });

  it('does not silently add model work to a legacy freeze', () => {
    const ops = nativeRequests({ maxNew: 1 }, false).map(row => row.op);
    expect(ops.slice(-2)).toEqual(['receipts', 'close']);
    expect(ops).not.toContain('lifecycle');
    expect(() => nativeRequests({ maxNew: 1 }, true)).toThrow(AssertionError);
    expect(() => nativeRequests({ maxNew: 1 }, true)).toThrow(/multi-token/);
  });

  it('fails partial or unobserved cancellation receipts', () => {
    const value = { schema: 'reploid.native-complete-lifecycle/v1', observedTokens: 1,
      first: { sampledIds: [5] }, repeat: { sampledIds: [5] }, recovered: { sampledIds: [5] },
      phases: ['first-complete-request', 'repeated-complete-request', 'pre-aborted-request',
        'active-cancellation-settled', 'recovered-complete-request'].map(name => ({ name })) };
    expect(lifecycleOutputs(value)).toEqual([value.first, value.repeat, value.recovered]);
    for (const changes of [{ observedTokens: 0 }, { phases: value.phases.slice(0, -1) }, { schema: 'other' }]) {
      expect(() => lifecycleOutputs({ ...value, ...changes })).toThrow(AssertionError);
    }
  });
});
