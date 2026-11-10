/** Read-only discovery and reward projections over admitted evidence. Owners live in evidence/. */
export {
  buildModelEvidenceView,
  buildPredictionDisagreementMap,
  buildQuestionLifecycles,
  projectResearchResolutionCriteria
} from './evidence/question-projections.js';
export {
  buildEvidenceGraph,
  searchEvidence
} from './evidence/graph.js';
export {
  clusterCompatibleResults,
  cosineSimilarity,
  embeddingsAreCompatible,
  findSimilarSequences
} from './evidence/similarity.js';
export {
  projectCrossRoomSequenceEvidence
} from './evidence/cross-room-projection.js';
export {
  proposeDiscoveryTasks,
  rankProposedCandidateActions,
  rankProposedDiscoveryActions
} from './evidence/discovery-tasks.js';
export {
  projectResearchRewards
} from './evidence/research-rewards.js';
