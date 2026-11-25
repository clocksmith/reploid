/**
 * Plain-language service-credit wording for one answer and for an account's statement.
 * Presentation only: every number comes from the ledger's own outcome or journal entry,
 * and nothing here decides a charge. Credits are non-cash; no text implies cash value.
 */
const plural = (count, word) => `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;
const credits = count => plural(count, 'credit');

/** What one answer's service-credit record means, as the person reading the answer needs it. */
export function serviceCreditOutcomeText(credit) {
  if (!credit || typeof credit !== 'object') return '';
  const status = credit.status;
  if (status === 'abandoned' || status === 'cancelled_queued') return 'Not sent · nothing charged';
  if (typeof credit.settledAt !== 'number') {
    return Number.isSafeInteger(credit.heldCredits) && credit.heldCredits > 0
      ? `Pending · ${credits(credit.heldCredits)} held until the computer reports back`
      : 'Pending · outcome not yet settled';
  }
  const charge = Number.isSafeInteger(credit.charge) ? credit.charge : 0;
  if (status === 'expired') return 'Hold released · the computer never reported back, nothing charged';
  if (status === 'cancelled') return `Stopped · ${charge ? `${credits(charge)} charged` : 'nothing charged'}`;
  if (status === 'failed') {
    return credit.reason === 'interrupted-stage-owner' ? 'A computer stopped mid-answer · nothing charged'
      : `Answer failed · ${charge ? `${credits(charge)} charged` : 'nothing charged'}`;
  }
  // A dispatched request that no computer admitted settles at zero without a status.
  if (charge === 0) return 'Nothing charged';
  return `${credits(charge)} charged${Number.isSafeInteger(credit.outputTokens) ? ` for ${plural(credit.outputTokens, 'output token')}` : ''}`;
}

/** The paying account from a ledger snapshot: the requester's own computer account, separate from the others. */
export function creditAccounts(snapshot, ownId) {
  const rows = Array.isArray(snapshot?.accounts) ? snapshot.accounts : [];
  const own = rows.find(row => row.id === ownId) ?? null;
  return { own, others: rows.filter(row => row !== own) };
}

export function accountText(row) {
  if (!row) return 'No account reported';
  const available = Number.isSafeInteger(row.available) ? row.available : row.balance - (row.held || 0);
  return `${credits(row.balance)}${row.held ? ` · ${credits(row.held)} held for unfinished answers` : ''}${available !== row.balance ? ` · ${credits(available)} available` : ''}`;
}

/**
 * Recent statement entries, newest first: what this account earned by serving and spent by asking,
 * plus holds that were released unclaimed. Model names come from the paired host's catalog when known.
 */
export function creditActivity(statement, { modelName = id => id, limit = 8 } = {}) {
  if (!statement || !Array.isArray(statement.entries)) return [];
  const rows = statement.entries.map(entry => {
    const outcome = entry.outcome || {}, model = modelName(entry.request?.model?.id) || 'a model';
    const tokens = Number.isSafeInteger(outcome.outputTokens) ? ` · ${plural(outcome.outputTokens, 'output token')}` : '';
    const label = entry.delta > 0 ? `Earned ${credits(entry.delta)} serving ${model}` : `Spent ${credits(-entry.delta)} asking ${model}`;
    return { at: entry.at, requestId: entry.requestId, delta: entry.delta, text: label + tokens };
  });
  for (const row of statement.expired || []) {
    rows.push({ at: row.outcome?.settledAt ?? row.request?.createdAt ?? 0, requestId: row.requestId, delta: 0,
      text: `Hold released unclaimed for ${modelName(row.request?.model?.id) || 'a model'} · nothing charged` });
  }
  return rows.sort((a, b) => b.at - a.at).slice(0, limit);
}
