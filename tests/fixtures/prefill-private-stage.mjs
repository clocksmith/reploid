// Operator-side qualification tool. Plans without joining any room unless --transfer is present.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import * as runtime from 'dopplerx/partitions';
import { createWorkPartitionPlan, isWorkOrderedModel } from '../../apps/poolday/host/work-partition-plan.js';
import catalog from '../../shared/config/chat-models.json' with { type: 'json' };
import bootstrap from '../../shared/config/swarm-bootstrap.json' with { type: 'json' };
import { ROOM_ID_PATTERN } from '../../server/swarm-protocol.js';
import { resolveServedFile } from '../../server/browser-roots.js';
import { createNativeParticipant } from '../../server/native-participant-runtime.js';
import { readOwnFile } from '../../server/fleet/native-host.js';
import { readNativeRoomTokenFile } from '../../server/native-room-token.js';
import { createNativeRtcAdapter } from '../../server/native-rtc-adapter.js';
import { openNativeSupplyBudget } from '../../server/native-supply-budget.js';
import { participantIdFor } from '../../packages/reploid/src/artifacts/participant-proofs.js';
import { checkCustodyKeyCertificate, CUSTODY_CERTIFICATE_LIFETIME_MS } from '../../packages/reploid/src/artifacts/custody-certificate.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const positive = value => Number.isSafeInteger(value) && value > 0;

export function checkedStage({ model, inventoryBytes, expectedInventorySha256, stageIndex, manifestBytes, indexBytes }) {
  assert.equal(hash(inventoryBytes), expectedInventorySha256, 'Inventory differs from the separately pinned assignment');
  const inventory = JSON.parse(inventoryBytes);
  assert.equal(inventory.modelId, model.id);
  assert.equal(inventory.modelIdentity, model.identity);
  assert.equal(inventory.planId, model.partitionPlanId);
  assert.equal('sha256:' + hash(manifestBytes), model.identity);
  const manifest = JSON.parse(manifestBytes), index = JSON.parse(indexBytes);
  assert.equal(manifest.modelId, model.id);
  assert.equal(index.manifestIdentity, model.identity);
  assert.equal(hash(indexBytes), inventory.indexSha256);
  assert.equal(inventory.indexSha256, model.source.files.find(f => f.role === 'model-piece-index').hash);
  const plan = model.partitionRequest ? createWorkPartitionPlan(runtime, manifest, model) : model.partitionPlan;
  const stage = inventory.stages[stageIndex], partition = plan.partitions[stageIndex];
  assert(partition && stage && partition.index === stageIndex && stage.stageIndex === stageIndex, 'Unknown stage index');
  assert.deepEqual(stage.layerRange, partition.layerRange);
  const pieces = new Map();
  for (const f of index.files) for (const piece of f.pieces) pieces.set(f.path + ':' + piece.offset, piece);
  const seen = new Set();
  let bytes = 0;
  for (const range of stage.ranges) {
    const key = range.path + ':' + range.offset, piece = pieces.get(key);
    assert.equal(manifest.shards[range.shardIndex]?.filename, range.path);
    assert(!seen.has(key) && piece && positive(range.size) && piece.size === range.size && piece.identity === range.identity,
      'Stage range is duplicated or differs from the pinned index');
    seen.add(key); bytes += range.size;
  }
  assert(positive(bytes) && stage.assignedBytes === bytes, 'Stage byte accounting mismatch');
  return stage;
}

export async function warmStage(source, stage, { signal, onProgress = () => {} }) {
  let pieces = 0, bytes = 0;
  for (const range of stage.ranges) {
    signal.throwIfAborted();
    const data = new Uint8Array(await source.storage.loadShardRange(range.shardIndex, range.offset, range.size));
    assert.equal(data.byteLength, range.size);
    assert.equal('sha256:' + hash(data), range.identity, 'Returned bytes differ from the pinned assignment');
    bytes += data.byteLength; ++pieces;
    onProgress({ pieces, bytes });
  }
  signal.throwIfAborted();
  const { transferredBytes, reusedBytes, completedPieces, suppliers } = source.getReceipt().custody;
  return { pieces, bytes, transferredBytes, reusedBytes, completedPieces, suppliers };
}

export function supplierGate(publicJwk) {
  assert(publicJwk && !publicJwk.d, 'Only the approved supplier public JWK is needed');
  return async certificate => !(await checkCustodyKeyCertificate(certificate, {
    publicJwk, atMs: Date.now(), maxLifetimeMs: CUSTODY_CERTIFICATE_LIFETIME_MS, maxClockSkewMs: 0
  })).length;
}

