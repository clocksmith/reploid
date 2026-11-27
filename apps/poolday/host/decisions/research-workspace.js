/**
 * The research workspace without markup: its counts, the signed record collection, exact-model evidence, the review
 * form, the lifecycle forms, compatible-sequence discovery, the governed next-work queues and participation quality.
 * The vanilla wording and rules of ui/pool-home/research-workspace-render.js, research-panels.js,
 * research-technical-panel.js and research-workspace-binding.js. Forms are data (research-forms.js); their values are
 * read by the same record builders the vanilla forms used, so a signed record is built the same way.
 */
import {
  ADJUDICATION_EXPERIMENT_VERSION, activeResearchRecords, buildEvidenceGraph, buildQuestionLifecycles, clusterCompatibleResults,
  findSimilarSequences, invalidatedResearchHashes, projectResearchReviewStates, projectResearchRewards, rankProposedCandidateActions,
  rankProposedDiscoveryActions, searchEvidence
} from '../../pool/evidence-network.js';
import { compactHash, recordLabel } from '../../ui/pool-home/research-panels.js';
import { reviewActionClaims } from '../../ui/pool-home/research-review-records.js';
import { LIFECYCLE_SECTIONS } from './research-forms.js';

const words = value => String(value ?? '').replace(/_/g, ' ');
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const label = record => String(recordLabel(record) || compactHash(record?.recordHash));
const option = record => ({ value: record.recordHash, title: label(record) });

/** A record hash a review address may name. */
export const isRecordHash = value => /^sha256:[a-f0-9]{64}$/.test(String(value || ''));

/** The record lists the workspace projects from one room's signed records, as the vanilla render derived them. */
export function projectResearchSources(records) {
  const active = activeResearchRecords(records);
  const reviewStates = new Map(projectResearchReviewStates(records).map(entry => [entry.recordHash, entry]));
  const accepted = record => reviewStates.get(record.recordHash)?.state === 'accepted';
  const of = kind => active.filter(record => record.kind === kind);
  const claims = of('human_claim');
  const resolutionPolicies = of('research_resolution_policy');
  const workOrders = of('research_work_order');
  const acceptedPolicies = resolutionPolicies.filter(accepted);
  const cohorts = of('research_cohort');
  const evaluations = of('research_evaluation');
  const adjudicationEvaluations = of('research_adjudication_evaluation');
  const candidateActions = of('research_candidate_action');
  return {
    active, reviewStates, claims,
    invalidated: invalidatedResearchHashes(records),
    questions: of('research_submission'),
    results: of('research_result'),
    priorEvidence: of('research_prior_evidence'),
    hypotheses: of('research_hypothesis'),
    predictions: of('research_prediction'),
    resolutionPolicies,
    workOrders,
    acceptedWorkOrders: workOrders.filter(record => accepted(record) && acceptedPolicies.some(policy => policy.questionHash === record.questionHash
      && Date.parse(policy.createdAt || '') <= Date.parse(record.createdAt || ''))),
    workClaims: of('research_work_claim'),
    outcomes: of('research_outcome'),
    cohorts,
    calibrationCohorts: cohorts.filter(accepted),
    calibrationEvaluations: [...evaluations, ...adjudicationEvaluations].filter(accepted),
    evaluations: evaluations.filter(accepted),
    allEvaluations: evaluations,
    realizedActionValues: of('research_realized_action_value'),
    allCandidateActions: candidateActions,
    candidateActions: candidateActions.filter(candidate => claims.some(claim => claim.claim?.kind === 'candidate_action_approval'
      && claim.claim?.decision === 'approved' && claim.claim?.actionContractHash === candidate.action?.contractHash
      && claim.targetHash === candidate.recordHash && claim.author?.identityRootId !== candidate.author?.identityRootId)),
    allAdjudicationExperiments: of('research_adjudication_experiment'),
    adjudicationExperiments: of('research_adjudication_experiment').filter(record => record.experiment?.schema === ADJUDICATION_EXPERIMENT_VERSION && accepted(record)),
    adjudicationEvaluations
  };
}

