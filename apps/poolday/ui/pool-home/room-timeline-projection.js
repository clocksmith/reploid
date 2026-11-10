/**
 * @fileoverview The room's causal timeline and participants: records, peer events and receipts
 * ordered in time, with explicit agreement entries and each entry's source authority.
 */
import { projectResearchExecutionIndependence, projectResearchReviewStates } from '../../pool/evidence-network.js';
import {
  RESEARCH_KINDS,
  asText,
  sortByTime,
  sorted,
  shortHash,
  publicIdentity,
  participant,
  recordTitle,
  recordSummary
} from './room-projection-records.js';
import { statusForRecord } from './room-evidence-archive.js';

export const evidenceAgreement = (result, records) => {
  if (!result) return { state: 'evidence_unavailable', label: 'Evidence unavailable', sourceHash: null };
  const agreement = result.compute?.agreement || null;
  const explicitStatus = asText(agreement?.status).toLowerCase();
  const independence = projectResearchExecutionIndependence(result);
  if ((explicitStatus === 'accepted' || explicitStatus === 'agreed')
    && independence.independentlyExecuted) {
    return { state: 'agreement_assessed', label: 'Agreement assessed', sourceHash: result.recordHash };
  }
  if (
    explicitStatus === 'rejected'
    || explicitStatus === 'disagreement'
    || explicitStatus === 'redundant_disagreement'
    || result.compute?.status === 'redundant_disagreement'
  ) {
    return { state: 'disagreement_assessed', label: 'Disagreement assessed', sourceHash: result.recordHash };
  }
  const acceptedAndRejected = projectResearchReviewStates(records)
    .some((entry) => entry.recordHash === result.recordHash && entry.disagreement === true);
  if (acceptedAndRejected) {
    return { state: 'disagreement_assessed', label: 'Disagreement assessed', sourceHash: result.recordHash };
  }
  return { state: 'not_assessed', label: 'Not assessed', sourceHash: result.recordHash };
};

export const latest = (records, kind) => sorted(records.filter((record) => record.kind === kind)).at(-1) || null;

export const resultForQuestion = (records, submission) => {
  if (!submission) return null;
  return sorted(records.filter((record) => (
    record.kind === RESEARCH_KINDS.result && record.submissionHash === submission.recordHash
  ))).at(-1) || null;
};

const sourceAuthorityForPeerEvent = (event = {}) => {
  const type = asText(event.type).toLowerCase();
  return type.includes('relay') || type.includes('signal') ? 'room_relay' : 'peer_ledger';
};

const peerEventId = (event = {}) => asText(
  event.messageHash
    || event.id
    || `${event.type || 'unknown'}:${event.createdAt || ''}:${event.body?.receiptHash || event.body?.providerId || ''}`,
  'peer-event:unknown'
);

const peerEventTitle = (event = {}) => {
  const type = asText(event.type, 'room activity').replace(/[-_]/g, ' ');
  return type ? `${type[0].toUpperCase()}${type.slice(1)}` : 'Room activity';
};

const makeTimelineEntry = ({ id, kind, occurredAt, title, status, sourceAuthority, sourceHash, summary, action }) => ({
  id: asText(id),
  kind: asText(kind, 'activity'),
  occurredAt: asText(occurredAt, null),
  title: asText(title, 'Room activity'),
  status: asText(status, 'observed'),
  sourceAuthority: asText(sourceAuthority, 'room_relay'),
  sourceHash: sourceHash ? asText(sourceHash) : null,
  summary: asText(summary, 'Room activity'),
  action: action ? asText(action) : null
});

export const projectParticipants = (records, peerEvents, latestResult, submission) => {
  const requester = submission?.author
    ? participant({
        id: submission.author.identityRootId || submission.author.userId,
        role: 'requester',
        status: 'question owner',
        label: publicIdentity(submission, 'requester')
      })
    : null;
  const contributors = [];
  const reviewers = [];
  const peers = [];
  const add = (list, value) => {
    if (!value?.id || list.some((entry) => entry.id === value.id)) return;
    list.push(value);
  };
  for (const record of records) {
    if (record.kind === RESEARCH_KINDS.result && record.compute?.providerId) {
      add(contributors, participant({ id: record.compute.providerId, role: 'contributor', status: 'receipt observed' }));
    }
    if (record.kind === RESEARCH_KINDS.claim) {
      add(reviewers, participant({
        id: record.author?.identityRootId || record.author?.userId,
        role: 'reviewer',
        status: record.claim?.decision || 'reviewed',
        label: publicIdentity(record, 'reviewer')
      }));
    }
  }
  for (const event of peerEvents) {
    const body = event.body || {};
    const providerId = body.providerId || body.fromPeerId || event.fromPeerId;
    if (providerId) add(peers, participant({ id: providerId, role: 'peer', status: asText(event.type, 'activity') }));
    if (body.providerId) add(contributors, participant({ id: body.providerId, role: 'contributor', status: 'room activity' }));
  }
  if (latestResult?.compute?.providerId) {
    add(contributors, participant({ id: latestResult.compute.providerId, role: 'contributor', status: 'latest result' }));
  }
  return {
    requester,
    contributors,
    reviewers,
    peers
  };
};

