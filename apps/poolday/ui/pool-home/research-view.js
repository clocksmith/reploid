/**
 * @fileoverview Stable entry for evidence-network rendering and human review controls.
 * Rendering, binding, review claims, lifecycle records and Room-1 actions live in
 * their own modules in this folder.
 */
import { renderResearchWorkspace } from './research-workspace-render.js';
import { bindResearchWorkspace, hydrateAndBindResearchWorkspace } from './research-workspace-binding.js';
import { bindResearchRoomActions } from './research-room-actions.js';

export { renderResearchWorkspace, bindResearchWorkspace, hydrateAndBindResearchWorkspace, bindResearchRoomActions };
export { createContextualReviewRecord } from './research-review-records.js';
export { createLifecycleRecordFromForm } from './research-lifecycle-records.js';
export { createCurrentRoomPriorEvidence } from './research-room-actions.js';

export default { renderResearchWorkspace, bindResearchWorkspace, bindResearchRoomActions, hydrateAndBindResearchWorkspace };
