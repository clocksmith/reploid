// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parse } from 'acorn';
import * as evidence from '../../self/pool/evidence-network.js';
import * as admission from '../../self/pool/evidence-admission.js';

// Public surface captured before extracting the implementation owners.
const publicNames = [
  "ADJUDICATION_CAMPAIGN_MEASUREMENT_PLAN_VERSION",
  "ADJUDICATION_CAMPAIGN_MEASUREMENT_ROLES",
  "ADJUDICATION_EVALUATION_VERSION",
  "ADJUDICATION_EXPERIMENT_VERSION",
  "BASELINE_FREEZE_ADJUDICATION_EVALUATION_VERSION",
  "BASELINE_FREEZE_ADJUDICATION_EXPERIMENT_VERSION",
  "CANONICAL_PROTEIN_ANNOTATION_COORDINATE_SYSTEM",
  "CONTEXTUAL_REUSE_REVIEW_VERSION",
  "CROSS_ROOM_REUSE_CONTEXT_VERSION",
  "CROSS_ROOM_SOURCE_IDENTITY_VERSION",
  "DISCOVERY_CHECKPOINT_VERSION",
  "DISCOVERY_CONTRACT_PROJECTION_ID",
  "DISCOVERY_CONTRACT_STATE_VERSION",
  "EVIDENCE_RELATIONS",
  "EXPERIMENTAL_EXECUTION_CONTEXT_VERSION",
  "HUMAN_CLAIM_KINDS",
  "LABORATORY_AVAILABILITY_STATUSES",
  "LABORATORY_CAPABILITY_CLAIM_VERSION",
  "LABORATORY_PROTOCOL_CUSTODY_ROLES",
  "LEGACY_ADJUDICATION_EVALUATION_VERSION",
  "LEGACY_ADJUDICATION_EXPERIMENT_VERSION",
  "LEGACY_DISCOVERY_CONTRACT_PROJECTION_ID",
  "LEGACY_DISCOVERY_CONTRACT_STATE_VERSION",
  "LEGACY_RESEARCH_RECORD_VERSION",
  "PRIOR_EVIDENCE_KINDS",
  "PROTEIN_ANNOTATION_COORDINATE_SYSTEMS",
  "PROTEIN_ANNOTATION_IDENTITY_VERSION",
  "PROTEIN_ANNOTATION_SCOPES",
  "PUBLIC_PROTEIN_EVIDENCE_FINDINGS",
  "PUBLIC_PROTEIN_EVIDENCE_KINDS",
  "PUBLIC_PROTEIN_EVIDENCE_VERSION",
  "REPLICATION_INDEPENDENCE_DIMENSIONS",
  "RESEARCH_ATTEMPT_STATUSES",
  "RESEARCH_FAILURE_CATEGORIES",
  "RESEARCH_INTENT_KINDS",
  "RESEARCH_OUTCOME_CLASSES",
  "RESEARCH_RECORD_KINDS",
  "RESEARCH_RECORD_VERSION",
  "RESEARCH_RESOLUTION_POLICY_VERSION",
  "RESEARCH_REVIEW_DECISIONS",
  "RESEARCH_WORK_KINDS",
  "RESEARCH_WORK_ORDER_CONTRACT_VERSION",
  "RESOLUTION_REOPEN_TRIGGERS",
  "RESOLUTION_UNCERTAINTY_TRIGGERS",
  "activeResearchRecords",
  "buildEvidenceGraph",
  "buildModelEvidenceView",
  "buildPredictionDisagreementMap",
  "buildQuestionLifecycles",
  "clusterCompatibleResults",
  "compareResearchDecisionContexts",
  "cosineSimilarity",
  "createCrossRoomReuseContext",
  "createSignedAdjudicationEvaluation",
  "createSignedAdjudicationExperiment",
  "createSignedCandidateAction",
  "createSignedCohortEvaluation",
  "createSignedDiscoveryCheckpoint",
  "createSignedEvaluationCohort",
  "createSignedExperimentalOutcome",
  "createSignedHumanClaim",
  "createSignedPriorEvidence",
  "createSignedPublicProteinEvidence",
  "createSignedRealizedActionValue",
  "createSignedResearchHypothesis",
  "createSignedResearchPrediction",
  "createSignedResearchResolutionPolicy",
  "createSignedResearchResult",
  "createSignedResearchRevocation",
  "createSignedResearchSubmission",
  "createSignedResearchWorkClaim",
  "createSignedResearchWorkOrder",
  "createSignedSequenceEvidenceLink",
  "embeddingsAreCompatible",
  "findSimilarSequences",
  "invalidatedResearchHashes",
  "projectAcceptedResearchMemory",
  "projectCrossRoomSequenceEvidence",
  "projectDiscoveryTaskContract",
  "projectResearchExecutionIndependence",
  "projectResearchQuestionClarity",
  "projectResearchResolutionCriteria",
  "projectResearchReviewStates",
  "projectResearchRewards",
  "proposeDiscoveryTasks",
  "rankProposedCandidateActions",
  "rankProposedDiscoveryActions",
  "researchRecordTargetHashes",
  "revokedResearchHashes",
  "searchEvidence",
  "validateCrossRoomReuseOrigin",
  "validateResearchRecordLinks",
  "validateResearchRecordModelAdmission",
  "verifyResearchRecord"
];
const defaultNames = [
  "createSignedResearchSubmission",
  "createSignedResearchResult",
  "createSignedHumanClaim",
  "createSignedResearchHypothesis",
  "createSignedPriorEvidence",
  "createSignedPublicProteinEvidence",
  "createCrossRoomReuseContext",
  "compareResearchDecisionContexts",
  "createSignedResearchPrediction",
  "createSignedResearchWorkOrder",
  "createSignedResearchWorkClaim",
  "createSignedExperimentalOutcome",
  "createSignedEvaluationCohort",
  "createSignedCohortEvaluation",
  "createSignedRealizedActionValue",
  "createSignedAdjudicationExperiment",
  "createSignedAdjudicationEvaluation",
  "createSignedCandidateAction",
  "createSignedDiscoveryCheckpoint",
  "createSignedResearchRevocation",
  "verifyResearchRecord",
  "validateResearchRecordModelAdmission",
  "validateResearchRecordLinks",
  "validateCrossRoomReuseOrigin",
  "researchRecordTargetHashes",
  "activeResearchRecords",
  "invalidatedResearchHashes",
  "buildEvidenceGraph",
  "buildPredictionDisagreementMap",
  "buildModelEvidenceView",
  "buildQuestionLifecycles",
  "projectResearchQuestionClarity",
  "projectResearchExecutionIndependence",
  "projectResearchReviewStates",
  "projectAcceptedResearchMemory",
  "projectCrossRoomSequenceEvidence",
  "projectDiscoveryTaskContract",
  "searchEvidence",
  "findSimilarSequences",
  "clusterCompatibleResults",
  "proposeDiscoveryTasks",
  "rankProposedDiscoveryActions",
  "rankProposedCandidateActions",
  "projectResearchRewards"
];
const owners = [
  "evidence-record-contract.js",
  "evidence-normalization.js",
  "evidence-records.js",
  "evidence-verification.js",
  "evidence-admission.js",
  "evidence-queries.js"
];

