// GPU-free native contributor custody control. Paths are explicit run inputs.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { createSwarmTransport } from '../../packages/reploid/src/transport/index.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createNativeRtcAdapter } from '../../server/native-participant.js';
import { createNativeModelFiles } from '../../server/native-model-files.js';
import profile from '../../self/config/reploid-library.json' with { type: 'json' };
import bootstrap from '../../self/config/swarm-bootstrap.json' with { type: 'json' };
import models from '../../self/config/chat-models.json' with { type: 'json' };
import rtcProvider from '/var/tmp/reploid-native-deps-20261012/node_modules/@roamhq/wrtc/lib/index.js';
import Socket from '/var/tmp/reploid-native-deps-20261012/node_modules/ws/wrapper.mjs';
const root = '/var/tmp/reploid-native-acquisition-stop-v3-20261012', model = models.find(m => m.id === 'qwen-3-5-0-8b-q4k-ehaf16');
await fs.mkdir(root + '/empty-model', { recursive: true });
const identity = await createSigningIdentity({ algorithm: 'Ed25519' }), rtc = createNativeRtcAdapter(rtcProvider);
const bus = new EventEmitter();
const config = resolveConfig({ profile: profile.profile, overrides: { mesh: { enabled: true, executeJobs: false, roomId: bootstrap.publicRoomId },
  webrtc: { signalingUrl: `ws://127.0.0.1:18000/swarm?scope=public&roomId=${bootstrap.publicRoomId}`, broadcastRoomId: bootstrap.publicRoomId, transportOrder: ['webrtc'] } } });
class WebSocket extends Socket { constructor(url) { super(url, { origin: 'http://localhost:8000' }); } }
const transport = createSwarmTransport({ config, Utils: { logger: console, generateId: () => crypto.randomUUID() },
  EventBus: { emit: (...args) => bus.emit(...args), on(name, fn) { bus.on(name, fn); return () => bus.off(name, fn); } },
  WebSocket, ...rtc, getSessionId: () => identity.peerId,
  getRoomCredentials: () => ({ roomId: bootstrap.publicRoomId, token: bootstrap.publicJoinMarker }),
  introductions: { getIdentity: () => identity, authorize: async request => request.roomId === bootstrap.publicRoomId && request.action !== 'forward' } });
const offers = new Map();
const observedTransport = { ...transport, onMessage(type, handler) {
  transport.onMessage(type, (peer, message, envelope) => {
    if (type === 'reploid:custody-offer') offers.set(peer, structuredClone(message));
    return handler(peer, message, envelope);
  });
} };
let files, source, timer;
try {
  await transport.init();
  files = await createNativeModelFiles({ transport: observedTransport, modelDirectory: root + '/empty-model', cacheDirectory: root + '/cache' });
  timer = setInterval(() => files.announce(), 500);
  const deadline = Date.now() + 30000;
  const hasShard = () => [...offers.entries()].some(([peer, offer]) => transport.getConnectedPeers().some(row => row.id === peer) && offer.artifacts?.some(file => file.path === 'shard_00000.bin' && file.role === 'model-weights'));
  while (Date.now() < deadline && !hasShard()) await new Promise(r => setTimeout(r, 100));
  assert(hasShard(), 'Observed connected supplier must advertise the required shard before this acquisition control');
  const controller = new AbortController();
  source = await files.preparePartitionSource(model, { signal: controller.signal });
  const first = new Uint8Array(await source.storage.loadShardRange(0, 0, 8));
  const before = { receipt: source.getReceipt(), cache: await fs.readdir(root + '/cache'), files: files.getState() };
  const index = JSON.parse(await fs.readFile(new URL('../../self/config/model-pieces/qwen-0-8b-pieces.json', import.meta.url)));
  const secondPiece = index.files.find(file => file.path === source.manifest.shards[0].filename)?.pieces[1];
  assert(secondPiece, 'Second piece must exist');
  const secondOffset = secondPiece.offset;
  const pending = source.storage.loadShardRange(0, secondOffset, 8).then(() => ({ completed: true }), error => ({ completed: false, error: error.message }));
  const pendingDeadline = Date.now() + 10000;
  while (!files.getState().pending && Date.now() < pendingDeadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert(files.getState().pending > 0, 'Real custody acquisition must be active before cancellation');
  await new Promise(resolve => setTimeout(resolve, 1500));
  const atStop = files.getState();
  controller.abort(new Error('Physical acquisition cancellation control'));
  const stopped = await pending;
  await Promise.all([source.storage.close(), source.storage.close()]); source = null;
  assert.equal(stopped.completed, false, 'Cancellation must precede completed second piece');
  assert.equal(files.getState().pending, 0, 'Acquisition must settle');
  const afterStop = { stopped, cache: await fs.readdir(root + '/cache'), files: files.getState() };
  assert.deepEqual(afterStop.cache.sort(), before.cache.sort(), 'Only the first complete piece and metadata survive');
  assert(!afterStop.cache.some(name => name.endsWith('.tmp')), 'No unfinished temporary files remain');
  source = await files.preparePartitionSource(model, { signal: AbortSignal.timeout(60000) });
  assert.deepEqual(new Uint8Array(await source.storage.loadShardRange(0, 0, 8)), first);
  const reused = source.getReceipt();
  assert.equal(reused.custody.transferredBytes, 0);
  assert.equal(reused.custody.reusedBytes, 4194304);
  const second = new Uint8Array(await source.storage.loadShardRange(0, secondOffset, 8));
  const retry = { receipt: source.getReceipt(), cache: await fs.readdir(root + '/cache'), files: files.getState(), secondBytes: [...second] };
  await fs.writeFile(root + '/observations.json', JSON.stringify({ before, atStop, afterStop, reused, retry }, null, 2));
  assert.equal(retry.receipt.custody.completedPieces, 1, 'Counts newly acquired pieces; cached reuse is separate');
  assert.equal(retry.receipt.pieces.length, 2, 'Both requested pieces were verified');
  assert.equal(retry.receipt.custody.transferredBytes, secondPiece.size);
  await source.storage.close(); source = null;
  await Promise.all([files.close(), files.close()]);
  const result = { ok: true, completedAt: new Date().toISOString(), gpuCreated: !!globalThis.navigator?.gpu,
    before, atStop, afterStop, reused, retry, afterClose: files.getState() };
  await fs.writeFile(root + '/result.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ event: 'settled-and-retried', ok: result.ok, gpuCreated: result.gpuCreated,
    retainedBytes: reused.custody.reusedBytes, retriedBytes: retry.receipt.custody.transferredBytes }));
} catch (error) {
  await fs.writeFile(root + '/failure.json', JSON.stringify({ error: error.stack, files: files?.getState(), offers: [...offers], source: source?.getReceipt() }, null, 2));
  throw error;
} finally { clearInterval(timer); await source?.storage.close(); await files?.close(); transport.disconnect(); }