export async function runPrefill(config, inventoryFile, transfer, signal, { models = catalog, onProgress = state => { if (state.pieces % 128 === 0) console.error(JSON.stringify(state)); } } = {}) {
  assert(['enrolled', 'offline-unenrolled'].includes(config.enrollmentStatus), 'Declare the private enrollment status');
  assert(!transfer || config.enrollmentStatus === 'enrolled', 'An offline, unenrolled profile cannot transfer');
  const model = models.find(row => row.id === config.modelId);
  assert(isWorkOrderedModel(model) && config.modelIdentity === model.identity && config.planId === model.partitionPlanId,
    'Select the exact catalog model and plan');
  assert(ROOM_ID_PATTERN.test(config.roomId) && config.roomId !== bootstrap.publicRoomId && config.signalingUrl, 'An explicit private room and signaling server are required');
  assert(config.roomTokenFile && path.isAbsolute(config.roomTokenFile) && path.isAbsolute(config.identityFile)
    && path.isAbsolute(config.modelDirectory) && path.isAbsolute(config.cacheDirectory), 'Expected absolute local paths');
  assert(positive(config.maxCacheBytes) && positive(config.maxDownloadBytes) && positive(config.offerTimeoutMs),
    'Explicit disk, cumulative payload and discovery limits are required');
  assert(/^peer:[a-f0-9]{24,64}$/.test(config.receiverId) && config.receiverId !== config.supplierId,
    'Bind the stage to a separate receiver participant ID');
  const approved = supplierGate(config.supplierPublicJwk);
  assert.equal(await participantIdFor(config.supplierPublicJwk), config.supplierId, 'Supplier public key differs from the pinned identity');
  const readMetadata = async role => {
    const entry = model.source.files.find(f => f.role === role);
    assert(entry && /^[\w.-]+$/.test(entry.path), 'Expected a local metadata filename');
    try { return await fs.readFile(path.join(config.modelDirectory, entry.path)); }
    catch (error) {
      if (error.code !== 'ENOENT' || !/^\/config\/model-(manifests|pieces)\/[\w.-]+$/.test(entry.url ?? '')) throw error;
      return fs.readFile(resolveServedFile(entry.url));
    }
  };
  const stage = checkedStage({ model, inventoryBytes: await fs.readFile(inventoryFile), expectedInventorySha256: config.inventorySha256,
    stageIndex: config.stageIndex, manifestBytes: await readMetadata('model-manifest'), indexBytes: await readMetadata('model-piece-index') });
  const result = { enrollmentStatus: config.enrollmentStatus, modelId: model.id, modelIdentity: model.identity, planId: model.partitionPlanId,
    inventorySha256: config.inventorySha256, stageIndex: stage.stageIndex, layerRange: stage.layerRange,
    assignedBytes: stage.assignedBytes, assignedRanges: stage.ranges.length, receiverId: config.receiverId, supplierId: config.supplierId,
    maxCacheBytes: config.maxCacheBytes, maxDownloadBytes: config.maxDownloadBytes };
  if (!transfer) return { ...result, mode: 'plan' };
  assert(stage.assignedBytes <= config.maxCacheBytes, 'Stage exceeds the owner’s cache budget');
  const roomToken = process.getuid ? await readNativeRoomTokenFile(config.roomTokenFile) : (await readOwnFile(config.roomTokenFile)).trimEnd();
  const identity = JSON.parse(await readOwnFile(config.identityFile));
  assert.equal(await participantIdFor(identity.publicJwk), config.receiverId, 'Local key differs from the pinned stage receiver');
  const [rtcModule, wsModule] = await Promise.all([import('@roamhq/wrtc'), import('ws')]);
  const rtc = createNativeRtcAdapter(rtcModule.default ?? rtcModule), Socket = wsModule.default ?? wsModule.WebSocket;
  class HostSocket extends Socket { constructor(url) { super(url, { origin: config.origin ?? 'http://localhost:8000' }); } }
  await fs.mkdir(config.cacheDirectory, { recursive: true, mode: 0o700 });
  // One qualification writer per real cache. SQLite relinquishes this lock after process death.
  const cache = await fs.realpath(config.cacheDirectory), lock = new DatabaseSync(cache + '.stage-prefill.sqlite');
  let budget, participant, source, announce;
  try {
    lock.exec('BEGIN EXCLUSIVE');
    budget = await openNativeSupplyBudget({ directory: cache + '.stage-download-budget', maxBytes: config.maxDownloadBytes, purpose: 'acquisition' });
    const initial = budget.getState().reservedBytes;
    signal.throwIfAborted();
    participant = await createNativeParticipant({ model, modelDirectory: config.modelDirectory, identity, rtc, WebSocket: HostSocket,
      signalingUrl: config.signalingUrl, roomId: config.roomId, roomToken, cacheDirectory: cache, maxCacheBytes: config.maxCacheBytes,
      nativeGpu: () => { throw new Error('Stage prefill has no GPU provider'); },
      privateCustodyPrefill: { supplierId: config.supplierId, authorizeSupplier: approved, reserveDownload: async count => { signal.throwIfAborted(); await budget.reserve(count); } },
      ...(config.hostIceOnly === true ? { getRtcConfig: () => ({ iceServers: [] }) } : {}) });
    announce = setInterval(() => participant.announceFiles(), 1000);
    source = await participant.preparePrivateStageSource({ signal, waitForOfferMs: config.offerTimeoutMs });
    const summary = await warmStage(source, stage, { signal, onProgress });
    return { ...result, mode: 'filled', ...summary, reservedBefore: initial, reservedAfter: budget.getState().reservedBytes };
  } finally {
    clearInterval(announce);
    try { await source?.storage.close(); }
    finally {
      try { await participant?.close(); }
      finally { try { budget?.close(); } finally { lock.close(); } }
    }
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [configFile, inventoryFile, flag, ...rest] = process.argv.slice(2);
  assert(configFile && inventoryFile && !rest.length && (flag === undefined || flag === '--transfer'),
    'Usage: node tests/fixtures/prefill-private-stage.mjs STAGE_CONFIG INVENTORY [--transfer]');
  const controller = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => controller.abort(new Error(sig)));
  try { console.log(JSON.stringify(await runPrefill(JSON.parse(await fs.readFile(configFile)), inventoryFile, flag === '--transfer', controller.signal))); }
  catch (error) { console.error(error); process.exitCode = 1; }
}
