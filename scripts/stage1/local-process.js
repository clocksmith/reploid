/**
 * One local Stage 1 participant: a zero-weight requester or one stage host. Started by the local adapter and driven
 * over IPC. Real here: signing identity, signaling, WebRTC, partition route, credit admission and settlement over
 * HTTP, and the production token witness. Fake: the model runtime (fake-runtime.js).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import catalog from '../../shared/config/chat-models.json' with { type: 'json' };
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { resolveServedFile } from '../../server/browser-roots.js';
import { createFakeStageRuntime } from './fake-runtime.js';
import { measureDirectoryBytes } from './inventory.js';
import { STAGE1_MODEL_ID } from './expectations.js';
import { openStage1Participant } from './stage-participant.js';

const role = process.argv[2], stageIndex = role === 'requester' ? null : Number(role.replace('stage', ''));
const model = catalog.find(row => row.id === STAGE1_MODEL_ID);
const identity = await createSigningIdentity({ algorithm: 'Ed25519' });
const pinnedFile = fileRole => model.source.files.find(file => file.role === fileRole);
let participant = null, options = null;

async function open(config) {
  options = config;
  let sourceRuntime = null;
  if (stageIndex !== null) {
    // Stage directories hold the pinned metadata a stage opens with, never weight bytes.
    const manifestBytes = await fs.readFile(resolveServedFile(pinnedFile('model-manifest').url, { roots: ['shared'] }));
    const pieces = pinnedFile('model-piece-index');
    await fs.mkdir(config.modelDirectory, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(config.modelDirectory, 'manifest.json'), manifestBytes);
    await fs.writeFile(path.join(config.modelDirectory, pieces.path), await fs.readFile(resolveServedFile(pieces.url, { roots: ['shared'] })));
    sourceRuntime = loader => ({ runtime: createFakeStageRuntime({ model, manifest: JSON.parse(manifestBytes), reference: config.reference,
      loader, pieces: config.assignedRanges }),
    gather: { maxPartBytes: 4096, memoryBudgetBytes: 8192, concurrency: 1 },
    receipt: { schema: 'reploid.diagnostic-source-identity/v1' }, assertCurrent: async () => {} });
  }
  // The stage directory holds no weight bytes here, so the loader's byte reader returns none; its allowlist and record are real.
  participant = await openStage1Participant({ stageIndex, identity, config, nativeGpu: async () => ({}), sourceRuntime,
    readBytes: async () => new Uint8Array(0) });
  return { assignedLayers: participant.assignedLayers() };
}

const operations = {
  open,
  state: () => participant.state(),
  activity: () => participant.activity(),
  'arm-gate': body => participant.armGate(body),
  'gate-state': body => participant.gateState(body),
  progress: () => participant.progress(),
  cancel: () => participant.cancel(),
  trace: body => participant.trace(body),
  generate: body => participant.generate(body),
  'settlement-records': body => participant.settlementRecords(body),
  'accept-terms': body => participant.acceptTerms(body),
  loaded: () => participant.loaded(),
  weights: () => measureDirectoryBytes([options.modelDirectory]),
  /** No model loads: the requirement is compared to a configured limit, and the result is marked as fake. */
  solo: ({ settings, requiredBytes }) => ({ outcome: 'failed', settings, claimedFailure: null,
    failure: { kind: 'out-of-memory', evidence: 'fake-runtime', operatorCapped: true, requiredBytes, limitBytes: options.fakeMemoryBytes } }),
  async close() { await participant?.close(); participant = null; return {}; }
};

process.on('message', async ({ id, op, body }) => {
  try { process.send({ id, result: (await operations[op](body ?? {})) ?? {} }); }
  catch (error) { process.send({ id, error: String(error?.message ?? error) }); }
  if (op === 'close') process.disconnect();
});
process.on('disconnect', () => { setTimeout(() => process.exit(0), 200).unref(); });
process.send({ event: 'identity', participantId: identity.peerId, publicJwk: identity.publicJwk });
