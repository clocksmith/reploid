/**
 * A peer run's result as records: its summary fields, the answer text, the recovery card and its
 * actions, the protein embedding outcome, the contributor proof and the raw record. The same reading
 * the vanilla result box rendered (ui/pool-home/run-result-view.js, run-contribution-evidence.js),
 * through the same pure formatters, without markup.
 */
import { compactHash, safeJsonStringify } from '../../ui/pool-home/view-markup.js';
import {
  extractOutputText, extractResultSummary, formatErrorResultText, formatResultMessage, isEmbeddingPublicationPermitted, isErrorResult, sequenceOutputFor
} from '../../ui/pool-home/run-result-format.js';

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

const POLICY_LABELS = { fastest_receipt: 'One peer', canary_audited: 'One peer with audit', redundant_agreement: 'Two matching peers', ring_quorum_receipt: 'Peer quorum' };
export const policyLabel = policyId => POLICY_LABELS[policyId] || String(policyId || 'default').replace(/_/g, ' ');

export const RUN_STATE_COPY = Object.freeze({
  idle: 'Ready',
  submitting: 'Preparing request',
  running: 'Running on the network',
  complete: 'Answer verified',
  error: 'Run needs attention',
  inspecting: 'Inspecting proof'
});

export const RUN_ACTIVITY_COPY = Object.freeze({
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

const modelLabelOf = (model = {}) => model.label || model.name || model.modelId || 'the selected model';

export const missingProviderRecovery = ({ roomId, model, localAllowed, inviteUrl }) => ({
  kind: 'provider_missing',
  title: 'No matching browser is ready',
  message: `No contributor in "${roomId}" is currently advertising ${modelLabelOf(model)}.${localAllowed ? ' Run here without sharing compute, or keep searching.' : ' The selected checks require a matching contributor; local execution cannot replace them.'}`,
  actions: [
    { id: 'retry_network', label: 'Keep searching', primary: true },
    ...(localAllowed ? [{ id: 'offer_local_provider', label: 'Run on this device' }] : []),
    { id: 'invite_contributor', label: 'Invite a contributor', href: inviteUrl }
  ]
});

export const localConsentRecovery = ({ model, inviteUrl }) => ({
  kind: 'local_provider_consent',
  title: 'Run on this device?',
  message: `${modelLabelOf(model)} may need to download before this browser can answer the preserved request.`,
  details: [
    'Uses WebGPU and browser storage after a capability check.',
    'Runs only your request. Does not advertise this tab or change Share compute.',
    'Verifies the signed model and local execution receipt; does not claim independent peer agreement.'
  ],
  actions: [
    { id: 'confirm_local_provider', label: 'Download and run here', primary: true },
    { id: 'back_to_network', label: 'Back' },
    { id: 'invite_contributor', label: 'Invite a contributor', href: inviteUrl }
  ]
});

export const interruptedRecovery = ({ roomId, model, ttlMs }) => ({
  kind: 'request_interrupted',
  title: 'Previous request was interrupted',
  message: `This tab reloaded before a verified result arrived from "${roomId}". The request has not been resumed or sent again.`,
  details: [
    `The explicitly public protein sequence remains in this browser tab for ${Math.round(ttlMs / 60000)} minutes.`,
    'Retry creates a new peer request and a new receipt path.',
    `Selected model: ${modelLabelOf(model)}.`
  ],
  actions: [
    { id: 'retry_interrupted_request', label: 'Retry request', primary: true },
    { id: 'discard_interrupted_request', label: 'Discard' }
  ]
});

/** Which contributor tabs were selected, matched, flagged or excluded, under which policy. */
export function projectContributionLayer(value = {}) {
  if (value.transport === 'local_capsule') {
    return { local: true, summary: [['Execution', 'This device'], ['Sharing', 'Unchanged']], note: 'Signed model and local execution receipt verified. No independent contributor comparison.',
      route: null, rejected: [], rows: [] };
  }
  const payloads = Array.isArray(value.receiptPayloads) ? value.receiptPayloads : [];
  const assignments = Array.isArray(value.assignments) ? value.assignments : [];
  const agreement = value.agreement || {};
  const acceptedHashes = new Set(agreement.receiptHashes || []);
  const validHashes = new Set((agreement.validRecords || []).map(record => record.receiptHash).filter(Boolean));
  const rejectedByHash = new Map((agreement.rejectedRecords || []).map(record => [
    record.receiptHash || record.receiptPayload?.body?.receiptHash || record.receiptPayload?.fromPeerId || 'unknown', record.reasons || []]));
  const rows = payloads.map(payload => {
    const body = payload.body || payload, receipt = body.receipt || {};
    const hash = body.receiptHash || receipt.receiptHash || '';
    let status = 'flagged';
    if (acceptedHashes.has(hash)) status = 'matched';
    else if (validHashes.has(hash)) status = 'returned';
    return { providerId: body.providerId || receipt.providerId || payload.fromPeerId || 'unknown',
      status,
      hash, tokens: receiptTokenTotal(body), outputHash: receipt.outputHash || body.outputHash || null, reason: rejectedByHash.get(hash)?.join('; ') || null };
  });
  const assignmentRows = rows.length ? rows : assignments.map(assignment => ({ providerId: assignment.providerId || 'unknown', status: 'selected',
    hash: assignment.assignmentId || assignment.jobId || '—', tokens: '—', outputHash: null, reason: null }));
  const policyId = value.policyId || agreement.policyId || value.assignment?.policyId || 'default';
  let checkStatus = 'not accepted';
  if (agreement.accepted) checkStatus = `${agreement.acceptedProviderCount || acceptedHashes.size || 1}/${agreement.requiredAgreement || 1} matched`;
  else if (value.status === 'finding_peer_provider') checkStatus = 'waiting for matching tabs';
  const sharedCount = assignments.length || value.acceptedSessionCount || rows.length || 0;
  const routeDecision = value.plan?.routeDecision || value.routeDecision || null;
  const candidates = Array.isArray(routeDecision?.candidates) ? routeDecision.candidates : [];
  const selected = candidates.find(candidate => routeDecision.selectedProviderIds?.includes(candidate.providerId));
  const rejected = candidates.filter(candidate => !candidate.eligible);
  return {
    local: false,
    summary: [['Shared', `${sharedCount} contributor tab${sharedCount === 1 ? '' : 's'}`], ['Match', checkStatus], ['Policy', policyLabel(policyId)]],
    note: assignmentRows.length ? '' : 'Contributor evidence appears after matching tabs answer.',
    route: routeDecision ? [['Artifact', String(selected?.artifactSourcePlan || 'provider_loaded_model').replace(/_/g, ' ')],
      ['Eligible', String(candidates.filter(candidate => candidate.eligible).length)], ['Excluded', String(rejected.length)]] : null,
    rejected: rejected.map(candidate => ({ providerId: compactHash(candidate.providerId || 'unknown'), reasons: (candidate.rejectionReasons || []).join(', ') || 'not eligible' })),
    rows: assignmentRows.map(row => ({ providerId: compactHash(row.providerId), status: row.status, reason: row.reason || row.status,
      tokens: String(row.tokens || '—'), output: compactHash(row.outputHash || row.hash || '—'), outputTitle: row.outputHash || row.hash || '—' }))
  };
}

/** The recovery card a result asks the person to act on, with its actions (buttons or links). */
function projectRecovery(recovery) {
  if (!recovery || typeof recovery !== 'object') return null;
  const actions = Array.isArray(recovery.actions) ? recovery.actions.map(action => ({ id: String(action.id || '').trim(), label: String(action.label || '').trim(),
    primary: action.primary === true, href: action.href || null })).filter(action => action.id && action.label) : [];
  const details = Array.isArray(recovery.details) ? recovery.details.filter(Boolean).map(String) : [];
  if (!recovery.title && !recovery.message && !actions.length && !details.length) return null;
  return { kind: recovery.kind || 'attention', title: recovery.title || '', message: recovery.message || '', details, actions };
}

/** The pooled embedding outcome: dimensions, its result identity, and whether the raw vector may be shown or copied. */
function projectEmbedding(value) {
  const pooled = sequenceOutputFor(value)?.pooledEmbedding;
  if (!Array.isArray(pooled) || pooled.length === 0) return null;
  const identity = compactHash(value.sequenceResultHash || value.vectorHash || '');
  const permitted = isEmbeddingPublicationPermitted(value);
  return {
    dimensions: pooled.length, permitted,
    meta: permitted ? `${pooled.length} dimensions · ${identity}` : `${pooled.length} dimensions · ${identity} · Raw vector withheld`,
    outcomeMeta: permitted ? `${pooled.length} dimensions · Result ${identity}`
      : `${pooled.length} dimensions · Result ${identity} · Raw vector withheld because embedding publication consent was not granted.`,
    vector: permitted ? safeJsonStringify(pooled) || '[]' : '',
    withheld: permitted ? '' : 'The raw embedding is withheld because publication consent was not granted.'
  };
}

/** A result value (a run record, an error record, a plain status or nothing) as the result box shows it. */
export function projectRunResult(value) {
  if (value === undefined || value === null || value === '') return { summary: [], output: '', message: '', recovery: null, embedding: null, contribution: projectContributionLayer({ status: 'finding_peer_provider' }), raw: '' };
  const object = typeof value === 'object';
  const summary = object ? extractResultSummary(value).map(([label, field]) => [label, label === 'Status' ? String(field) : compactHash(field)]) : [];
  const output = extractOutputText(object ? value : {}) || formatResultMessage(value);
  let raw;
  if (typeof value === 'string') raw = value;
  else if (isErrorResult(value)) raw = formatErrorResultText(value);
  else raw = safeJsonStringify(value, { redactSequenceOutput: true }) || String(value);
  return {
    summary, output, raw, message: formatResultMessage(value),
    recovery: object ? projectRecovery(value.recovery) : null,
    embedding: object ? projectEmbedding(value) : null,
    contribution: projectContributionLayer(object ? value : {})
  };
}
