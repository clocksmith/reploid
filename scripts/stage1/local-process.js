/**
 * One local Stage 1 participant: a zero-weight requester or one stage host. Started by the local adapter and driven
 * over IPC. Real here: signing identity, signaling, WebRTC, partition route, credit admission and settlement over
 * HTTP, and the production token witness. Fake: the model runtime (fake-runtime.js).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import wrtc from '@roamhq/wrtc';
import catalog from '../../shared/config/chat-models.json' with { type: 'json' };
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createExecutionPolicy } from '../../packages/reploid/src/chat/execution-policy.js';
import { createNativeParticipant, createNativeRtcAdapter } from '../../server/native-participant.js';
import { shortcutOrderedParticipation } from '../../server/native-ordered-shortcut.js';
import { createFleetClient } from '../../server/fleet/service.js';
import { createFleetRequester } from '../../server/fleet/requester.js';
import { createFleetExecutionAdmission } from '../../server/fleet/execution-admission.js';
import { openStageOwner } from '../../server/fleet/stage-owner.js';
import { openStageTokenWitness } from '../../server/fleet/stage-token-witness.js';
import { resolveServedFile } from '../../server/browser-roots.js';
import { createFakeStageRuntime } from './fake-runtime.js';
import { measureDirectoryBytes } from './inventory.js';
import { STAGE1_MODEL_ID } from './expectations.js';

const role = process.argv[2], stageIndex = role === 'requester' ? null : Number(role.replace('stage', ''));
const model = catalog.find(row => row.id === STAGE1_MODEL_ID);
const identity = await createSigningIdentity({ algorithm: 'Ed25519' });
class LocalSocket extends WebSocket { constructor(url) { super(url, { origin: 'http://localhost:8000' }); } }
const logger = { info() {}, log() {}, debug() {}, warn() {}, error() {} };
const holds = new Set(), observed = {}, traces = new Map();
let participant = null, stageOwner = null, requester = null, options = null, active = null;

const pinnedFile = fileRole => model.source.files.find(file => file.role === fileRole);

/** Records each final-stage token ID in the clear, beside the production witness's digest of them. */
function traceTokens(inner) {
  return { wrap(resident) {
    const wrapped = inner.wrap(resident);
    return { ...wrapped, async executeStage(input) {
      const result = await wrapped.executeStage(input);
      if (Number.isSafeInteger(result?.tokenId)) {
        const attempt = input.identity.attemptId;
        traces.set(attempt, [...(traces.get(attempt) ?? []), result.tokenId]);
      }
      return result;
    } };
  } };
}

async function open(config) {
  options = config;
  const manifestDescriptor = pinnedFile('model-manifest'), pieceDescriptor = pinnedFile('model-piece-index');
  const manifestBytes = await fs.readFile(resolveServedFile(manifestDescriptor.url, { roots: ['shared'] }));
  await fs.mkdir(config.modelDirectory, { recursive: true, mode: 0o700 });
  await fs.mkdir(config.stateDirectory, { recursive: true, mode: 0o700 });
  const credits = createFleetClient({ url: config.serviceUrl, identity, outboxFile: path.join(config.stateDirectory, 'credit-outbox.json') });
  const common = { model, modelDirectory: config.modelDirectory, identity, rtc: createNativeRtcAdapter(wrtc), WebSocket: LocalSocket,
    signalingUrl: config.signalingUrl, roomId: config.roomId, roomToken: config.roomToken, cacheDirectory: null, nativeGpu: async () => ({}),
    logger, getRtcConfig: () => ({ iceServers: [], iceTransportPolicy: 'all' }) };
  if (stageIndex === null) {
    participant = await createNativeParticipant(common);
    requester = createFleetRequester({ participant, identity, credits, maxOutputTokens: config.maxOutputTokens });
    return {};
  }
  // Stage directories hold the pinned metadata a stage opens with, never weight bytes.
  await fs.writeFile(path.join(config.modelDirectory, 'manifest.json'), manifestBytes);
  await fs.writeFile(path.join(config.modelDirectory, pieceDescriptor.path), await fs.readFile(resolveServedFile(pieceDescriptor.url, { roots: ['shared'] })));
  const fake = createFakeStageRuntime({ model, manifest: JSON.parse(manifestBytes), reference: config.reference, holds, observed });
  const sourceRuntime = { runtime: fake, gather: { maxPartBytes: 4096, memoryBudgetBytes: 8192, concurrency: 1 },
    receipt: { schema: 'reploid.diagnostic-source-identity/v1' }, assertCurrent: async () => {} };
  stageOwner = await openStageOwner({ file: path.join(config.stateDirectory, 'stage-owner.sqlite'), participantId: identity.peerId,
    roomId: config.roomId, serviceUrl: config.serviceUrl });
  const witness = await openStageTokenWitness(config.witness, { roomId: config.roomId, participantId: identity.peerId });
  participant = await createNativeParticipant({ ...common, sourceRuntime, localStageWitness: traceTokens(witness),
    ordered: shortcutOrderedParticipation({ model, models: catalog, stageIndex }),
    executionAdmission: createFleetExecutionAdmission({ credits, model, stageOwner }) });
  await participant.contribute(true);
  return { assignedLayers: observed.assignedLayers };
}

