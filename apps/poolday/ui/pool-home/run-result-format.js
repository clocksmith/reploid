/**
 * @fileoverview Pure reading of a run result: its output text, summary fields, status labels,
 * failure text and whether its embedding may be published.
 */
import { compactHash, firstPresent } from './view-markup.js';

export const extractOutputText = (value = {}) => {
  const receipt = value.receipt || value.record || null;
  const candidates = [
    value.outputText,
    value.output,
    value.responseText,
    value.text,
    value.content,
    value.completion,
    value?.job?.outputText,
    value?.job?.output,
    receipt?.outputText,
    receipt?.output,
    receipt?.transcript?.outputText
  ];
  const output = String(candidates.find((entry) => typeof entry === 'string' && entry.length > 0) || '');
  if (output) return output;
  if (value.sequenceResultHash) {
    const dimensions = Number(value.embeddingDimensions || value.sequenceOutput?.pooledEmbedding?.length || 0);
    return [
      'Protein embedding ready',
      dimensions > 0 ? `${dimensions} dimensions` : null,
      `Result ${compactHash(value.sequenceResultHash)}`
    ].filter(Boolean).join('\n');
  }
  return '';
};

export const isErrorResult = (value = {}) => !!(value && typeof value === 'object' && (value.error || value.status === 'error'));

export const extractResultSummary = (value = {}) => {
  if (isErrorResult(value)) {
    return [['Status', value.statusLabel || value.error || 'Failed']];
  }
  const job = value.job || value;
  const record = value.receipt || value.record || value;
  const receipt = record.receipt || value.receipt?.receipt || value.receipt || {};
  const verifier = record.verifierDecision || value.verifierDecision || value.localVerification || null;
  const acceptance = record.requesterAcceptance || value.requesterAcceptance || value.acceptance || null;
  const agreement = job.agreement || acceptance?.agreement || value.agreement || null;
  const ring = receipt?.verification?.ring || job.ring || agreement?.ring || null;
  const routeDecision = value.plan?.routeDecision || value.routeDecision || null;
  const fields = [
    ['Job', firstPresent(job.jobId, record.jobId, receipt.jobId)],
    ['Answer ID', firstPresent(job.receiptHash, record.receiptHash, verifier?.receiptHash, acceptance?.receiptHash)],
    ['Status', formatProductStatusText(firstPresent(job.status, agreement?.status, verifier?.accepted === true ? 'accepted' : verifier?.accepted === false ? 'rejected' : null))],
    ['Match', agreement ? `${agreement.status || 'pending'} ${Number(agreement.requiredAgreement || agreement.requiredProviders || 1)}-of-${Number(agreement.providerCount || agreement.providerIds?.length || 1)}` : firstPresent(job.trustTier, job.effectiveTrustTier, agreement?.effectiveTrustTier, ring?.effectiveTrustTier, receipt?.trustTier)],
    ['Connection', firstPresent(job.transport, value.transport, receipt?.promptTransport)],
    ['Route', firstPresent(routeDecision?.decisionHash, receipt?.routeDecisionHash)],
    ['Model', firstPresent(job.model?.id, job.modelRequirements?.modelId, receipt?.model?.id, value.model?.modelId)],
    ['Sequence result', firstPresent(value.sequenceResultHash, receipt?.sequenceResultHash)],
    ['Dimensions', firstPresent(value.embeddingDimensions, receipt?.embeddingDimensions)],
    ['Spend', firstPresent(acceptance?.pointSpend, value.pointSpend)],
    ['Runtime hash', firstPresent(receipt?.verification?.runtimeProfileHash, job.runtimeProfileHash, record.runtimeProfileHash)],
    ['Doppler evidence', receipt?.dopplerEvidenceComparison?.verified === true
      ? firstPresent(receipt.dopplerEvidenceComparison.runtimeProfileHash, 'verified')
      : null],
    ['Output', firstPresent(receipt?.outputHash, record.outputHash, job.outputHash)],
    ['Tokens', firstPresent(receipt?.tokenIdsHash, record.tokenIdsHash, job.tokenIdsHash)],
    ['Verifier', verifier ? (verifier.ok === true || verifier.accepted === true ? 'accepted' : verifier.reasons?.length ? verifier.reasons.join('; ') : 'rejected') : null]
  ].filter(([, fieldValue]) => fieldValue !== undefined && fieldValue !== null && fieldValue !== '');
  return fields.slice(0, 10);
};

