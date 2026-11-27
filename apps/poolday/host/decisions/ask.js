/**
 * "Run a model" (/ask) without markup: the sequence, model, verification policy and public-sequence
 * consent the person has staged, the run's state and result, and the recovery choices when no
 * contributor answers or the page reloaded mid-run. It is the vanilla run surface's binding
 * (ui/pool-home/peer-run-surface.js and run-controls.js) with the DOM taken out; the host's peer run
 * session (host/peer-run-session.js) executes, signs and verifies.
 */
import { createPeerRunSession, supportsLocalRequest, canOfferLocalFallback } from '../peer-run-session.js';
import { getPeerRoomId, getPeerRelayMode } from '../product-context.js';
import { createPeerRoomInviteUrl } from '../../pool/peer-rendezvous.js';
import { FASTEST_RECEIPT_POLICY_ID } from '../../pool/policy-router.js';
import { LAUNCH_MODEL, getEnabledPoolModelContract, getPoolModelWorkload } from '../../../../shared/pool/model-contract.js';
import { readParticipationPreferences } from '../../../../shared/pool/participation-profile.js';
import { SEQUENCE_ALPHABETS, SEQUENCE_PUBLIC_SENSITIVITY, isSequenceWorkload } from '../../../../shared/pool/sequence-workload.js';
import { describeSelectedRun } from '../../ui/pool-home/route-controls.js';
import { displayPoolError } from '../../ui/pool-home/control-display-text.js';
import { getRequesterIdentityNamespace, pageIdentityNavigationType } from '../../ui/pool-home/page-identity.js';
import { addReceiptLedgerRow, latestAcceptedReceipt, recordPeerLedgerEvents } from './run-ledger.js';
import {
  RUN_ACTIVITY_COPY, RUN_STATE_COPY, interruptedRecovery as buildInterruptedRecovery,
  localConsentRecovery as buildLocalConsentRecovery, missingProviderRecovery as buildMissingProviderRecovery, projectRunResult
} from './run-result.js';
import { DEFAULT_MODEL_ID, canRequestWith, modelChoices, packFacts, policyChoices, readDeviceIdentity, workloadLabel } from './run-routes.js';

/** The room this page runs in, its relay and where its saved answers are listed. */
export const roomContext = () => ({ id: getPeerRoomId(), relay: getPeerRelayMode(), recordsHref: `/records?${new URLSearchParams({ room: getPeerRoomId() })}` });

// The remembered consent to send a public sequence (ui/pool-home/sequence-consent.js) and the bounded recovery of an
// interrupted request (pending-request-recovery.js): the same keys and limits, so either page reads the other's record.
const CONSENT_KEY = 'reploid.pool.sequence-public-consent.v1';
const PENDING_KEY = 'reploid.pool.pending-request.v1';
const PENDING_VERSION = 1;
export const PENDING_REQUEST_TTL_MS = 15 * 60 * 1000;

