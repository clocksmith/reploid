// Run in a private network namespace with only loopback and no GPU devices.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { networkInterfaces, tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import http from 'node:http';
import SignalingServer from '../../server/signaling-server.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import catalog from '../../shared/config/chat-models.json' with { type: 'json' };

assert(Object.values(networkInterfaces()).flat().every(address => address.internal), 'Requires an isolated loopback network namespace');
for (const device of ['/dev/dri', '/dev/kfd', '/dev/nvidia0']) {
  await assert.rejects(access(device), { code: 'ENOENT' });
}
const [code, policy] = process.argv.slice(2);
assert(path.isAbsolute(code) && ['room', 'named'].includes(policy));
const root = await mkdtemp(path.join(tmpdir(), 'native-custody-'));
const sha = value => createHash('sha256').update(value).digest('hex');
const token = randomUUID(), room = 'reploid-swarm-private-' + randomUUID();
const limitGiB = '1', modelId = 'tiny-custody';
const bytes = Buffer.from('one scope, two pieces!!!');
const manifest = Buffer.from(JSON.stringify({ modelId, hashAlgorithm: 'sha256',
  shards: [{ filename: 'weights.bin', size: bytes.length, hash: sha(bytes) }] }));
const pieceBytes = bytes.length / 2;
const pieces = [0, pieceBytes].map(offset => ({ offset, size: pieceBytes,
  identity: 'sha256:' + sha(bytes.subarray(offset, offset + pieceBytes)) }));
const index = Buffer.from(JSON.stringify({ schema: 'doppler.verified-pieces/v1', manifestIdentity: 'sha256:' + sha(manifest),
  maxPieceBytes: pieceBytes, files: [{ path: 'weights.bin', size: bytes.length, pieces }] }));
const model = { id: modelId, name: 'Private synthetic custody', provider: 'doppler', identity: 'sha256:' + sha(manifest),
  executionModes: ['whole-model'], generation: catalog.find(row => row.generation).generation,
  source: { files: [['manifest.json', 'model-manifest', manifest], ['pieces.json', 'model-piece-index', index]]
    .map(([name, role, data]) => ({ path: name, role, hashAlgorithm: 'sha256', hash: sha(data), sizeBytes: data.length })) } };
