/**
 * @fileoverview Binds one peer run surface: request validation and consent, adapter selection,
 * local or peer execution, receipts, research publication, recovery and run state.
 */
import { createPeerRunSession, supportsLocalRequest, canOfferLocalFallback } from '../../host/peer-run-session.js';
import { adapterRequirementFromPublication } from '../../pool/adapter-publication.js';
import { resolveFetchableAdapterPublication } from '../../pool/adapter-registry.js';
import { LAUNCH_MODEL, getEnabledPoolModelContract, getPoolModelWorkload } from '../../../../shared/pool/model-contract.js';
import { createPoolIdentity } from '../../../../shared/pool/identity.js';
import { FASTEST_RECEIPT_POLICY_ID, listPolicies } from '../../pool/policy-router.js';
import { createPoolSdk } from '../../../../shared/pool/sdk.js';
import { SEQUENCE_ALPHABETS, SEQUENCE_PUBLIC_SENSITIVITY, isSequenceWorkload } from '../../../../shared/pool/sequence-workload.js';
import { createSignedResearchResult, createSignedResearchSubmission } from '../../pool/evidence-network.js';
import {
  addReceiptLedgerRow,
  clearPoolRoomDraft,
  describeSelectedRun,
  getPeerInviteUrl,
  getPeerRelayMode,
  getPeerRoomId,
  refreshRecordTimelineState,
  recordPeerLedgerEvents,
  setPoolRunVisualState,
  setResearchPublicationStatus,
  setResult
} from './view.js';
import { publishResearchRecord } from './research-store.js';
import {
  POOL_PENDING_REQUEST_TTL_MS,
  readPendingRequestRecovery,
  writePendingRequestRecovery,
  clearPendingRequestRecovery
} from './pending-request-recovery.js';
import { writeSequencePublicConsent, syncSequencePublicConsent } from './sequence-consent.js';
import { displayPoolError } from './control-display-text.js';
import { getRequesterIdentityNamespace } from './page-identity.js';
import { refreshServerRoomActivity } from './room-activity-controls.js';

const policyGuaranteesIndependentExecution = (policy = {}) => (
  Number(policy.redundancy || 0) >= 2
  || Number(policy.minRingSize || 0) >= 2
);

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

export const createSelectOption = (label, value = '') => {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  return option;
};

const resolveSelectedAdapter = async (adapterSelect, model, { required = false } = {}) => {
  const packHash = String(adapterSelect?.value || '').trim();
  if (!packHash) {
    if (required) throw new Error('Select a published adapter pack before running the adapter lane');
    return null;
  }
  const publication = await resolveFetchableAdapterPublication({
    sdk: createPoolSdk(),
    packHash,
    model
  });
  return adapterRequirementFromPublication(publication, { state: 'fetchable' });
};

