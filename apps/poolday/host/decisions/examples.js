/**
 * The Examples route without markup: the protein-sequence run (request validation, the remembered public-sequence
 * consent, peer or local execution, recovery and the preserved request) and the document search. It is the vanilla
 * route's binding (ui/pool-home/home-ask-controls.js, peer-run-surface.js, run-result-view.js and document-search.js)
 * with the DOM taken out, calling the same model contracts, run session and result readers. The run session
 * (host/peer-run-session.js) and the document assistant (pool/document-delegation.js) own execution.
 */
import { createPeerRunSession, supportsLocalRequest, canOfferLocalFallback } from '../peer-run-session.js';
import { getPeerRoomId, getPeerRelayMode } from '../product-context.js';
import { createPeerRoomInviteUrl } from '../../pool/peer-rendezvous.js';
import { FASTEST_RECEIPT_POLICY_ID, getPolicy, listPolicies } from '../../pool/policy-router.js';
import {
  LAUNCH_MODEL, POOLDAY_MODEL_WORKLOADS, getEnabledPoolModelContract, getPoolModelWorkload, listPoolModels
} from '../../../../shared/pool/model-contract.js';
import {
  SEQUENCE_ALPHABETS, SEQUENCE_PUBLIC_SENSITIVITY, getMaxPublicSequenceLength, isSequenceWorkload, normalizeSequenceInput
} from '../../../../shared/pool/sequence-workload.js';
import { LAB_SURFACE_IDS, SURFACE_INTENTS } from '../../../../shared/config/surface-intents.js';
import { POOLDAY_NAME, ROUTE_COPY, choosePooldayAskPlaceholderForLane } from '../../ui/pool-home/constants.js';
import {
  extractOutputText, extractResultSummary, formatErrorResultText, formatResultMessage, isEmbeddingPublicationPermitted, isErrorResult,
  sequenceOutputFor
} from '../../ui/pool-home/run-result-format.js';
import { compactHash, safeJsonStringify } from '../../ui/pool-home/view-markup.js';
import { displayPoolError } from '../../ui/pool-home/control-display-text.js';
import {
  POOL_PENDING_REQUEST_TTL_MS, readPendingRequestRecovery, writePendingRequestRecovery, clearPendingRequestRecovery
} from '../../ui/pool-home/pending-request-recovery.js';
import { getRequesterIdentityNamespace } from '../../ui/pool-home/page-identity.js';
import { addReceiptLedgerRow, recordPeerLedgerEvents } from '../../ui/pool-home/record-ledger-view.js';
import { participantLabel } from '../../ui/pool-home/computer-labels.js';
import { bindDiamondRenderer } from '../../ui/components/diamond-renderer.js';
import { subscribeContributionState } from '../../ui/pool-home/contribution-state.js';
import { readTextAttachments } from '../../ui/components/attachments.js';
import documentPolicy from '../../pool/document-search-policy.json' with { type: 'json' };

const CONSENT_KEY = 'reploid.pool.sequence-public-consent.v1';
const RUN_STATE_COPY = Object.freeze({ idle: 'Ready', submitting: 'Preparing request', running: 'Running on the network',
  complete: 'Answer verified', error: 'Run needs attention', inspecting: 'Inspecting proof' });
const RUN_ACTIVITY_COPY = Object.freeze({
  peer_run_intent_created: 'Request signed',
  peer_provider_discovery_started: 'Finding compatible contributor tabs',
  peer_assignment_planned: 'Contributor tabs matched',
  'relay-publish-retrying': 'Retrying relay publish',
  'relay-poll-failed': 'Relay delayed — retrying',
  'relay-dispatch-retrying': 'Retrying local message delivery',
  'relay-dispatch-recovered': 'Message delivery recovered',
  'relay-circuit-open': 'Relay unavailable — retrying shortly',
  'relay-circuit-half-open': 'Checking relay recovery',
  'relay-circuit-closed': 'Relay connection recovered',
  peer_inference_started: 'Contributor tabs are answering',
  peer_provider_queued: 'Request queued behind existing contributor work',
  peer_provider_execution_started: 'Contributor started this request',
  peer_transport_retrying: 'Retrying through relay transport',
  peer_receipts_received: 'Checking returned receipts',
  peer_agreement_verified: 'Agreement verified',
  peer_run_completed: 'Answer verified',
  peer_run_failed: 'Run needs attention'
});
const POLICY_LABELS = Object.freeze({ fastest_receipt: 'One peer', canary_audited: 'One peer with audit',
  redundant_agreement: 'Two matching peers', ring_quorum_receipt: 'Peer quorum' });
const policyLabel = policyId => POLICY_LABELS[policyId] || String(policyId || 'default').replace(/_/g, ' ');

