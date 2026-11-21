import { createHash } from 'node:crypto';
import { canonicalize } from '../../packages/reploid/src/artifacts/canonical-json.js';
import { same } from './contract.js';

// A retired coordinator cannot prove a disappearing peer cleaned up. Its configured
// credit service can subsequently settle that exact attempt from signed evidence.
export function createStageHistory({ credits, participantId, notify, pollMs = 5000 }) {
  const confirmed = new Map();
  let pending = null, nextRead = 0;
  const key = row => row.identity?.attemptId;
  const matched = row => {
    const record = confirmed.get(key(row));
    return record && same(record.identity, row.identity) ? record : null;
  };
  const eligible = row => row.phase === 'cleanup-failed' && row.acknowledgments
    && row.identity?.route?.stages?.[0]?.participantId === participantId && !matched(row);

  async function read(rows) {
    // Keep at most the bounded history still exposed by this participant.
    const visible = new Set(rows.map(key));
    for (const id of confirmed.keys()) if (!visible.has(id)) confirmed.delete(id);
    let changed = false;
    for (const local of rows.filter(eligible)) {
      const binding = local.identity;
      const id = 'service:' + binding.requesterId + ':' + binding.attemptId;
      try {
        const result = await credits.call('request', { id });
        // This authenticated coordinator validates the signed stage/owner evidence
        // before it writes the terminal outcome. A balance or an expiry is insufficient.
        if (result?.state !== 'settled' || result.binding?.mode !== 'partition'
          || result.binding.id !== id || result.outcome?.id !== id
          || !Number.isFinite(result.outcome.settledAt) || !result.evidence
          || !same(result.binding.route, binding) || !same(result.evidence.identity, binding)) continue;
        const digest = createHash('sha256').update(canonicalize(result.evidence)).digest('hex');
        if (digest !== result.outcome.evidenceHash) continue;
        // Replaying an already-settled proof verifies every signature and owner fence on
        // the coordinator. A lost reply leaves the host unknown and is safe to retry.
        const checked = await credits.call('settle', { id, evidence: result.evidence });
        if (!same(checked, result.outcome)) continue;
        confirmed.set(key(local), { identity: binding, settledAt: result.outcome.settledAt, evidenceHash: digest });
        changed = true;
      } catch { /* Unreachable coordinator, unbilled attempt or invalid evidence stays unknown. */ }
    }
    return changed;
  }
  function refresh(state) {
    if (!credits) return Promise.resolve(false);
    if (!pending) {
      nextRead = Date.now() + pollMs;
      pending = read(state?.unknownAttempts || []).finally(() => { pending = null; });
    }
    return pending;
  }
  function view(state) {
    const rows = state?.unknownAttempts;
    if (!credits || !rows?.length) return state;
    if (!pending && Date.now() >= nextRead && rows.some(eligible)) {
      void refresh(state).then(changed => { if (changed) notify(); });
    }
    const recovered = rows.filter(matched);
    if (!recovered.length) return state;
    return { ...state, unknownAttempts: rows.filter(row => !matched(row)),
      creditReconciledAttempts: recovered.map(row => {
        const { settledAt, evidenceHash } = matched(row);
        return { ...row, creditSettlement: { settledAt, evidenceHash } };
      }) };
  }
  return { refresh, view };
}
