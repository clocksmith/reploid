/** Review, correction, revocation, link validation, and reusable memory admission. Owners live in evidence/. */
export {
  activeResearchRecords,
  invalidatedResearchHashes,
  projectResearchReviewStates,
  researchRecordTargetHashes,
  revokedResearchHashes,
  validateResearchRecordModelAdmission
} from './evidence/review-state.js';
export {
  projectAcceptedResearchMemory
} from './evidence/accepted-memory.js';
export {
  validateCrossRoomReuseOrigin,
  validateResearchRecordLinks
} from './evidence/link-validation.js';