const PRODUCT_STATUS_LABELS = Object.freeze({
  accepted: 'Accepted',
  rejected: 'Rejected',
  pending: 'Pending',
  finding_peer_provider: 'Looking for matching contributor tabs',
  peer_provider_listening: 'This contributor tab is available',
  peer_provider_stopped: 'Contributor tab stopped',
  peer_room_starting: 'Starting this contributor tab',
  peer_room_listening: 'This contributor tab is available',
  provider_advertised: 'This contributor tab is visible in the room',
  provider_advert_failed: 'Contributor advert failed',
  peer_session_queued: 'Contributor tab queued',
  peer_session_dequeued: 'Contributor tab selected',
  peer_session_rejected: 'Contributor tab rejected the run',
  peer_assignment_rejected: 'Assignment rejected',
  peer_session_opening: 'Opening a browser-to-browser session',
  peer_session_open: 'Contributor is answering',
  peer_provider_queued: 'Contributor queued this request',
  peer_provider_execution_started: 'Contributor started this request',
  peer_execution_started: 'Contributor is computing',
  peer_execution_abandoned: 'Interrupted execution settled without a requester',
  peer_receipt_sent: 'Receipt sent',
  peer_acceptance_received: 'Receipt accepted',
  peer_session_failed: 'Run failed',
  stopped: 'Stopped'
});

const formatProductStatusText = (value = '') => {
  const normalized = String(value || '');
  if (!normalized) return '';
  if (PRODUCT_STATUS_LABELS[normalized]) return PRODUCT_STATUS_LABELS[normalized];
  if (/^webrtc_peer_room_(local|server)$/.test(normalized)) return 'Room connection ready';
  return normalized.replace(/_/g, ' ');
};

export const formatResultMessage = (value = {}) => {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'string') return value;
  if (isErrorResult(value)) {
    const mainReason = value.reason || value.error || 'Request failed';
    const actionText = value.action || value.payload?.action;
    return actionText ? `${mainReason}\n\n${actionText}` : mainReason;
  }
  const output = extractOutputText(value);
  if (output) return output;
  const status = firstPresent(value.status, value.runner, value.transport, value.receiptHash);
  if (status) return formatProductStatusText(status);
  const summary = extractResultSummary(value);
  if (summary.length > 0) {
    return summary.slice(0, 4).map(([label, fieldValue]) => `${label}: ${fieldValue}`).join('\n');
  }
  return 'Local peer state updated.';
};

export const sequenceOutputFor = (value = {}) => (
  value.sequenceOutput
  || value.receiptRecord?.sequenceOutput
  || value.receiptPayload?.body?.sequenceOutput
  || value.receipt?.sequenceOutput
  || value.record?.sequenceOutput
  || value.body?.sequenceOutput
  || null
);

/**
 * Raw embedding values are publication material, not ordinary result detail.
 * Keep this decision explicit so a local execution cannot accidentally turn a
 * private vector into a copyable disclosure.
 */
export const isEmbeddingPublicationPermitted = (value = {}) => (
  value.embeddingPublicationConsent === true
  || value.researchSubmission?.consent?.publishEmbedding === true
  || value.researchResult?.consent?.publishEmbedding === true
);

