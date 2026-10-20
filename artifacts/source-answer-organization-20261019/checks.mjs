// Closed-fixture checks are necessary gates, not a general factuality judge.
export function checkAnswer(item, result) {
  const text = result.content.trim();
  const lower = text.toLowerCase();
  const abstained = /^(?:the )?retrieved sources do not answer (?:it|the question)\.?$/i.test(text);
  const citations = [...text.matchAll(/\[(\d+)\]/g)].map(match => Number(match[1]));
  const exactCitationSet = item.citationNumbers.every(number => citations.includes(number))
    && citations.every(number => item.citationNumbers.includes(number));
  const facts = item.answerable
    ? !abstained && item.facts.every(fact => lower.includes(fact.toLowerCase()))
      && item.forbidden.every(fact => !lower.includes(fact.toLowerCase()))
    : null;
  const citationCheck = item.answerable ? exactCitationSet && citations.length > 0 : citations.length === 0;
  const requestedFormat = item.formatPattern ? new RegExp(item.formatPattern, 'i').test(text) : null;
  const abstention = item.answerable ? !abstained : abstained;
  const naturalStop = result.completion?.stopReason === 'stop-token';
  return { facts, citationCheck, requestedFormat, abstained, abstention, naturalStop,
    passed: [facts, citationCheck, requestedFormat, abstention, naturalStop].every(value => value !== false),
    manualSupportReviewRequired: true };
}

export function buildMessages(contract, item, arm) {
  const sources = item.sources.map((text, index) =>
    `[${index + 1}] Fixture ${index + 1}\nhttps://source.example.test/${item.id}/${index + 1}\n${text}`
  ).join('\n\n');
  const body = `Sources:\n\n${sources}\n\nQuestion: ${item.query}`;
  if (arm === 'baseline') return [{ role: 'user', content: `${contract.baselineInstructions}\n\n${body}` }];
  if (arm === 'candidate') return [{ role: 'system', content: contract.candidateInstructions }, { role: 'user', content: body }];
  throw new Error(`Unknown arm: ${arm}`);
}

export function summarize(contract, rows) {
  return Object.fromEntries(['baseline', 'candidate'].map(arm => {
    const selected = rows.filter(row => row.arm === arm);
    const answerable = selected.filter(row => contract.cases.find(item => item.id === row.id).answerable);
    const unknown = selected.filter(row => !contract.cases.find(item => item.id === row.id).answerable);
    return [arm, { completed: selected.length, expected: contract.cases.length,
      contentChecksPassed: answerable.filter(row => row.checks?.facts).length,
      answerableCount: contract.cases.filter(item => item.answerable).length,
      answeredSupportedCases: answerable.filter(row => row.checks?.facts && row.checks?.citationCheck).length,
      unsupportedAbstentions: answerable.filter(row => row.checks?.abstained).length,
      correctUnknownAbstentions: unknown.filter(row => row.checks?.abstention).length,
      citationChecksPassed: selected.filter(row => row.checks?.citationCheck).length,
      requestedFormatPassed: selected.filter(row => row.checks?.requestedFormat === true).length,
      requestedFormatCount: contract.cases.filter(item => item.formatPattern).length,
      completeChecksPassed: selected.filter(row => row.checks?.passed).length,
      failures: selected.filter(row => !row.checks?.passed).map(row => row.id) }];
  }));
}