export function createAskController({ local = globalThis.localStorage, session = globalThis.sessionStorage, href = () => globalThis.location?.href || '',
  emit = detail => globalThis.dispatchEvent?.(new CustomEvent('reploid:pool-run-visual-state', { detail })) } = {}) {
  const listeners = new Set();
  let disposed = false, requestInFlight = false, runActivityGeneration = 0;
  let pendingRequest = null, pendingErrorResult = null, result = null, copyStatus = '';
  const readConsent = () => { try { return local?.getItem(CONSENT_KEY) === 'true'; } catch { return false; } };
  let form = { prompt: 'MAPLALLLLGLVAGA', modelId: DEFAULT_MODEL_ID, policyId: FASTEST_RECEIPT_POLICY_ID, sequencePublic: readConsent() };
  let run = { state: 'idle', phase: '', message: RUN_STATE_COPY.idle };
  let identity = { label: 'Identity', protection: null, title: 'This device signs its network roles' };
  let snapshot = null;
  const project = () => {
    const preferences = readParticipationPreferences();
    const view = projectRunResult(result);
    return Object.freeze({
      form: { ...form }, busy: requestInFlight, run: { ...run },
      outputVisible: ['complete', 'error', 'inspecting'].includes(run.state),
      models: modelChoices(), policies: policyChoices(), workload: workloadLabel(form.modelId), facts: packFacts(form.modelId),
      canRequest: canRequestWith(preferences), identity: { ...identity }, room: roomContext(),
      result: { ...view, answerHidden: !!view.recovery }, copyStatus
    });
  };
  const notify = () => { if (disposed) return; snapshot = project(); for (const listener of listeners) listener(); };
  const setRun = (state, phase = '', message = '') => {
    run = { state, phase, message: message || RUN_STATE_COPY[state] || RUN_STATE_COPY.idle };
    emit({ ...run }); notify();
  };
  const setResult = value => {
    if (value && typeof value === 'object') recordPeerLedgerEvents(value.ledgerEvents || value.body?.ledgerEvents || []);
    result = value; copyStatus = ''; notify();
  };
  const inviteUrl = () => createPeerRoomInviteUrl({ roomId: getPeerRoomId(), relay: getPeerRelayMode(), baseUrl: href() });
  const runSession = createPeerRunSession({ identityNamespace: getRequesterIdentityNamespace() });
  const { requesterIdentity } = runSession;
  const missingProviderRecovery = request => buildMissingProviderRecovery({
    roomId: getPeerRoomId(), model: request.selectedModel, localAllowed: supportsLocalRequest(request), inviteUrl: inviteUrl()
  });
  const localConsentRecovery = request => buildLocalConsentRecovery({
    model: request.selectedModel, inviteUrl: inviteUrl()
  });
  const interruptedRecovery = request => buildInterruptedRecovery({
    roomId: getPeerRoomId(), model: request.selectedModel, ttlMs: PENDING_REQUEST_TTL_MS
  });

  const sequenceRequestFor = model => ({ workload: getPoolModelWorkload(model), alphabet: model.sequence?.alphabet || SEQUENCE_ALPHABETS.aminoAcid,
    sensitivity: SEQUENCE_PUBLIC_SENSITIVITY, includeTokenEmbeddings: false, includeLogits: false });
  const clearPending = () => { try { session?.removeItem(PENDING_KEY); } catch { /* nothing to clear */ } };
  const writePending = request => {
    if (request?.lane !== 'sequence' || request?.sequenceRequest?.sensitivity !== SEQUENCE_PUBLIC_SENSITIVITY || !String(request.sequence || '').trim()) return;
    try {
      session?.setItem(PENDING_KEY, JSON.stringify({ version: PENDING_VERSION, lane: 'sequence', sensitivity: SEQUENCE_PUBLIC_SENSITIVITY,
        sequence: request.sequence, selectedModelId: request.selectedModel.modelId, policyId: request.policyId,
        researchSubmission: request.researchSubmission || null, roomId: getPeerRoomId(), relay: getPeerRelayMode(), startedAt: new Date().toISOString() }));
    } catch { /* recovery is best-effort */ }
  };
  const readPending = () => {
    try {
      const record = JSON.parse(session?.getItem(PENDING_KEY) || 'null');
      const navigation = pageIdentityNavigationType();
      const startedAt = Date.parse(record?.startedAt || '');
      const recoverable = record && (navigation === 'reload' || navigation === 'back_forward') && record.version === PENDING_VERSION && record.lane === 'sequence'
        && record.sensitivity === SEQUENCE_PUBLIC_SENSITIVITY && typeof record.sequence === 'string' && record.sequence.trim()
        && record.roomId === getPeerRoomId() && record.relay === getPeerRelayMode()
        && Number.isFinite(startedAt) && Date.now() - startedAt >= 0 && Date.now() - startedAt <= PENDING_REQUEST_TTL_MS;
      if (recoverable) return record;
      session?.removeItem(PENDING_KEY);
    } catch { clearPending(); }
    return null;
  };

  const restoreInterruptedRequest = () => {
    const record = readPending();
    if (!record) return false;
    const selectedModel = getEnabledPoolModelContract(record.selectedModelId);
    if (!selectedModel || !isSequenceWorkload(getPoolModelWorkload(selectedModel))) { clearPending(); return false; }
    pendingRequest = { lane: 'sequence', promptText: null, sequence: record.sequence.trim(), sequenceRequest: sequenceRequestFor(selectedModel), selectedModel,
      modelRequirements: selectedModel, adapterPackHash: null, policyId: record.policyId || FASTEST_RECEIPT_POLICY_ID, researchSubmission: record.researchSubmission || null };
    form = { ...form, prompt: pendingRequest.sequence, modelId: selectedModel.modelId, sequencePublic: true };
    pendingErrorResult = { status: 'error', statusLabel: 'Interrupted', error: 'Previous request needs a decision', reason: 'This tab reloaded before a verified result arrived.',
      code: 'peer_request_interrupted', retryable: true, action: 'Retry the request or discard the preserved input.', roomId: getPeerRoomId(), relay: getPeerRelayMode(),
      model: selectedModel, recovery: interruptedRecovery(pendingRequest) };
    setResult(pendingErrorResult);
    setRun('error', 'recovery', 'Previous request needs a decision');
    return true;
  };
  const restoreLatestCompletedRun = () => {
    const row = latestAcceptedReceipt();
    if (!row) return false;
    const restored = { ...(row.record || {}), receiptHash: row.receiptHash, savedRecord: { restored: true, roomId: getPeerRoomId(), occurredAt: row.occurredAt || null } };
    setResult(restored);
    setRun('inspecting', 'saved', restored.transport === 'local_capsule' ? 'Showing last saved local result' : 'Showing last saved answer');
    return true;
  };

  const prepareRunRequest = () => {
    const input = form.prompt.trim();
    if (!input) {
      setRun('error', 'prompt', 'Enter a protein sequence to run');
      setResult({ status: 'error', error: 'Protein sequence is required', reason: 'The request body is empty.', action: 'Enter a protein sequence, then run again.' });
      return null;
    }
    if (form.sequencePublic !== true) {
      const error = new Error('Confirm that this protein sequence is public before sending it to selected contributors');
      error.code = 'sequence_public_consent_required';
      error.action = 'Check the public-sequence confirmation, then run again.';
      throw error;
    }
    try { local?.setItem(CONSENT_KEY, 'true'); } catch { /* consent applies to this page */ }
    const selectedModel = getEnabledPoolModelContract(form.modelId || LAUNCH_MODEL.modelId) || LAUNCH_MODEL;
    if (!isSequenceWorkload(getPoolModelWorkload(selectedModel))) throw new Error('The selected request model does not support biological sequence work');
    return { lane: 'sequence', promptText: null, sequence: input.replace(/^Sequence:\s*/i, ''), sequenceRequest: sequenceRequestFor(selectedModel), selectedModel,
      modelRequirements: selectedModel, adapterPackHash: null, policyId: form.policyId || FASTEST_RECEIPT_POLICY_ID };
  };

  const submit = async (prepared = null) => {
    if (requestInFlight || disposed) return;
    const generation = ++runActivityGeneration;
    let acceptActivity = true;
    requestInFlight = true;
    if (!prepared) { pendingRequest = null; pendingErrorResult = null; }
    const knownProvider = Boolean(prepared?.knownProviderAdverts?.length);
    let submitStatus = 'Preparing signed request';
    if (knownProvider) submitStatus = 'Starting the preserved request on this device';
    else if (prepared) submitStatus = 'Checking the network again';
    setRun('submitting', 'prompt', submitStatus);
    try {
      const request = prepared || prepareRunRequest();
      if (!request || disposed) return;
      pendingRequest = request; pendingErrorResult = null;
      writePending(request);
      setResult(describeSelectedRun({ status: knownProvider ? 'starting_known_provider' : 'finding_peer_provider', policyId: request.policyId,
        modelId: request.selectedModel.modelId, adapterPackHash: request.adapterPackHash }));
      const value = await runSession.run(request, {
        onLocalExecution: () => setRun('running', 'infer', 'Preparing this device: verifying and loading the selected model'),
        onActivity(activity = {}) {
          if (acceptActivity && generation === runActivityGeneration) setRun('running', activity.phase || '', RUN_ACTIVITY_COPY[activity.status] || 'Running on the network');
        }
      });
      acceptActivity = false;
      if (disposed) return;
      value.inviteUrl = inviteUrl();
      value.relay = value.transport === 'local_capsule' ? 'none' : getPeerRelayMode();
      addReceiptLedgerRow({ ...(value.receiptRecord || value), requesterAcceptance: value.requesterAcceptance || null, agreement: value.agreement || null,
        routeDecision: value.plan?.routeDecision || value.routeDecision || null, transport: value.transport || null, relay: value.relay || getPeerRelayMode(),
        policyId: value.policyId || request.policyId, outputKind: value.outputKind || null, sequenceResultHash: value.sequenceResultHash || null,
        embeddingDimensions: value.embeddingDimensions || null }, value.receiptHash);
      setResult(value);
      setRun('complete', 'answer', value.transport === 'local_capsule' ? 'Completed on this device' : 'Protein embedding verified');
      pendingRequest = null; clearPending();
    } catch (error) {
      acceptActivity = false;
      if (disposed) return;
      const selectedModel = pendingRequest?.selectedModel || getEnabledPoolModelContract(form.modelId || LAUNCH_MODEL.modelId) || LAUNCH_MODEL;
      const networkUnavailable = pendingRequest && canOfferLocalFallback(error);
      const shown = displayPoolError(error, {
        title: networkUnavailable ? 'No matching provider is currently available' : 'Request could not complete',
        action: networkUnavailable ? 'Reploid searched the peer network. Choose a recovery option below.'
          : error?.payload?.action || error?.action || 'Check the technical details, then try again.',
        context: { roomId: getPeerRoomId(), relay: getPeerRelayMode(), model: selectedModel, adapterPackHash: pendingRequest?.adapterPackHash || null }
      });
      if (networkUnavailable) {
        shown.statusLabel = 'No provider';
        shown.action = 'The request is preserved. Choose a recovery option below.';
        shown.recovery = missingProviderRecovery(pendingRequest);
        pendingErrorResult = shown;
        recordPeerLedgerEvents([{ type: 'request_event', fromPeerId: requesterIdentity.identityRootId || requesterIdentity.userId || 'local-requester',
          createdAt: new Date().toISOString(), body: { status: 'waiting_for_provider', reason: 'No matching provider', roomId: getPeerRoomId(),
            modelId: selectedModel.modelId || selectedModel.id || null, policyId: pendingRequest.policyId || null, retryable: true } }]);
      }
      setResult(shown);
      clearPending();
      setRun('error', 'match', networkUnavailable ? 'No matching provider is currently available' : 'Run needs attention');
    } finally {
      acceptActivity = false;
      requestInFlight = false;
      notify();
    }
  };

  snapshot = project();
  if (!restoreInterruptedRequest() && !restoreLatestCompletedRun()) setRun('idle');
  void readDeviceIdentity().then(value => { identity = value; notify(); });

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setPrompt(prompt) { form = { ...form, prompt }; notify(); },
    setModel(modelId) { form = { ...form, modelId }; notify(); },
    setPolicy(policyId) { form = { ...form, policyId }; notify(); },
    setSequencePublic(on) { form = { ...form, sequencePublic: !!on }; notify(); },
    run() { void submit(); },
    /** Copies the pooled vector only when its publication was permitted, and says what happened. */
    async copyEmbedding(clipboard = globalThis.navigator?.clipboard) {
      const embedding = projectRunResult(result).embedding;
      if (!embedding?.permitted) copyStatus = 'The raw embedding is withheld because publication consent was not granted.';
      else if (!embedding.vector) copyStatus = 'The embedding is not available to copy.';
      else if (typeof clipboard?.writeText !== 'function') copyStatus = 'Clipboard access is unavailable. Open View embedding vector and copy it manually.';
      else {
        try { await clipboard.writeText(embedding.vector); copyStatus = 'Embedding vector copied.'; }
        catch { copyStatus = 'Copy failed. Open View embedding vector and copy it manually.'; }
      }
      notify();
    },
    /** A recovery card's action: retry, run on this device (after its consent step), go back or discard. */
    recover(actionId) {
      if ((actionId === 'retry_network' || actionId === 'retry_interrupted_request') && pendingRequest) { void submit(pendingRequest); return; }
      if (actionId === 'discard_interrupted_request') {
        clearPending(); pendingRequest = null; pendingErrorResult = null;
        setResult(''); setRun('idle', '', 'Ready for a new request'); return;
      }
      if (actionId === 'offer_local_provider' && pendingRequest && pendingErrorResult) { setResult({ ...pendingErrorResult, recovery: localConsentRecovery(pendingRequest) }); return; }
      if (actionId === 'back_to_network' && pendingErrorResult) { setResult(pendingErrorResult); return; }
      if (actionId === 'confirm_local_provider' && pendingRequest && !requestInFlight) void submit({ ...pendingRequest, localExecution: true });
    },
    dispose() { disposed = true; ++runActivityGeneration; runSession.close(); listeners.clear(); }
  };
}

let pageController = null;
/** The page's one run controller, as the vanilla page kept one run surface. */
export const getAskController = () => (pageController ??= createAskController());