const readyRoute = () => (participant.getState().models || []).find(row => row.id === model.id && row.partition && row.availability === 'ready');

const withoutSettlement = ({ settlement: _settlement, serviceCredit: _credit, ...execution } = {}) => execution;

async function generate({ messages, threadId, cancelAfterDeltas = null }) {
  const route = readyRoute();
  if (!route) throw Error('No ready split route');
  const stages = route.partition.route.stages.map(stage => stage.participantId);
  const attemptId = randomUUID(), controller = new AbortController();
  active = { attemptId, controller };
  const privacy = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'named', ids: [...new Set(stages)] } });
  let deltas = 0, text = '', reservationId = null;
  const requestApproval = preview => {
    const recipients = preview.recipients ?? preview.input?.recipients ?? [];
    return preview.modelIdentity === model.identity && preview.planId === model.partitionPlanId
      && stages.every(id => recipients.includes(id)) && recipients.every(id => id === identity.peerId || stages.includes(id));
  };
  const onDelta = value => {
    deltas += 1; text += value?.text ?? '';
    if (cancelAfterDeltas !== null && deltas >= cancelAfterDeltas) controller.abort(new DOMException('Stopped by harness', 'AbortError'));
  };
  try {
    const result = await requester.generate({ model: route, threadId, attemptId, privacy, messages },
      { signal: controller.signal, requestApproval, onDelta, onReservation: id => { reservationId = id; } });
    return { attemptId, reservationId, completed: true, text: result.content, route: { stages, planId: route.partition.planId,
      quantization: route.quantization ?? null, modelId: result.modelId, modelIdentity: result.modelIdentity },
    execution: withoutSettlement(result.execution) };
  } catch (error) {
    if (cancelAfterDeltas === null || !controller.signal.aborted) throw error;
    return { attemptId, reservationId, completed: false, text, stopped: error?.name === 'AbortError' || controller.signal.aborted };
  } finally { active = null; }
}

const operations = {
  open,
  state: () => ({ ready: Boolean(readyRoute()), phase: participant?.getState().phase ?? null }),
  activity() {
    const state = participant.getState(), active = state.reservations?.active;
    // A missing counter must not read as "nothing active".
    if (!Number.isSafeInteger(active) || !Number.isSafeInteger(state.unsettledOwners)) throw Error('Stage reservation state unavailable');
    return { active, unsettledOwners: state.unsettledOwners };
  },
  hold: ({ threadId }) => { holds.add(threadId); return {}; },
  trace: ({ attemptId }) => ({ tokenIds: traces.get(attemptId) ?? [] }),
  weights: () => measureDirectoryBytes([options.modelDirectory]),
  /** No model loads: the requirement is compared to a configured limit, and the result is marked as fake. */
  solo: ({ settings, requiredBytes }) => ({ outcome: 'failed', settings, claimedFailure: null,
    failure: { kind: 'out-of-memory', evidence: 'fake-runtime', operatorCapped: true, requiredBytes, limitBytes: options.fakeMemoryBytes } }),
  generate,
  async close() {
    active?.controller.abort(Error('Closing'));
    await participant?.close();
    await stageOwner?.close();
    participant = null; stageOwner = null;
    return {};
  }
};

process.on('message', async ({ id, op, body }) => {
  try { process.send({ id, result: (await operations[op](body ?? {})) ?? {} }); }
  catch (error) { process.send({ id, error: String(error?.message ?? error) }); }
  if (op === 'close') process.disconnect();
});
process.on('disconnect', () => { setTimeout(() => process.exit(0), 200).unref(); });
process.send({ event: 'identity', participantId: identity.peerId, publicJwk: identity.publicJwk });
