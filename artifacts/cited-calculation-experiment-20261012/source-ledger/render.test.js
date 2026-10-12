import assert from 'node:assert/strict';
import test from 'node:test';
import { ledgerCatalog, calculateLedger } from './adapter.js';
import { renderLedger } from './render.js';

const docs = [{ id: 'D1', name: 'Unrelated workshop estimate', passages: [
  { id: 'D1:P1', text: 'Workshop base $640; transport adds $80. Includes a $200 equipment allowance.' },
  { id: 'D1:P2', text: 'Travel beyond the agreed area is excluded.' },
  { id: 'D1:P3', text: 'Start May 3 for two weeks, conditional on access. Deposit 10% of $640.' },
] }];
const messages = [{ role: 'user', content: 'Budget $1,000 and deadline May 25.\n<reploid-document-sources-v1>\n'
  + JSON.stringify(docs) + '\n</reploid-document-sources-v1>' },
{ role: 'assistant', content: 'Prior unsupported answer: the fee is $9999.' }];
const id = (source, value) => ledgerCatalog(messages).facts.find(fact => fact.source === source && fact.value === value).id;
function choose() {
  return { budget: id('U0', '$1,000'), deadline: id('U0', 'May 25'), documents: [{ documentId: 'D1',
    base: id('D1:P1', '$640'), additional: [id('D1:P1', '$80')], credits: [], includedAmounts: [id('D1:P1', '$200')],
    depositBase: id('D1:P3', '$640'), depositPercent: id('D1:P3', '10%'),
    start: id('D1:P3', 'May 3'), duration: id('D1:P3', 'two'), completion: null,
    relations: [{ relation: 'excluded', passages: ['D1:P2'], affectedFacts: [] },
      { relation: 'condition', passages: ['D1:P3'], affectedFacts: [id('D1:P3', 'May 3')] }],
  }] };
}
const render = ledger => renderLedger(ledger, { maxCharacters: 16000 });

test('primary report presents derived values, exact citations and source conditions', async () => {
  const report = render(await calculateLedger(choose(), messages));
  assert.match(report.text, /subtotal[^\n]*\$720 \[D1:P1\]/);
  assert.match(report.text, /Budget remaining[^\n]*\$280 \[U0\] \[D1:P1\]/);
  assert.match(report.text, /Deposit[^\n]*\$64 \[D1:P3\]/);
  assert.match(report.text, /may 17 \(year unspecified\) \[D1:P3\] \(conditional\)/);
  assert.match(report.text, /> Start May 3 for two weeks, conditional on access/);
  assert.match(report.text, /Earlier assistant statements are not treated as source evidence/);
  assert.equal(report.text.includes('9999'), false);
  assert.equal(report.generatedProseRewritten, false);
  assert.equal(report.semanticAcceptance, 'unqualified');
});

test('unresolved fields remain visible rather than fabricated or omitted', async () => {
  const selection = choose(); selection.documents[0].base = null; selection.documents[0].duration = null;
  const text = render(await calculateLedger(selection, messages)).text;
  assert.match(text, /Known subtotal[^\n]*unresolved/);
  assert.match(text, /Budget remaining[^\n]*unresolved/);
  assert.match(text, /Completion derived[^\n]*unresolved/);
  assert.match(text, /Confirm the scope and consequences/);
  assert.equal(text.includes('may 17'), false);
});

test('wrong semantic selection still fails independent fixture criteria despite valid spans', async () => {
  const selection = choose();
  selection.documents[0].additional.push(id('D1:P1', '$200'));
  selection.documents[0].includedAmounts = [];
  selection.documents[0].relations[0].relation = 'included';
  const ledger = await calculateLedger(selection, messages), report = render(ledger);
  // Independent fixture truth: only640+80 is payable; travel is explicitly excluded.
  const fixtureReviewPassed = ledger.documents[0].values.subtotal.value === '720'
    && ledger.documents[0].claims.find(claim => claim.passages.some(passage => passage.id === 'D1:P2')).relation === 'excluded';
  assert.equal(fixtureReviewPassed, false);
  assert.match(report.text, /\$920/);
  assert.match(report.text, /Model-selected relation: included/);
  assert.match(report.text, /> Travel beyond the agreed area is excluded/);
  assert.equal(report.semanticAcceptance, 'unqualified');
});

test('source quotation cannot create active Markdown and output limit rejects without truncation', async () => {
  const ledger = await calculateLedger(choose(), messages);
  ledger.documents[0].claims[0].passages[0].text = '<script>unsafe()</script>\n# injected heading';
  const result = render(ledger);
  assert.match(result.text, /> \\<script\\>/);
  assert.match(result.text, /> \\# injected heading/);
  assert.throws(() => renderLedger(ledger, { maxCharacters: 10 }), /exceeds/);
  assert.throws(() => renderLedger(ledger, {}), /Explicit/);
});