/** What a lifecycle record adds beyond its label, as the vanilla record card stated it. */
export function lifecycleSummary(record = {}) {
  const r = record;
  if (r.kind === 'research_hypothesis') return { text: r.hypothesis.statement, detail: `Conditions: ${JSON.stringify(r.hypothesis.conditions)} · discriminators: ${r.hypothesis.discriminatingObservations.join(' · ')}` };
  if (r.kind === 'research_prior_evidence') {
    const finding = r.evidence?.finding;
    const findingLabel = finding ? ` · ${words(finding.classification)} · attempt ${words(finding.attempt.status)}${finding.attempt.failureCategory !== 'none' ? ` (${words(finding.attempt.failureCategory)})` : ''}` : '';
    return { text: `${words(r.evidence.kind)}${findingLabel} · ${r.evidence.summary}`,
      detail: `${r.evidence.reference.accession || r.evidence.reference.uri} @ ${r.evidence.reference.version || compactHash(r.evidence.reference.contentHash)} · retrieved ${r.evidence.provenance.retrievedAt}${r.evidence.schema ? ` · ${r.evidence.schema}` : ''}` };
  }
  if (r.kind === 'research_prediction') return { text: `${r.prediction.normalizedLabel} · confidence ${Math.round(r.prediction.confidence * 100)}%`, detail: `${r.prediction.method.methodId} @ ${r.prediction.method.version} · frozen ${r.prediction.frozenAt} · ${r.prediction.outcomeAccess}` };
  if (r.kind === 'research_resolution_policy') return { text: `${r.policy.conclusionLabel} · resolution criteria frozen`,
    detail: `Provisional acceptance: ${r.policy.provisionalAcceptance.minimumAcceptedCompletedOutcomes} accepted outcome(s), ${r.policy.provisionalAcceptance.minimumIndependentReplications} replica(s) · closure criteria only; no closure authority` };
  if (r.kind === 'research_work_order') {
    const w = r.work;
    return { text: `${w.kind} · ${w.replicaTarget} planned replica${w.replicaTarget === 1 ? '' : 's'}`,
      detail: `Protocol ${w.protocol.protocolId} @ ${w.protocol.version} · ${compactHash(w.protocol.protocolHash)}${w.schema ? ` · analysis ${w.plannedAnalysis.methodId} @ ${w.plannedAnalysis.version} · custody ${w.custody.planId} @ ${w.custody.version} · replication dimensions ${w.replication.requiredIndependentDimensions.join(', ')} · public non-clinical scope · no laboratory or interpretation authority · public failures required` : ' · legacy work order'} · proposed and unallocated until independently reviewed` };
  }
  if (r.kind === 'research_work_claim') {
    const claim = r.workClaim || {};
    const laboratory = claim.consent?.publicLaboratoryIdentity === true ? claim.laboratory?.name : `Participant ${compactHash(r.author?.identityRootId || r.author?.userId || r.recordHash)}`;
    const details = claim.schema
      ? [claim.laboratory?.institution, ...(claim.capabilityClaims || []).map(entry => `${entry.id} @ ${entry.version}`), `${claim.protocolCustody?.role || 'unknown'} custody`,
        claim.safety?.classification, `${claim.availability?.status || 'unknown availability'} through ${claim.availability?.validUntil || 'undeclared date'}`]
      : [...(claim.capabilities || []), 'legacy qualification claim'];
    return { text: `${laboratory} claimed ${compactHash(r.workOrderHash)}`, detail: `${details.filter(Boolean).join(' · ')} · signed declarations, not proof of authorization, safety, or capability` };
  }
  if (r.kind === 'research_outcome') return { text: `${r.outcome.classification} · ${r.outcome.attempt.status}${r.outcome.attempt.failureCategory !== 'none' ? ` · ${r.outcome.attempt.failureCategory}` : ''}`,
    detail: `${r.replicationOfHash ? `Replication claim of ${compactHash(r.replicationOfHash)} · admitted only after declared-dimension checks · ` : ''}${r.outcome.blind.state} · analysis ${compactHash(r.outcome.analysis.analysisHash)}` };
  if (r.kind === 'research_cohort') return { text: `${r.cohort.predictionHashes.length} frozen predictions · ${r.cohort.workOrderHashes.length} work orders`, detail: `${r.cohort.frozenAt} · ${r.cohort.blindingRequired ? 'blinding required' : 'blinding not required'}` };
  if (r.kind === 'research_evaluation') return { text: r.evaluation.metricResults.map(metric => `${metric.metricId} ${metric.improved ? 'improved' : 'did not improve'} (${metric.baselineValue} to ${metric.currentValue})`).join(' · '),
    detail: `${r.evaluation.outcomeHashes.length} independently accepted outcomes · next cohort ${r.evaluation.nextCohortQuestionHashes.length ? 'bound' : 'not bound'}` };
  if (r.kind === 'research_realized_action_value') return { text: `${words(r.realizedValue.assessment.status)} · ${words(r.realizedValue.assessment.decisionEffect)}`,
    detail: `${r.realizedValue.metricResults.length} measured metric(s) · ${r.realizedValue.contributions.length} causal contribution(s) · reward requires independent acceptance` };
  if (r.kind === 'research_adjudication_experiment') {
    const e = r.experiment;
    return { text: `${e.target.catalogId} @ ${e.target.catalogVersion} · ${e.target.curatorRole}`,
      detail: `Baseline ${e.baseline.workflowId}${e.baseline.actionSelection ? ` / ${e.baseline.actionSelection.policyId}` : ''} versus ${e.candidate.policyId} · ${e.cohort.caseCount} family-disjoint paired cases · north star ${e.northStarPolicy?.aggregation?.cohortStatistic || 'legacy not frozen'} · outcome access ${e.outcomeBoundary?.accessAtFreeze || 'legacy boundary not frozen'}` };
  }
  if (r.kind === 'research_adjudication_evaluation') return { text: `Frozen adjudication rule ${r.evaluation.assessment.conclusion}`,
    detail: `North star ${r.evaluation.northStarEvidence?.reportingStatus || 'legacy not reported'} · ${r.evaluation.metricResults.map(metric => `${metric.metricId} ${metric.baselineValue} to ${metric.candidateValue}`).join(' · ')}` };
  if (r.kind === 'research_candidate_action') return { text: `${r.action.kind} · ${r.action.title}`,
    detail: `${r.action.uncertainty.map(entry => `${entry.source}: ${entry.representation}`).join(' · ')} · exact ${r.action.execution.contractKind} ${r.action.execution.contractId} @ ${r.action.execution.version} · proposal only` };
  if (r.kind === 'research_discovery_checkpoint') return { text: `${r.checkpoint.state.status} Discovery Contract state · ${r.checkpoint.inputRecordHashes.length} complete inputs · ${r.checkpoint.activeInputRecordHashes.length} active inputs`,
    detail: `Projection ${r.checkpoint.projection.id} · state ${compactHash(r.checkpoint.stateHash)}` };
  if (r.kind === 'research_revocation') return { text: `Future reuse revoked: ${r.revocation.reason}`, detail: `Target ${compactHash(r.targetHash)} remains in immutable history.` };
  return null;
}