await writeFile(path.join(root, 'model.json'), JSON.stringify({ schema: 'reploid.native-model/v1', model }));
await writeFile(path.join(root, 'room.token'), token, { mode: 0o600 });
const signaling = new SignalingServer({ path: '/signaling', localOnly: true });
const server = http.createServer();
server.on('upgrade', (request, socket, head) => {
  if (signaling.shouldHandle(request)) signaling.handleUpgrade(request, socket, head);
  else socket.destroy();
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const signalUrl = 'ws://127.0.0.1:' + server.address().port + '/signaling';
const peers = new Set();
async function start(label, id, command, extra = []) {
  const dir = path.join(root, label), weights = path.join(dir, 'weights');
  await mkdir(weights, { recursive: true });
  await writeFile(path.join(dir, 'identity.json'), JSON.stringify(id), { mode: 0o600 });
  await writeFile(path.join(weights, 'manifest.json'), manifest);
  await writeFile(path.join(weights, 'pieces.json'), index);
  if (command === 'share') await writeFile(path.join(weights, 'weights.bin'), bytes);
  const args = [path.join(code, 'server/native-node.js'), command, modelId, '--model-config', path.join(root, 'model.json'),
    '--weights', weights, '--identity-file', path.join(dir, 'identity.json'), '--room', room, '--room-token-file', path.join(root, 'room.token'),
    '--signaling-url', signalUrl, ...extra];
  const child = spawn(process.execPath, args, { cwd: code, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HOME: dir } });
  peers.add(child);
  const exit = once(child, 'exit').then(([status, signal]) => { peers.delete(child); return { status, signal }; });
  const lines = [], rows = [];
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', line => {
      lines.push(line);
      try { rows.push(JSON.parse(line)); } catch { /* Node also writes diagnostics. */ }
    });
  }
  async function until(check, timeout = 16000) {
    const end = Date.now() + timeout;
    while (!check()) {
      if (child.exitCode !== null || child.signalCode || Date.now() >= end) {
        const details = lines.filter(line => !line.startsWith('{')).slice(-16);
        throw Error(label + ': ' + JSON.stringify({ exit: child.exitCode, details,
          rows: rows.slice(-4).map(row => [row.event, row.error, row.phase, row.files?.remoteOffers, row.files?.offeredFiles]) }));
      }
      await delay(50);
    }
  }
  return { weights, dir, child, exit, until, rows, lines };
}
try {
  const [supplier, allowed, excluded] = await Promise.all(Array.from({ length: 3 },
    () => createSigningIdentity({ algorithm: 'Ed25519' })));
  const host = await start('supplier', supplier, 'share', ['--supply-limit-gib', limitGiB,
    ...(policy === 'named' ? ['--supply-to', allowed.peerId] : [])]);
  await host.until(() => host.rows.some(row => row.event === 'network' && row.files?.sharing === true));
  async function requester(label, identity, permitted) {
    const job = await start(label, identity, 'serve');
    if (permitted) {
      await job.until(() => job.rows.some(row => row.event === 'model-fill' && row.phase === 'complete'));
      assert.deepEqual(await readFile(path.join(job.weights, 'weights.bin')), bytes);
      const complete = job.rows.find(row => row.event === 'model-fill' && row.phase === 'complete');
      const received = complete.sources['authorized-custody-peers'];
      assert.equal(received.bytes, bytes.length);
      assert.equal(received.pieces, pieces.length);
      return { verifiedPayload: received.bytes, pieces: received.pieces, sha256: sha(bytes), suppliers: complete.suppliers,
        weightSources: Object.keys(complete.sources).filter(source => complete.sources[source].bytes > 0) };
    }
    await job.until(() => job.lines.some(line => line.includes('File requester is not permitted')));
    await assert.rejects(access(path.join(job.weights, 'weights.bin')), { code: 'ENOENT' });
    return { refused: true, verifiedPayload: 0 };
  }
  function supplyBudget() {
    const db = new DatabaseSync(path.join(host.dir, 'model-cache', 'custody-budget.sqlite'), { readOnly: true });
    try { return JSON.parse(db.prepare('SELECT record FROM allowance WHERE id = 1').get().record); }
    finally { db.close(); }
  }
  const denied = policy === 'named' ? await requester('excluded', excluded, false) : null;
  const beforePermitted = supplyBudget();
  assert.equal(beforePermitted.reservedBytes, 0);
  const permitted = await requester('allowed', allowed, true);
  host.child.kill('SIGTERM');
  const stopped = await host.exit;
  assert.deepEqual(stopped, { status: 0, signal: null });
  const initialized = host.rows.find(row => row.event === 'native-initialized');
  assert.equal(initialized.shaderCache, null);
  assert.equal(host.rows.find(row => row.event === 'reploid-node').chosen['gpu-module'], undefined);
  assert(!host.rows.some(row => row.event === 'model-fill' || row.event === 'shader-cache'));
  const budget = supplyBudget();
  assert.equal(budget.reservedBytes, bytes.length);
  console.log(JSON.stringify({ policy, approvedRequester: allowed.peerId, modelIdentity: model.identity,
    indexIdentity: 'sha256:' + sha(index), permitted, denied, supplierStop: stopped,
    supplyLimitBytes: Number(limitGiB) * 2 ** 30, budget, reservedBeforePermitted: beforePermitted.reservedBytes, supplierCompute: false }));
} finally {
  await Promise.all([...peers].map(async child => {
    const stopped = once(child, 'exit');
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 2500);
    try { await stopped; } finally { clearTimeout(timer); }
  }));
  signaling.close();
  await new Promise(resolve => server.close(resolve));
}