const explicitAgreementTimelineEntry = (record) => {
  if (record.kind !== RESEARCH_KINDS.result) return null;
  const status = asText(record.compute?.agreement?.status || record.compute?.status).toLowerCase();
  const isAgreement = status === 'accepted' || status === 'agreed';
  const isDisagreement = status === 'rejected'
    || status === 'disagreement'
    || status === 'redundant_disagreement';
  if (!isAgreement && !isDisagreement) return null;
  const title = isAgreement ? 'Agreement assessed' : 'Disagreement assessed';
  return makeTimelineEntry({
    id: `agreement:${record.recordHash}`,
    kind: 'agreement',
    occurredAt: record.createdAt,
    title,
    status,
    sourceAuthority: 'execution',
    sourceHash: record.recordHash,
    summary: isAgreement
      ? 'The signed execution record carries an explicit agreement assessment.'
      : 'The signed execution record carries an explicit disagreement assessment.',
    action: 'Inspect evidence'
  });
};

export const buildTimeline = ({ records, peerEvents, receipts, reviewStates, invalidated, acceptedCorrections, agreement }) => {
  const entries = records.flatMap((record) => [
    makeTimelineEntry({
      id: record.recordHash,
      kind: record.kind,
      occurredAt: record.createdAt,
      title: recordTitle(record),
      status: statusForRecord(record, reviewStates, invalidated, acceptedCorrections),
      sourceAuthority: record.kind === RESEARCH_KINDS.result ? 'execution' : 'research_evidence',
      sourceHash: record.recordHash,
      summary: recordSummary(record),
      action: record.kind === RESEARCH_KINDS.claim ? 'Review evidence' : null
    }),
    explicitAgreementTimelineEntry(record)
  ].filter(Boolean));
  if (agreement?.sourceHash
    && ['agreement_assessed', 'disagreement_assessed'].includes(agreement.state)
    && !entries.some((entry) => entry.kind === 'agreement' && entry.sourceHash === agreement.sourceHash)) {
    const result = records.find((record) => record.recordHash === agreement.sourceHash);
    entries.push(makeTimelineEntry({
      id: `agreement:${agreement.sourceHash}`,
      kind: 'agreement',
      occurredAt: result?.createdAt,
      title: agreement.label,
      status: agreement.state,
      sourceAuthority: 'research_evidence',
      sourceHash: agreement.sourceHash,
      summary: agreement.state === 'agreement_assessed'
        ? 'Signed review evidence assessed agreement for this result.'
        : 'Signed review evidence assessed disagreement for this result.',
      action: 'Review evidence'
    }));
  }
  for (const receipt of receipts) {
    const sourceHash = receipt.receiptHash || receipt.record?.receiptHash || null;
    entries.push(makeTimelineEntry({
      id: `receipt:${sourceHash || receipt.jobId || receipt.occurredAt}`,
      kind: 'receipt',
      occurredAt: receipt.occurredAt || receipt.record?.createdAt,
      title: 'Signed receipt received',
      status: asText(receipt.fidelity, 'observed'),
      sourceAuthority: 'execution',
      sourceHash,
      summary: `Contributor ${shortHash(receipt.provider || 'unknown')} · ${asText(receipt.speed, 'speed unavailable')}`,
      action: 'Inspect evidence'
    }));
  }
  for (const event of peerEvents) {
    const id = peerEventId(event);
    entries.push(makeTimelineEntry({
      id: `peer:${id}`,
      kind: 'room_activity',
      occurredAt: event.createdAt || event.occurredAt,
      title: peerEventTitle(event),
      status: 'observed',
      sourceAuthority: sourceAuthorityForPeerEvent(event),
      sourceHash: event.messageHash || null,
      summary: `Peer ${shortHash(event.fromPeerId || event.body?.providerId || 'unknown')} activity`,
      action: 'Inspect activity'
    }));
  }
  return entries.sort(sortByTime);
};
