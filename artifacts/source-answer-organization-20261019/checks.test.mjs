import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkAnswer, buildMessages } from './checks.mjs';
const item = { id: 'selection', sources: ['Reed is animated and 84 minutes.'], query: 'Name only, with a citation.',
  answerable: true, facts: ['Reed'], forbidden: ['Stone'], citationNumbers: [1], formatPattern: '^Reed\\s*\\[1\\]\\.?$' };
const result = content => ({ content, completion: { stopReason: 'stop-token' } });
test('abstaining on an answerable case cannot pass content or overall checks', () => {
  const checks = checkAnswer(item, result('The retrieved sources do not answer it.'));
  assert.equal(checks.abstained, true);
  assert.equal(checks.abstention, false);
  assert.equal(checks.facts, false);
  assert.equal(checks.passed, false);
});
test('right name with wrong citation or excess prose fails distinct dimensions', () => {
  const wrong = checkAnswer(item, result('Reed [2]'));
  assert.equal(wrong.facts, true);
  assert.equal(wrong.citationCheck, false);
  const prose = checkAnswer(item, result('Reed is animated and 84 minutes [1].'));
  assert.equal(prose.facts, true);
  assert.equal(prose.citationCheck, true);
  assert.equal(prose.requestedFormat, false);
  assert.equal(prose.passed, false);
  assert.equal(checkAnswer(item, result('Reed [1]')).passed, true);
});
test('empty or truncated responses never qualify; unknowns require abstention', () => {
  assert.equal(checkAnswer(item, result('')).passed, false);
  assert.equal(checkAnswer(item, { ...result('Reed [1]'), completion: { stopReason: 'max-tokens' } }).passed, false);
  const unknown = { ...item, answerable: false, facts: [], citationNumbers: [], formatPattern: null };
  assert.equal(checkAnswer(unknown, result('Netflix')).passed, false);
  assert.equal(checkAnswer(unknown, result('The retrieved sources do not answer it.')).passed, true);
});
test('organization changes retain exact source bytes and question without filtering', () => {
  const contract = { baselineInstructions: 'Baseline', candidateInstructions: 'Candidate' };
  const baseline = buildMessages(contract, item, 'baseline');
  const candidate = buildMessages(contract, item, 'candidate');
  assert.equal(baseline[0].content, `Baseline\n\n${candidate[1].content}`);
  assert(candidate[1].content.includes(item.sources[0]));
  assert(candidate[1].content.endsWith(item.query));
});
