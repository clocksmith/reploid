/**
 * The harness-owned composition of one Stage 1 participant, used by the local processes and the real host agent. It
 * adds observers around the production resident and changes none of it: a cleartext token trace, the production
 * token witness, and a gate that holds an answer at one step so a cancel or a forced drop cannot race completion.
 *
 * A stage reads weight pieces only through the stage loader (stage-loader.js), which serves its assigned ranges from
 * its stage directory and nothing else, and records what it served.
 *
 * Settlement records are harness-collected: the requester signs settlement terms inside its own disclosure approval,
 * which runs after the route is chosen and before the reservation and dispatch, so the binding is complete there.
 * Stages sign their acceptance when the harness asks, during or after the attempt, because live code does not yet
 * carry terms to a stage before it reserves (a parked wire change).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
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
import { MAX_UNACKNOWLEDGED_OUTPUTS, createAttemptEvidenceSigner } from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { acceptSettlementTerms, signSettlementStop, signSettlementTerms } from '../../server/fleet/settlement-terms.js';
import { UNFINISHED_ANSWER_TERMS } from '../../server/fleet/credit-shares.js';
import { STAGE1_MODEL_ID } from './expectations.js';
import { createStageLoader, readPieceBytes } from './stage-loader.js';
import { metadataPieces, readPieceIndexBytes } from './stage-metadata.js';

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

/** Holds one armed thread at one step until the attempt is stopped or closed, or its process dies. A hold nobody ends fails. */
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

/** Real hosts: Doppler's verified piece storage, with every piece read going through the stage loader. */
const loaderSource = loader => async ({ model, modelDirectory, signal }) => {
  const runtime = await import('dopplerx/partitions');
  const root = await fs.realpath(modelDirectory);
  const manifestBytes = new Uint8Array(await fs.readFile(path.join(root, 'manifest.json')));
  const { bytes: indexBytes, digest } = await readPieceIndexBytes({ model, modelDirectory: root });
  const opened = await runtime.createVerifiedPieceStorage({ manifestBytes, indexBytes, indexIdentity: digest,
    signal, nodeGather: null, acquire: piece => loader.read(piece) });
  return { manifestBytes, storage: opened.storage, getReceipt: () => opened.getReceipt() };
};

/**
 * `stageIndex` null is the zero-weight requester. `config` carries the room and service credentials and is never logged;
 * a stage's `config.assignedRanges` is its loader allowlist. `nativeGpu`, `sourceRuntime` (a fake runtime, or a function
 * of the stage loader returning one) and `readBytes` (the loader's byte reader) are what differ between a real host and a fake.
 */