/** What the page shows above the task: its name, its promise and the experiments it links to. */
export function examplesPageCopy() {
  return {
    name: POOLDAY_NAME,
    body: ROUTE_COPY.examples.body,
    recordsHref: `/records?room=${encodeURIComponent(getPeerRoomId())}`,
    experiments: LAB_SURFACE_IDS.map(id => ({ id, label: SURFACE_INTENTS[id].label, href: SURFACE_INTENTS[id].route }))
  };
}

/** The model's facts, as the vanilla pack summary states them. */
export function packSummary(model = LAUNCH_MODEL) {
  const identity = model.artifactIdentity || {};
  const dimensions = Number(model.embeddingDimensions || model.dimensions || 0);
  const maxInput = Number(model.sequence?.maxLength || model.contextLength || 0);
  const work = model.executionMode === 'full_model_browser_sequence' ? 'Full model · one sequence'
    : `${model.runtime || 'Doppler'} · ${model.backend || 'qualified provider'}`;
  return [
    ['Model identity', compactHash(identity.weightPackId || model.modelHash || model.modelId)],
    ['Capability', dimensions ? `Sequence embedding · ${dimensions} dimensions` : getPoolModelWorkload(model).replace(/[._-]/g, ' ')],
    ['Input', maxInput ? `Public protein sequence · up to ${maxInput} residues` : 'Public protein sequence'],
    ['Work', work],
    ['Providers', 'Searching']
  ];
}

const describeSelectedRun = ({ policyId, modelId, status = 'finding_peer_provider' } = {}) => {
  const policy = getPolicy(policyId || FASTEST_RECEIPT_POLICY_ID);
  const model = getEnabledPoolModelContract(modelId || LAUNCH_MODEL.modelId) || LAUNCH_MODEL;
  return {
    status, transport: `webrtc_peer_room_${getPeerRelayMode()}`, roomId: getPeerRoomId(), relay: getPeerRelayMode(),
    workMode: 'whole_job_redundant_records', policyId: policy?.policyId || policyId || FASTEST_RECEIPT_POLICY_ID,
    trustTier: policy?.adaptiveRing ? 'group check' : 'one tab',
    requiredAgreement: policy?.adaptiveRing ? `${policy.minRingSize || 1}-${policy.maxRingSize || 1} tabs, match by output hash`
      : `${policy?.redundancy || 1} tab${Number(policy?.redundancy || 1) === 1 ? '' : 's'}`,
    model: { modelId: model.modelId, modelHash: model.modelHash, manifestHash: model.manifestHash, runtime: model.runtime, backend: model.backend },
    adapter: null
  };
};

const receiptTokenTotal = (record = {}) => {
  const receipt = record.receipt || record.body?.receipt || record;
  const counts = receipt.tokenCounts || record.tokenCounts || {};
  const input = Number(counts.input || 0), output = Number(counts.output || 0);
  const tokenIds = record.tokenIds || record.body?.tokenIds || receipt.tokenIds || [];
  const inputCount = Number.isFinite(input) ? input : 0;
  const fallbackOutput = Array.isArray(tokenIds) ? tokenIds.length : 0;
  const outputCount = Number.isFinite(output) && output > 0 ? output : fallbackOutput;
  return inputCount + outputCount;
};

/** Which contributor tabs were selected, matched, flagged or excluded, under which policy (run-contribution-evidence.js). */
export function projectContributors(value = {}) {
  if (value.transport === 'local_capsule') {
    return { local: true, summary: [['Execution', 'This device'], ['Sharing', 'Unchanged']],
      note: 'Signed model and local execution receipt verified. No independent contributor comparison.', route: null, excluded: [], rows: [] };
  }
  const payloads = Array.isArray(value.receiptPayloads) ? value.receiptPayloads : [];
  const assignments = Array.isArray(value.assignments) ? value.assignments : [];
  const agreement = value.agreement || {};
  const accepted = new Set(agreement.receiptHashes || []);
  const valid = new Set((agreement.validRecords || []).map(record => record.receiptHash).filter(Boolean));
  const rejected = new Map((agreement.rejectedRecords || []).map(record => [
    record.receiptHash || record.receiptPayload?.body?.receiptHash || record.receiptPayload?.fromPeerId || 'unknown', record.reasons || []]));
  const rows = payloads.map(payload => {
    const body = payload.body || payload, receipt = body.receipt || {};
    const hash = body.receiptHash || receipt.receiptHash || '';
    const providerId = body.providerId || receipt.providerId || payload.fromPeerId || 'unknown';
    let status = 'flagged';
    if (accepted.has(hash)) status = 'matched';
    else if (valid.has(hash)) status = 'returned';
    return { provider: compactHash(providerId), status,
      reason: rejected.get(hash)?.join('; ') || null, tokens: String(receiptTokenTotal(body)),
      output: compactHash(receipt.outputHash || body.outputHash || hash || '—') };
  });
  const listed = rows.length ? rows : assignments.map(assignment => ({ provider: compactHash(assignment.providerId || 'unknown'), status: 'selected',
    reason: null, tokens: '—', output: compactHash(assignment.assignmentId || assignment.jobId || '—') }));
  const policyId = value.policyId || agreement.policyId || value.assignment?.policyId || 'default';
  let check = 'not accepted';
  if (agreement.accepted) check = `${agreement.acceptedProviderCount || accepted.size || 1}/${agreement.requiredAgreement || 1} matched`;
  else if (value.status === 'finding_peer_provider') check = 'waiting for matching tabs';
  const shared = assignments.length || value.acceptedSessionCount || rows.length || 0;
  const decision = value.plan?.routeDecision || value.routeDecision || null;
  const candidates = Array.isArray(decision?.candidates) ? decision.candidates : [];
  const selected = candidates.find(candidate => decision.selectedProviderIds?.includes(candidate.providerId));
  const excluded = candidates.filter(candidate => !candidate.eligible);
  return {
    local: false,
    summary: [['Shared', `${shared} contributor tab${shared === 1 ? '' : 's'}`], ['Match', check], ['Policy', policyLabel(policyId)]],
    note: listed.length ? '' : 'Contributor evidence appears after matching tabs answer.',
    route: decision ? [['Artifact', String(selected?.artifactSourcePlan || 'provider_loaded_model').replace(/_/g, ' ')],
      ['Eligible', String(candidates.filter(candidate => candidate.eligible).length)], ['Excluded', String(excluded.length)]] : null,
    excluded: excluded.map(candidate => `${compactHash(candidate.providerId || 'unknown')}: ${(candidate.rejectionReasons || []).join(', ') || 'not eligible'}`),
    rows: listed
  };
}