describe('evidence public facade', () => {
  it('preserves every named and default export without exporting internal helpers', () => {
    expect(Object.keys(evidence).filter((name) => name !== 'default').sort()).toEqual(publicNames);
    expect(Object.keys(evidence.default)).toEqual(defaultNames);
    for (const name of defaultNames) expect(evidence.default[name]).toBe(evidence[name]);
    expect(evidence.projectAcceptedResearchMemory).toBe(admission.projectAcceptedResearchMemory);
    expect(evidence.validateResearchRecordLinks).toBe(admission.validateResearchRecordLinks);
  });

  it('keeps implementation owners acyclic and independent of the compatibility facade', async () => {
    const graph = new Map();
    for (const file of owners) {
      const source = await readFile(new URL('../../self/pool/' + file, import.meta.url), 'utf8');
      const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
      const imports = ast.body.filter((node) => node.type === 'ImportDeclaration').map((node) => node.source.value.replace(/^\.\//, ''));
      expect(imports).not.toContain('evidence-network.js');
      graph.set(file, imports.filter((name) => owners.includes(name)));
    }
    const visit = (file, stack = []) => {
      expect(stack, 'cycle at ' + file).not.toContain(file);
      for (const dependency of graph.get(file)) visit(dependency, [...stack, file]);
    };
    for (const file of owners) visit(file);
  });
});
