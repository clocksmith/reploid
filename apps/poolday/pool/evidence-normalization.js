/** Canonical record field normalization; no publication or admission authority. Owners live in evidence/. */
export {
  normalizeHashList,
  normalizeTextList,
  requireHash,
  requiredInteger
} from './evidence/primitives.js';
export {
  normalizeConsent,
  normalizeModelContract,
  normalizeVerifiedReceiptEvidence
} from './evidence/compute-normalization.js';
export {
  createCrossRoomReuseContext,
  crossRoomSourceIdentityKey,
  normalizeContextualReuseReview,
  normalizeCrossRoomReuseContext
} from './evidence/cross-room-normalization.js';
export {
  normalizeDiscoveryCheckpoint,
  normalizeTaskApprovalContract,
  projectDiscoveryTaskContract
} from './evidence/discovery-normalization.js';
export {
  conditionsHaveContent,
  normalizeAnalysisIdentity,
  normalizeAssayProtocol,
  normalizeConditions,
  normalizeProteinAnnotationIdentity,
  normalizePublicProteinEvidenceProfile,
  normalizeReferenceIdentity,
  normalizeTransformations,
  normalizeUncertainty
} from './evidence/scientific-normalization.js';
export {
  adjudicationMetricResult,
  assessAdjudicationExperiment,
  normalizeAdjudicationExperimentContract
} from './evidence/adjudication-normalization.js';
export {
  normalizeExperimentalExecutionContext,
  normalizeLaboratoryCapabilityClaim,
  normalizeResearchResolutionPolicy,
  normalizeResearchWorkOrderContract
} from './evidence/laboratory-normalization.js';
