import { projectProduction } from './contribution-models.js';
import { renderConversationWorkspace, bindConversationWorkspace } from './conversation-workspace.js';

export { projectProduction };

/** Home and /network share one conversation workspace composition. */
export function renderProductionSurface(options = {}) {
  return renderConversationWorkspace(options);
}

export function bindProductionSurface(root, session, options = {}) {
  return bindConversationWorkspace(root, session, options);
}
