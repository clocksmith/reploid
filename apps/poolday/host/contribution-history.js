/** Bounded device execution history, not delivery, reward or correctness acceptance. */
export const CONTRIBUTION_HISTORY_KEY = 'reploid.contribution-executions:v1';
const LIMIT = 200;
const valid = row => row && typeof row.id === 'string' && typeof row.modelId === 'string'
  && typeof row.modelIdentity === 'string' && Number.isSafeInteger(row.completedAt) && row.completedAt > 0
  && (row.outputTokens === null || Number.isSafeInteger(row.outputTokens) && row.outputTokens >= 0);

/** Project retained device records, not lifetime usage or financial settlement.
 * Count output tokens once per execution; never estimate tokens from text length.
 */
export function projectComputerUsage({ threads = [], network = {}, historyUnavailable = null } = {}) {
  const summary = rows => rows.reduce((total, row) => {
    total.requests++;
    if (Number.isSafeInteger(row.outputTokens) && row.outputTokens >= 0) total.outputTokens += row.outputTokens;
    else total.unmeasured++;
    return total;
  }, { outputTokens: 0, requests: 0, unmeasured: 0 });
  const attempts = new Map();
  for (const thread of threads) {
    const outputAttempts = new Set((thread.messages || []).filter(message => message.role === 'assistant' && message.content).map(message => message.attemptId));
    for (const attempt of thread.attempts || []) {
      if (!['completed', 'failed', 'cancelled', 'interrupted'].includes(attempt.status)) continue;
      const execution = attempt.execution;
      const count = execution?.completion?.generatedTokenCount ?? execution?.timing?.generatedTokenCount
        ?? execution?.usage?.outputTokens
        ?? (Number.isFinite(execution?.serviceCredit?.settledAt) ? execution.serviceCredit.outputTokens : undefined);
      // An interrupted stream without a count is unknown; an attempt rejected before output is not usage.
      if (count === undefined && attempt.status !== 'completed' && !outputAttempts.has(attempt.id)) continue;
      attempts.set(`${thread.id}:${attempt.id}`, { outputTokens: count });
    }
  }
  const history = network.contributionHistory;
  return {
    supplied: { ...summary(history?.records || []), limit: history?.limit ?? LIMIT, available: !!history },
    consumed: { ...summary([...attempts.values()]), available: !historyUnavailable },
    error: [history?.error, historyUnavailable].filter(Boolean).join('. ') || null
  };
}

export function createContributionHistory({ storage, now = Date.now, id = () => crypto.randomUUID() } = {}) {
  let records = [], error = null;
  const read = () => {
    try {
      const saved = JSON.parse(storage?.getItem(CONTRIBUTION_HISTORY_KEY) || 'null');
      if (saved && (saved.schema !== 'reploid.contribution-executions/v1' || !Array.isArray(saved.records)
        || !saved.records.every(valid))) throw Error('Invalid contribution history');
      return (saved?.records || []).map(row => ({ id: row.id, completedAt: row.completedAt,
        modelId: row.modelId, modelIdentity: row.modelIdentity, outputTokens: row.outputTokens }))
        .sort((a, b) => b.completedAt - a.completedAt).slice(0, LIMIT);
    } catch { error = 'Contribution history could not be read'; return []; }
  };
  records = read();
  return Object.freeze({
    record(completion) {
      const row = { id: id(), completedAt: now(), modelId: completion.modelId,
        modelIdentity: completion.modelIdentity, outputTokens: completion.outputTokens ?? null };
      if (!valid(row)) throw Error('Invalid completed contribution');
      // Merge on write so another tab's recent records are retained where possible.
      records = [...new Map([row, ...read(), ...records].map(item => [item.id, item])).values()]
        .sort((a, b) => b.completedAt - a.completedAt).slice(0, LIMIT);
      try {
        if (!storage?.setItem) throw Error('Storage unavailable');
        storage.setItem(CONTRIBUTION_HISTORY_KEY, JSON.stringify({ schema: 'reploid.contribution-executions/v1', records }));
        error = null;
      } catch { error = 'Contribution history could not be saved'; }
    },
    getState() { return { records: structuredClone(records), error, limit: LIMIT }; }
  });
}
