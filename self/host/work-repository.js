import { normalizeWorkInputs } from './work-inputs.js';
const copy = value => JSON.parse(JSON.stringify(value));
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };

export function createWorkRepository({ storage, locks, policy }) {
  const read = () => {
    const raw = storage.getItem(policy.storageKey);
    if (!raw) return [];
    requireValue(new TextEncoder().encode(raw).byteLength <= policy.maxHistoryBytes, 'Saved work exceeds its storage limit');
    const value = JSON.parse(raw);
    requireValue(value.schema === policy.storageSchema && Array.isArray(value.attempts)
      && value.attempts.length <= policy.maxSavedAttempts, 'Saved work has an unsupported format');
    const ids = new Set();
    for (const row of value.attempts) {
      requireValue(row && typeof row.id === 'string' && !ids.has(row.id)
        && typeof row.goal === 'string' && row.goal.length <= policy.maxGoalCharacters
        && typeof row.output === 'string' && row.output.length <= policy.maxOutcomeCharacters
        && typeof row.modelId === 'string' && Number.isSafeInteger(row.revision),
      'Saved work contains an invalid attempt');
      if (row.criteria !== undefined) requireValue(typeof row.criteria === 'string'
        && row.criteria.length <= policy.maxCriteriaCharacters, 'Saved success criteria are invalid');
      if (row.inputs !== undefined) normalizeWorkInputs(row.inputs);
      if (row.artifacts !== undefined) {
        requireValue(Array.isArray(row.artifacts) && row.artifacts.length <= policy.files.maxArtifacts
          && row.artifacts.every(item => item && typeof item.id === 'string' && typeof item.name === 'string'
            && typeof item.text === 'string' && new TextEncoder().encode(item.text).byteLength <= policy.files.maxArtifactBytes),
        'Saved result files are invalid');
      }
      ids.add(row.id);
    }
    return value.attempts;
  };
  const save = async row => {
    requireValue(typeof locks?.request === 'function', 'Safe work retention requires browser Web Locks');
    try {
      return await locks.request(policy.storageKey, async () => {
        const current = read();
        const index = current.findIndex(item => item.id === row.id);
        requireValue(index < 0 || current[index].revision === row.revision,
          'This saved attempt changed in another tab. Reload before editing it.');
        requireValue(index >= 0 || current.length < policy.maxSavedAttempts,
          'Work history is full. Existing attempts were preserved; export them before starting more work.');
        const next = copy({ ...row, revision: (row.revision ?? 0) + 1,
          persistence: { state: 'committed', error: null } });
        if (index < 0) current.push(next); else current[index] = next;
        const serialized = JSON.stringify({ schema: policy.storageSchema, attempts: current });
        requireValue(new TextEncoder().encode(serialized).byteLength <= policy.maxHistoryBytes,
          'Saved work exceeds its storage limit');
        storage.setItem(policy.storageKey, serialized);
        row.revision = next.revision;
        row.persistence = next.persistence;
        return current;
      });
    } catch (error) {
      row.persistence = { state: 'uncommitted', error: String(error.message || error) };
      throw error;
    }
  };
  return Object.freeze({ read, save });
}
