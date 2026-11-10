/**
 * @fileoverview Shared reading of research records for the Research Room projection: record kinds,
 * text, time and hash helpers, public identities, titles and summaries. Pure; never signs.
 */

export const RESEARCH_KINDS = Object.freeze({
  submission: 'research_submission',
  result: 'research_result',
  claim: 'human_claim',
  hypothesis: 'research_hypothesis',
  prediction: 'research_prediction',
  priorEvidence: 'research_prior_evidence',
  resolutionPolicy: 'research_resolution_policy',
  workOrder: 'research_work_order',
  workClaim: 'research_work_claim',
  outcome: 'research_outcome',
  cohort: 'research_cohort',
  evaluation: 'research_evaluation',
  realizedActionValue: 'research_realized_action_value',
  adjudicationExperiment: 'research_adjudication_experiment',
  adjudicationEvaluation: 'research_adjudication_evaluation',
  discoveryCheckpoint: 'research_discovery_checkpoint',
  candidateAction: 'research_candidate_action',
  revocation: 'research_revocation'
});

export const asText = (value, fallback = '') => {
  const text = String(value ?? '').trim();
  return text || fallback;
};

export const asArray = (value) => Array.isArray(value) ? value : [];

const dateValue = (value) => {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? timestamp : 0;
};

export const sortByTime = (left, right) => (
  dateValue(left?.createdAt || left?.occurredAt) - dateValue(right?.createdAt || right?.occurredAt)
    || asText(left?.recordHash || left?.id).localeCompare(asText(right?.recordHash || right?.id))
);

export const sorted = (values) => [...values].sort(sortByTime);

export const unique = (values) => [...new Set(values.filter(Boolean).map((value) => String(value)))];

export const shortHash = (value) => {
  const text = asText(value, 'unknown');
  return text.length > 24 ? `${text.slice(0, 16)}...${text.slice(-8)}` : text;
};

export const publicationConsent = (record = {}) => ({
  sequence: record.consent?.publicSequence === true,
  embedding: record.consent?.publishEmbedding === true,
  residue: record.consent?.publishResidueEvidence === true,
  identity: record.consent?.publishIdentity === true
    || record.consent?.publicIdentity === true
    || record.workClaim?.consent?.publicLaboratoryIdentity === true
});

export const publicIdentity = (record = {}, fallback = 'participant') => {
  const consent = publicationConsent(record);
  if (consent.identity) {
    return asText(
      record.author?.publicLabel
        || record.author?.displayName
        || record.workClaim?.laboratory?.name
        || record.author?.userId,
      fallback
    );
  }
  return shortHash(record.author?.identityRootId || record.author?.userId || fallback);
};

export const participant = ({ id, role, status = 'observed', label = null } = {}) => ({
  id: asText(id, 'unknown'),
  role: asText(role, 'peer'),
  status: asText(status, 'observed'),
  label: label ? asText(label) : null
});