const publicationState = allowed => (allowed === true ? 'permitted' : 'withheld');

/** One signed record as the collection lists it, with its consent-aware technical evidence. */
export function projectRecordEntry(record, { invalidated = new Set(), reviewStates = new Map(), submissionsByHash = new Map() } = {}) {
  const reviewState = reviewStates.get(record.recordHash)?.state || 'unresolved';
  const isInvalidated = invalidated.has(record.recordHash);
  const publication = (record.kind === 'research_result' ? submissionsByHash.get(record.submissionHash) : record)?.consent || {};
  const isResult = record.kind === 'research_result', isSubmission = record.kind === 'research_submission';
  const lines = [];
  if (isResult) lines.push(`Derived from ${compactHash(record.submissionHash)} · provider ${compactHash(record.compute?.providerId || 'unknown')} · receipt ${compactHash(record.compute?.receiptHash)}`);
  if (record.kind === 'human_claim') lines.push(`${record.claim?.relation || ''} ${compactHash(record.targetHash)} · confidence ${Math.round(Number(record.claim?.confidence || 0) * 100)}%${record.claim?.decision ? ` · ${record.claim.decision}` : ''}`);
  let sequence = null;
  if (isSubmission) {
    sequence = record.consent?.publicSequence === true
      ? { value: record.sequence?.value || '' }
      : { withheld: `Sequence value withheld. Hash ${compactHash(record.sequence?.hash)} remains available for provenance.` };
  }
  return {
    hash: record.recordHash,
    kind: words(record.kind),
    label: label(record),
    meta: [record.author?.role || record.author?.roleId || 'unknown role', compactHash(record.author?.identityRootId || record.author?.userId || record.author?.roleId || 'unknown author'),
      compactHash(record.recordHash), isInvalidated ? 'revoked or downstream-invalidated' : reviewState].join(' · '),
    invalidated: isInvalidated,
    sequence,
    lines,
    links: record.kind === 'human_claim' ? (record.claim?.evidenceLinks || []).map(link => ({ label: link.label || link.url, url: link.url })) : [],
    summary: lifecycleSummary(record),
    technical: [
      ['Record hash', record.recordHash || 'unknown'], ['Room', record.roomId || 'unknown'], ['Review state', reviewState], ['History state', isInvalidated ? 'invalidated' : 'active'],
      ...(isSubmission ? [['Sequence hash', record.sequence?.hash || 'unknown'], ['Sequence publication', publicationState(publication.publicSequence === true)], ['Sequence length', String(record.sequence?.length || 'not published')]] : []),
      ...(isResult ? [['Source submission', compactHash(record.submissionHash)], ['Receipt', record.compute?.receiptHash || 'unknown'], ['Model', record.modelContract?.id || 'unknown'],
        ['Model hash', record.modelContract?.hash || 'unknown'], ['Manifest', record.modelContract?.manifestHash || 'unknown'],
        ['Runtime', `${record.modelContract?.runtime || 'unknown'} / ${record.modelContract?.backend || 'unknown'}`], ['Route decision', record.compute?.routeDecisionHash || 'none'],
        ['Runtime profile', record.compute?.runtimeProfileHash || 'none'], ['Assignment', record.compute?.assignmentId || 'none'],
        ['Embedding publication', publicationState(publication.publishEmbedding === true)], ['Residue evidence', publicationState(publication.publishResidueEvidence === true)]] : [])
    ],
    technicalNote: isResult ? 'Raw vectors, residue values, and unpublished sequence values remain outside this disclosure unless their signed publication consent exists.' : ''
  };
}

