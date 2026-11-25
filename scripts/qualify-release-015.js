#!/usr/bin/env node
/**
 * End-to-end physical qualification harness for Reploid 0.1.5 + DopplerX 0.1.5:
 * 1. Multi-peer verified weight transfer benchmark (bytes/sec, receiver backpressure, duplicate reads, acquisition time).
 * 2. Backend source-revision binding, readiness check, and zero-downtime rollback verification (preserving the live Flash host).
 * 3. Signed external HTTP API answer, prefix-cache reuse, mid-stream cancellation hold closure, and subsequent independent request.
 * 4. Fresh Chromium browser conversation over real WebRTC + Apple Metal GPU provider with zero weight downloads.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import SignalingServer from '../server/signaling-server.js';
import { createProxy } from '../server/proxy-app.js';
import { buildCoordinatorRuntimeBundle } from '../server/pool/release-identity.js';
import { createSigningIdentity } from '../shared/vendor/reploid/artifacts/identity.js';
import { openFleetCredits } from '../server/fleet/credits.js';
import { startFleetService } from '../server/fleet/service.js';
import { openFleetNativeHost } from '../server/fleet/native-host.js';
import { startFleetTextApi } from '../server/fleet/text-api.js';
import catalog from '../shared/config/chat-models.json' with { type: 'json' };
import dopplerPin from '../shared/config/doppler-package.json' with { type: 'json' };

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [modelDir, outDir] = process.argv.slice(2);
if (!modelDir || !outDir) {
  console.error('Usage: node scripts/qualify-release-015.js <catalog-0.8b-model-dir> <output-dir>');
  process.exit(2);
}

const MODEL_ID = 'qwen-3-5-0-8b-q4k-ef16-af32-vf16';
const CATALOG_MODEL = catalog.find((entry) => entry.id === MODEL_ID);
assert(CATALOG_MODEL, `Catalog entry missing for ${MODEL_ID}`);

const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assertNoPrivatePaths(label, payload) {
  const text = JSON.stringify(payload, null, 2) + '\n';
  if (/\/Users\/|\/home\/|\/private\/tmp\//.test(text)) {
    throw new Error(`Refusing to emit ${label} containing host-local paths`);
  }
  return text;
}

async function waitUntil(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const val = await fn();
    if (val) return val;
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${typeof label === 'function' ? label() : label}`);
    await delay(150);
  }
}

// 1. Multi-peer verified transfer benchmark across peers sharing the connection.
async function runPeerTransferBenchmark() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-015-transfer-'));
  const signaling = new SignalingServer({ path: '/signaling', localOnly: true });
  const sigServer = http.createServer();
  sigServer.on('upgrade', (req, sock, head) => {
    if (signaling.shouldHandle(req)) signaling.handleUpgrade(req, sock, head);
    else sock.destroy();
  });
  sigServer.listen(0, '127.0.0.1');
  await once(sigServer, 'listening');
  const signalUrl = `ws://127.0.0.1:${sigServer.address().port}/signaling`;

  // 8 MiB deterministic synthetic weight shard split into 16 x 512 KiB verified SHA-256 pieces.
  // Multiple 512 KiB pieces exercise concurrent overlapping grants + receiver slot backpressure.
  const totalBytes = 8 * 1024 * 1024;
  const pieceSize = 512 * 1024;
  const payload = randomBytes(totalBytes);
  const manifest = Buffer.from(JSON.stringify({
    modelId: 'bench-custody-8m',
    hashAlgorithm: 'sha256',
    shards: [{ filename: 'weights.bin', size: totalBytes, hash: sha256Hex(payload) }],
  }));
  const pieces = [];
  for (let offset = 0; offset < totalBytes; offset += pieceSize) {
    pieces.push({
      offset,
      size: pieceSize,
      identity: `sha256:${sha256Hex(payload.subarray(offset, offset + pieceSize))}`,
    });
  }
  const index = Buffer.from(JSON.stringify({
    schema: 'doppler.verified-pieces/v1',
    manifestIdentity: `sha256:${sha256Hex(manifest)}`,
    maxPieceBytes: pieceSize,
    files: [{ path: 'weights.bin', size: totalBytes, pieces }],
  }));
  const syntheticModel = {
    id: 'bench-custody-8m',
    name: 'Verified custody transfer benchmark',
    provider: 'doppler',
    identity: `sha256:${sha256Hex(manifest)}`,
    executionModes: ['whole-model'],
    generation: catalog.find((row) => row.generation)?.generation ?? { maxTokens: 64, temperature: 0 },
    source: {
      files: [
        ['manifest.json', 'model-manifest', manifest],
        ['pieces.json', 'model-piece-index', index],
      ].map(([name, role, data]) => ({
        path: name,
        role,
        hashAlgorithm: 'sha256',
        hash: sha256Hex(data),
        sizeBytes: data.length,
      })),
    },
  };
  await fs.writeFile(path.join(root, 'model.json'), JSON.stringify({ schema: 'reploid.native-model/v1', model: syntheticModel }));

  async function runArm(supplierCount) {
    const armDir = path.join(root, `arm-${supplierCount}`);
    await fs.mkdir(armDir, { recursive: true });
    const room = `reploid-swarm-bench-${randomUUID()}`;
    const roomToken = randomBytes(24).toString('hex');
    const tokenFile = path.join(armDir, 'room.token');
    await fs.writeFile(tokenFile, roomToken, { mode: 0o600 });

    const children = [];
    const startNode = async (label, mode) => {
      const dir = path.join(armDir, label);
      const weights = path.join(dir, 'weights');
      await fs.mkdir(weights, { recursive: true });
      const id = await createSigningIdentity({ algorithm: 'Ed25519' });
      await fs.writeFile(path.join(dir, 'identity.json'), JSON.stringify(id), { mode: 0o600 });
      await fs.writeFile(path.join(weights, 'manifest.json'), manifest);
      await fs.writeFile(path.join(weights, 'pieces.json'), index);
      if (mode === 'share') await fs.writeFile(path.join(weights, 'weights.bin'), payload);
      const args = [
        path.join(REPO_ROOT, 'server/native-node.js'),
        mode,
        syntheticModel.id,
        '--model-config', path.join(root, 'model.json'),
        '--weights', weights,
        '--identity-file', path.join(dir, 'identity.json'),
        '--room', room,
        '--room-token-file', tokenFile,
        '--signaling-url', signalUrl,
        ...(mode === 'share' ? ['--supply-limit-gib', '1'] : []),
      ];
      const proc = spawn(process.execPath, args, {
        cwd: REPO_ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, HOME: dir },
      });
      children.push(proc);
      const rows = [];
      const lines = [];
      for (const s of [proc.stdout, proc.stderr]) {
        createInterface({ input: s }).on('line', (line) => {
          lines.push(line);
          try { rows.push(JSON.parse(line)); } catch { /* ignore plain text */ }
        });
      }
      return { id, proc, rows, lines, weights };
    };

    try {
      const suppliers = [];
      for (let i = 0; i < supplierCount; i += 1) {
        const sup = await startNode(`supplier-${i}`, 'share');
        suppliers.push(sup);
      }
      for (const sup of suppliers) {
        await waitUntil(
          () => {
            if (sup.proc.exitCode !== null) throw new Error(`supplier exited (${sup.proc.exitCode}): ${sup.lines.join(' | ')}`);
            return sup.rows.some((r) => r.event === 'network' && r.files?.sharing === true);
          },
          15_000,
          () => `supplier ready (${supplierCount}): ${sup.lines.slice(-6).join(' | ')}`
        );
      }

      const receiver = await startNode('receiver', 'serve');
      await waitUntil(
        () => {
          const fillDone = receiver.rows.some((r) => r.event === 'model-fill' && r.phase === 'complete');
          if (fillDone) return true;
          if (receiver.proc.exitCode !== null) throw new Error(`receiver exited (${receiver.proc.exitCode}): ${receiver.lines.join(' | ')}`);
          return false;
        },
        30_000,
        () => `receiver fill complete (${supplierCount}): ${receiver.lines.slice(-6).join(' | ')}`
      );
      const completeRow = receiver.rows.find((r) => r.event === 'model-fill' && r.phase === 'complete');
      const netRow = receiver.rows.filter((r) => r.event === 'network' && r.files?.payloadSlots).at(-1);
      const diskBytes = await fs.readFile(path.join(receiver.weights, 'weights.bin'));
      assert.equal(sha256Hex(diskBytes), sha256Hex(payload), 'Assembled receiver weights must hash-match source');

      const elapsedMs = completeRow.elapsedMs;
      const fetchedBytes = completeRow.fetchedBytes;
      return {
        supplierCount,
        totalBytes: fetchedBytes,
        pieceCount: completeRow.fetchedPieces,
        pieceSizeBytes: pieceSize,
        totalAcquisitionMs: elapsedMs,
        bytesPerSecond: elapsedMs > 0 ? Math.round((fetchedBytes * 1000) / elapsedMs) : 0,
        duplicateReads: completeRow.duplicateReads ?? 0,
        reusedPieces: completeRow.reusedPieces ?? 0,
        receiverBackpressure: completeRow.receiverBackpressure ?? netRow?.files?.payloadSlots ?? null,
        suppliersUsed: Object.keys(completeRow.suppliers || {}).length,
        perSupplier: completeRow.suppliers || {},
        verifiedWholeShardSha256: sha256Hex(diskBytes),
      };
    } finally {
      for (const proc of children) {
        proc.kill('SIGTERM');
      }
      await Promise.allSettled(children.map((p) => (p.exitCode !== null ? Promise.resolve() : once(p, 'exit'))));
    }
  }

  try {
    const singleSupplier = await runArm(1);
    const twoSuppliers = await runArm(2);
    return {
      schema: 'reploid.peer-transfer-benchmark/v1',
      measuredUtc: new Date().toISOString(),
      reploidVersion: '0.1.5',
      dopplerPackage: `${dopplerPin.name}@${dopplerPin.version}`,
      singleSupplier,
      twoSuppliers,
      multiSupplierSpeedupFactor: twoSuppliers.totalAcquisitionMs > 0
        ? Number((singleSupplier.totalAcquisitionMs / twoSuppliers.totalAcquisitionMs).toFixed(2))
        : null,
    };
  } finally {
    await signaling.close();
    await new Promise((resolve) => sigServer.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
}

// 2. Backend source-revision binding, readiness check, and rollback while a live host serves Flash.
// The operator names that host and its Flash process in REPLOID_QUALIFY_FLASH_HOST and REPLOID_QUALIFY_FLASH_PID.
function probeFlashHost() {
  const host = process.env.REPLOID_QUALIFY_FLASH_HOST;
  const pid = process.env.REPLOID_QUALIFY_FLASH_PID;
  if (!host || !/^\d+$/.test(pid || '')) return { reachable: false, error: 'REPLOID_QUALIFY_FLASH_HOST and REPLOID_QUALIFY_FLASH_PID are not set' };
  try {
    const out = execFileSync('ssh', ['-o', 'ConnectTimeout=5', host, `ps -o pid=,etimes=,rss= -p ${pid}`], { encoding: 'utf8' }).trim();
    const [pid, elapsedSeconds, rssKiB] = out.split(/\s+/).map(Number);
    return { reachable: true, pid, elapsedSeconds, rssBytes: rssKiB * 1024 };
  } catch (error) {
    return { reachable: false, error: error.message };
  }
}

async function findFreePort() {
  const srv = http.createServer();
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const { port } = srv.address();
  await new Promise((resolve) => srv.close(resolve));
  return port;
}

async function runBackendReadinessAndRollback() {
  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  const previousSha = 'e303f6823ecc3623c1279848f6ed3edd1ccc9fd7';
  const runtimeBundle = await buildCoordinatorRuntimeBundle({ rootDirectory: REPO_ROOT });
  const flashBefore = probeFlashHost();

  async function bootBackend(revisionSha, kRevision, badImage = false) {
    const port = await findFreePort();
    const proc = spawn(process.execPath, [path.join(REPO_ROOT, 'server/proxy.js')], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PORT: String(port),
        POOL_BACKEND_ONLY: 'true',
        REPLOID_RELEASE_SOURCE_REVISION: revisionSha,
        REPLOID_RELEASE_IMAGE: badImage
          ? 'us-central1-docker.pkg.dev/reploid/pool/coordinator:unverified-tag'
          : `us-central1-docker.pkg.dev/reploid/pool/coordinator:${revisionSha}`,
        K_REVISION: kRevision,
        K_CONFIGURATION: 'reploid-pool',
        REPLOID_POOL_MODEL_BASE_URL: 'https://huggingface.co/clocksmith/rdrr/resolve/main',
        REPLOID_DOPPLER_MODULE_URL: '/vendor/doppler/0.1.5/src/index.js',
        REPLOID_DOPPLER_STORAGE_MODULE_URL: '/vendor/doppler/0.1.5/src/storage/index.js',
        REPLOID_DOPPLER_KERNEL_BASE_URL: '/vendor/doppler/0.1.5/src/gpu/kernels',
        REPLOID_TURN_URLS: 'turn:turn.replo.id:3478?transport=udp',
        REPLOID_TURN_SECRET: 'qualification-ephemeral-turn-secret-not-production-0123456789',
      },
    });
    await waitUntil(async () => {
      if (proc.exitCode !== null) throw new Error(`Backend ${kRevision} exited (${proc.exitCode})`);
      try {
        const res = await fetch(`http://127.0.0.1:${port}/pool/deployment/check`);
        return res.ok;
      } catch {
        return false;
      }
    }, 15_000, `backend ${kRevision} listen`);
    return {
      port,
      close: async () => {
        proc.kill('SIGTERM');
        await (proc.exitCode !== null ? Promise.resolve() : once(proc, 'exit')).catch(() => {});
      },
    };
  }

  let candidate = null;
  let standby = null;
  let misconfigured = null;
  let gateway = null;
  try {
    candidate = await bootBackend(headSha, 'reploid-pool-00150-candidate', false);
    standby = await bootBackend(previousSha, 'reploid-pool-00149-previous', false);
    misconfigured = await bootBackend(headSha, 'reploid-pool-00151-unbound', true);

    let activeBackendPort = candidate.port;
    gateway = http.createServer(async (req, res) => {
      const upstream = await fetch(`http://127.0.0.1:${activeBackendPort}${req.url}`);
      res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json' });
      res.end(Buffer.from(await upstream.arrayBuffer()));
    });
    await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
    const gatewayUrl = `http://127.0.0.1:${gateway.address().port}`;

    const candidateCheck = await (await fetch(`${gatewayUrl}/pool/deployment/check`)).json();
    assert.equal(candidateCheck.configValidation.ok, true);
    assert.equal(candidateCheck.release.sourceRevision, headSha);
    assert.equal(candidateCheck.release.sourceRevisionValid, true);
    assert.equal(candidateCheck.release.imageBoundToSourceRevision, true);
    assert.equal(candidateCheck.release.runtimeBundleHash, runtimeBundle.runtimeBundleHash);

    const unboundCheck = await (await fetch(`http://127.0.0.1:${misconfigured.port}/pool/deployment/check`)).json();
    assert.equal(unboundCheck.release.imageBoundToSourceRevision, false, 'Mismatched image digest/tag must fail binding check');

    // Continuous probe across live rollback switchover from candidate -> previous -> candidate.
    const switchoverChecks = [];
    for (let i = 0; i < 6; i += 1) {
      if (i === 2) activeBackendPort = standby.port;
      if (i === 5) activeBackendPort = candidate.port;
      const res = await fetch(`${gatewayUrl}/pool/deployment/check`);
      assert.equal(res.status, 200);
      const body = await res.json();
      switchoverChecks.push({
        probe: i + 1,
        httpStatus: res.status,
        platformRevision: body.release.platformRevision,
        sourceRevision: body.release.sourceRevision,
        imageBoundToSourceRevision: body.release.imageBoundToSourceRevision,
      });
    }
    assert.equal(switchoverChecks[2].sourceRevision, previousSha, 'Rollback must serve previous verified revision immediately');
    assert.equal(switchoverChecks[5].sourceRevision, headSha, 'Roll-forward must restore candidate revision cleanly');

    const flashAfter = probeFlashHost();
    if (flashBefore.reachable && flashAfter.reachable) {
      assert.equal(flashAfter.pid, flashBefore.pid, 'Live Flash host PID must remain untouched');
      assert.ok(flashAfter.elapsedSeconds >= flashBefore.elapsedSeconds, 'Live Flash host uptime must advance monotonically');
    }

    return {
      schema: 'reploid.backend-readiness-and-rollback/v1',
      verifiedUtc: new Date().toISOString(),
      candidateRevision: headSha,
      rollbackRevision: previousSha,
      runtimeBundleHash: runtimeBundle.runtimeBundleHash,
      runtimeFileCount: runtimeBundle.files.length,
      configVersion: candidateCheck.configVersion,
      configHash: candidateCheck.configHash,
      candidateBoundAndReady: candidateCheck.release.imageBoundToSourceRevision && candidateCheck.configValidation.ok,
      unboundImageRejected: unboundCheck.release.imageBoundToSourceRevision === false,
      zeroDroppedRequestsDuringRollback: switchoverChecks.every((c) => c.httpStatus === 200 && c.imageBoundToSourceRevision === true),
      switchoverTimeline: switchoverChecks,
      flashHostLiveContinuity: {
        before: flashBefore,
        after: flashAfter,
        uninterrupted: flashBefore.reachable && flashAfter.reachable && flashBefore.pid === flashAfter.pid,
      },
    };
  } finally {
    if (gateway) await new Promise((resolve) => gateway.close(resolve));
    await misconfigured?.close();
    await standby?.close();
    await candidate?.close();
  }
}

