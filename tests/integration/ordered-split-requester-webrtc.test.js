// @vitest-environment node
import { expect, it, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import WebSocket from 'ws';
import * as doppler from 'dopplerx/partitions';
import SignalingServer from '../../server/signaling-server.js';
import catalog from '../../shared/config/chat-models.json' with { type: 'json' };
import orderedPolicy from '../../apps/poolday/config/ordered-participation.json' with { type: 'json' };
import { shortcutOrderedParticipation } from '../../server/native-ordered-shortcut.js';
import { askMesh } from '../../server/native-node-ask.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { resolveServedFile } from '../../server/browser-roots.js';
import { createNativeParticipant, createNativeRtcAdapter, summarizeNativePartitionState } from '../../server/native-participant.js';

let wrtc;
try {
  ({ default: wrtc } = await import('@roamhq/wrtc'));
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND' || !error.message.includes('@roamhq/wrtc')) throw error;
}

it.runIf(wrtc)('discovers and answers over a two-stage 27B ordered split from weightless API, CLI and --model-config requesters', async () => {
  const model27 = catalog.find(row => row.id === 'qwen-3-8-27b-text-q4k-ef16-af32');
  const manifestDescriptor = model27.source.files.find(file => file.role === 'model-manifest');
  const manifestBytes = await fs.readFile(resolveServedFile(manifestDescriptor.url, { roots: ['shared'] }));
  const manifestJson = JSON.parse(manifestBytes);
  const pieceDescriptor = model27.source.files.find(file => file.role === 'model-piece-index');
  const pieceBytes = await fs.readFile(resolveServedFile(pieceDescriptor.url, { roots: ['shared'] }));

  const fakeRuntime = {
    ...doppler,
    configureDeviceMemoryBudget: async () => {},
    inspectDeviceMemory: () => ({ liveBytes: 1024, maxBytes: 6442450944, peakBytes: 1024, allocations: 1, rejected: 0 }),
    createVerifiedPieceStorage: async () => ({
      manifest: manifestJson,
      storage: {
        rangeLease: { read: async () => new ArrayBuffer(0), concurrency: 1 },
        preflight: async () => {},
        loadTokenizerJson: async () => ({}),
        loadShardRange: async () => new ArrayBuffer(0),
        close: async () => {},
      },
      getReceipt: () => ({ verifiedBytes: 0 }),
      getGatherReceipt: () => ({ verifiedBytes: 0 }),
    }),
    createManifestResidentPartitionFactory: ({ createStorage }) => ({
      async openResidentPartition({ model, plan, planId, index }) {
        const storage = await createStorage();
        await storage.loadTokenizerJson();
        const generation = model.generation;
        const generationDigest = await doppler.hashPartitionGeneration(generation);
        const hiddenSize = plan.hiddenSize;
        return {
          getRecoveryCapabilities: () => ({
            schema: 'doppler.resident-recovery/v1',
            inputReplay: false,
            checkpointExport: false,
            checkpointImport: false,
          }),
          getDescriptor: () => ({
            schema: 'doppler.resident-partition/v2',
            ready: true,
            stageCount: plan.stageCount,
            modelId: model27.id,
            modelIdentity: model27.identity,
            generationDigest,
            planId,
            index,
            layerRange: plan.partitions[index].layerRange,
            residentWeightBytes: 1024,
          }),
          tokenize: async () => ({ modelIdentity: model27.identity, tokenIds: [11, 22], generation }),
          executeStage: async ({ identity, partitionIndex, step, tokenPosition, inputTokenIds }) => {
            const base = { identity, partitionIndex, step, tokenPosition, continuation: { step } };
            if (index === plan.stageCount - 1) {
              return { ...base, tokenId: 100 + step, delta: step === 0 ? '13' : '', done: step === 1, stopReason: 'eos-token' };
            }
            return {
              ...base,
              activationTensor: {
                shape: [1, inputTokenIds.length, hiddenSize],
                dtype: 'f32',
                data: new Float32Array(inputTokenIds.length * hiddenSize).fill(1),
                seqOffset: tokenPosition,
                step,
              },
            };
          },
          closeAttempt: async () => {},
          close: async () => {},
        };
      },
    }),
  };

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ordered-split-requester-'));
  const weightsDir = path.join(dir, 'stage-weights');
  const emptyDir = path.join(dir, 'empty-requester-weights');
  await fs.mkdir(weightsDir, { recursive: true });
  await fs.mkdir(emptyDir, { recursive: true });
  await fs.writeFile(path.join(weightsDir, 'manifest.json'), manifestBytes);
  await fs.writeFile(path.join(weightsDir, pieceDescriptor.path), pieceBytes);

  const httpServer = http.createServer((req, res) => { res.statusCode = 404; res.end(); });
  const signaling = new SignalingServer({ path: '/swarm' });
  httpServer.on('upgrade', (req, socket, head) => {
    if (signaling.shouldHandle(req)) signaling.handleUpgrade(req, socket, head);
    else socket.destroy();
  });
  httpServer.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');
  const signalingUrl = `ws://127.0.0.1:${httpServer.address().port}/swarm`;
  const roomId = 'reploid-swarm-split-requester-test';
  const roomToken = 't'.repeat(40);
  const tokenFile = path.join(dir, 'room.token');
  await fs.writeFile(tokenFile, roomToken + '\n', { mode: 0o600 });
  const rtc = createNativeRtcAdapter(wrtc);
  class LocalWs extends WebSocket { constructor(url) { super(url, { origin: 'http://localhost:8000' }); } }

  const sourceRuntime = {
    runtime: fakeRuntime,
    gather: { maxPartBytes: 4096, memoryBudgetBytes: 8192, concurrency: 1 },
    receipt: { schema: 'reploid.diagnostic-source-identity/v1' },
    assertCurrent: async () => {},
  };

  const [id0, id1, idApi] = await Promise.all([0, 1, 2].map(() => createSigningIdentity({ algorithm: 'Ed25519' })));
  let stage0, stage1, apiRequester;
  const savedArgv = [...process.argv];
  try {
    stage0 = await createNativeParticipant({
      model: model27, modelDirectory: weightsDir, identity: id0, rtc, WebSocket: LocalWs,
      signalingUrl, roomId, roomToken, cacheDirectory: null, sourceRuntime,
      ordered: shortcutOrderedParticipation({ model: model27, models: catalog, stageIndex: 0 }),
      nativeGpu: async () => ({}),
    });
    stage1 = await createNativeParticipant({
      model: model27, modelDirectory: weightsDir, identity: id1, rtc, WebSocket: LocalWs,
      signalingUrl, roomId, roomToken, cacheDirectory: null, sourceRuntime,
      ordered: shortcutOrderedParticipation({ model: model27, models: catalog, stageIndex: 1 }),
      nativeGpu: async () => ({}),
    });
    await Promise.all([stage0.contribute(true), stage1.contribute(true)]);
    await vi.waitFor(() => expect(stage0.getState().placement).toEqual([id0.peerId, id1.peerId]), { timeout: 10000 });

    // 1. Direct createNativeParticipant requester with default ordered=null and empty model directory
    apiRequester = await createNativeParticipant({
      model: model27, modelDirectory: emptyDir, identity: idApi, rtc, WebSocket: LocalWs,
      signalingUrl, roomId, roomToken, cacheDirectory: path.join(dir, 'api-cache'),
      nativeGpu: async () => ({}),
    });
    await vi.waitFor(() => expect(apiRequester.getState().models).toHaveLength(1), { timeout: 10000 });
    const summary = summarizeNativePartitionState(apiRequester.getState());
    expect(summary.routes).toMatchObject({
      count: 1,
      records: [{
        id: model27.id,
        availability: 'ready',
        placement: 'ordered-layer-partition',
        planId: model27.partitionPlanId,
        stages: [id0.peerId, id1.peerId],
      }],
    });
    const apiAnswer = await askMesh(apiRequester, model27, 'What is f(4)?', {
      signal: AbortSignal.timeout(10000),
      report: () => {},
    });
    expect(apiAnswer).toBe('13');
    await apiRequester.close();
    apiRequester = null;

    // 2. CLI main({ argv, runOnce }) with --model-config + --ordered-config and an empty requester directory,
    // including verifying that importing native-participant.js after process.argv[1] mutation never hijacks import.
    const modelConfigFile = path.join(dir, 'model.json');
    const orderedConfigFile = path.join(dir, 'requester-ordered.json');
    await fs.writeFile(modelConfigFile, JSON.stringify({ schema: 'reploid.native-model/v1', model: model27.id }));
    await fs.writeFile(orderedConfigFile, JSON.stringify({ stage: null, ...orderedPolicy.limits }));
    const entryPath = new URL('../../server/native-participant.js', import.meta.url).pathname;
    process.argv = [process.execPath, entryPath];
    const { main } = await import('../../server/native-participant.js?rehearsal-import-check');
    const cliAnswer = await main({
      argv: [
        '--connect-only', '--model', model27.id, '--model-directory', emptyDir,
        '--identity-file', path.join(dir, 'cli-requester-id.json'),
        '--room', roomId, '--room-token-file', tokenFile, '--signaling-url', signalingUrl,
        '--model-config', modelConfigFile, '--ordered-config', orderedConfigFile,
        '--rtc-module', '@roamhq/wrtc', '--ws-module', 'ws',
      ],
      runOnce: (participant, model, signal) => askMesh(participant, model, 'What is f(4)?', { signal, report: () => {} }),
    });
    expect(cliAnswer).toBe('13');
  } finally {
    process.argv = savedArgv;
    await Promise.allSettled([apiRequester?.close(), stage0?.close(), stage1?.close()]);
    signaling.close();
    httpServer.closeAllConnections?.();
    if (httpServer.listening) await new Promise(resolve => httpServer.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
}, 40000);