const modelEvidenceView = (view, submissionsByHash) => {
  const question = submissionsByHash.get(view.submissionHash);
  return {
    title: question ? label(question) : compactHash(view.submissionHash),
    sources: `${plural(view.modelSources.length, 'isolated exact-model source')}`,
    entries: view.modelSources.map(source => {
      let residues = 'Model-specific embedding evidence only; no bounded residue evidence was published.';
      if (source.maskedResidueProposalCount > 0) {
        residues = `${plural(source.maskedResidueProposalCount, 'bounded masked-residue proposal')} at sequence positions ${source.residuePositions.join(', ') || 'not residue-mapped'}`;
      } else if (source.residueEmbeddingCount > 0) {
        residues = `${plural(source.residueEmbeddingCount, 'bounded residue embedding')} at sequence positions ${source.residuePositions.join(', ') || 'not residue-mapped'}`;
      }
      return {
        title: source.model.id || 'Unknown exact model',
        counts: `${plural(source.resultHashes.length, 'signed result')} · ${plural(source.receiptHashes.length, 'receipt')} · ${plural(source.providerIds.length, 'provider')}`,
        identity: `Model ${compactHash(source.model.hash)} · manifest ${compactHash(source.model.manifestHash)} · tokenizer ${compactHash(source.model.tokenizerHash)} · ${source.model.runtime || 'unknown runtime'} / ${source.model.backend || 'unknown backend'}`,
        residues,
        boundaries: source.claimBoundaries.join(' ')
      };
    }),
    agreement: view.agreement.detail,
    disagreement: view.disagreement.detail,
    shared: view.sharedResiduePositions.length
      ? `Shared protein residue coordinates: ${view.sharedResiduePositions.map(position => `${position.sequenceIndex} (${position.sourceCount} sources)`).join(', ')}. Coordinates are shared identities, not a comparison of vectors or tokenizer-local logits.` : '',
    uncertainty: view.uncertainty.map(entry => entry.detail),
    next: { kind: words(view.nextAction.kind), reason: view.nextAction.reason }
  };
};

const agreementLabel = (record = {}) => {
  const status = String(record.compute?.agreement?.status || '').trim().toLowerCase();
  if (['accepted', 'agreed'].includes(status)) return 'Agreement assessed';
  if (['rejected', 'disagreement', 'redundant_disagreement'].includes(status) || record.compute?.status === 'redundant_disagreement') return 'Disagreement assessed';
  return 'Not assessed';
};