export const bindPeerRunSurface = ({
  button,
  prompt,
  form = null,
  policySelect = null,
  modelSelect = null,
  adapterSelect = null,
  adapterRequired = () => false,
  sequencePublicControl = null,
  researchPublicControl = null,
  intentKindControl = null,
  intentLabelControl = null,
  intentTextControl = null,
  intentConditionsControl = null,
  intentObservationControl = null,
  intentDecisionControl = null,
  intentScopeControl = null,
  intentExclusionsControl = null,
  intentUnknownsControl = null,
  resultId
} = {}) => {
  if (!button || !prompt || !resultId || button.dataset.poolRunBound === 'true') return;
  button.dataset.poolRunBound = 'true';
  const runSession = createPeerRunSession({ identityNamespace: getRequesterIdentityNamespace() });
  const { requesterIdentity } = runSession;
  const researchIdentity = createPoolIdentity('requester');
  const recoveryElement = document.getElementById(`${resultId}-recovery`);
  let pendingRequest = null;
  let pendingErrorResult = null;
  let requestInFlight = false;
  let disposed = false;
  let runActivityGeneration = 0;
  const updateRunState = (state, phase = '', message = '') => {
    setPoolRunVisualState({ state, phase, message });
  };
  const handleRunActivity = (activity = {}) => {
    updateRunState(
      'running',
      activity.phase || '',
      RUN_ACTIVITY_COPY[activity.status] || 'Running on the network'
    );
  };

  const modelLabelOf = (model = {}) => model.label || model.name || model.modelId || 'the selected model';
  const buildMissingProviderRecovery = (request) => ({
    kind: 'provider_missing',
    title: 'No matching browser is ready',
    message: `No contributor in "${getPeerRoomId()}" is currently advertising ${modelLabelOf(request.selectedModel)}.${supportsLocalRequest(request) ? ' Run here without sharing compute, or keep searching.' : ' The selected checks require a matching contributor; local execution cannot replace them.'}`,
    actions: [
      {
        id: 'retry_network',
        label: 'Keep searching',
        primary: true
      },
      ...(supportsLocalRequest(request) ? [{
        id: 'offer_local_provider',
        label: 'Run on this device'
      }] : []),
      {
        id: 'invite_contributor',
        label: 'Invite a contributor',
        href: getPeerInviteUrl()
      }
    ]
  });
  const buildLocalConsentRecovery = (request) => ({
    kind: 'local_provider_consent',
    title: 'Run on this device?',
    message: `${modelLabelOf(request.selectedModel)} may need to download before this browser can answer the preserved request.`,
    details: [
      'Uses WebGPU and browser storage after a capability check.',
      'Runs only your request. Does not advertise this tab or change Share compute.',
      'Verifies the signed model and local execution receipt; does not claim independent peer agreement.'
    ],
    actions: [
      {
        id: 'confirm_local_provider',
        label: 'Download and run here',
        primary: true
      },
      {
        id: 'back_to_network',
        label: 'Back'
      },
      {
        id: 'invite_contributor',
        label: 'Invite a contributor',
        href: getPeerInviteUrl()
      }
    ]
  });
  const requestFromPendingRecovery = (record) => {
    const selectedModel = getEnabledPoolModelContract(record?.selectedModelId);
    if (!selectedModel || !isSequenceWorkload(getPoolModelWorkload(selectedModel))) return null;
    return {
      lane: 'sequence',
      promptText: null,
      sequence: record.sequence.trim(),
      sequenceRequest: {
        workload: getPoolModelWorkload(selectedModel),
        alphabet: selectedModel.sequence?.alphabet || SEQUENCE_ALPHABETS.aminoAcid,
        sensitivity: SEQUENCE_PUBLIC_SENSITIVITY,
        includeTokenEmbeddings: false,
        includeLogits: false
      },
      selectedModel,
      modelRequirements: selectedModel,
      adapterPackHash: null,
      policyId: record.policyId || FASTEST_RECEIPT_POLICY_ID,
      researchSubmission: record.researchSubmission || null
    };
  };

  const buildInterruptedRequestRecovery = (request) => ({
    kind: 'request_interrupted',
    title: 'Previous request was interrupted',
    message: `This tab reloaded before a verified result arrived from "${getPeerRoomId()}". The request has not been resumed or sent again.`,
    details: [
      `The explicitly public protein sequence remains in this browser tab for ${Math.round(POOL_PENDING_REQUEST_TTL_MS / 60000)} minutes.`,
      'Retry creates a new peer request and a new receipt path.',
      `Selected model: ${modelLabelOf(request.selectedModel)}.`
    ],
    actions: [
      {
        id: 'retry_interrupted_request',
        label: 'Retry request',
        primary: true
      },
      {
        id: 'discard_interrupted_request',
        label: 'Discard'
      }
    ]
  });
  const restoreInterruptedRequest = () => {
    const persisted = readPendingRequestRecovery();
    if (!persisted) return false;
    const restoredRequest = requestFromPendingRecovery(persisted);
    if (!restoredRequest) {
      clearPendingRequestRecovery();
      return false;
    }
    pendingRequest = restoredRequest;
    if (prompt) prompt.value = restoredRequest.sequence;
    if (modelSelect) modelSelect.value = restoredRequest.selectedModel.modelId;
    if (sequencePublicControl) {
      sequencePublicControl.checked = true;
      syncSequencePublicConsent(sequencePublicControl);
    }
    if (researchPublicControl && restoredRequest.researchSubmission) researchPublicControl.checked = true;
    if (intentKindControl && restoredRequest.researchSubmission) intentKindControl.value = restoredRequest.researchSubmission.requesterIntent?.kind || 'question';
    if (intentLabelControl && restoredRequest.researchSubmission) intentLabelControl.value = restoredRequest.researchSubmission.requesterIntent?.label || '';
    if (intentTextControl && restoredRequest.researchSubmission) intentTextControl.value = restoredRequest.researchSubmission.requesterIntent?.text || '';
    if (intentConditionsControl && restoredRequest.researchSubmission) intentConditionsControl.value = restoredRequest.researchSubmission.requesterIntent?.conditions || '';
    if (intentObservationControl && restoredRequest.researchSubmission) intentObservationControl.value = restoredRequest.researchSubmission.requesterIntent?.desiredObservation || '';
    if (intentDecisionControl && restoredRequest.researchSubmission) intentDecisionControl.value = restoredRequest.researchSubmission.requesterIntent?.decisionContext || '';
    if (intentScopeControl && restoredRequest.researchSubmission) intentScopeControl.value = restoredRequest.researchSubmission.requesterIntent?.scope || '';
    if (intentExclusionsControl && restoredRequest.researchSubmission) intentExclusionsControl.value = restoredRequest.researchSubmission.requesterIntent?.exclusions || '';
    if (intentUnknownsControl && restoredRequest.researchSubmission) intentUnknownsControl.value = restoredRequest.researchSubmission.requesterIntent?.knownUnknowns || '';
    const interrupted = {
      status: 'error',
      statusLabel: 'Interrupted',
      error: 'Previous request needs a decision',
      reason: 'This tab reloaded before a verified result arrived.',
      code: 'peer_request_interrupted',
      retryable: true,
      action: 'Retry the request or discard the preserved input.',
      roomId: getPeerRoomId(),
      relay: getPeerRelayMode(),
      model: restoredRequest.selectedModel,
      recovery: buildInterruptedRequestRecovery(restoredRequest)
    };
    pendingErrorResult = interrupted;
    setResult(resultId, interrupted, { stream: true });
    updateRunState('error', 'recovery', 'Previous request needs a decision');
    return true;
  };

  const setRunButtonBusy = (busy, label = 'Running') => {
    if (busy) {
      if (!button.dataset.poolRunIdleLabel) button.dataset.poolRunIdleLabel = button.textContent;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = label;
      return;
    }
    button.disabled = false;
    button.removeAttribute('aria-busy');
    if (button.dataset.poolRunIdleLabel) {
      button.textContent = button.dataset.poolRunIdleLabel;
      delete button.dataset.poolRunIdleLabel;
    }
  };

  const prepareRunRequest = async () => {
    const lane = document.querySelector('.pool-home-stage')?.dataset.poolLane || 'sequence';
    let requestInput = prompt.value.trim();
    if (!requestInput && prompt.placeholder) {
      requestInput = prompt.placeholder.trim();
      prompt.value = requestInput;
    }
    if (!requestInput) {
      const inputLabel = lane === 'sequence' ? 'protein sequence' : 'prompt';
      updateRunState('error', 'prompt', `Enter a ${inputLabel} to run`);
      setResult(resultId, {
        status: 'error',
        error: lane === 'sequence' ? 'Protein sequence is required' : 'Prompt is required',
        reason: 'The request body is empty.',
        action: `Enter a ${inputLabel}, then run again.`
      }, { stream: true });
      return null;
    }
    if (lane === 'sequence' && sequencePublicControl?.checked !== true) {
      const error = new Error('Confirm that this protein sequence is public before sending it to selected contributors');
      error.code = 'sequence_public_consent_required';
      error.action = 'Check the public-sequence confirmation, then run again.';
      throw error;
    }
    if (lane === 'sequence') {
      writeSequencePublicConsent();
      syncSequencePublicConsent(sequencePublicControl);
    }
    const targetModelId = modelSelect?.value;
    const selectedModel = getEnabledPoolModelContract(targetModelId || LAUNCH_MODEL.modelId) || LAUNCH_MODEL;
    const sequenceWorkload = isSequenceWorkload(getPoolModelWorkload(selectedModel));
    if (lane === 'sequence' && !sequenceWorkload) {
      throw new Error('The selected request model does not support biological sequence work');
    }
    const sequence = lane === 'sequence'
      ? requestInput.replace(/^Sequence:\s*/i, '')
      : null;
    const sequenceRequest = lane === 'sequence'
      ? {
        workload: getPoolModelWorkload(selectedModel),
        alphabet: selectedModel.sequence?.alphabet || SEQUENCE_ALPHABETS.aminoAcid,
        sensitivity: SEQUENCE_PUBLIC_SENSITIVITY,
        includeTokenEmbeddings: false,
        includeLogits: false
      }
      : null;
    const publishesResearch = lane === 'sequence' && researchPublicControl?.checked === true;
    if (publishesResearch && !intentTextControl?.value?.trim()) {
      const error = new Error('State the question, hypothesis, or context before publishing research evidence');
      error.code = 'research_question_required';
      error.action = 'Add the exact question reviewers should answer, then run again.';
      throw error;
    }
    const adapter = await resolveSelectedAdapter(adapterSelect, selectedModel, {
      required: Boolean(adapterRequired())
    });
    let selectedPolicyId = policySelect?.value || FASTEST_RECEIPT_POLICY_ID;
    const selectedPolicy = listPolicies().find((policy) => policy.policyId === selectedPolicyId);
    if (publishesResearch && !policyGuaranteesIndependentExecution(selectedPolicy)) {
      const redundantPolicy = listPolicies().find((policy) => policy.policyId === 'redundant_agreement');
      if (!policyGuaranteesIndependentExecution(redundantPolicy)) {
        const error = new Error('Public Research Room evidence requires an independent-execution policy');
        error.code = 'research_independence_policy_required';
        error.action = 'Restore the redundant-agreement policy contract, then run again.';
        throw error;
      }
      selectedPolicyId = redundantPolicy.policyId;
      if (policySelect?.querySelector(`option[value="${selectedPolicyId}"]`)) {
        policySelect.value = selectedPolicyId;
      }
    }
    const request = {
      lane,
      promptText: lane === 'sequence' ? null : requestInput,
      sequence,
      sequenceRequest,
      selectedModel,
      modelRequirements: adapter ? { ...selectedModel, adapter } : selectedModel,
      adapterPackHash: adapter?.packHash || null,
      policyId: selectedPolicyId
    };
    if (publishesResearch) {
      const researchSubmission = await createSignedResearchSubmission({
        identity: researchIdentity,
        roomId: getPeerRoomId(),
        sequence,
        intent: {
          kind: intentKindControl?.value || 'question',
          text: intentTextControl?.value || '',
          label: intentLabelControl?.value || '',
          context: '',
          conditions: intentConditionsControl?.value || '',
          desiredObservation: intentObservationControl?.value || '',
          decisionContext: intentDecisionControl?.value || '',
          scope: intentScopeControl?.value || '',
          exclusions: intentExclusionsControl?.value || '',
          knownUnknowns: intentUnknownsControl?.value || ''
        },
        consent: {
          publicSequence: true,
          publicEvidenceNetwork: true,
          publishEmbedding: true
        },
        modelContract: selectedModel,
        policyId: request.policyId
      });
      const publication = await publishResearchRecord(researchSubmission, { roomId: getPeerRoomId() });
      clearPoolRoomDraft(getPeerRoomId());
      request.researchSubmission = researchSubmission;
      setResearchPublicationStatus(resultId, publication.remote
        ? `Submission ${researchSubmission.recordHash} published before compute.`
        : `Submission ${researchSubmission.recordHash} preserved locally; coordinator sync is pending.`);
    }
    return request;
  };

  const submitRunRequest = async (preparedRequest = null) => {
    if (requestInFlight || disposed) return;
    const activityGeneration = ++runActivityGeneration;
    let acceptRunActivity = true;
    requestInFlight = true;
    if (!preparedRequest) {
      pendingRequest = null;
      pendingErrorResult = null;
    }
    setRunButtonBusy(true);
    const usingKnownProvider = Boolean(preparedRequest?.knownProviderAdverts?.length);
    updateRunState('submitting', 'prompt', usingKnownProvider
      ? 'Starting the preserved request on this device'
      : preparedRequest
        ? 'Checking the network again'
        : 'Preparing signed request');
    try {
      const request = preparedRequest || await prepareRunRequest();
      if (!request || disposed) return;
      pendingRequest = request;
      pendingErrorResult = null;
      writePendingRequestRecovery(request);
      setResult(resultId, describeSelectedRun({
        status: usingKnownProvider ? 'starting_known_provider' : 'finding_peer_provider',
        policyId: request.policyId,
        modelId: request.selectedModel.modelId,
        adapterPackHash: request.adapterPackHash
      }), { stream: true });
      const result = await runSession.run(request, {
        onLocalExecution: () => updateRunState('running', 'infer', 'Preparing this device: verifying and loading the selected model'),
        onActivity(activity) {
          if (acceptRunActivity && activityGeneration === runActivityGeneration) handleRunActivity(activity);
        }
      });
      acceptRunActivity = false;
      if (disposed) return;
      result.inviteUrl = getPeerInviteUrl();
      result.relay = result.transport === 'local_capsule' ? 'none' : getPeerRelayMode();
      if (request.researchSubmission && request.lane === 'sequence') {
        const researchResult = await createSignedResearchResult({
          identity: researchIdentity,
          roomId: getPeerRoomId(),
          submission: request.researchSubmission,
          receiptRecord: result.receiptRecord || result,
          receiptEvidence: result.receiptEvidence || null,
          agreement: result.agreement || null,
          routeDecision: result.plan?.routeDecision || result.routeDecision || null,
          embedding: result.sequenceOutput?.pooledEmbedding || result.receiptRecord?.sequenceOutput?.pooledEmbedding || null,
          sequenceResult: result.sequenceResult || result.receiptRecord?.sequenceResult || null,
          sequenceOutput: result.sequenceOutput || result.receiptRecord?.sequenceOutput || null
        });
        const publication = await publishResearchRecord(researchResult, { roomId: getPeerRoomId() });
        result.researchSubmissionHash = request.researchSubmission.recordHash;
        result.researchResultHash = researchResult.recordHash;
        result.researchPublication = publication.remote ? 'coordinator_synced' : 'local_sync_pending';
        result.embeddingPublicationConsent = request.researchSubmission.consent?.publishEmbedding === true;
      }
      addReceiptLedgerRow({
        ...(result.receiptRecord || result),
        requesterAcceptance: result.requesterAcceptance || null,
        agreement: result.agreement || null,
        routeDecision: result.plan?.routeDecision || result.routeDecision || null,
        transport: result.transport || null,
        relay: result.relay || getPeerRelayMode(),
        policyId: result.policyId || request.policyId,
        outputKind: result.outputKind || null,
        sequenceResultHash: result.sequenceResultHash || null,
        embeddingDimensions: result.embeddingDimensions || null
      }, result.receiptHash);
      void refreshServerRoomActivity();
      setResult(resultId, result, { stream: true });
      if (result.researchResultHash) {
        setResearchPublicationStatus(resultId, `Evidence result ${result.researchResultHash} preserved. Open Records to review, connect, and discover.`);
      }
      updateRunState(
        'complete',
        'answer',
        result.transport === 'local_capsule' ? 'Completed on this device' : request.lane === 'sequence' ? 'Protein embedding verified' : 'Answer verified'
      );
      pendingRequest = null;
      clearPendingRequestRecovery();
    } catch (error) {
      acceptRunActivity = false;
      if (disposed) return;
      const selectedModel = pendingRequest?.selectedModel
        || getEnabledPoolModelContract(modelSelect?.value || LAUNCH_MODEL.modelId)
        || LAUNCH_MODEL;
      const networkUnavailable = pendingRequest && canOfferLocalFallback(error);
      const displayError = displayPoolError(error, {
        title: networkUnavailable ? 'No matching provider is currently available' : 'Request could not complete',
        action: networkUnavailable
          ? 'Reploid searched the peer network. Choose a recovery option below.'
          : error?.payload?.action || error?.action || 'Check the technical details, then try again.',
        context: {
          roomId: getPeerRoomId(),
          relay: getPeerRelayMode(),
          model: selectedModel,
          adapterPackHash: pendingRequest?.adapterPackHash || adapterSelect?.value || null
        }
      });
      if (networkUnavailable) {
        displayError.statusLabel = 'No provider';
        displayError.action = 'The request is preserved. Choose a recovery option below.';
        displayError.recovery = buildMissingProviderRecovery(pendingRequest);
        pendingErrorResult = displayError;
        recordPeerLedgerEvents([{
          type: 'request_event',
          fromPeerId: requesterIdentity.identityRootId || requesterIdentity.userId || 'local-requester',
          createdAt: new Date().toISOString(),
          body: {
            status: 'waiting_for_provider',
            reason: 'No matching provider',
            roomId: getPeerRoomId(),
            modelId: selectedModel.modelId || selectedModel.id || null,
            policyId: pendingRequest.policyId || null,
            retryable: true
          }
        }]);
        refreshRecordTimelineState();
      }
      setResult(resultId, displayError, { stream: true });
      clearPendingRequestRecovery();
      updateRunState('error', 'match', networkUnavailable
        ? 'No matching provider is currently available'
        : 'Run needs attention');
    } finally {
      acceptRunActivity = false;
      requestInFlight = false;
      if (!disposed) setRunButtonBusy(false);
    }
  };

  const runPreservedRequestLocally = async () => {
    if (!pendingRequest || requestInFlight) return;
    await submitRunRequest({ ...pendingRequest, localExecution: true });
  };

  recoveryElement?.addEventListener('click', (event) => {
    const action = event.target.closest?.('[data-pool-run-recovery-action]');
    if (!action || action.tagName === 'A') return;
    const actionId = action.dataset.poolRunRecoveryAction;
    if (actionId === 'retry_network') {
      void submitRunRequest(pendingRequest);
      return;
    }
    if (actionId === 'retry_interrupted_request' && pendingRequest) {
      void submitRunRequest(pendingRequest);
      return;
    }
    if (actionId === 'discard_interrupted_request') {
      clearPendingRequestRecovery();
      pendingRequest = null;
      pendingErrorResult = null;
      setResult(resultId, '', { stream: true });
      updateRunState('idle', '', 'Ready for a new request');
      return;
    }
    if (actionId === 'offer_local_provider' && pendingRequest && pendingErrorResult) {
      setResult(resultId, {
        ...pendingErrorResult,
        recovery: buildLocalConsentRecovery(pendingRequest)
      }, { stream: true });
      return;
    }
    if (actionId === 'back_to_network' && pendingErrorResult) {
      setResult(resultId, pendingErrorResult, { stream: true });
      return;
    }
    if (actionId === 'confirm_local_provider') {
      void runPreservedRequestLocally();
    }
  });
  const submit = (event) => {
    event?.preventDefault?.();
    void submitRunRequest();
  };
  if (form) form.addEventListener('submit', submit);
  else button.addEventListener('click', submit);
  if (!restoreInterruptedRequest()) updateRunState('idle');
  return () => {
    disposed = true;
    ++runActivityGeneration;
    runSession.close();
  };
};
