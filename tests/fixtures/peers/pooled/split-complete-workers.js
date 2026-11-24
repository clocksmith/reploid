// Matched single-clock JSONL protocol adapters for two-machine split comparison (Pooled host & Native requester).
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import rtc from '@roamhq/wrtc';
import Socket from 'ws';
import { createNativeParticipant, createNativeRtcAdapter } from '../../../../server/native-participant.js';
import { createSigningIdentity } from '../../../../packages/reploid/src/artifacts/identity.js';
import { ROOM_ID_PATTERN } from '../../../../server/swarm-protocol.js';
import bootstrap from '../../../../shared/config/swarm-bootstrap.json' with { type: 'json' };
import { serveCompleteRequestProtocol } from '../../complete-request-protocol.js';
import { readDiagnosticMetadata } from '../../native-diagnostic-source.js';
import { closeOwnedPeerRoom } from './close-owned-room.js';
import { runPooledCompleteRequest } from './complete-request.js';

class LoopbackWebSocket extends Socket {
  constructor(url) {
    super(url, { origin: 'http://localhost:8000' });
  }
}
const logger = { log() {}, info() {}, debug() {}, warn: console.error, error: console.error };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
assert(['pooled-split-host', 'native-split-requester'].includes(config.mode), 'Explicit split protocol mode required');
assert(config.out && path.isAbsolute(config.out), 'Absolute output path required');