export const recordTitle = (record = {}) => {
  if (record.kind === RESEARCH_KINDS.submission) {
    return asText(record.requesterIntent?.label || record.requesterIntent?.text, 'Question submitted');
  }
  if (record.kind === RESEARCH_KINDS.result) return `${asText(record.modelContract?.id, 'Model')} result`;
  if (record.kind === RESEARCH_KINDS.claim) {
    if (record.claim?.kind === 'correction' || record.claim?.relation === 'corrects') return 'Correction attached';
    return asText(record.claim?.text, 'Human review recorded');
  }
  if (record.kind === RESEARCH_KINDS.hypothesis) return 'Hypothesis proposed';
  if (record.kind === RESEARCH_KINDS.prediction) return 'Prediction proposed';
  if (record.kind === RESEARCH_KINDS.priorEvidence) return 'Prior evidence linked';
  if (record.kind === RESEARCH_KINDS.resolutionPolicy) return 'Resolution criteria frozen';
  if (record.kind === RESEARCH_KINDS.workOrder) return 'Discovery work proposed';
  if (record.kind === RESEARCH_KINDS.workClaim) return 'Contributor claimed work';
  if (record.kind === RESEARCH_KINDS.outcome) return 'Outcome recorded';
  if (record.kind === RESEARCH_KINDS.cohort) return 'Cohort frozen';
  if (record.kind === RESEARCH_KINDS.evaluation) return 'Evidence evaluated';
  if (record.kind === RESEARCH_KINDS.realizedActionValue) return 'Realized action value measured';
  if (record.kind === RESEARCH_KINDS.adjudicationExperiment) return 'Adjudication experiment frozen';
  if (record.kind === RESEARCH_KINDS.adjudicationEvaluation) return 'Adjudication experiment evaluated';
  if (record.kind === RESEARCH_KINDS.discoveryCheckpoint) return 'Discovery Contract checkpoint frozen';
  if (record.kind === RESEARCH_KINDS.candidateAction) return asText(record.action?.title, 'Candidate action proposed');
  if (record.kind === RESEARCH_KINDS.revocation) return 'Evidence revoked';
  return 'Research evidence';
};

export const recordSummary = (record = {}) => {
  if (record.kind === RESEARCH_KINDS.submission) {
    return `${record.sequence?.alphabet === 'dna' ? 'DNA' : 'Protein'} sequence · ${Number(record.sequence?.length || 0)} residues`;
  }
  if (record.kind === RESEARCH_KINDS.result) {
    return `${Number(record.embedding?.dimensions || record.modelContract?.dimensions || 0) || 'Unknown'} dimensions · receipt ${shortHash(record.compute?.receiptHash)}`;
  }
  if (record.kind === RESEARCH_KINDS.claim) return asText(record.claim?.decision || record.claim?.relation, 'Review or annotation');
  if (record.kind === RESEARCH_KINDS.priorEvidence) return asText(record.evidence?.summary, 'Prior evidence');
  if (record.kind === RESEARCH_KINDS.hypothesis) return asText(record.hypothesis?.statement, 'Competing explanation');
  if (record.kind === RESEARCH_KINDS.prediction) return asText(record.prediction?.expectedObservation, 'Expected observation');
  if (record.kind === RESEARCH_KINDS.resolutionPolicy) return `${asText(record.policy?.conclusionLabel, 'Resolution')} · criteria only, no closure authority`;
  if (record.kind === RESEARCH_KINDS.workOrder) return asText(record.work?.title, 'Bounded next work');
  if (record.kind === RESEARCH_KINDS.outcome) return asText(record.outcome?.summary, 'Experimental outcome');
  if (record.kind === RESEARCH_KINDS.realizedActionValue) {
    return `${asText(record.realizedValue?.assessment?.status, 'pending').replace(/_/g, ' ')} · ${record.realizedValue?.contributions?.length || 0} causal contributions`;
  }
  if (record.kind === RESEARCH_KINDS.adjudicationExperiment) {
    return `${asText(record.experiment?.target?.catalogId, 'Unnamed catalog')} · ${asText(record.experiment?.target?.decision, 'Decision not declared')}`;
  }
  if (record.kind === RESEARCH_KINDS.discoveryCheckpoint) {
    return `${record.checkpoint?.inputRecordHashes?.length || 0} complete inputs · ${record.checkpoint?.activeInputRecordHashes?.length || 0} active inputs · ${asText(record.checkpoint?.state?.status, 'open')}`;
  }
  if (record.kind === RESEARCH_KINDS.candidateAction) {
    return `${asText(record.action?.kind, 'action')} · ${record.action?.uncertainty?.map((entry) => `${entry.source}:${entry.representation}`).join(' · ') || 'uncertainty not declared'}`;
  }
  if (record.kind === RESEARCH_KINDS.adjudicationEvaluation) {
    return `Frozen rule: ${asText(record.evaluation?.assessment?.conclusion, 'unavailable')}`;
  }
  return recordTitle(record);
};
