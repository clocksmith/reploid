/**
 * @fileoverview Explicit bridge from an internal RSI improvement projection to
 * a separate externally governed Change Passport seed.
 */

import {
  adaptImprovementEpisodeToPassportSource,
  hashChangePassportValue,
  normalizeChangePassportEventPayload,
  normalizeChangePassportStart
} from './contract.js';
import { validateChangePassportPolicy } from './policy.js';

export const CHANGE_PASSPORT_IMPROVEMENT_ADAPTER_SCHEMA =
  'change.passport-improvement-adapter/v1';

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

const requiredText = (value, label) => {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
};

const sourceDigest = async (value, cryptoApi) => {
  const normalized = String(value || '').toLowerCase();
  if (/^sha256:[a-f0-9]{64}$/.test(normalized)) return normalized;
  return hashChangePassportValue({ sourceDigest: requiredText(value, 'source digest') }, cryptoApi);
};

const sourceEvidence = ({ evidenceId, kind, digest, source, summary, observedAt, uri = null }) => ({
  evidenceId,
  kind,
  digest,
  source,
  uri,
  summary,
  observedAt,
  custody: {
    mode: 'content_addressed_reference',
    accessRequired: true,
    retention: 'source_improvement_ledger'
  }
});

const conclusionForEpisode = (episode) => {
  if (episode.comparison?.conclusion === 'improved' && episode.verification?.passed === true) {
    return 'pass';
  }
  if (episode.comparison?.conclusion === 'inconclusive') return 'inconclusive';
  return 'fail';
};

/**
 * Produces canonical event payloads, not signed events. Each payload must still
 * be submitted by its named actor through the Change Control service. In
 * particular, the adapter cannot turn a Zero proposal or X evaluation into an
 * external reviewer approval.
 */
