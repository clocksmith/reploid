// @vitest-environment node
// Real owned processes and transport; numerical peer/model execution substituted.
import { expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { inspectNativeRuntimeSource } from '../../server/native-runtime-source.js';
import { inspectPeerRuntime } from '../fixtures/peers/pooled/runtime-identity.js';
import { protocolRun } from '../fixtures/peers/pooled/compare-complete.js';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// The bounded client, provider-state, lifecycle, preflight and split suites live in their own
// test files; these two cases drive actual workers through compare-complete's protocolRun.
const protocol = (command, requests, root) => protocolRun(command, requests, path.join(root, 'stdout.log'), 5);

it('uses the shared client with the actual native metadata worker without importing a runtime or GPU', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-client-boundary-'));
  try {
    const source = path.join(root, 'source'); await fs.mkdir(path.join(source, 'src'), { recursive: true });
    await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({ name: 'dopplerx', version: '0.0.0', type: 'module' }));
    await fs.writeFile(path.join(source, 'src/partitions.js'), 'throw new Error("runtime must not import in metadata test");');
    const weights = Uint8Array.of(1, 2, 3, 4), manifest = JSON.stringify({ modelId: 'metadata-only', hashAlgorithm: 'sha256',
      shards: [{ filename: 'weights.bin', size: 4, hash: hash(weights) }] });
    const index = JSON.stringify({ schema: 'doppler.verified-pieces/v1', manifestIdentity: 'sha256:' + hash(manifest),
      files: [{ path: 'weights.bin', size: 4, pieces: [{ offset: 0, size: 4, identity: 'sha256:' + hash(weights) }] }] });
    await fs.writeFile(path.join(root, 'manifest.json'), manifest); await fs.writeFile(path.join(root, 'pieces.json'), index);
    await fs.writeFile(path.join(root, 'weights.bin'), weights);
    const identity = await inspectNativeRuntimeSource(source), config = path.join(root, 'config.json');
    await fs.writeFile(config, JSON.stringify({ installedPackage: source, sourceTree: { treeSha256: identity.treeSha256 },
      manifestPath: path.join(root, 'manifest.json'), manifestSha256: hash(manifest),
      pieceIndex: { path: 'pieces.json', role: 'model-piece-index', hashAlgorithm: 'sha256', hash: hash(index) } }));
    const rows = await protocol([process.execPath, path.join(repo, 'tests/fixtures/qwen-partition-worker.js'), config],
      [{ op: 'preflight' }, { op: 'close' }], root);
    expect(rows[0]).toMatchObject({ gpuOpened: false, model: { readyForWholeModel: true } });
    expect(rows[1]).toMatchObject({ gpuOpened: false, ownedProcessExit: { graceful: true, forced: false, exitCode: 0 } });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it('measures dispatch through the actual peer adapter with a substituted CPU SDK and natural shutdown', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'peer-client-boundary-'));
  try {
    const code = path.join(root, 'code'); await fs.mkdir(path.join(code, 'room'), { recursive: true });
    await fs.writeFile(path.join(code, 'package.json'), '{"type":"module"}');
    await fs.writeFile(path.join(code, 'gpu.js'), 'throw new Error("GPU must not import in CPU integration");');
    await fs.writeFile(path.join(code, 'room/sampling.js'), 'export const makeSampler=()=>logits=>logits[0];');
    await fs.writeFile(path.join(code, 'observer.js'), `export function createGpuMemoryObserver(capBytes){return {
      stats:{capBytes,liveBytes:0,peakBytes:0,overCapAllocations:0,errors:[]},attach(){throw Error('no GPU')}}}`);
    await fs.writeFile(path.join(code, 'sdk.js'), `export async function createRoom(){
      const experts={async close(){await Promise.resolve();}},engine={maxSeq:2048,experts,async close(){await experts.close();}};
      return {ai:{engine,experts,tok:{decode:ids=>ids.join(' ')}},split:{ranges:[[0,48]]},async start(){},
        ckptClear(){},locked:fn=>fn(),async generate(ids,o){for(const id of [5,6]){o.sample([id]);o.onToken(id);}
          return {tokens:[5,6],reused:0,resumed:0,prefilled:ids.length,pinned:0,from:null,count:2,reason:'max'};},
        async close(){engine.close().catch(()=>{});experts.close().catch(()=>{});}};}`);
    const provenance = { roots: [{ label: 'code', path: code }], maxBytes: 65536, timeoutMs: 1000 };
    const inventory = JSON.stringify(await inspectPeerRuntime(provenance)), inventoryPath = path.join(root, 'inventory.json');
    await fs.writeFile(inventoryPath, inventory);
    const config = path.join(root, 'config.json');
    await fs.writeFile(config, JSON.stringify({ protocol: true, sdk: path.join(code, 'sdk.js'), source: code,
      models: root, webgpuModule: path.join(code, 'gpu.js'), memoryObserver: path.join(code, 'observer.js'),
      provenance: { ...provenance, inventory: { path: inventoryPath, sha256: hash(inventory) } }, out: path.join(root, 'result.json'),
      gpuGB: 20, gpuCapGB: 32, ramGB: 8, ctx: 2048, requestTimeoutMs: 1000, minAvailableGiB: 0,
      minDevices: 1, signal: '127.0.0.1:1', expectedRanges: [[0, 48]] }));
    const rows = await protocol([process.execPath, path.join(repo, 'tests/fixtures/peers/pooled/complete-worker.js'), config],
      [{ op: 'open' }, { op: 'request', prompt: 'test', promptIds: [1], maxNew: 2, stopIds: [9] }, { op: 'close' }], root);
    expect(rows[1]).toMatchObject({ inputIds: [1], ids: [5, 6], text: '5 6', clientTimingScope: 'owned-local-stdio-jsonl/v1' });
    expect(rows[1].clientRequestWallMs).toBeGreaterThanOrEqual(rows[1].requestWallMs);
    expect(rows[1].clientRequestBytes).toBeGreaterThan(0); expect(rows[1].clientResponseBytes).toBeGreaterThan(0);
    expect(rows[2]).toMatchObject({ cleanup: 'settled', ownedProcessExit: { graceful: true, forced: false, exitCode: 0 } });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
