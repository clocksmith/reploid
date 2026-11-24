/**
 * The harness-owned composition of one Stage 1 participant, used by the local processes and the real host agent. It
 * adds three observers around the production resident and changes none of it: a cleartext token trace, the production
 * token witness, and a gate that holds an answer before its final token so a cancel cannot race completion.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import catalog from '../../shared/config/chat-models.json' with { type: 'json' };
import { createExecutionPolicy } from '../../packages/reploid/src/chat/execution-policy.js';
import { createNativeParticipant } from '../../server/native-participant-runtime.js';
import { createNativeRtcAdapter } from '../../server/native-rtc-adapter.js';
import { shortcutOrderedParticipation } from '../../server/native-ordered-shortcut.js';
import { createFleetClient } from '../../server/fleet/service.js';
import { createFleetRequester } from '../../server/fleet/requester.js';
import { createFleetExecutionAdmission } from '../../server/fleet/execution-admission.js';
import { openStageOwner } from '../../server/fleet/stage-owner.js';
import { openStageTokenWitness } from '../../server/fleet/stage-token-witness.js';
import { STAGE1_MODEL_ID } from './expectations.js';

const SILENT = { info() {}, log() {}, debug() {}, warn() {}, error() {} };

/** Records each final-stage token ID in the clear, beside the production witness's digest of them. */
export function createTokenTrace() {
  const traces = new Map();
  return {
    tokens: attemptId => [...(traces.get(attemptId) ?? [])],
    wrap: resident => ({ ...resident, async executeStage(input) {
      const result = await resident.executeStage(input);
      if (Number.isSafeInteger(result?.tokenId)) {
        const attempt = input.identity.attemptId;
        traces.set(attempt, [...(traces.get(attempt) ?? []), result.tokenId]);
      }
      return result;
    } })
  };
}

/** Holds one armed thread at one step until the attempt is stopped or closed. A hold that nobody ends fails. */
export function createCancelGate({ holdMs = 120000 } = {}) {
  const armed = new Map(), entered = new Set(), waiters = new Map();
  const release = attemptId => { for (const finish of waiters.get(attemptId) ?? []) finish(); waiters.delete(attemptId); };
  const hold = (attemptId, signal) => new Promise((_, reject) => {
    const timer = setTimeout(() => reject(Error('Cancel gate was never released')), holdMs);
    const finish = () => { clearTimeout(timer); reject(signal?.reason ?? Error('Attempt closed at the cancel gate')); };
    if (signal?.aborted) { finish(); return; }
    signal?.addEventListener('abort', finish, { once: true });
    waiters.set(attemptId, [...(waiters.get(attemptId) ?? []), finish]);
  });
  return {
    arm(threadId, step) {
      if (!Number.isSafeInteger(step) || step < 1) throw Error('The cancel gate needs an answer of at least two tokens');
      armed.set(threadId, step);
    },
    isEntered: threadId => entered.has(threadId),
    wrap: resident => ({ ...resident,
      async executeStage(input) {
        if (armed.get(input.identity?.threadId) === input.step) {
          entered.add(input.identity.threadId);
          await hold(input.identity.attemptId, input.signal);
        }
        return resident.executeStage(input);
      },
      closeAttempt(request) { release(request.identity?.attemptId); return resident.closeAttempt(request); } })
  };
}

const withoutSettlement = ({ settlement: _settlement, serviceCredit: _credit, ...execution } = {}) => execution;

/**
 * `stageIndex` null is the zero-weight requester. `config` carries the room and service credentials and is never logged.
 * `nativeGpu` and `sourceRuntime` are what differ between a real host and a fake one.
 */