export async function openStage1Participant({ stageIndex, identity, config, nativeGpu, sourceRuntime = null, readBytes = readPieceBytes }) {
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
  const signer = createAttemptEvidenceSigner({ identity });
  // Requester: per attempt, its signed terms and stop, its acknowledgment view and how often it asked to disclose.
  // Stage: per attempt, the tally evidence it handed to the ledger and each step receipt it checkpointed.
  const records = new Map(), threads = new Map(), stageEvidence = new Map();
  let participant, stageOwner = null, requester = null, active = null, loader = null;
  if (stageIndex === null) {
    participant = await createNativeParticipant(common);
    requester = createFleetRequester({ participant, identity, credits, maxOutputTokens: config.maxOutputTokens });
  } else {
    // The journal's scope includes the room, and every Stage 1 run opens a new room, so each room gets its own journal. A
    // shared file would make the second run refuse the first run's journal as belonging to another scope.
    const journalName = `stage-owner-${createHash('sha256').update(String(config.roomId)).digest('hex').slice(0, 16)}.sqlite`;
    stageOwner = await openStageOwner({ file: path.join(config.stateDirectory, journalName), participantId: identity.peerId,
      roomId: config.roomId, serviceUrl: config.serviceUrl });
    const witness = await openStageTokenWitness(config.witness, { roomId: config.roomId, participantId: identity.peerId });
    // The tokenizer and any other non-weight file the stage opens come through the loader too, recorded as metadata.
    const index = await readPieceIndexBytes({ model, modelDirectory: config.modelDirectory });
    loader = createStageLoader({ directory: config.modelDirectory, assignedRanges: config.assignedRanges,
      metadataPieces: metadataPieces(model, index.bytes), readBytes });
    const fake = typeof sourceRuntime === 'function' ? sourceRuntime(loader) : sourceRuntime;
    const admission = createFleetExecutionAdmission({ credits, model, stageOwner });
    const kept = attemptId => {
      if (!stageEvidence.has(attemptId)) stageEvidence.set(attemptId, { bundle: null, receipts: new Map() });
      return stageEvidence.get(attemptId);
    };
    const observed = { ...admission,
      partitionReceipt(bundle) { kept(bundle.attemptId).bundle = structuredClone(bundle); return admission.partitionReceipt(bundle); },
      ...(admission.checkpoint ? { checkpoint(request, index, receipt) {
        if (receipt?.attemptId) kept(receipt.attemptId).receipts.set(receipt.sequence, structuredClone(receipt));
        return admission.checkpoint(request, index, receipt);
      } } : {}) };
    participant = await createNativeParticipant({ ...common, ...(fake ? { sourceRuntime: fake } : { resolvePartitionSource: loaderSource(loader) }),
      localStageWitness: { wrap: resident => gate.wrap(trace.wrap(witness.wrap(resident))) },
      ordered: shortcutOrderedParticipation({ model, models: catalog, stageIndex }),
      executionAdmission: observed });
    await participant.contribute(true);
  }
  const readyRoute = () => (participant.getState().models || []).find(row => row.id === model.id && row.partition && row.availability === 'ready');

  /** The requester's terms, from the policy and plan weights the service quoted and the route it is about to approve. */
  async function signTerms(preview, { threadId, attemptId }) {
    const { policy, model: served } = await credits.call('terms', { id: model.id, identity: model.identity });
    const weights = served.plans?.find(row => row.id === preview.route?.planId)?.creditWeights;
    const notBefore = Date.now();
    return signSettlementTerms({ signer, reservationId: `service:${identity.peerId}:${attemptId}`, policy,
      identity: { schema: 'reploid.partition-attempt/v2', threadId, attemptId, requesterId: identity.peerId, placementGeneration: 0, route: preview.route },
      maxOutputTokens: preview.serviceCreditQuote?.maxOutputTokens, weights, notBefore, deadline: notBefore + policy.maxRequestMs,
      unfinishedTerms: UNFINISHED_ANSWER_TERMS, maxUnacknowledgedOutputs: MAX_UNACKNOWLEDGED_OUTPUTS });
  }

  /** `keepPartial` returns a failed answer with the text received so far instead of throwing. */
  async function generate({ messages, threadId, keepPartial = false }) {
    const route = readyRoute();
    if (!route) throw Error('No ready split route');
    const stages = route.partition.route.stages.map(stage => stage.participantId);
    const attemptId = randomUUID(), controller = new AbortController(), run = { attemptId, controller, deltas: 0, reservationId: null };
    active = run;
    const record = { threadId, terms: null, termsError: null, stop: null, stopError: null, view: null, approvals: 0,
      received: { deltas: 0, text: '' }, outcome: 'running' };
    records.set(attemptId, record);
    threads.set(threadId, [...(threads.get(threadId) ?? []), attemptId]);
    const privacy = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'named', ids: [...new Set(stages)] } });
    let text = '';
    const requestApproval = async preview => {
      record.approvals += 1;
      const recipients = preview.recipients ?? preview.input?.recipients ?? [];
      if (!(preview.modelIdentity === model.identity && preview.planId === model.partitionPlanId
        && stages.every(id => recipients.includes(id)) && recipients.every(id => id === identity.peerId || stages.includes(id)))) return false;
      // Inside the approval: the route is chosen and nothing is reserved or dispatched yet.
      try { record.terms = await signTerms(preview, { threadId, attemptId }); }
      catch (error) { record.termsError = String(error?.message ?? error); }
      return true;
    };
    const onDelta = value => { run.deltas += 1; text += value?.text ?? ''; record.received = { deltas: run.deltas, text }; };
    try {
      const result = await requester.generate({ model: route, threadId, attemptId, privacy, messages },
        { signal: controller.signal, requestApproval, onDelta, onReservation: id => { run.reservationId = id; record.reservationId = id; },
          onAcknowledgments: view => { record.view = view; } });
      record.outcome = 'completed';
      return { attemptId, reservationId: run.reservationId, completed: true, text: result.content,
        route: { stages, planId: route.partition.planId, quantization: route.quantization ?? null, modelId: result.modelId,
          modelIdentity: result.modelIdentity }, execution: withoutSettlement(result.execution) };
    } catch (error) {
      record.outcome = controller.signal.aborted ? 'stopped' : 'failed';
      if (controller.signal.aborted) return { attemptId, reservationId: run.reservationId, completed: false, text, deltas: run.deltas, stopped: true };
      if (!keepPartial) throw error;
      return { attemptId, reservationId: run.reservationId, completed: false, text, deltas: run.deltas, stopped: false,
        failed: true, error: String(error?.message ?? error) };
    } finally { if (active === run) active = null; }
  }

  /** What this participant itself holds for one attempt. Nothing here is read from the ledger. */
  function settlementRecords({ attemptId }) {
    if (stageIndex === null) {
      const record = records.get(attemptId);
      if (!record) return { role: 'requester', known: false };
      return { role: 'requester', known: true, terms: record.terms, termsSigned: 'in-approval-before-dispatch', termsError: record.termsError,
        stop: record.stop, stopError: record.stopError, acknowledgments: record.view?.evidence() ?? null,
        reservationId: record.reservationId ?? null,
        received: { ...record.received }, outcome: record.outcome,
        approvals: record.approvals, attemptsOnThread: threads.get(record.threadId)?.length ?? 0 };
    }
    const kept = stageEvidence.get(attemptId);
    return { role: 'stage', stageIndex, closing: kept?.bundle ?? null, checkpoints: kept ? [...kept.receipts.values()] : [] };
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
    /**
     * The requester ends the answer: it signs its stop at the count it has acknowledged, then stops as a person's Stop
     * does (`requesterStop`), so the live requester hands its own signed stop to the ledger before the stages stop.
     */
    async cancel() {
      const run = active;
      if (!run) return { cancelled: false };
      const record = records.get(run.attemptId);
      if (record?.terms) {
        try { record.stop = await signSettlementStop({ signer, terms: record.terms, acknowledged: record.view?.count() ?? 0 }); }
        catch (error) { record.stopError = String(error?.message ?? error); }
      } else if (record) record.stopError = 'no signed terms to stop';
      run.controller.abort(Object.assign(new DOMException('Stopped by harness', 'AbortError'), { requesterStop: true }));
      return { cancelled: true };
    },
    trace: ({ attemptId }) => ({ tokenIds: trace.tokens(attemptId) }),
    generate,
    settlementRecords,
    /** A stage's signed acceptance of the requester's terms at its own index, with its own key. */
    acceptTerms({ terms }) {
      if (stageIndex === null) throw Error('Only a stage accepts settlement terms');
      return acceptSettlementTerms({ signer, terms, partitionIndex: stageIndex });
    },
    /** What the stage loader served and refused. */
    loaded() { if (!loader) throw Error('The requester loads no pieces'); return loader.accounting(); },
    async close() {
      active?.controller.abort(Error('Closing'));
      await participant.close();
      await stageOwner?.close();
      return {};
    }
  };
}
