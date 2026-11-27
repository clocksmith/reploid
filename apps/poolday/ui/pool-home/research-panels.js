
/**
 * @fileoverview Reusable Research Room evidence, review, discovery, and quality panels.
 *
 * These functions only render already-projected records. Signing, persistence,
 * hydration, and review state remain owned by research-view.js and the evidence
 * network.
 */

export const compactHash = (value) => {
  const text = String(value || '');
  return text.length > 22 ? `${text.slice(0, 13)}…${text.slice(-6)}` : text || 'none';
};

export const recordLabel = (record = {}) => {
  if (record.kind === 'research_submission') return record.requesterIntent?.label || record.requesterIntent?.text || record.sequence?.hash;
  if (record.kind === 'research_result') return `${record.modelContract?.id || 'model result'} · ${compactHash(record.compute?.receiptHash)}`;
  if (record.kind === 'research_work_claim') {
    return record.workClaim?.consent?.publicLaboratoryIdentity === true
      ? record.workClaim?.laboratory?.name
      : compactHash(record.author?.identityRootId || record.author?.userId || record.recordHash);
  }
  if (record.kind === 'research_discovery_checkpoint') {
    return `${record.checkpoint?.state?.status || 'open'} Discovery Contract checkpoint`;
  }
  if (record.kind === 'research_resolution_policy') return `${record.policy?.conclusionLabel || 'Resolution'} criteria`;
  if (record.kind === 'research_candidate_action') return record.action?.title || record.action?.contractHash;
  return record.claim?.text
    || record.hypothesis?.statement
    || record.evidence?.summary
    || record.prediction?.expectedObservation
    || record.work?.title
    || record.workClaim?.laboratory?.name
    || record.outcome?.summary
    || record.cohort?.label
    || (record.experiment?.target?.catalogId ? `${record.experiment.target.catalogId} adjudication experiment` : '')
    || record.evaluation?.metricResults?.map((metric) => metric.metricId).join(', ')
    || record.revocation?.reason
    || record.recordHash;
};