export async function buildImprovementEpisodePassportSeed({
  episode,
  passportId,
  organizationId,
  changeClass,
  policy,
  repository,
  target,
  rollback,
  title,
  summary,
  proposalId,
  createdAt,
  evidenceCutoff,
  cryptoApi = globalThis.crypto
} = {}) {
  if (episode?.schema !== 'rsi.improvement-episode/v1' || episode.integrity?.valid !== true) {
    throw new Error('A valid rsi.improvement-episode/v1 projection is required');
  }
  for (const field of ['candidate', 'execution', 'verification', 'evaluation', 'comparison']) {
    if (!episode[field]) throw new Error(`Improvement episode ${field} evidence is required`);
  }
  for (const field of ['generator', 'promotionAuthority']) {
    if (!episode[field]) throw new Error(`Improvement episode ${field} binding is required`);
  }
  if (!Array.isArray(episode.negativeEvidence) || episode.negativeEvidence.length === 0) {
    throw new Error('Improvement episode retained negative evidence is required');
  }
  if (episode.proposer?.authorityId === episode.evaluator?.authorityId) {
    throw new Error('Improvement proposer and evaluator authority must remain independent');
  }
  const policyValidation = await validateChangePassportPolicy(policy, cryptoApi);
  if (!policyValidation.valid) {
    throw new Error(`Change Passport policy is invalid: ${policyValidation.reasons.join('; ')}`);
  }

  const sourceEpisode = await adaptImprovementEpisodeToPassportSource(episode, cryptoApi);
  const timestamp = requiredText(createdAt || episode.updatedAt, 'createdAt');
  const cutoff = requiredText(evidenceCutoff || episode.updatedAt, 'evidenceCutoff');
  const baselineHash = await hashChangePassportValue({
    generationId: episode.baseline?.generationId,
    hashes: episode.baseline?.hashes
  }, cryptoApi);
  const candidateHash = await sourceDigest(episode.candidate.candidateHash, cryptoApi);
  const manifestHash = await hashChangePassportValue({
    candidateId: episode.candidate.candidateId,
    patchHash: episode.candidate.patchHash,
    changedFiles: episode.candidate.changedFiles,
    semanticScope: episode.candidate.semanticScope
  }, cryptoApi);
  const evaluatorHash = await sourceDigest(episode.evaluator.evaluatorHash, cryptoApi);
  const suiteHash = await sourceDigest(episode.evaluator.testSuiteDigest, cryptoApi);
  const contractHash = await sourceDigest(episode.baseline?.hashes?.contract, cryptoApi);

  const admittedEvidence = [
    sourceEvidence({
      evidenceId: `evidence:${episode.episodeId}:ledger`,
      kind: 'improvement_episode',
      digest: sourceEpisode.projectionHash,
      source: `Internal ${episode.surface} rsi.improvement-episode/v1 projection`,
      summary: 'Hash-linked source projection. Its internal signatures remain source attestations and are not external endorsements.',
      observedAt: episode.updatedAt,
      uri: episode.projectionPath || null
    }),
    sourceEvidence({
      evidenceId: `evidence:${episode.episodeId}:verification`,
      kind: 'tests',
      digest: await hashChangePassportValue(episode.verification, cryptoApi),
      source: `Improvement verifier ${episode.verification.verifierId || 'unknown'}`,
      summary: episode.verification.passed
        ? 'The internal frozen verification checks passed.'
        : 'The internal frozen verification checks did not pass.',
      observedAt: episode.updatedAt
    }),
    sourceEvidence({
      evidenceId: `evidence:${episode.episodeId}:evaluation`,
      kind: 'evaluation',
      digest: await hashChangePassportValue({
        evaluation: episode.evaluation,
        comparison: episode.comparison
      }, cryptoApi),
      source: `Internal evaluator ${episode.evaluator.authorityId}`,
      summary: `Internal comparison conclusion: ${episode.comparison.conclusion}. A separate Change Passport reviewer must decide eligibility.`,
      observedAt: episode.updatedAt
    })
  ].map((payload) => normalizeChangePassportEventPayload('evidence.admitted', payload));

  const evidenceIds = admittedEvidence.map((entry) => entry.evidenceId).sort();
  const evidenceManifestHash = await hashChangePassportValue(
    admittedEvidence
      .map((entry) => [entry.evidenceId, entry.digest])
      .sort(([left], [right]) => left.localeCompare(right)),
    cryptoApi
  );

  const start = normalizeChangePassportStart({
    passportId,
    organizationId,
    changeClass,
    proposal: {
      proposalId: proposalId || `proposal:${episode.episodeId}`,
      title: title || episode.objective?.statement,
      summary: summary || episode.candidate.expectedBehavior,
      repository,
      baseRevision: episode.baseline?.generationId,
      candidateRevision: episode.candidate.generationId,
      baselineHash,
      candidateHash,
      manifestHash,
      target,
      proposerAuthorityId: episode.proposer.authorityId
    },
    policy,
    evaluator: {
      evaluatorId: episode.evaluator.evaluatorId,
      authorityId: episode.evaluator.authorityId,
      version: episode.evaluator.version,
      evaluatorHash,
      suiteHash,
      contractHash,
      frozenBeforeCandidate: episode.evaluator.frozenBeforeCandidate === true
    },
    budget: {
      calls: Number(episode.resourceBudget?.calls || 0),
      elapsedMilliseconds: Number(episode.resourceBudget?.elapsedMs || 0),
      costAmount: Number(episode.resourceBudget?.costAmount || 0),
      costUnit: episode.resourceBudget?.costUnit || 'internal_budget_unit'
    },
    rollback,
    evidenceCutoff: cutoff,
    createdAt: timestamp,
    sourceEpisode
  });

  const evaluation = normalizeChangePassportEventPayload('evaluation.recorded', {
    evaluationId: `evaluation:${episode.episodeId}`,
    evaluatorId: start.evaluator.evaluatorId,
    evaluatorAuthorityId: start.evaluator.authorityId,
    evaluatorHash: start.evaluator.evaluatorHash,
    suiteHash: start.evaluator.suiteHash,
    contractHash: start.evaluator.contractHash,
    baselineHash: start.proposal.baselineHash,
    candidateHash: start.proposal.candidateHash,
    evidenceManifestHash,
    conclusion: conclusionForEpisode(episode),
    metrics: cloneJson(episode.evaluation.metrics || []),
    limitations: [
      'This result is an internal X/improvement evaluator attestation, not an external approval.',
      ...(episode.comparison.regressions || []).map((entry) => `Declared regression: ${JSON.stringify(entry)}`)
    ],
    observedAt: episode.updatedAt
  });

  return Object.freeze({
    schema: CHANGE_PASSPORT_IMPROVEMENT_ADAPTER_SCHEMA,
    sourceEpisode,
    authorityBindings: Object.freeze({
      generator: cloneJson(episode.generator),
      evaluator: cloneJson(episode.evaluator),
      promotion: cloneJson(episode.promotionAuthority)
    }),
    negativeEvidence: cloneJson(episode.negativeEvidence),
    start,
    triggerDeclarations: cloneJson(policy.reopeningRules || []),
    admittedEvidence,
    evidenceFreeze: normalizeChangePassportEventPayload('evidence.frozen', {
      manifestHash: evidenceManifestHash,
      evidenceIds,
      cutoff
    }),
    evaluation,
    requiredSubmissions: Object.freeze([
      { payload: 'start', authorityId: start.proposal.proposerAuthorityId, role: 'proposer' },
      ...admittedEvidence.map((_, index) => ({
        payload: `admittedEvidence[${index}]`,
        authorityId: index === 2 ? start.evaluator.authorityId : start.proposal.proposerAuthorityId,
        role: index === 2 ? 'evaluator' : 'evidence_producer'
      })),
      { payload: 'evidenceFreeze', authorityId: 'configured-change-authority', role: 'change_authority' },
      { payload: 'evaluation', authorityId: start.evaluator.authorityId, role: 'evaluator' }
    ]),
    authorityBoundary: 'No review, decision, effect, outcome, reopening, revocation, or rollback authority is inferred from the source episode.'
  });
}

export default {
  CHANGE_PASSPORT_IMPROVEMENT_ADAPTER_SCHEMA,
  buildImprovementEpisodePassportSeed
};