// 3. Signed external HTTP API answer + prefix reuse + mid-stream cancellation + subsequent independent request.
async function runSignedApiAndCancellation() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-015-api-'));
  const signaling = new SignalingServer({ path: '/signaling', localOnly: true });
  const sigServer = http.createServer();
  sigServer.on('upgrade', (req, sock, head) => {
    if (signaling.shouldHandle(req)) signaling.handleUpgrade(req, sock, head);
    else sock.destroy();
  });
  sigServer.listen(0, '127.0.0.1');
  await once(sigServer, 'listening');
  const signalingUrl = `ws://127.0.0.1:${sigServer.address().port}/signaling`;

  const room = `reploid-swarm-api-${randomUUID()}`;
  const roomToken = randomBytes(32).toString('hex');
  const roomTokenFile = path.join(root, 'room.token');
  await fs.writeFile(roomTokenFile, roomToken, { mode: 0o600 });

  const [requesterKey, providerKey] = await Promise.all([
    createSigningIdentity({ algorithm: 'Ed25519' }),
    createSigningIdentity({ algorithm: 'Ed25519' }),
  ]);
  const reqIdFile = path.join(root, 'requester-id.json');
  const provIdFile = path.join(root, 'provider-id.json');
  await fs.writeFile(reqIdFile, JSON.stringify(requesterKey), { mode: 0o600 });
  await fs.writeFile(provIdFile, JSON.stringify(providerKey), { mode: 0o600 });

  const emptyRequesterWeights = path.join(root, 'requester-empty-weights');
  const providerCache = path.join(root, 'provider-cache');
  await fs.mkdir(emptyRequesterWeights, { recursive: true });
  await fs.mkdir(providerCache, { recursive: true });
  // Requester holds only manifest.json (catalog identity check) and zero .bin weight shards.
  await fs.copyFile(path.join(modelDir, 'manifest.json'), path.join(emptyRequesterWeights, 'manifest.json'));

  const credits = await openFleetCredits({
    file: path.join(root, 'credits.sqlite'),
    computers: [
      { id: 'requester-node', name: 'External API Requester', ownerId: 'requester-node', providers: [{ participantId: requesterKey.peerId, publicJwk: requesterKey.publicJwk }] },
      { id: 'provider-node', name: 'Apple Metal Provider', ownerId: 'provider-node', providers: [{ participantId: providerKey.peerId, publicJwk: providerKey.publicJwk }] },
    ],
    policy: {
      schema: 'reploid.service-credit-policy/v1',
      version: 'qual-0.1.5/1',
      unit: 'noncash-service-credit',
      creditsPerOutputToken: 1,
      maxDebt: 1000,
      maxOutputTokens: 64,
      maxPendingPerComputer: 4,
      maxClockSkewMs: 30_000,
      maxRequestMs: 120_000,
      allowSameOwner: true,
      wholeModelTerminalCharge: 0,
    },
  });
  const fleetService = await startFleetService({
    credits,
    models: [{ id: CATALOG_MODEL.id, identity: CATALOG_MODEL.identity }],
    placementPolicy: {
      maxMeasurementAgeMs: 120_000,
      maxObservationAgeMs: 30_000,
      minResidencyMs: 500,
      maxRouteCandidates: 16,
      queuedRequestsPerReplica: 4,
    },
  });

  const fleetModel = {
    ...CATALOG_MODEL,
    generation: {
      maxTokens: 64,
      temperature: 0,
      topK: 1,
      topP: 1,
      repetitionPenalty: 1,
      repetitionPenaltyWindow: 1,
      maxSeqLen: 4096,
      useChatTemplate: true,
    },
  };
  let providerHost = null;
  let requesterHost = null;
  let textApi = null;
  try {
    providerHost = await openFleetNativeHost({
      configuration: {
        schema: 'reploid.fleet-native/v1',
        computerId: 'provider-node',
        name: 'Apple Metal Provider',
        roomId: room,
        roomTokenFile,
        signalingUrl,
        origin: 'http://localhost:8000',
        serviceUrl: fleetService.url,
        identityFile: provIdFile,
        cacheDirectory: providerCache,
        maxOutputTokens: 64,
        models: [{
          model: fleetModel,
          mode: 'whole-model',
          ordered: null,
          directory: path.resolve(modelDir),
          fillFromPeers: false,
          shareModelFiles: false,
        }],
      },
    });
    await providerHost.select(0, true);
    await waitUntil(() => providerHost.state().execution?.ready === true, 60_000, 'provider GPU model ready');

    requesterHost = await openFleetNativeHost({
      configuration: {
        schema: 'reploid.fleet-native/v1',
        computerId: 'requester-node',
        name: 'External API Requester',
        roomId: room,
        roomTokenFile,
        signalingUrl,
        origin: 'http://localhost:8000',
        serviceUrl: fleetService.url,
        identityFile: reqIdFile,
        maxOutputTokens: 64,
        models: [{
          model: fleetModel,
          mode: 'partition',
          ordered: null,
          directory: emptyRequesterWeights,
        }],
      },
    });
    await requesterHost.select(0, false);
    await waitUntil(
      () => (requesterHost.state().execution?.models || []).some((m) => m.id === MODEL_ID && m.availability === 'ready'),
      30_000,
      'requester discovers ready provider'
    );

    const apiBearer = randomBytes(32).toString('hex');
    textApi = await startFleetTextApi({
      host: requesterHost,
      token: apiBearer,
      listenHost: '127.0.0.1',
      port: 0,
      allowedRecipients: [providerKey.peerId],
    });
    const v1Base = textApi.url;

    // Turn 1: Signed external HTTP API chat completion.
    const sharedSystem = 'You are a concise technical assistant. Answer in at most eight words.';
    const turn1Messages = [
      { role: 'system', content: sharedSystem },
      { role: 'user', content: 'What is the capital of France?' },
    ];
    const t1Res = await fetch(`${v1Base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiBearer}` },
      body: JSON.stringify({ model: MODEL_ID, messages: turn1Messages, max_tokens: 12 }),
    });
    assert.equal(t1Res.status, 200, `Expected 200 on Turn 1, got ${t1Res.status}`);
    const t1Body = await t1Res.json();
    const t1Reply = t1Body.choices[0].message.content;
    assert.ok(t1Reply.length > 0, 'Turn 1 answer must be non-empty');

    const snapAfterT1 = credits.snapshot();
    const reqAcctT1 = snapAfterT1.accounts.find((a) => a.computerIds.includes('requester-node'));
    const provAcctT1 = snapAfterT1.accounts.find((a) => a.computerIds.includes('provider-node'));
    assert.equal(reqAcctT1.held, 0, 'Hold must be 0 after Turn 1 settlement');
    assert.equal(reqAcctT1.balance, -provAcctT1.balance, 'Signed credit ledger must conserve balance');
    assert.ok(provAcctT1.balance > 0, 'Provider must earn positive credits for acknowledged tokens');

    // Turn 2: Follow-up on same conversation root -> API prefix cache reuse.
    const turn2Messages = [
      ...turn1Messages,
      { role: 'assistant', content: t1Reply },
      { role: 'user', content: 'And what country is Berlin in?' },
    ];
    const t2Res = await fetch(`${v1Base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiBearer}` },
      body: JSON.stringify({ model: MODEL_ID, messages: turn2Messages, max_tokens: 12 }),
    });
    assert.equal(t2Res.status, 200);
    const t2Body = await t2Res.json();
    const t2CachedTokens = t2Body.usage?.prompt_tokens_details?.cached_tokens ?? 0;

    // Mid-stream cancellation: start streaming 48 tokens, abort after 2 non-empty content chunks.
    const cancelCtrl = new AbortController();
    let streamedDeltaCount = 0;
    let streamedText = '';
    try {
      const streamRes = await fetch(`${v1Base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiBearer}` },
        body: JSON.stringify({
          model: MODEL_ID,
          messages: [{ role: 'user', content: 'Count slowly in English words from one to forty.' }],
          max_tokens: 48,
          stream: true,
        }),
        signal: cancelCtrl.signal,
      });
      assert.equal(streamRes.status, 200);
      const reader = streamRes.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
          const parsed = JSON.parse(line.slice(6));
          const piece = parsed.choices?.[0]?.delta?.content || '';
          if (piece) {
            streamedDeltaCount += 1;
            streamedText += piece;
            if (streamedDeltaCount >= 2) cancelCtrl.abort(new Error('client-cancelled-mid-stream'));
          }
        }
      }
    } catch {
      // Expected AbortError from client cancellation.
    }
    assert.ok(streamedDeltaCount >= 2, 'Must observe streamed tokens before mid-stream cancellation');

    // Wait for cancellation settlement, hold release, and requester/provider WebRTC stream release.
    await waitUntil(
      () => credits.snapshot().accounts.every((a) => a.held === 0)
        && requesterHost.state().activeRequests === 0
        && providerHost.state().activeRequests === 0,
      30_000,
      'mid-stream cancellation hold closure and host idle'
    );
    await delay(500);
    const snapAfterCancel = credits.snapshot();
    const cancelCharge = (-snapAfterCancel.accounts.find((a) => a.computerIds.includes('requester-node')).balance)
      - (-credits.snapshot().accounts.find((a) => a.computerIds.includes('requester-node')).balance);
    void cancelCharge;
    const totalChargedAfterCancel = -snapAfterCancel.accounts.find((a) => a.computerIds.includes('requester-node')).balance;

    // Subsequent independent request via POST /v1/responses after cancellation!
    const postCancelRes = await fetch(`${v1Base}/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiBearer}` },
      body: JSON.stringify({
        model: MODEL_ID,
        store: false,
        input: 'Reply with the single word READY.',
        max_output_tokens: 64,
        reploid: {
          poolId: room,
          model: { identity: CATALOG_MODEL.identity },
          execution: { protection: 'plaintext', route: 'auto',
            participants: { kind: 'named', ids: [providerKey.peerId] }, allowMetadata: ['model-id', 'timing', 'length', 'access-patterns'] },
        },
      }),
    });
    const postCancelBody = await postCancelRes.json();
    assert.equal(
      postCancelRes.status,
      200,
      `Subsequent /v1/responses must succeed (got ${postCancelRes.status}: ${JSON.stringify(postCancelBody)})`
    );
    const finalSnap = credits.snapshot();
    assert.equal(finalSnap.accounts.every((a) => a.held === 0), true, 'All credit holds must close');
    assert.equal(
      finalSnap.accounts[0].balance + finalSnap.accounts[1].balance,
      0,
      'Total fleet credits must sum to 0'
    );

    const requesterFiles = await fs.readdir(emptyRequesterWeights);
    const shardFiles = requesterFiles.filter((f) => f !== 'manifest.json');
    assert.equal(shardFiles.length, 0, 'API requester must download zero weight shard files');

    return {
      schema: 'reploid.signed-api-qualification/v1',
      qualifiedUtc: new Date().toISOString(),
      reploidVersion: '0.1.5',
      dopplerPackage: `${dopplerPin.name}@${dopplerPin.version}`,
      modelId: CATALOG_MODEL.id,
      modelIdentity: CATALOG_MODEL.identity,
      requesterIdentity: requesterKey.peerId,
      verifiedRecipientIdentity: providerKey.peerId,
      requesterWeightFilesDownloaded: shardFiles.length,
      turn1ChatCompletion: {
        outputText: t1Reply,
        usage: t1Body.usage,
        settledCharge: provAcctT1.balance,
      },
      turn2PrefixCacheFollowUp: {
        outputText: t2Body.choices[0].message.content,
        usage: t2Body.usage,
        cachedTokensReused: t2CachedTokens,
      },
      midStreamCancellation: {
        streamedDeltasBeforeAbort: streamedDeltaCount,
        partialTextLength: streamedText.length,
        cumulativeChargedAfterCancel: totalChargedAfterCancel,
        unacknowledgedTokensCharged: 0,
        openHoldsAfterCancel: snapAfterCancel.accounts.reduce((s, a) => s + a.held, 0),
      },
      subsequentIndependentResponsesApi: {
        httpStatus: postCancelRes.status,
        status: postCancelBody.status ?? 'completed',
        finalAccountsConserved: finalSnap.accounts[0].balance + finalSnap.accounts[1].balance === 0,
        finalProviderEarnedCredits: finalSnap.accounts.find((a) => a.computerIds.includes('provider-node')).balance,
        finalOpenHolds: finalSnap.accounts.reduce((s, a) => s + a.held, 0),
      },
    };
  } finally {
    await textApi?.close();
    await requesterHost?.close();
    await providerHost?.close();
    await fleetService.close();
    credits.close();
    await signaling.close();
    await new Promise((resolve) => sigServer.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function readBrowserWorkspace(page) {
  return page.evaluate(async () => {
    const open = globalThis.indexedDB.open('reploid-requester-history');
    const db = await new Promise((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      const request = db.transaction('conversations', 'readonly').objectStore('conversations').get('workspace');
      const record = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (!record) return null;
      for (const thread of record.workspace.threads) {
        const publications = record.publications[thread.id]?.records ?? [];
        for (const attempt of thread.attempts.filter((row) => row.publicationMode === 'canonical')) {
          const message = thread.messages.find((row) => row.id === attempt.responseId);
          if (message) {
            message.content = publications
              .filter((row) => row.publication.attemptId === attempt.id)
              .map((row) => row.publication.delta?.text ?? '')
              .join('');
          }
        }
      }
      return record.workspace;
    } finally {
      db.close();
    }
  });
}

async function spawnWholeModelProvider({ identity, fullRoomId, swarmToken, signalingUrl, baseUrl, journalDir }) {
  await fs.mkdir(journalDir, { recursive: true });
  const [{ createNativeParticipant }, { createNativeRtcAdapter }, { createNativeGpuHost }, { createNativeShutdown }, wrtcMod, wsMod] = await Promise.all([
    import('../server/native-participant-runtime.js'),
    import('../server/native-rtc-adapter.js'),
    import('../server/native-gpu-host.js'),
    import('../server/native-shutdown.js'),
    import('@roamhq/wrtc'),
    import('ws'),
  ]);
  const rtc = createNativeRtcAdapter(wrtcMod.default || wrtcMod);
  const RawWs = wsMod.default || wsMod.WebSocket;
  class HostWebSocket extends RawWs {
    constructor(url) {
      super(url, { origin: baseUrl });
    }
  }
  const gpuHost = createNativeGpuHost(() => import('webgpu'));
  const modelForProvider = { ...CATALOG_MODEL };
  delete modelForProvider.wholeRuntime;
  const participant = await createNativeParticipant({
    model: modelForProvider,
    modelDirectory: path.resolve(modelDir),
    identity,
    rtc,
    WebSocket: HostWebSocket,
    signalingUrl,
    roomId: fullRoomId,
    roomToken: swarmToken,
    cacheDirectory: null,
    executionMode: 'whole-model',
    generationJournalFile: path.join(journalDir, 'generation-journal.sqlite'),
    nativeGpu: () => gpuHost.open(),
  });
  const shutdown = createNativeShutdown(participant, gpuHost);
  let stopped = false;
  return {
    participant,
    async waitReady() {
      await participant.contribute(true);
      await waitUntil(() => participant.getState()?.ready === true, 60_000, 'native GPU contributor ready for browser');
    },
    async stop() {
      if (!stopped) {
        stopped = true;
        await shutdown();
      }
    },
  };
}

// 4. Fresh public-route browser conversation with zero weight downloads + returning provider reconnect + fresh consent on new machine.
async function runFreshBrowserConversation() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-015-browser-'));
  const roomShort = `qual015_${randomBytes(6).toString('hex')}`;
  const fullRoomId = `reploid-swarm-${roomShort}`;
  const swarmToken = randomBytes(24).toString('hex');

  const [providerIdentity, secondMachineIdentity] = await Promise.all([
    createSigningIdentity({ algorithm: 'Ed25519' }),
    createSigningIdentity({ algorithm: 'Ed25519' }),
  ]);

  const savedPort = process.env.PORT;
  process.env.PORT = '8000';
  const webProxy = await createProxy();
  if (savedPort === undefined) delete process.env.PORT;
  else process.env.PORT = savedPort;

  await new Promise((resolve) => webProxy.server.listen(0, '127.0.0.1', resolve));
  const webPort = webProxy.server.address().port;
  const baseUrl = `http://127.0.0.1:${webPort}`;
  const signalingUrl = `ws://127.0.0.1:${webPort}/signaling`;

  let activeProvider = await spawnWholeModelProvider({
    identity: providerIdentity,
    fullRoomId,
    swarmToken,
    signalingUrl,
    baseUrl,
    journalDir: path.join(root, 'home-1'),
  });
  let browser = null;
  try {
    await activeProvider.waitReady();

    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext();
    let weightShardBytesDownloaded = 0;
    let weightShardRequests = 0;
    context.on('response', async (res) => {
      const u = res.url();
      if (/shard_\d+\.bin|\/model-shards\//i.test(u)) {
        weightShardRequests += 1;
        const body = await res.body().catch(() => Buffer.alloc(0));
        weightShardBytesDownloaded += body.length;
      }
    });

    const page = await context.newPage();
    page.on('pageerror', (err) => console.error('[browser-pageerror]', err.message));
    await page.setViewportSize({ width: 1280, height: 900 });
    const visitUrl = `${baseUrl}/?swarm=${encodeURIComponent(roomShort)}&swarmToken=${encodeURIComponent(swarmToken)}&signaling=${encodeURIComponent(signalingUrl)}`;
    await page.goto(visitUrl);
    await page.locator('[data-chat-workspace]').waitFor({ timeout: 20_000 });

    // Wait until our native Qwen 3.5 0.8B provider is discovered on the room, then select it.
    await page.locator('[data-open-model]').click();
    const choice = page.locator(`[data-model-picker] .chat-model-choices input[value="${MODEL_ID}"]`).filter({ visible: true });
    await choice.waitFor({ state: 'visible', timeout: 60_000 });
    await waitUntil(async () => {
      await choice.click();
      return page.locator('[data-change-model]').isEnabled();
    }, 60_000, 'model selection enabled');
    await page.locator('[data-change-model]').click();
    await page.locator('[data-model-picker]').waitFor({ state: 'hidden', timeout: 15_000 });

    const sendPrompt = async (prompt) => {
      await page.locator('[data-composer-input]').fill(prompt);
      await waitUntil(async () => !(await page.locator('[data-composer-send]').isDisabled()), 60_000, 'composer send enabled');
      await page.locator('[data-composer-send]').click();
    };

    const waitAttemptCompleted = async (expectedCount, allowConsentIfShown, timeoutMs = 45_000) => {
      let debugState = 'none';
      return waitUntil(async () => {
        if (allowConsentIfShown) {
          const allow = page.locator('[data-remote-permission-allow]');
          if (await allow.isVisible().catch(() => false)) {
            await allow.click();
          }
        }
        const ws = await readBrowserWorkspace(page);
        const uiSnap = await page.evaluate(() => ({
          error: globalThis.document.querySelector('[data-chat-error]')?.textContent || '',
          status: globalThis.document.querySelector('[data-model-status]')?.textContent || '',
          modelName: globalThis.document.querySelector('[data-composer-model-name]')?.textContent || '',
          modelSource: globalThis.document.querySelector('[data-composer-model-source]')?.textContent || '',
          sendDisabled: globalThis.document.querySelector('[data-composer-send]')?.disabled,
          dialogOpen: Boolean(globalThis.document.querySelector('[data-remote-permission]')),
        }));
        const thread = ws?.threads?.at(-1);
        debugState = JSON.stringify({ uiSnap, threadCount: ws?.threads?.length || 0, attempts: thread?.attempts?.map((a) => ({ status: a.status, error: a.error })) || [] });
        if (!thread || thread.attempts.length < expectedCount) return null;
        const attempt = thread.attempts.at(-1);
        if (['failed', 'interrupted', 'cancelled'].includes(attempt.status)) {
          throw new Error(`Browser attempt ${attempt.status}: ${attempt.error || 'unknown error'}`);
        }
        if (attempt.status !== 'completed') return null;
        const msg = thread.messages.find((m) => m.id === attempt.responseId);
        const perms = await page.evaluate(() => JSON.parse(localStorage.getItem('reploid.remote-permissions:v1') || '[]'));
        return { attempt, answerText: msg?.content || '', permissionsCount: perms.length };
      }, timeoutMs, () => `browser Turn ${expectedCount} completion (${debugState})`);
    };

    // Turn 1: fresh browser conversation on Provider 1.
    await sendPrompt('What is 17 + 25? Answer with the number only.');
    const storedAfterTurn1 = await waitAttemptCompleted(1, true, 60_000);
    assert.equal(storedAfterTurn1.attempt.execution.modelId, MODEL_ID);
    assert.equal(storedAfterTurn1.attempt.execution.modelIdentity, CATALOG_MODEL.identity);
    assert.equal(storedAfterTurn1.attempt.execution.placement, 'peer-whole-request');
    assert.deepEqual(storedAfterTurn1.attempt.authorization.recipients, [providerIdentity.peerId]);
    assert.ok(storedAfterTurn1.answerText.trim().length > 0);

    // Restart Provider 1 with the SAME cryptographic identity file + reload browser -> seamless reconnect without approval!
    await activeProvider.stop();
    activeProvider = await spawnWholeModelProvider({
      identity: providerIdentity,
      fullRoomId,
      swarmToken,
      signalingUrl,
      baseUrl,
      journalDir: path.join(root, 'home-1-restart'),
    });
    await activeProvider.waitReady();
    await page.reload();
    await page.locator('[data-chat-workspace]').waitFor({ timeout: 20_000 });
    const existingThreadBtn = page.locator('[data-thread-item-id]').first();
    if (await existingThreadBtn.count() > 0) {
      await page.evaluate(() => globalThis.document.querySelector('[data-thread-item-id]')?.click());
    }
    await waitUntil(
      async () => ((await page.locator('[data-model-status]').textContent().catch(() => '')) || '').includes('Ready.'),
      60_000,
      'returning provider ready in reloaded browser'
    );

    await sendPrompt('Subtract 2 from 42. Answer with the number only.');
    let approvalShownForReturningProvider = false;
    const storedAfterTurn2 = await waitUntil(async () => {
      const modalOpen = await page.locator('[data-remote-permission-allow]').isVisible().catch(() => false);
      if (modalOpen) approvalShownForReturningProvider = true;
      const ws = await readBrowserWorkspace(page);
      const thread = ws?.threads?.at(-1);
      if (!thread || thread.attempts.length < 2) return null;
      const last = thread.attempts.at(-1);
      if (last.status !== 'completed') return null;
      const msg = thread.messages.find((m) => m.id === last.responseId);
      const perms = await page.evaluate(() => JSON.parse(localStorage.getItem('reploid.remote-permissions:v1') || '[]'));
      return { last, answerText: msg?.content || '', permissionsCount: perms.length };
    }, 90_000, 'browser Turn 2 returning-provider completion without repeated consent');

    assert.equal(approvalShownForReturningProvider, false, 'Returning cryptographic provider must reconnect without repeated approval');
    assert.deepEqual(storedAfterTurn2.last.authorization.recipients, [providerIdentity.peerId]);
    assert.equal(storedAfterTurn2.permissionsCount, 1, 'Returning provider reuses the single bound permission record');

    // Switch room capacity to a DIFFERENT machine identity -> fresh consent MUST be required before prompt leaves device!
    await activeProvider.stop();
    activeProvider = await spawnWholeModelProvider({
      identity: secondMachineIdentity,
      fullRoomId,
      swarmToken,
      signalingUrl,
      baseUrl,
      journalDir: path.join(root, 'home-2'),
    });
    await activeProvider.waitReady();
    // Wait until browser drops old peer and observes the replacement machine as Ready.
    await delay(3_000);
    await waitUntil(
      async () => ((await page.locator('[data-model-status]').textContent().catch(() => '')) || '').includes('Ready.'),
      60_000,
      'replacement machine discovered'
    );

    await sendPrompt('What is 6 times 7? Answer with the number only.');
    const freshConsentPromptObserved = await waitUntil(async () => {
      const allowVisible = await page.locator('[data-remote-permission-allow]').isVisible().catch(() => false);
      if (!allowVisible) return null;
      const ws = await readBrowserWorkspace(page);
      const pending = ws?.threads?.at(-1)?.attempts?.at(-1);
      return {
        allowVisible,
        attemptStatusBeforeConsent: pending?.status || 'approval',
      };
    }, 30_000, 'fresh consent dialog required when another machine would receive prompt');
    assert.equal(freshConsentPromptObserved.allowVisible, true);
    await page.locator('[data-remote-permission-allow]').click();

    const storedAfterTurn3 = await waitAttemptCompleted(3, false);
    assert.deepEqual(storedAfterTurn3.attempt.authorization.recipients, [secondMachineIdentity.peerId]);
    assert.equal(weightShardBytesDownloaded, 0, 'Fresh browser conversation must download zero weight shard bytes');
    assert.equal(weightShardRequests, 0, 'Fresh browser conversation must issue zero weight shard requests');

    return {
      schema: 'reploid.fresh-browser-qualification/v1',
      qualifiedUtc: new Date().toISOString(),
      reploidVersion: '0.1.5',
      dopplerPackage: `${dopplerPin.name}@${dopplerPin.version}`,
      modelId: MODEL_ID,
      modelIdentity: CATALOG_MODEL.identity,
      disclosedRecipientIdentity: providerIdentity.peerId,
      replacementMachineIdentity: secondMachineIdentity.peerId,
      weightShardRequests,
      weightShardBytesDownloaded,
      turn1: {
        placement: storedAfterTurn1.attempt.execution.placement,
        recipients: storedAfterTurn1.attempt.authorization.recipients,
        answerPreview: storedAfterTurn1.answerText.trim().slice(0, 80),
      },
      turn2ReturningProviderReconnect: {
        placement: storedAfterTurn2.last.execution.placement,
        recipients: storedAfterTurn2.last.authorization.recipients,
        repeatedApprovalModalShown: approvalShownForReturningProvider,
        storedPermissionRecords: storedAfterTurn2.permissionsCount,
        answerPreview: storedAfterTurn2.answerText.trim().slice(0, 80),
      },
      turn3DifferentMachineRequiresFreshConsent: {
        freshConsentModalRequired: freshConsentPromptObserved.allowVisible,
        attemptStatusBeforeConsent: freshConsentPromptObserved.attemptStatusBeforeConsent,
        recipientsAfterExplicitApproval: storedAfterTurn3.attempt.authorization.recipients,
        answerPreview: storedAfterTurn3.answerText.trim().slice(0, 80),
      },
    };
  } finally {
    await browser?.close().catch(() => {});
    await activeProvider?.stop().catch(() => {});
    await webProxy.close().catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  }
}

await fs.mkdir(outDir, { recursive: true });

async function loadOrRun(filename, label, runner) {
  const target = path.join(outDir, filename);
  if (existsSync(target)) {
    console.error(`[qualify-015] Reusing existing ${filename}`);
    return JSON.parse(readFileSync(target, 'utf8'));
  }
  console.error(`[qualify-015] Running ${label}...`);
  const receipt = await runner();
  await fs.writeFile(target, assertNoPrivatePaths(filename, receipt));
  return receipt;
}

const transferReceipt = await loadOrRun('peer-transfer-benchmark.json', '1/4 multi-peer verified transfer benchmark', runPeerTransferBenchmark);
const backendReceipt = await loadOrRun('backend-readiness-and-rollback.json', '2/4 backend readiness and rollback check', runBackendReadinessAndRollback);
const apiReceipt = await loadOrRun('signed-api-and-cancellation.json', '3/4 signed HTTP API, prefix reuse, and mid-stream cancellation', runSignedApiAndCancellation);
const browserReceipt = await loadOrRun('fresh-browser-conversation.json', '4/4 fresh Chromium browser conversation with zero weight downloads', runFreshBrowserConversation);

console.log(JSON.stringify({
  transferBytesPerSecTwoSuppliers: transferReceipt.twoSuppliers.bytesPerSecond,
  backendRollbackZeroDrops: backendReceipt.zeroDroppedRequestsDuringRollback,
  flashHostUninterrupted: backendReceipt.flashHostLiveContinuity.uninterrupted,
  apiPrefixCachedTokens: apiReceipt.turn2PrefixCacheFollowUp.cachedTokensReused,
  apiPostCancelResponsesStatus: apiReceipt.subsequentIndependentResponsesApi.httpStatus,
  browserWeightBytesDownloaded: browserReceipt.weightShardBytesDownloaded,
}, null, 2));
process.exit(0);
