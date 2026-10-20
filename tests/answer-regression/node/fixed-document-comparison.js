// Fixed documents, one context delta, paired execution. Development evidence only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { renderSourceContext } from '../../../packages/reploid/src/retrieval/index.js';

export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

export function validateComparison(contract) {
  assert.equal(contract.schema, 'reploid.fixed-document-comparison/v1');
  assert.equal(contract.delta, 'move-source-instructions-to-system');
  assert.equal(contract.maxGenerations, contract.cases.length * 2);
  assert(Number.isSafeInteger(contract.maxOutputTokens) && contract.maxOutputTokens > 0);
  assert(Number.isSafeInteger(contract.perRequestTimeoutMs) && contract.perRequestTimeoutMs > 0);
  assert(typeof contract.systemContext === 'string');
  assert.equal(new Set(contract.cases.map(item => item.id)).size, contract.cases.length);
  assert(contract.cases.length > 0);
  for (const item of contract.cases) {
    assert(item.id && item.query && item.sources.length > 0);
    assert(item.sources.every(source => typeof source === 'string' && source.length));
    assert(typeof item.answerable === 'boolean');
    assert(item.requiredFacts.every(fact => typeof fact === 'string' && fact.length));
    assert(item.forbiddenFacts.every(fact => typeof fact === 'string' && fact.length));
    assert(item.requiredCitations.every(number => Number.isSafeInteger(number) && number > 0 && number <= item.sources.length));
    assert(['free', 'name-only'].includes(item.format));
    if (item.format === 'name-only') assert(typeof item.expectedName === 'string' && item.expectedName.length);
  }
  return contract;
}

export function comparisonMessages(contract, item, policy, arm) {
  assert(['baseline', 'candidate'].includes(arm));
  const sources = item.sources.map((passage, index) => ({ number: index + 1, passage,
    title: `Fixture ${index + 1}`, url: `https://source.example.test/${item.id}/${index + 1}` }));
  const context = renderSourceContext(sources, policy);
  const question = `${policy.context.questionLabel} ${item.query}`;
  const system = contract.systemContext;
  if (arm === 'baseline') return [...(system ? [{ role: 'system', content: system }] : []),
    { role: 'user', content: `${context}\n\n${question}` }];
  // Move only the instruction prefix. Preserve source bytes, numbering and question order.
  assert(context.startsWith(policy.context.instructions));
  return [{ role: 'system', content: [system, policy.context.instructions].filter(Boolean).join('\n\n') },
    { role: 'user', content: `${context.slice(policy.context.instructions.length).trimStart()}\n\n${question}` }];
}

export function inspectAnswer(item, result) {
  const content = result.content ?? '', text = content.toLowerCase();
  const cited = [...content.matchAll(/\[(\d+)\]/g)].map(match => Number(match[1]));
  const abstained = /(?:sources? (?:do|does) not answer|not (?:provided|supplied|specified|recorded)|cannot (?:answer|determine))/i.test(content);
  const answer = content.replace(/\[\d+\]/g, '').trim();
  return {
    // String matching is not semantic review. Never report these as factual or citation support acceptance.
    factIndicators: item.requiredFacts.every(fact => text.includes(fact.toLowerCase()))
      && item.forbiddenFacts.every(fact => !text.includes(fact.toLowerCase())),
    citationMarkers: cited.every(number => number > 0 && number <= item.sources.length)
      && item.requiredCitations.every(number => cited.includes(number)),
    requestedFormat: item.format === 'name-only' ? answer === item.expectedName : null,
    naturalStop: result.completion?.stopReason === 'stop-token',
    abstentionIndicator: abstained,
    supportedQuestionAbstention: item.answerable && abstained,
    factualCorrectness: null,
    citationSupport: null,
    reviewRequired: true,
  };
}

export async function compareDocuments({ contract, policy, generate, save, identity }) {
  validateComparison(contract);
  // Freeze copies before calling external ports: neither arm can mutate the next arm's inputs.
  contract = structuredClone(contract); policy = structuredClone(policy);
  const receipt = { schema: contract.schema, scope: 'development; no independent acceptance',
    contract, policy, identity, contractHash: digest(contract), policyHash: digest(policy),
    rows: [], completed: false, qualified: false };
  const persist = () => save(structuredClone(receipt));
  await persist();
  for (const [index, item] of contract.cases.entries()) {
    for (const arm of index % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
      const messages = comparisonMessages(contract, item, policy, arm);
      const row = { id: item.id, arm, answerable: item.answerable,
        documentsHash: digest(item.sources), questionHash: digest(item.query),
        messages, messagesHash: digest(messages), result: null, error: null };
      const started = performance.now();
      try {
        row.result = structuredClone(await generate(structuredClone(messages), {
          signal: AbortSignal.timeout(contract.perRequestTimeoutMs), maxOutputTokens: contract.maxOutputTokens,
        }));
        row.checks = inspectAnswer(item, row.result);
      } catch (error) { row.error = { name: error.name, message: error.message }; }
      row.totalMs = performance.now() - started;
      receipt.rows.push(row);
      await persist();
      // A runtime failure ends the bounded experiment; never overlap an unsettled request with another arm.
      if (row.error) return receipt;
    }
  }
  receipt.completed = true;
  receipt.summary = Object.fromEntries(['baseline', 'candidate'].map(arm => {
    const rows = receipt.rows.filter(row => row.arm === arm);
    return [arm, { total: rows.length, answerable: rows.filter(row => row.answerable).length,
      factIndicators: rows.filter(row => row.checks.factIndicators).length,
      citationMarkers: rows.filter(row => row.checks.citationMarkers).length,
      supportedQuestionAbstentions: rows.filter(row => row.checks.supportedQuestionAbstention).length,
      unansweredQuestionAbstentions: rows.filter(row => !row.answerable && row.checks.abstentionIndicator).length,
      naturalStops: rows.filter(row => row.checks.naturalStop).length,
      factualCorrectness: null, citationSupport: null, reviewRequired: true }];
  }));
  await persist();
  return receipt;
}