/** A run result as the vanilla result box shows it: summary, embedding outcome, answer text, recovery, proof, raw. */
export function projectRunResult(value) {
  if (value === undefined || value === null || value === '') return null;
  const summary = value && typeof value === 'object' ? extractResultSummary(value)
    .map(([label, fieldValue]) => [label, label === 'Status' ? String(fieldValue) : compactHash(fieldValue)]) : [];
  let raw;
  if (typeof value === 'string') raw = value;
  else if (isErrorResult(value)) raw = formatErrorResultText(value);
  else raw = safeJsonStringify(value, { redactSequenceOutput: true }) || String(value);
  const pooled = value && typeof value === 'object' ? sequenceOutputFor(value)?.pooledEmbedding : null;
  let embedding = null;
  if (Array.isArray(pooled) && pooled.length) {
    const identity = compactHash(value.sequenceResultHash || value.vectorHash || '');
    const permitted = isEmbeddingPublicationPermitted(value);
    embedding = {
      permitted,
      meta: permitted ? `${pooled.length} dimensions · Result ${identity}`
        : `${pooled.length} dimensions · Result ${identity} · Raw vector withheld because embedding publication consent was not granted.`,
      detailMeta: permitted ? `${pooled.length} dimensions · ${identity}` : `${pooled.length} dimensions · ${identity} · Raw vector withheld`,
      vector: permitted ? safeJsonStringify(pooled) || '[]' : '',
      withheld: permitted ? '' : 'The raw embedding is withheld because publication consent was not granted.'
    };
  }
  const recovery = value && typeof value === 'object' && value.recovery && (value.recovery.title || value.recovery.message || value.recovery.actions?.length)
    ? { kind: value.recovery.kind || 'attention', title: value.recovery.title || '', message: value.recovery.message || '',
      details: (value.recovery.details || []).filter(Boolean),
      actions: (value.recovery.actions || []).filter(action => action?.id && action?.label)
        .map(action => ({ id: action.id, label: action.label, primary: action.primary === true, href: action.href || null })) }
    : null;
  return {
    error: isErrorResult(value),
    summary,
    embedding,
    output: extractOutputText(value) || formatResultMessage(value),
    recovery,
    contributors: value && typeof value === 'object' ? projectContributors(value) : null,
    raw
  };
}

const readConsent = storage => { try { return storage?.getItem(CONSENT_KEY) === 'true'; } catch { return false; } };
const writeConsent = storage => { try { storage?.setItem(CONSENT_KEY, 'true'); } catch { /* applies to this page */ } };

/**
 * The protein-sequence run. Commands change what is staged; `submit` validates and runs it; `recover` takes a
 * recovery action. The snapshot is a fresh object on each change.
 */