export const formatErrorResultText = (value = {}) => {
  const payload = value.payload || {};
  const model = value.model || payload.model || payload.requiredModel || null;
  const artifact = payload.artifactPreflight || value.artifactPreflight || null;
  const providerFailures = Array.isArray(value.providerFailures)
    ? value.providerFailures
    : Array.isArray(payload.providerFailures)
      ? payload.providerFailures
      : [];
  const failedProviderIds = Array.isArray(value.failedProviderIds)
    ? value.failedProviderIds
    : Array.isArray(payload.failedProviderIds)
      ? payload.failedProviderIds
      : [];
  const routeCandidates = Array.isArray(payload.routeCandidates)
    ? payload.routeCandidates
    : [];
  const summarizeTransportDiagnostics = (diagnostics = {}) => {
    if (!diagnostics || typeof diagnostics !== 'object') return '';
    const fields = [
      diagnostics.state ? `state=${diagnostics.state}` : null,
      diagnostics.connectionState ? `connection=${diagnostics.connectionState}` : null,
      diagnostics.iceConnectionState ? `ice=${diagnostics.iceConnectionState}` : null,
      Number.isFinite(Number(diagnostics.pendingRemoteIceCandidateCount))
        ? `pending-ice=${Number(diagnostics.pendingRemoteIceCandidateCount)}`
        : null,
      Number.isFinite(Number(diagnostics.expiredRemoteIceCandidateCount)) && Number(diagnostics.expiredRemoteIceCandidateCount) > 0
        ? `expired-ice=${Number(diagnostics.expiredRemoteIceCandidateCount)}`
        : null,
      Number.isFinite(Number(diagnostics.overflowRemoteIceCandidateCount)) && Number(diagnostics.overflowRemoteIceCandidateCount) > 0
        ? `dropped-ice=${Number(diagnostics.overflowRemoteIceCandidateCount)}`
        : null,
      diagnostics.turnConfigured === true ? 'turn=configured' : diagnostics.turnConfigured === false ? 'turn=not-configured' : null
    ].filter(Boolean);
    return fields.join(', ');
  };
  const providerFailureText = providerFailures.map((failure) => {
    const providerId = compactHash(failure?.providerId || 'unknown contributor');
    const code = failure?.code ? ` (${failure.code})` : '';
    const message = failure?.message ? `: ${failure.message}` : '';
    const transport = summarizeTransportDiagnostics(failure?.diagnostics);
    return `${providerId}${code}${message}${transport ? ` [transport: ${transport}]` : ''}`;
  }).join('; ');
  const transportDiagnostics = value.transportDiagnostics || payload.transportDiagnostics || value.diagnostics || payload.diagnostics;
  const transportText = summarizeTransportDiagnostics(transportDiagnostics);
  const routeCandidateText = routeCandidates.map((candidate) => {
    const providerId = compactHash(candidate?.providerId || 'unknown contributor');
    const reasons = Array.isArray(candidate?.rejectionReasons) && candidate.rejectionReasons.length > 0
      ? candidate.rejectionReasons.join(', ')
      : 'eligible';
    return `${providerId}: ${reasons}`;
  }).join('; ');
  const lines = [
    value.error ? `Error: ${value.error}` : null,
    value.reason ? `Reason: ${value.reason}` : null,
    value.code ? `Code: ${value.code}` : null,
    value.action || payload.action ? `Next: ${value.action || payload.action}` : null,
    value.roomId || payload.roomId ? `Room: ${value.roomId || payload.roomId}` : null,
    value.relay ? `Relay: ${value.relay}` : null,
    model?.modelId || model?.id ? `Model: ${model.modelId || model.id}` : null,
    Number.isFinite(Number(payload.requiredProviders)) ? `Required contributors: ${Number(payload.requiredProviders)}` : null,
    Number.isFinite(Number(payload.eligibleProviders)) ? `Eligible contributors: ${Number(payload.eligibleProviders)}` : null,
    routeCandidateText ? `Eligibility: ${routeCandidateText}` : null,
    failedProviderIds.length > 0 ? `Contributors: ${failedProviderIds.map((providerId) => compactHash(providerId)).join(', ')}` : null,
    providerFailureText ? `Contributor failures: ${providerFailureText}` : null,
    transportText ? `Transport: ${transportText}` : null,
    artifact?.status ? `Artifact: ${artifact.status}` : null,
    artifact?.urls?.manifest || payload.urls?.manifest ? `Manifest: ${artifact?.urls?.manifest || payload.urls?.manifest}` : null
  ].filter(Boolean);
  return lines.join('\n');
};