const reviewContext = (record, { submissionsByHash, reviewStates }) => {
  const submission = record.kind === 'research_submission' ? record : submissionsByHash.get(record.submissionHash || record.questionHash);
  const intent = submission?.requesterIntent || {};
  const reuse = record.evidence?.reuseContext || null;
  const origin = reuse?.originSource || null;
  return {
    hash: record.recordHash,
    title: label(record),
    meta: `${words(record.kind)} · ${compactHash(record.recordHash)}`,
    facts: [
      ...(submission ? [['Question', `${intent.label || intent.text || 'Question not labelled'}${intent.text && intent.text !== intent.label ? ` · ${intent.text}` : ''}`],
        ['Sequence', `${compactHash(submission.sequence?.hash)} · ${submission.sequence?.length || 'unknown'} residues · ${submission.consent?.publicSequence === true ? 'Sequence publication permitted' : 'Sequence value withheld'}`]] : []),
      ...(record.kind === 'research_result' ? [['Result evidence', `${record.modelContract?.id || 'Model result'} · ${record.embedding?.dimensions || record.modelContract?.dimensions || 'unknown'} dimensions · receipt ${compactHash(record.compute?.receiptHash)}`],
        ['Agreement', agreementLabel(record)]] : []),
      ...(reuse ? [['Origin context', `${reuse.origin.roomId} · ${compactHash(reuse.origin.questionHash)}`],
        ...(origin ? [['Declared source identity', `${origin.reference?.accession || origin.reference?.uri || 'unlabelled source'} @ ${origin.reference?.version || compactHash(origin.reference?.contentHash)} · ${compactHash(origin.identityHash)}`]] : []),
        ['Declared-context comparison', `${words(reuse.comparison.status)}${reuse.comparison.differences.length ? ` · differs: ${reuse.comparison.differences.join(', ')}` : ''}${reuse.comparison.missing.length ? ` · missing: ${reuse.comparison.missing.join(', ')}` : ''}`]] : []),
      ['Current review', words(reviewStates.get(record.recordHash)?.state || 'unresolved')]
    ],
    note: `Choose a signed decision below. Similarity and retrieval ranking do not establish agreement.${reuse ? ' Cross-room acceptance also requires an explicit determination that the origin evidence is relevant to this current decision context.' : ''}`
  };
};

export const REVIEW_ACTIONS = Object.freeze([['accept', 'Accept evidence'], ['reject', 'Reject evidence'], ['correct', 'Attach correction'], ['replicate', 'Request replication']]);
export const CONTEXT_DETERMINATIONS = Object.freeze([['relevant', 'Relevant to this decision context'], ['not_relevant', 'Not relevant to this decision context'], ['uncertain', 'Contextual relevance remains uncertain']]);
export const DEFAULT_REVIEW = Object.freeze({ target: '', text: '', confidence: '0.75', evidenceUrl: '', contextDetermination: '' });

/** The review targets: every active record except approvals, which are decisions about work rather than evidence. */
export const reviewTargets = active => active.filter(record => record.kind !== 'human_claim' || !['task_approval', 'candidate_action_approval'].includes(record.claim?.kind));

/** The target the review form selects: the one chosen here, else the address's, else the first. */
export function selectedReviewTarget(targets, chosen = '', addressed = '') {
  if (targets.some(record => record.recordHash === chosen)) return chosen;
  if (isRecordHash(addressed) && targets.some(record => record.recordHash === addressed)) return addressed;
  return targets[0]?.recordHash || '';
}