export function createExamplesRun({ storage = null, sessionStorageAvailable = true, random = Math.random, now = () => Date.now() } = {}) {
  const listeners = new Set();
  const models = listPoolModels({ enabledOnly: true, workload: POOLDAY_MODEL_WORKLOADS.sequenceEmbedding });
  const policies = listPolicies().map(policy => ({ value: policy.policyId, label: policyLabel(policy.policyId) }));
  let runSession = null;
  const session = () => (runSession ??= createPeerRunSession({ identityNamespace: getRequesterIdentityNamespace() }));
  let disposed = false, inFlight = false, generation = 0;
  let pendingRequest = null, pendingError = null;
  const state = {
    modelId: models.find(model => model.modelId === LAUNCH_MODEL.modelId)?.modelId || models[0]?.modelId || '',
    policyId: FASTEST_RECEIPT_POLICY_ID,
    sequence: '',
    suggestion: choosePooldayAskPlaceholderForLane('sequence', random),
    consent: readConsent(storage),
    consentSaved: readConsent(storage),
    visual: { state: 'idle', phase: '', message: RUN_STATE_COPY.idle },
    result: null,
    busy: false,
    focusSequence: 0
  };
  let snapshot = null;
  const model = () => getEnabledPoolModelContract(state.modelId) || LAUNCH_MODEL;
  const feedback = () => {
    const contract = model();
    const alphabet = contract.sequence?.alphabet || SEQUENCE_ALPHABETS.aminoAcid;
    const policyLimit = getMaxPublicSequenceLength(alphabet);
    const limit = Math.min(policyLimit, Number(contract.sequence?.maxLength) || policyLimit);
    const length = state.sequence.replace(/\s+/g, '').length;
    let message = '';
    if (length) {
      try {
        normalizeSequenceInput(state.sequence, alphabet);
        if (length > limit) message = `This model accepts up to ${limit} residues.`;
      } catch (error) { message = error.message; }
    }
    return { count: `${length} / ${limit}`, message: message || 'Whitespace is ignored.', invalid: Boolean(message) };
  };
  const project = () => Object.freeze({
    models: models.map(entry => ({ value: entry.modelId, label: entry.label || entry.modelId })),
    policies,
    modelId: state.modelId,
    policyId: state.policyId,
    sequence: state.sequence,
    suggestion: state.suggestion,
    consent: state.consent,
    consentSaved: state.consentSaved,
    feedback: feedback(),
    pack: packSummary(model()),
    visual: state.visual,
    busy: state.busy,
    outputVisible: ['complete', 'error', 'inspecting'].includes(state.visual.state),
    result: projectRunResult(state.result),
    focusSequence: state.focusSequence
  });
  const notify = () => { if (disposed) return; snapshot = project(); for (const listener of listeners) listener(); };
  const setVisual = (runState, phase = '', message = '') => { state.visual = { state: runState, phase, message: message || RUN_STATE_COPY[runState] || RUN_STATE_COPY.idle }; };
  const inviteUrl = () => createPeerRoomInviteUrl({ roomId: getPeerRoomId(), relay: getPeerRelayMode(), baseUrl: globalThis.location?.href || '' });
  const modelLabelOf = (contract = {}) => contract.label || contract.name || contract.modelId || 'the selected model';
  const missingProviderRecovery = request => ({
    kind: 'provider_missing', title: 'No matching browser is ready',
    message: `No contributor in "${getPeerRoomId()}" is currently advertising ${modelLabelOf(request.selectedModel)}.${supportsLocalRequest(request) ? ' Run here without sharing compute, or keep searching.' : ' The selected checks require a matching contributor; local execution cannot replace them.'}`,
    actions: [{ id: 'retry_network', label: 'Keep searching', primary: true },
      ...(supportsLocalRequest(request) ? [{ id: 'offer_local_provider', label: 'Run on this device' }] : []),
      { id: 'invite_contributor', label: 'Invite a contributor', href: inviteUrl() }]
  });
  const localConsentRecovery = request => ({
    kind: 'local_provider_consent', title: 'Run on this device?',
    message: `${modelLabelOf(request.selectedModel)} may need to download before this browser can answer the preserved request.`,
    details: ['Uses WebGPU and browser storage after a capability check.',
      'Runs only your request. Does not advertise this tab or change Share compute.',
      'Verifies the signed model and local execution receipt; does not claim independent peer agreement.'],
    actions: [{ id: 'confirm_local_provider', label: 'Download and run here', primary: true }, { id: 'back_to_network', label: 'Back' },
      { id: 'invite_contributor', label: 'Invite a contributor', href: inviteUrl() }]
  });
  const interruptedRecovery = request => ({
    kind: 'request_interrupted', title: 'Previous request was interrupted',
    message: `This tab reloaded before a verified result arrived from "${getPeerRoomId()}". The request has not been resumed or sent again.`,
    details: [`The explicitly public protein sequence remains in this browser tab for ${Math.round(POOL_PENDING_REQUEST_TTL_MS / 60000)} minutes.`,
      'Retry creates a new peer request and a new receipt path.', `Selected model: ${modelLabelOf(request.selectedModel)}.`],
    actions: [{ id: 'retry_interrupted_request', label: 'Retry request', primary: true }, { id: 'discard_interrupted_request', label: 'Discard' }]
  });
  const requestFromRecord = record => {
    const selectedModel = getEnabledPoolModelContract(record?.selectedModelId);
    if (!selectedModel || !isSequenceWorkload(getPoolModelWorkload(selectedModel))) return null;
    return { lane: 'sequence', promptText: null, sequence: record.sequence.trim(),
      sequenceRequest: { workload: getPoolModelWorkload(selectedModel), alphabet: selectedModel.sequence?.alphabet || SEQUENCE_ALPHABETS.aminoAcid,
        sensitivity: SEQUENCE_PUBLIC_SENSITIVITY, includeTokenEmbeddings: false, includeLogits: false },
      selectedModel, modelRequirements: selectedModel, adapterPackHash: null, policyId: record.policyId || FASTEST_RECEIPT_POLICY_ID, researchSubmission: null };
  };
  // A run preserved before a reload asks what to do with it; it is never resumed or resent on its own.
  if (sessionStorageAvailable) {
    const persisted = readPendingRequestRecovery();
    const restored = persisted && requestFromRecord(persisted);
    if (persisted && !restored) clearPendingRequestRecovery();
    if (restored) {
      pendingRequest = restored;
      state.sequence = restored.sequence; state.modelId = restored.selectedModel.modelId; state.consent = true;
      pendingError = { status: 'error', statusLabel: 'Interrupted', error: 'Previous request needs a decision',
        reason: 'This tab reloaded before a verified result arrived.', code: 'peer_request_interrupted', retryable: true,
        action: 'Retry the request or discard the preserved input.', roomId: getPeerRoomId(), relay: getPeerRelayMode(),
        model: restored.selectedModel, recovery: interruptedRecovery(restored) };
      state.result = pendingError;
      setVisual('error', 'recovery', 'Previous request needs a decision');
    }
  }
  const prepare = () => {
    let input = state.sequence.trim();
    if (!input && state.suggestion) { input = state.suggestion.trim(); state.sequence = input; }
    if (!input) {
      setVisual('error', 'prompt', 'Enter a protein sequence to run');
      state.result = { status: 'error', error: 'Protein sequence is required', reason: 'The request body is empty.', action: 'Enter a protein sequence, then run again.' };
      return null;
    }
    if (!state.consent) {
      const error = new Error('Confirm that this protein sequence is public before sending it to selected contributors');
      error.code = 'sequence_public_consent_required';
      error.action = 'Check the public-sequence confirmation, then run again.';
      throw error;
    }
    writeConsent(storage); state.consentSaved = true;
    const selectedModel = model();
    if (!isSequenceWorkload(getPoolModelWorkload(selectedModel))) throw new Error('The selected request model does not support biological sequence work');
    return { lane: 'sequence', promptText: null, sequence: input.replace(/^Sequence:\s*/i, ''),
      sequenceRequest: { workload: getPoolModelWorkload(selectedModel), alphabet: selectedModel.sequence?.alphabet || SEQUENCE_ALPHABETS.aminoAcid,
        sensitivity: SEQUENCE_PUBLIC_SENSITIVITY, includeTokenEmbeddings: false, includeLogits: false },
      selectedModel, modelRequirements: selectedModel, adapterPackHash: null, policyId: state.policyId || FASTEST_RECEIPT_POLICY_ID };
  };
  const run = async (prepared = null) => {
    if (inFlight || disposed) return;
    const activityGeneration = ++generation;
    let acceptActivity = true;
    inFlight = true; state.busy = true;
    if (!prepared) { pendingRequest = null; pendingError = null; }
    const knownProvider = Boolean(prepared?.knownProviderAdverts?.length);
    let submitMsg = 'Preparing signed request';
    if (knownProvider) submitMsg = 'Starting the preserved request on this device';
    else if (prepared) submitMsg = 'Checking the network again';
    setVisual('submitting', 'prompt', submitMsg);
    notify();
    try {
      const request = prepared || prepare();
      if (!request || disposed) return;
      pendingRequest = request; pendingError = null;
      writePendingRequestRecovery(request);
      state.result = describeSelectedRun({ status: knownProvider ? 'starting_known_provider' : 'finding_peer_provider', policyId: request.policyId,
        modelId: request.selectedModel.modelId });
      notify();
      const result = await session().run(request, {
        onLocalExecution: () => { setVisual('running', 'infer', 'Preparing this device: verifying and loading the selected model'); notify(); },
        onActivity(activity = {}) {
          if (!acceptActivity || activityGeneration !== generation) return;
          setVisual('running', activity.phase || '', RUN_ACTIVITY_COPY[activity.status] || 'Running on the network'); notify();
        }
      });
      acceptActivity = false;
      if (disposed) return;
      result.inviteUrl = inviteUrl();
      result.relay = result.transport === 'local_capsule' ? 'none' : getPeerRelayMode();
      recordPeerLedgerEvents(result.ledgerEvents || result.body?.ledgerEvents || []);
      addReceiptLedgerRow({ ...(result.receiptRecord || result), requesterAcceptance: result.requesterAcceptance || null, agreement: result.agreement || null,
        routeDecision: result.plan?.routeDecision || result.routeDecision || null, transport: result.transport || null, relay: result.relay || getPeerRelayMode(),
        policyId: result.policyId || request.policyId, outputKind: result.outputKind || null, sequenceResultHash: result.sequenceResultHash || null,
        embeddingDimensions: result.embeddingDimensions || null }, result.receiptHash);
      state.result = result;
      setVisual('complete', 'answer', result.transport === 'local_capsule' ? 'Completed on this device' : 'Protein embedding verified');
      pendingRequest = null;
      clearPendingRequestRecovery();
    } catch (error) {
      acceptActivity = false;
      if (disposed) return;
      const selectedModel = pendingRequest?.selectedModel || model();
      const unavailable = pendingRequest && canOfferLocalFallback(error);
      const shown = displayPoolError(error, {
        title: unavailable ? 'No matching provider is currently available' : 'Request could not complete',
        action: unavailable ? 'Reploid searched the peer network. Choose a recovery option below.'
          : error?.payload?.action || error?.action || 'Check the technical details, then try again.',
        context: { roomId: getPeerRoomId(), relay: getPeerRelayMode(), model: selectedModel, adapterPackHash: null }
      });
      if (unavailable) {
        shown.statusLabel = 'No provider';
        shown.action = 'The request is preserved. Choose a recovery option below.';
        shown.recovery = missingProviderRecovery(pendingRequest);
        pendingError = shown;
        recordPeerLedgerEvents([{ type: 'request_event', fromPeerId: 'local-requester', createdAt: new Date(now()).toISOString(),
          body: { status: 'waiting_for_provider', reason: 'No matching provider', roomId: getPeerRoomId(), modelId: selectedModel.modelId || null,
            policyId: pendingRequest.policyId || null, retryable: true } }]);
      }
      state.result = shown;
      clearPendingRequestRecovery();
      setVisual('error', 'match', unavailable ? 'No matching provider is currently available' : 'Run needs attention');
    } finally {
      inFlight = false; state.busy = false;
      notify();
    }
  };
  snapshot = project();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setSequence(value) { state.sequence = String(value ?? ''); notify(); },
    setModel(modelId) { if (models.some(entry => entry.modelId === modelId)) { state.modelId = modelId; notify(); } },
    setPolicy(policyId) { if (policies.some(entry => entry.value === policyId)) { state.policyId = policyId; notify(); } },
    setConsent(on) {
      state.consent = Boolean(on);
      if (state.consent) { writeConsent(storage); state.consentSaved = true; }
      notify();
    },
    /** A fresh suggestion while the field is empty and not being edited. */
    rotateSuggestion() { if (!state.sequence.trim()) { state.suggestion = choosePooldayAskPlaceholderForLane('sequence', random); notify(); } },
    useExample() {
      if (state.busy || !state.suggestion) return;
      state.sequence = state.suggestion; state.focusSequence++; notify();
    },
    /** Input the field marks invalid is never sent; the field says why. */
    submit() { if (!feedback().invalid) void run(); },
    recover(actionId) {
      if ((actionId === 'retry_network' || actionId === 'retry_interrupted_request') && pendingRequest) { void run(pendingRequest); return; }
      if (actionId === 'discard_interrupted_request') {
        clearPendingRequestRecovery(); pendingRequest = null; pendingError = null; state.result = null;
        setVisual('idle', '', 'Ready for a new request'); notify(); return;
      }
      if (actionId === 'offer_local_provider' && pendingRequest && pendingError) { state.result = { ...pendingError, recovery: localConsentRecovery(pendingRequest) }; notify(); return; }
      if (actionId === 'back_to_network' && pendingError) { state.result = pendingError; notify(); return; }
      if (actionId === 'confirm_local_provider' && pendingRequest && !inFlight) void run({ ...pendingRequest, localExecution: true });
    },
    dispose() { disposed = true; ++generation; runSession?.close(); listeners.clear(); }
  };
}

