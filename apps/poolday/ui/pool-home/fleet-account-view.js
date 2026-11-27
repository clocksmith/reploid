

const plural = (count, word) => `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;
const credits = count => plural(count, 'credit');

/** The account line: balance first, then what is held and what can be spent now including starter credit. */
export function fleetAccountText(view) {
  const row = view?.credits;
  if (!row) return '';
  const parts = [`Balance ${credits(row.balance)}`];
  if (row.held) parts.push(`${credits(row.held)} held for unfinished answers`);
  parts.push(`${credits(Math.max(0, row.spendable))} can be spent now`);
  return parts.join(' · ');
}

export function fleetStarterText(view) {
  const limit = view?.credits?.debtLimit ?? 0;
  return limit > 0
    ? `Starter credit: your balance may go down to −${limit.toLocaleString()} before you have earned anything. Serving answers for others pays it back.`
    : 'No starter credit: this sign-in is not verified. Serve answers for others to earn credits first, or sign in with Google.';
}