/** The review form's problems before signing, in the order the vanilla form's required marks would stop it. */
export function reviewProblem(review, requiresContext) {
  if (!review.target) return 'Choose the evidence to review.';
  if (requiresContext && !review.contextDetermination) return 'Choose a cross-room contextual relevance determination.';
  if (!String(review.text).trim()) return 'Explain the decision, the correction, or what an independent replication should check.';
  const confidence = Number(review.confidence);
  if (review.confidence === '' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return 'Confidence must be a number from 0 to 1.';
  if (review.evidenceUrl) { try { new URL(review.evidenceUrl); } catch { return 'Evidence URL must be a full address, starting with https://.'; } }
  return '';
}

// Group rules from the vanilla binding: the prior-evidence kind shows the annotation, finding or failure fields.
const groupRule = (hook, values) => {
  const kind = values.evidenceKind;
  if (hook === 'data-protein-annotation-fields') {
    const on = ['annotation', 'domain'].includes(kind);
    return { hidden: !on, field: field => (field.name === 'annotationScope' && kind === 'domain'
      ? { disabled: true, required: false, value: 'domain' } : { disabled: !on, required: on && field.name !== 'ontologyLabel' }) };
  }
  if (hook === 'data-public-evidence-finding') {
    const assay = kind === 'assay', negative = kind === 'negative_result';
    return { hidden: !assay && !negative, field: field => (field.name === 'findingClassification'
      ? { disabled: !assay, required: assay, ...(negative ? { value: 'negative' } : {}) } : {}) };
  }
  if (hook === 'data-public-evidence-failure') {
    const failed = kind === 'failed_attempt';
    return { hidden: !failed, field: () => ({ disabled: !failed, required: failed }) };
  }
  return null;
};

const EMPTY_SOURCE = { value: '__none__', title: 'No eligible records', disabled: true };

const resolveField = (field, values, sources, override = {}) => {
  if (field.k === 'note') return field;
  const fromSource = field.source ? (sources[field.source] || []).map(option) : [];
  const options = field.k === 'select' || field.k === 'multi'
    ? [...field.options, ...fromSource, ...(field.source && !fromSource.length ? [EMPTY_SOURCE] : [])] : undefined;
  const valid = options?.filter(entry => !entry.disabled).map(entry => entry.value);
  const current = override.value ?? (field.name in values ? values[field.name] : field.value);
  let value = current;
  if (field.k === 'select') value = valid.includes(current) ? current : valid[0] ?? '';
  else if (field.k === 'multi') value = Array.isArray(current) ? current.filter(entry => valid.includes(entry)) : [];
  return { ...field, options, value, required: override.required ?? field.required === true,
    disabled: override.disabled ?? field.disabled === true, ...(field.source ? { source: field.source } : {}) };
};

const resolveItems = (items, values, sources, rule = null) => items.flatMap(item => {
  if (item.k === 'group') {
    const own = item.hook ? groupRule(item.hook, values) : null;
    if (own?.hidden) return [];
    return [{ k: 'group', legend: item.legend, hook: item.hook || '', items: resolveItems(item.items, values, sources, own || rule) }];
  }
  return [resolveField(item, values, sources, item.k === 'note' || !rule ? {} : rule.field(item))];
});

const leaves = items => items.flatMap(item => {
  if (item.k === 'group') return leaves(item.items);
  if (item.k === 'note') return [];
  return [item];
});

/** Every lifecycle form as it stands for these records and the values typed so far. */
export function projectLifecycleForms(sources, values = {}, { pending = {}, errors = {} } = {}) {
  return LIFECYCLE_SECTIONS.map(section => ({
    kicker: section.kicker, title: section.title, anchor: section.anchor || '',
    parts: section.parts.map(part => (part.k === 'note' ? part : {
      k: 'form', action: part.action, summary: part.summary, submit: part.submit, quiet: part.quiet,
      ready: part.requires.every(([key, count]) => (sources[key] || []).length >= count),
      items: resolveItems(part.items, values[part.action] || {}, sources),
      pending: pending[`lifecycle:${part.action}`] === true,
      error: errors[`lifecycle:${part.action}`] || ''
    }))
  }));
}

/** A lifecycle form's first unmet requirement, as the browser's required, pattern and range checks would report it. */
export function lifecycleProblem(form) {
  for (const field of leaves(form.items)) {
    if (field.disabled) continue;
    const value = field.value;
    let empty;
    if (field.k === 'check') empty = value !== true;
    else if (field.k === 'multi') empty = !value.length;
    else empty = String(value ?? '').trim() === '';
    if (field.required && empty) return `Complete "${field.label}" before signing.`;
    if (empty) continue;
    if (field.pattern && !new RegExp(`^(?:${field.pattern})$`).test(String(value))) return `"${field.label}" must match the requested format.`;
    if (field.k === 'number') {
      const number = Number(value);
      if (!Number.isFinite(number)) return `"${field.label}" must be a number.`;
      if ((field.min !== undefined && number < field.min) || (field.max !== undefined && number > field.max)) return `"${field.label}" must be between ${field.min ?? 'any'} and ${field.max ?? 'any'}.`;
    }
    if (field.k === 'url') { try { new URL(String(value)); } catch { return `"${field.label}" must be a full address.`; } }
  }
  return '';
}

/** A form's submitted values as the record builders read them: FormData's get and getAll over enabled, shown fields. */
export function lifecycleValues(form) {
  const entries = [];
  for (const field of leaves(form.items)) {
    if (field.disabled) continue;
    if (field.k === 'check') { if (field.value === true) entries.push([field.name, 'on']); }
    else if (field.k === 'multi') for (const value of field.value) entries.push([field.name, value]);
    else entries.push([field.name, String(field.value ?? '')]);
  }
  return {
    get: name => entries.find(([key]) => key === name)?.[1] ?? null,
    getAll: name => entries.filter(([key]) => key === name).map(([, value]) => value),
    has: name => entries.some(([key]) => key === name),
    entries: () => entries[Symbol.iterator]()
  };
}

/** The workspace's counts, collection, evidence, review, forms, discovery, next work and participation. */
export function projectResearchWorkspace(records, {
  query = '', similarityTarget = '', review = DEFAULT_REVIEW, addressedTarget = '', reviewStatus = '', values = {}, pending = {}, errors = {}
} = {}) {
  const sources = projectResearchSources(records);
  const { active, reviewStates, invalidated } = sources;
  const graph = buildEvidenceGraph(records);
  const lifecycles = buildQuestionLifecycles(records);
  const submissionsByHash = new Map(sources.questions.map(record => [record.recordHash, record]));
  const targets = reviewTargets(active);
  const target = selectedReviewTarget(targets, review.target, addressedTarget);
  const targetRecord = targets.find(record => record.recordHash === target) || null;
  const requiresContext = Boolean(targetRecord?.evidence?.reuseContext);
  const similarity = sources.results.some(record => record.recordHash === similarityTarget) ? similarityTarget : sources.results.at(-1)?.recordHash || '';
  const similar = similarity ? findSimilarSequences(records, similarity) : [];
  const clusters = clusterCompatibleResults(records);
  const actionRanking = rankProposedDiscoveryActions(records);
  const candidateRanking = rankProposedCandidateActions(records);
  const policy = candidateRanking.policy;
  const count = kind => active.filter(record => record.kind === kind).length;
  return {
    stats: [['Submissions', count('research_submission')], ['Hypotheses', count('research_hypothesis')], ['Predictions', count('research_prediction')],
      ['Resolution policies', count('research_resolution_policy')], ['Work orders', count('research_work_order')], ['Outcomes', count('research_outcome')],
      ['Frozen cohorts', count('research_cohort')], ['Cohort evaluations', count('research_evaluation')], ['Realized action values', count('research_realized_action_value')],
      ['Adjudication experiments', count('research_adjudication_experiment')], ['Adjudication evaluations', count('research_adjudication_evaluation')],
      ['Candidate actions', count('research_candidate_action')], ['Results', count('research_result')], ['Human claims', count('human_claim')],
      ['Evidence nodes', graph.nodes.length], ['Connections', graph.edges.length], ['Question lifecycles', lifecycles.length]].map(([term, value]) => [term, String(value)]),
    records: searchEvidence(records, query).map(record => projectRecordEntry(record, { invalidated, reviewStates, submissionsByHash })),
    modelEvidence: lifecycles.map(lifecycle => modelEvidenceView(lifecycle.modelEvidence, submissionsByHash)),
    review: {
      targets: targets.map(option),
      target,
      context: targetRecord ? reviewContext(targetRecord, { submissionsByHash, reviewStates }) : null,
      requiresContext,
      text: review.text, confidence: review.confidence, evidenceUrl: review.evidenceUrl, contextDetermination: review.contextDetermination,
      determinations: CONTEXT_DETERMINATIONS.map(([value, title]) => ({ value, title })),
      actions: REVIEW_ACTIONS.map(([value, title]) => ({ value, title, pendingLabel: reviewActionClaims[value].pending, pending: pending[`review:${value}`] === true })),
      status: reviewStatus
    },
    forms: projectLifecycleForms(sources, values, { pending, errors }),
    discovery: {
      results: sources.results.map(option), target: similarity,
      similar: similar.map(entry => ({ title: label(entry.record), detail: `${(entry.similarity * 100).toFixed(2)}% similar · ${entry.supportingAnnotations.length} accepted annotations`,
        meta: `Model ${entry.record.modelContract.id} · receipt ${compactHash(entry.record.compute.receiptHash)}` })),
      clusters: clusters.map(cluster => ({ title: cluster.clusterId, detail: `${plural(cluster.members.length, 'exact-contract compatible result')}`,
        meta: cluster.members.map(record => compactHash(record.recordHash)).join(' · ') }))
    },
    nextWork: {
      candidates: candidateRanking.admittedCandidates.map(candidate => ({
        hash: candidate.recordHash, contractHash: candidate.actionId,
        title: `${words(candidate.actionKind)}: ${candidate.title}`, rationale: candidate.rationale,
        meta: `${candidate.recordHash === candidateRanking.selectedAction?.recordHash ? 'Highest-ranked admitted candidate · ' : ''}${words(candidate.rankingStatus)} · score ${candidate.rankingScore} · ${words(candidate.humanApprovalState)}`,
        approved: candidate.humanApprovalState === 'approved',
        facts: [['Uncertainty reduction', `${candidate.rawValueComponents.uncertaintyReduction}/5`], ['Decision relevance', `${candidate.rawValueComponents.decisionRelevance}/5`],
          ['Duplicate-work avoidance', `${candidate.rawValueComponents.duplicateWorkAvoidance}/5`], ['Aggregate declared burden', String(candidate.rawValueComponents.costBurden)],
          ...['compute', 'money', 'labor', 'instrument', 'sample', 'elapsedTime'].map(component => { const entry = candidate.scientificCost[component] || {};
            return [component === 'elapsedTime' ? 'elapsed time' : component, `${entry.amount} ${entry.unit} · burden ${entry.burden}/5`]; }),
          [`Exact ${candidate.execution.contractKind}`, `${candidate.execution.contractId} @ ${candidate.execution.version} · artifact ${compactHash(candidate.execution.artifactHash)} · parameters ${compactHash(candidate.execution.parametersHash)}`],
          ['Uncertainty sources', candidate.uncertainty.map(entry => `${words(entry.source)}: ${words(entry.representation)}${entry.calibration ? ` via ${entry.calibration.methodId} @ ${entry.calibration.version} on ${compactHash(entry.calibration.cohortHash)}` : ''}`).join(' · ')],
          ['Affected hypotheses', candidate.affectedHypothesisHashes.map(compactHash).join(' · ')],
          ['Independence', `${candidate.independence.dimensions.join(' · ')} · minimum ${candidate.independence.minimumIndependentExecutions}`],
          ['Safety', `${candidate.safety.classification} · human review required`], ['Approval authority', 'Proposal and ranking have no allocation or execution authority.']],
        predicted: candidate.predictedObservations.map(entry => entry.observation).join(' · '),
        falsifiers: candidate.falsifiers.map(entry => entry.observation).join(' · '),
        assumptions: candidate.scientificCost.assumptions.join(' · '),
        pending: pending[`candidate:${candidate.recordHash}`] === true, error: errors[`candidate:${candidate.recordHash}`] || ''
      })),
      rejected: candidateRanking.rejectedActions.map(candidate => ({ title: candidate.title, detail: candidate.reasons.map(words).join(' · '), meta: compactHash(candidate.recordHash) })),
      policy: [['Policy', `${policy.policyId} @ ${policy.version}`], ['Method', `${policy.method} · ${words(policy.status)}`], ['Parameters', JSON.stringify(policy.parameters)],
        ['Cost assumptions', JSON.stringify(policy.costAssumptions)],
        ['Calibration evidence', policy.calibrationEvidenceHashes.length ? policy.calibrationEvidenceHashes.map(compactHash).join(' · ') : 'None; ranking is explicitly not calibrated.']],
      tasks: actionRanking.rankedCandidates.map(task => ({
        id: task.actionId, targetHash: task.targetHash, title: words(task.actionKind), reason: task.reason, approved: task.status === 'approved',
        meta: `Basis: ${task.basis === 'accepted_memory' ? plural(task.basisHashes?.length || 0, 'accepted memory record') : 'question or governance boundary'} · heuristic priority ${task.heuristicPriority} · ordinal uncertainty reduction ${task.expectedInformationGain.estimate} · planning cost ${task.valueComponents.totalCost}.`,
        pending: pending[`task:${task.actionId}`] === true, error: errors[`task:${task.actionId}`] || ''
      })),
      taskPolicy: actionRanking.policy.policyId
    },
    rewards: projectResearchRewards(records).map(reward => ({ title: compactHash(reward.authorId),
      detail: `${reward.points} points · ${reward.realizedUsefulnessCredits || 0} realized usefulness credits · ${reward.verifiedCompute} verified compute · ${reward.acceptedEvidence} accepted evidence · ${reward.acceptedReviews} accepted reviews · ${Math.round(reward.quality * 100)}% durable` }))
  };
}
