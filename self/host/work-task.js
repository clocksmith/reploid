import { normalizeWorkInputs } from './work-inputs.js';
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
export function extractProposedCriteria(goal) {
  const text = typeof goal === 'string' ? goal.trim() : '';
  if (!text) return 'Produce the requested deliverable and verify file syntax and integrity without unverified execution.';
  const snippet = text.length > 96 ? text.slice(0, 93) + '...' : text;
  return `Deliver an outcome addressing: "${snippet}". Verify file syntax and integrity without unverified execution.`;
}


export function resolveWorkTask({ goal, criteria, feedback, parentId, inputs, allowPeers, recallAccepted }, { policy, records }) {
  requireValue(typeof goal === 'string' && goal.trim().length > 0 && goal.length <= policy.maxGoalCharacters, 'Tell Reploid what you want help with');
  requireValue(criteria == null || typeof criteria === 'string', 'Criteria must be text');
  if (criteria !== undefined && criteria !== null && typeof criteria === 'string' && criteria.trim()) {
    requireValue(criteria.trim().length <= policy.maxCriteriaCharacters, 'Describe how you will judge the result');
  }
  const resolvedCriteria = (typeof criteria === 'string' && criteria.trim())
    ? criteria.trim()
    : extractProposedCriteria(goal);
  requireValue(typeof feedback === 'string' && feedback.length <= policy.maxFeedbackCharacters, 'Revision feedback is too long');
  const parent = parentId ? records.find(item => item.id === parentId) : null;
  requireValue(!parentId || parent && feedback.trim(), 'A revision needs a saved parent and your feedback');
  requireValue(typeof allowPeers === 'boolean' && typeof recallAccepted === 'boolean', 'Task permissions must be explicit');
  const taskInputs = normalizeWorkInputs(inputs);
  return { parent: parent ? JSON.parse(JSON.stringify(parent)) : null, goal: goal.trim(), criteria: resolvedCriteria, feedback: feedback.trim(), inputs: taskInputs };
}