if (config.mode === 'pooled-split-host') {
  assert(config.sdk && config.source && config.models && config.webgpuModule && config.memoryObserver
    && config.invite && Array.isArray(config.expectedRanges) && config.minDevices >= 2,
  'Explicit frozen two-machine Pooled split host configuration required');
  const { createRoom } = await import(pathToFileURL(config.sdk).href);
  const { makeSampler } = await import(pathToFileURL(path.join(config.source, 'room/sampling.js')).href);
  const { buildIds } = await import(pathToFileURL(path.join(config.source, 'room/conversation.js')).href);
  const { createGpuMemoryObserver } = await import(pathToFileURL(config.memoryObserver).href);
  const observer = createGpuMemoryObserver(config.gpuCapGB * 2 ** 30);
  const ownedGpus = new Set();
  const result = {
    started: new Date().toISOString(),
    mode: config.mode,
    gpuMemory: observer.stats,
    cases: [],
  };
  const write = () => fs.writeFile(config.out, JSON.stringify(result, null, 2));
  const abort = new AbortController();
  const cancel = () => abort.abort(new Error('Owned Pooled split host cancelled'));
  process.once('SIGTERM', cancel);
  process.once('SIGINT', cancel);
  let room = null;
  let closing = null;

  const open = async () => {
    assert(!room, 'Pooled split room already opened');
    const started = performance.now();
    room = await createRoom({
      model: 'qwen3.8-flash',
      name: config.name || 'a1-workstation-flash',
      pledgeGB: config.gpuGB,
      ramGB: config.ramGB,
      expertDisk: true,
      signal: config.signal,
      modelDir: config.models,
      ctx: config.ctx,
      autoRedeal: false,
      ckpt: false,
      allowApi: false,
      relay: false,
      split: 'memory',
      gate: true,
      setup: {
        webgpu: async () => {
          const module = await import(pathToFileURL(config.webgpuModule).href);
          return {
            ...module,
            create(flags) {
              const gpu = module.create(flags);
              const requestAdapter = gpu.requestAdapter.bind(gpu);
              ownedGpus.add(gpu);
              gpu.requestAdapter = async options => {
                const adapter = await requestAdapter(options);
                if (!adapter) return adapter;
                const requestDevice = adapter.requestDevice.bind(adapter);
                adapter.requestDevice = async descriptor => {
                  const device = observer.attach(await requestDevice(descriptor));
                  const createBuffer = device.createBuffer.bind(device);
                  device.createBuffer = buffer => {
                    const bytes = Math.ceil(Number(buffer.size) / 4) * 4;
                    assert(Number.isSafeInteger(bytes) && bytes >= 0
                      && observer.stats.liveBytes + bytes <= observer.stats.capBytes,
                    'Peer GPU allocation exceeds frozen ceiling');
                    return createBuffer(buffer);
                  };
                  return device;
                };
                return adapter;
              };
              return gpu;
            },
          };
        },
      },
      log: console.error,
    });
    await fs.writeFile(
      config.invite,
      JSON.stringify({ code: room.code, key: room.inviteFragment.replace(/^#k=/u, '') }),
      { mode: 0o600 }
    );
    if (Array.isArray(config.peerOrder) && config.peerOrder.length > 0) {
      const original = room.constructor.dealPlan;
      assert.equal(typeof original, 'function', 'Original Pooled planner required');
      result.peerOrderOverlay = {
        order: config.peerOrder,
        originalPlannerIdentity: 'sha256:' + createHash('sha256').update(original.toString()).digest('hex'),
      };
      room.constructor.dealPlan = function dealOrdered(args) {
        const names = args.peers.map(peer => peer.name);
        assert(names.length === config.peerOrder.length && config.peerOrder.every(name => names.includes(name)),
          'Exact private Pooled split peers required');
        const peers = [...args.peers].sort((a, b) => config.peerOrder.indexOf(a.name) - config.peerOrder.indexOf(b.name));
        return original.call(this, { ...args, peers });
      };
    }
    const startRoomT0 = performance.now();
    await room.start('qwen3.8-flash', { minDevices: config.minDevices, waitMs: config.openTimeoutMs ?? 180000 });
    result.roomStartMs = performance.now() - startRoomT0;
    result.loadMs = performance.now() - started;
    result.split = room.split;
    assert.deepEqual(result.split?.ranges, config.expectedRanges, 'Pooled split ranges differ from frozen placement');
    await write();
    return { loadMs: result.loadMs, roomStartMs: result.roomStartMs, split: result.split };
  };

  const requestOutput = async request => {
    assert(room, 'Pooled split room is not open');
    abort.signal.throwIfAborted();
    const row = await runPooledCompleteRequest({
      room,
      makeSampler,
      prompt: request.prompt,
      promptIds: request.promptIds,
      maxNew: request.maxNew,
      stopIds: request.stopIds,
      timeoutMs: config.requestTimeoutMs,
      signal: abort.signal,
      tokenizePrompt: () => buildIds(room.ai.tok, { turns: [{ role: 'user', text: request.prompt }], thinking: false }),
    });
    assert.equal(observer.stats.errors.length, 0, 'Peer GPU errors invalidate split result');
    const output = {
      ...row,
      name: request.name,
      repeat: request.repeat,
      memory: { process: process.memoryUsage(), device: structuredClone(observer.stats) },
    };
    result.cases.push(output);
    await write();
    return output;
  };

  const close = () => {
    if (!closing) {
      closing = (async () => {
        await closeOwnedPeerRoom(room, ownedGpus);
        room = null;
        result.cleanup = 'settled';
        result.finished = new Date().toISOString();
        await write();
        process.removeListener('SIGTERM', cancel);
        process.removeListener('SIGINT', cancel);
        return result;
      })();
    }
    return closing;
  };

  await serveCompleteRequestProtocol({
    onClose: close,
    async invoke(req) {
      if (req.op === 'open') return open();
      if (req.op === 'request') return requestOutput(req);
      if (req.op === 'receipts') return { gpuMemory: structuredClone(observer.stats) };
      if (req.op === 'close') return close();
      throw new Error(`Unknown Pooled split operation: ${req.op}`);
    },
  });
} else {
  assert(ROOM_ID_PATTERN.test(config.roomId) && config.roomId !== bootstrap.publicRoomId, 'Separate private room required');
  assert(config.ordered && config.model?.partitionPlanId, 'Explicit ordered distributed plan required');
  await readDiagnosticMetadata(config.diagnostic);
  assert.equal(config.model.identity, 'sha256:' + config.diagnostic.manifestSha256);
  const identity = await createSigningIdentity({ algorithm: 'Ed25519' });
  const lifetime = new AbortController();
  const cancel = () => lifetime.abort(new Error('Owned Native split requester cancelled'));
  process.once('SIGTERM', cancel);
  process.once('SIGINT', cancel);
  const result = {
    started: new Date().toISOString(),
    mode: config.mode,
    participantId: identity.peerId,
    modelIdentity: config.model.identity,
    planId: config.model.partitionPlanId,
    rows: [],
  };
  const write = () => fs.writeFile(config.out, JSON.stringify(result, null, 2));
  let participant = null;
  let foundModel = null;
  let closing = null;

  const open = async () => {
    assert(!participant, 'Native split requester already opened');
    const started = performance.now();
    participant = await createNativeParticipant({
      model: config.model,
      modelDirectory: path.dirname(config.diagnostic.manifestPath),
      identity,
      rtc: createNativeRtcAdapter(rtc),
      WebSocket: LoopbackWebSocket,
      signalingUrl: config.signalingUrl || bootstrap.signalingUrl,
      roomId: config.roomId,
      roomToken: await fs.readFile(config.roomTokenFile, 'utf8'),
      nativeGpu: async () => { throw new Error('Split requester must not open a GPU'); },
      executionMode: 'partition',
      ordered: config.ordered,
      logger,
    });
    const deadline = Date.now() + (config.discoveryTimeoutMs ?? 180000);
    while (!foundModel) {
      lifetime.signal.throwIfAborted();
      foundModel = participant.getState().models?.find(m =>
        m.id === config.model.id && m.identity === config.model.identity && m.availability === 'ready'
      );
      if (foundModel) break;
      assert(Date.now() < deadline, 'Exact private two-stage model discovery deadline');
      await pause(100);
    }
    result.openWallMs = performance.now() - started;
    await write();
    return { openWallMs: result.openWallMs, modelIdentity: config.model.identity, split: config.expectedRanges };
  };

  const requestOutput = async request => {
    assert(participant && foundModel, 'Native split requester is not open');
    const expectedProviders = request.expectedProviders ?? config.expectedProviders;
    assert(Array.isArray(expectedProviders) && expectedProviders.length === config.model.partitionPlan.stageCount,
      'One approved provider identity per declared stage required');
    let firstDeltaMs = null;
    const deltas = [];
    const started = performance.now();
    const generation = await participant.generate(
      { model: foundModel, threadId: randomUUID(), attemptId: randomUUID(), messages: [{ role: 'user', content: request.prompt }] },
      {
        signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(config.requestTimeoutMs ?? 180000)]),
        onDelta: value => {
          firstDeltaMs ??= performance.now() - started;
          deltas.push(value);
        },
        requestApproval: async grant => {
          const peer = typeof grant.recipientIdentity === 'string' ? grant.recipientIdentity : grant.recipientIdentity?.participantId;
          assert(expectedProviders.includes(peer), `Unapproved disclosure recipient: ${peer}`);
          assert.equal(grant.planId, config.model.partitionPlanId);
          return true;
        },
      }
    );
    const requestWallMs = performance.now() - started;
    assert.equal(generation.modelIdentity, config.model.identity);
    assert(generation.execution?.schema === 'reploid.mesh.partition-summary/v2'
      && generation.execution.stepSummary.count > 0, 'Ordered aggregate execution summary required');
    const output = {
      name: request.name,
      repeat: request.repeat,
      text: generation.content,
      requestWallMs,
      ttftMs: firstDeltaMs,
      firstDeltaMs,
      decodeCompletionMs: firstDeltaMs === null ? null : requestWallMs - firstDeltaMs,
      deltas,
      result: generation,
    };
    result.rows.push(output);
    await write();
    return output;
  };

  const close = () => {
    if (!closing) {
      closing = (async () => {
        lifetime.abort(new Error('Owned Native split requester closing'));
        await participant?.close();
        participant = null;
        result.cleanup = 'settled';
        result.finished = new Date().toISOString();
        await write();
        process.removeListener('SIGTERM', cancel);
        process.removeListener('SIGINT', cancel);
        return result;
      })();
    }
    return closing;
  };

  await serveCompleteRequestProtocol({
    onClose: close,
    async invoke(req) {
      if (req.op === 'open') return open();
      if (req.op === 'request') return requestOutput(req);
      if (req.op === 'receipts') return { rows: result.rows.length };
      if (req.op === 'close') return close();
      throw new Error(`Unknown Native split operation: ${req.op}`);
    },
  });
}

// Native WebRTC addons (node-datachannel / wrtc) retain C++ worker threads after room close;
// close stdout cleanly so CompleteRequestClient observes EOF + exit code 0 immediately.
process.stdout.end(() => process.exit(process.exitCode ?? 0));