/**
 * The document search as the vanilla panel words it (document-search.js refreshDocumentSearch). `staged` holds what
 * the person has typed or checked on this page: the share task and its consent.
 */
export function projectDocumentSearch(state, { shareConsent = false } = {}) {
  if (!state) return null;
  const statusLabels = { Embedding: 'Preparing search', Reranking: 'Ordering results' };
  let status = statusLabels[state.status] || state.status;
  if (!state.busy && !state.configured) status = 'Choose models to start.';
  else if (!state.busy && !state.corpus) status = 'Add documents to start.';
  const sharing = state.delegation;
  const taskClass = sharing?.taskClass || 'local-only';
  let shareStatus = 'Connect a compatible computer to share a task.';
  if (sharing?.phase === 'remote') shareStatus = 'Waiting for the other computer.';
  else if (sharing?.phase === 'combining') shareStatus = 'Finishing your answer on this device.';
  else if (sharing?.taskClass === 'local-only') shareStatus = 'This task stays on this device.';
  else if (sharing?.taskClass === 'derived-remote' && sharing?.available) shareStatus = 'Write only the information you approve for sharing. Source files stay here.';
  else if (sharing?.available) shareStatus = 'Only the task below is shared. Your question and files stay here.';
  const result = state.result;
  return {
    configured: Boolean(state.configured),
    busy: Boolean(state.busy),
    status,
    modelStatus: state.configured ? 'Models selected' : 'No models selected',
    corpus: state.corpus ? state.corpus.documents.map(item => item.sources.join(', ')).join(' · ') : 'No documents',
    submitDisabled: Boolean(state.busy || !state.configured || !state.corpus),
    cancelVisible: Boolean(state.busy),
    rerankAvailable: !state.busy && Boolean(state.hasReranker),
    answerAvailable: !state.busy && Boolean(state.hasGenerator),
    hasReranker: Boolean(state.hasReranker),
    hasGenerator: Boolean(state.hasGenerator),
    taskClass,
    shareStatus,
    reviewDisabled: Boolean(state.busy || !sharing?.available || !result),
    taskDisabled: Boolean(state.busy) || taskClass === 'local-only',
    preview: sharing?.preview ? {
      id: sharing.preview.id,
      recipient: `Recipient: ${participantLabel(sharing.preview.providerId)} · ${sharing.preview.modelId}`,
      scope: 'Only this approved task leaves your device. Source documents stay here.',
      input: sharing.preview.text,
      technical: safeJsonStringify(sharing.preview) || ''
    } : null,
    sendDisabled: Boolean(state.busy || !sharing?.preview || !shareConsent),
    answer: result?.answer?.text || '',
    matches: (result?.matches || []).map(match => ({ title: `${match.sources.join(', ')} · characters ${match.start + 1}–${match.end}`, text: match.text })),
    evidence: result ? JSON.stringify({ execution: result.execution, corpusHash: result.corpusHash, receipts: result.receipts, indexReceipt: result.indexReceipt,
      ...(result.remoteExecution ? { sharedTask: result.disclosure, remoteExecution: result.remoteExecution } : {}) }, null, 2) : '',
    restored: result ? { query: result.query, rerank: Boolean(result.reranked), answer: Boolean(result.answer) } : null
  };
}