export async function openStage1Participant({ stageIndex, identity, config, nativeGpu, sourceRuntime = null }) {
  const model = catalog.find(row => row.id === STAGE1_MODEL_ID);
  await fs.mkdir(config.modelDirectory, { recursive: true, mode: 0o700 });
  await fs.mkdir(config.stateDirectory, { recursive: true, mode: 0o700 });
  const ca = config.serviceCa ?? undefined;
  class Socket extends WebSocket { constructor(url) { super(url, { origin: 'http://localhost:8000', ...(ca ? { ca } : {}) }); } }
  const credits = createFleetClient({ url: config.serviceUrl, identity, ...(ca ? { ca } : {}),
    outboxFile: path.join(config.stateDirectory, 'credit-outbox.json') });
  const { default: wrtc } = await import('@roamhq/wrtc');
  const common = { model, modelDirectory: config.modelDirectory, identity, rtc: createNativeRtcAdapter(wrtc), WebSocket: Socket,
    signalingUrl: config.signalingUrl, roomId: config.roomId, roomToken: config.roomToken, cacheDirectory: null, nativeGpu,
    logger: SILENT, getRtcConfig: () => ({ iceServers: [], iceTransportPolicy: 'all' }) };
  const trace = createTokenTrace(), gate = createCancelGate({ holdMs: config.gateHoldMs });
  let participant, stageOwner = null, requester = null, active = null;
  if (stageIndex === null) {
    participant = await createNativeParticipant(common);
    requester = createFleetRequester({ participant, identity, credits, maxOutputTokens: config.maxOutputTokens });
  } else {
    stageOwner = await openStageOwner({ file: path.join(config.stateDirectory, 'stage-owner.sqlite'), participantId: identity.peerId,
      roomId: config.roomId, serviceUrl: config.serviceUrl });
    const witness = await openStageTokenWitness(config.witness, { roomId: config.roomId, participantId: identity.peerId });
    participant = await createNativeParticipant({ ...common, ...(sourceRuntime ? { sourceRuntime } : {}),
      localStageWitness: { wrap: resident => gate.wrap(trace.wrap(witness.wrap(resident))) },
      ordered: shortcutOrderedParticipation({ model, models: catalog, stageIndex }),
      executionAdmission: createFleetExecutionAdmission({ credits, model, stageOwner }) });
    await participant.contribute(true);
  }
  const readyRoute = () => (participant.getState().models || []).find(row => row.id === model.id && row.partition && row.availability === 'ready');

  async function generate({ messages, threadId }) {
    const route = readyRoute();
    if (!route) throw Error('No ready split route');
    const stages = route.partition.route.stages.map(stage => stage.participantId);
    const attemptId = randomUUID(), controller = new AbortController(), run = { attemptId, controller, deltas: 0, reservationId: null };
    active = run;
    const privacy = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'named', ids: [...new Set(stages)] } });
    let text = '';
    const requestApproval = preview => {
      const recipients = preview.recipients ?? preview.input?.recipients ?? [];
      return preview.modelIdentity === model.identity && preview.planId === model.partitionPlanId
        && stages.every(id => recipients.includes(id)) && recipients.every(id => id === identity.peerId || stages.includes(id));
    };
    const onDelta = value => { run.deltas += 1; text += value?.text ?? ''; };
    try {
      const result = await requester.generate({ model: route, threadId, attemptId, privacy, messages },
        { signal: controller.signal, requestApproval, onDelta, onReservation: id => { run.reservationId = id; } });
      return { attemptId, reservationId: run.reservationId, completed: true, text: result.content,
        route: { stages, planId: route.partition.planId, quantization: route.quantization ?? null, modelId: result.modelId,
          modelIdentity: result.modelIdentity }, execution: withoutSettlement(result.execution) };
    } catch (error) {
      if (!controller.signal.aborted) throw error;
      return { attemptId, reservationId: run.reservationId, completed: false, text, stopped: true };
    } finally { if (active === run) active = null; }
  }

  return {
    assignedLayers: () => participant.getState().descriptor?.layerRange ?? null,
    state: () => ({ ready: Boolean(readyRoute()), phase: participant.getState().phase ?? null }),
    activity() {
      const state = participant.getState(), running = state.reservations?.active;
      // A missing counter must not read as "nothing active".
      if (!Number.isSafeInteger(running) || !Number.isSafeInteger(state.unsettledOwners)) throw Error('Stage reservation state unavailable');
      return { active: running, unsettledOwners: state.unsettledOwners };
    },
    armGate: ({ threadId, step }) => { gate.arm(threadId, step); return {}; },
    gateState: ({ threadId }) => ({ entered: gate.isEntered(threadId) }),
    progress: () => ({ attemptId: active?.attemptId ?? null, deltas: active?.deltas ?? 0 }),
    cancel() { active?.controller.abort(new DOMException('Stopped by harness', 'AbortError')); return { cancelled: Boolean(active) }; },
    trace: ({ attemptId }) => ({ tokenIds: trace.tokens(attemptId) }),
    generate,
    async close() {
      active?.controller.abort(Error('Closing'));
      await participant.close();
      await stageOwner?.close();
      return {};
    }
  };
}
