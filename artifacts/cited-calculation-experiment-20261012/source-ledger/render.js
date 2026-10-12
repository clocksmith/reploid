const need = (ok, message) => { if (!ok) throw Error(message); };
const escape = text => String(text).replace(/[\\`*_{}\[\]<>#|]/g, '\\$&');
const cite = sources => [...new Set(sources)].map(source => `[${source}]`).join(' ');
const label = value => value.kind === 'money' ? `$${value.value.replace(/^\$/, '')}` : value.value;

/** Primary evidence report, not correction or rewriting of generated prose. */
export function renderLedger(ledger, { maxCharacters }) {
  need(Number.isSafeInteger(maxCharacters) && maxCharacters > 0, 'Explicit positive output character bound required');
  need(ledger?.semanticAcceptance === 'unqualified' && Array.isArray(ledger.sourceFacts)
    && Array.isArray(ledger.documents), 'Expected calculated source ledger');
  const facts = new Map(ledger.sourceFacts.map(fact => [fact.id, fact]));
  const lines = ['Source-based comparison', '',
    'Interpretations are model-selected and remain unverified. Quoted evidence and exact calculations are shown separately.'];
  if (ledger.priorAssistantClaimsPresent) lines.push('Earlier assistant statements are not treated as source evidence.');
  lines.push('', `Requested budget: ${ledger.budget ? `${label(ledger.budget)} ${cite([ledger.budget.source])}` : 'unresolved'}.`,
    `Requested deadline: ${ledger.deadline ? `${label(ledger.deadline)} ${cite([ledger.deadline.source])}` : 'unresolved'}.`);
  const quote = passage => {
    lines.push(`${cite([passage.id])}`);
    for (const line of passage.text.split('\n')) lines.push(`> ${escape(line)}`);
  };
  const value = (title, result) => {
    if (!result) { lines.push(`${title}: unresolved.`); return; }
    lines.push(`${title}: ${label(result)} ${cite(result.sources)}${result.conditional ? ' (conditional)' : ''}.`);
    for (const condition of result.conditions ?? []) {
      lines.push('Applies only subject to the selected source condition:');
      for (const passage of condition.passages) quote(passage);
    }
  };
  for (const document of ledger.documents) {
    lines.push('', `${escape(document.name)} (${document.documentId})`);
    value('Known subtotal before unpriced exclusions or future conditional charges', document.values.subtotal);
    value('Budget remaining before unpriced exclusions or future conditional charges', document.values.headroom);
    lines.push('All-in total: unresolved. Unpriced exclusions and future conditional charges are not inferred.');
    value('Deposit, part of the price rather than an extra charge', document.values.deposit);
    for (const id of document.selection.includedAmounts) {
      const fact = facts.get(id); need(fact, 'Missing admitted included-amount fact');
      lines.push(`Selected included amount, not added again: ${label(fact)} ${cite([fact.source])}.`);
    }
    value('Stated completion', document.values.statedCompletion);
    value('Completion derived from selected start and duration', document.values.derivedCompletion);
    lines.push('No unconditional deadline guarantee is established by these selected values.');
    for (const claim of document.claims) {
      lines.push(`Model-selected relation: ${claim.relation}.`);
      for (const passage of claim.passages) quote(passage);
      if (['excluded', 'condition', 'conflict', 'unknown'].includes(claim.relation)) {
        lines.push('Confirm the scope and consequences of the quoted passage before relying on the price or schedule.');
      }
    }
    for (const missing of document.unresolved) lines.push(`Unresolved: ${missing}`);
  }
  lines.push('', 'No unconditional recommendation is established. Resolve the listed exclusions, conditions and conflicts before choosing.');
  const text = lines.join('\n');
  need(text.length <= maxCharacters, 'Rendered report exceeds character bound; no truncation');
  return { text, characters: text.length, kind: 'primary-source-ledger-report',
    semanticAcceptance: 'unqualified', generatedProseRewritten: false };
}