/** The documents the search accepts, and the model settings it reads, as the vanilla panel limits them. */
export const DOCUMENT_LIMITS = Object.freeze({ maxDocuments: documentPolicy.maxDocuments, maxDocumentBytes: documentPolicy.maxDocumentBytes,
  maxCorpusBytes: documentPolicy.maxCorpusBytes, extensions: ['txt', 'md'], maxSettingsBytes: 1048576 });

/**
 * The document search panel over the page's document assistant (pool/document-delegation.js): what the person has
 * staged here (model settings and publisher trust, the question and its options, a shared task and its consent) and
 * the assistant's own state. The assistant reports no changes, so its state is read again while the panel is open.
 */
export function createDocumentSearch(assistant, { readAttachments = readTextAttachments, intervalMs = 300, setTimer = globalThis.setInterval, clearTimer = globalThis.clearInterval } = {}) {
  if (!assistant) return null;
  const listeners = new Set();
  let disposed = false, generation = 0, error = '', lastState = assistant.getState();
  const initial = lastState;
  const staged = {
    workflow: initial.busy || initial.result ? 'documents' : 'sequence',
    modelsFile: null, trusted: false,
    query: initial.result?.query || '', rerank: Boolean(initial.result?.reranked), answer: Boolean(initial.result?.answer),
    shareTask: '', shareConsent: false, setupOpen: !initial.configured
  };
  let snapshot = null;
  const project = () => {
    const view = projectDocumentSearch(lastState, { shareConsent: staged.shareConsent });
    return Object.freeze({ ...view, status: error || view.status, workflow: staged.workflow, modelsChosen: Boolean(staged.modelsFile),
      trusted: staged.trusted, query: staged.query, rerank: staged.rerank && view.hasReranker, answerRequested: staged.answer && view.hasGenerator,
      shareTask: staged.shareTask, shareConsent: staged.shareConsent, setupOpen: staged.setupOpen });
  };
  const notify = () => { if (disposed) return; snapshot = project(); for (const listener of listeners) listener(); };
  // The assistant builds a fresh state on each read, so a change is a change in what the panel would show.
  const signature = state => JSON.stringify(projectDocumentSearch(state));
  let lastSignature = signature(lastState);
  const refresh = () => {
    const next = assistant.getState();
    const nextSignature = signature(next);
    if (nextSignature === lastSignature) return;
    const configuredNow = next.configured && !lastState.configured;
    lastState = next; lastSignature = nextSignature; error = '';
    if (!next.configured) staged.setupOpen = true;
    else if (configuredNow) staged.setupOpen = false;
    notify();
  };
  const fail = cause => { if (!disposed) { error = String(cause?.message || cause); notify(); } };
  // A failure's own message stays until what the panel shows changes again.
  const act = async work => { try { await work(); refresh(); } catch (cause) { refresh(); fail(cause); } };
  const timer = setTimer(refresh, intervalMs);
  snapshot = project();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    /** Protein sequences or document search; a running search or run keeps its panel. */
    setWorkflow(workflow, { runBusy = false } = {}) {
      if (lastState.busy || runBusy) return;
      staged.workflow = workflow === 'documents' ? 'documents' : 'sequence'; notify();
    },
    setSetupOpen(open) { staged.setupOpen = Boolean(open); notify(); },
    setModelsFile(file) { generation++; staged.modelsFile = file || null; staged.trusted = false; notify(); },
    setTrusted(on) { staged.trusted = Boolean(on); notify(); },
    configure() {
      const attempt = ++generation;
      void act(async () => {
        const file = staged.modelsFile;
        if (!file || file.size > DOCUMENT_LIMITS.maxSettingsBytes) throw new Error('Choose model settings smaller than 1 MiB');
        if (!staged.trusted) throw new Error('Confirm you trust the model publishers first');
        const configuration = JSON.parse(await file.text());
        if (disposed || attempt !== generation) return;
        if (!staged.trusted) throw new Error('Publisher trust was withdrawn');
        assistant.configure(configuration);
      });
    },
    addDocuments(files) {
      const attempt = ++generation;
      void act(async () => {
        if (!files?.length) return;
        const documents = await readAttachments([...files], [], { maxFiles: DOCUMENT_LIMITS.maxDocuments, maxFileBytes: DOCUMENT_LIMITS.maxDocumentBytes,
          maxTotalBytes: DOCUMENT_LIMITS.maxCorpusBytes, extensions: DOCUMENT_LIMITS.extensions });
        if (!disposed && attempt === generation) await assistant.setDocuments(documents);
      });
    },
    setQuery(value) { staged.query = String(value ?? ''); notify(); },
    setRerank(on) { staged.rerank = Boolean(on); notify(); },
    setAnswer(on) { staged.answer = Boolean(on); notify(); },
    search() {
      void act(() => assistant.search({ query: staged.query, rerank: staged.rerank && Boolean(lastState.hasReranker),
        generateAnswer: staged.answer && Boolean(lastState.hasGenerator) }));
      refresh();
    },
    setTaskClass(value) {
      staged.shareConsent = false;
      try { assistant.setTaskClass(value); } catch (cause) { fail(cause); }
      refresh(); notify();
    },
    setShareTask(value) {
      staged.shareTask = String(value ?? ''); staged.shareConsent = false;
      try { assistant.withdrawDelegation(); } catch (cause) { fail(cause); }
      refresh(); notify();
    },
    reviewShare() { staged.shareConsent = false; void act(() => assistant.prepareDelegation({ task: staged.shareTask })); },
    setShareConsent(on) { staged.shareConsent = Boolean(on); notify(); },
    sendShare() {
      const previewId = lastState.delegation?.preview?.id;
      void act(async () => {
        try { await assistant.approveDelegation({ previewId, text: staged.shareTask, publicInput: staged.shareConsent }); }
        finally { staged.shareConsent = false; }
      });
    },
    cancel() { generation++; assistant.cancel(); refresh(); },
    clear() {
      generation++; assistant.clear();
      staged.shareTask = ''; staged.shareConsent = false; staged.query = '';
      refresh(); notify();
    },
    dispose() { disposed = true; generation++; clearTimer(timer); listeners.clear(); }
  };
}

/**
 * The decorative prism's light effect over the shared WebGPU renderer (ui/components/diamond-renderer.js): it rests
 * while this page's run or this browser's contribution is working, and publishes its counters on
 * window.REPLOID_POOL_PRISM_STATS as the vanilla route did.
 */
export function createPrismEnhancer(run) {
  return shell => {
    let providerBusy = false;
    const requestBusy = () => ['running', 'submitting'].includes(run.getSnapshot().visual.state);
    const stats = {}; globalThis.REPLOID_POOL_PRISM_STATS = stats;
    const dispose = bindDiamondRenderer(shell, { stats, isBusy: () => requestBusy() || providerBusy });
    const unsubscribeRun = run.subscribe(() => dispose.refresh?.());
    const unsubscribeContribution = subscribeContributionState(state => {
      providerBusy = state.state === 'working' || state.state === 'starting'; dispose.refresh?.();
    });
    return () => { unsubscribeRun(); unsubscribeContribution(); dispose(); };
  };
}
