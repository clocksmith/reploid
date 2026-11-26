#!/usr/bin/env node
/**
 * Prints, for every attempt in a records-only package, the numbers its amounts are worked out from, read straight from
 * the signed records (scripts/settlement/outsider-package.js --records-only copies this file into the package as
 * `inputs.mjs`).
 *
 *   node inputs.mjs            every trade in this package
 *   node inputs.mjs TRADE_ID   one trade
 *
 * It uses no verifier and checks no signature and no time window: it is for doing the arithmetic yourself, with the
 * rules in SPECIFICATION.md ("Deciding an outcome", "Split arithmetic"). `node verify.mjs` is the check.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const wanted = process.argv[2] ?? null;
const ids = readdirSync(path.join(here, 'trades')).sort().filter(id => !wanted || id === wanted);
if (!ids.length) { console.log(`No trade named ${wanted} in this package. The trades are: ${readdirSync(path.join(here, 'trades')).sort().join(', ')}.`); process.exit(2); }
const kind = (record, name) => record.schema === `reploid.${name}/v1`;
for (const id of ids) {
  const trade = JSON.parse(readFileSync(path.join(here, 'trades', id, 'trade.json'), 'utf8'));
  console.log(`${id}: ${trade.label}`);
  for (const attempt of trade.attempts) {
    const records = attempt.records, terms = records.find(record => kind(record, 'settlement-terms'));
    const last = terms.shares.length - 1, receipts = records.filter(record => kind(record, 'stage-receipt'));
    // The acknowledged count: the highest count the requester acknowledged with the chain value the final stage signed for it.
    const committed = new Set(receipts.filter(record => record.partitionIndex === last && record.output).map(record => `${record.output.count} ${record.output.chain}`));
    const acknowledged = Math.max(0, ...records.filter(record => kind(record, 'output-acknowledgment') && committed.has(`${record.count} ${record.chain}`)).map(record => record.count));
    const closed = [...new Set(receipts.filter(record => record.status === 'settled' || record.status === 'failed').map(record => record.partitionIndex))].sort((a, b) => a - b);
    const faults = [...new Set(records.filter(record => kind(record, 'settlement-stage-fault')).map(record => record.partitionIndex))].sort((a, b) => a - b);
    const accounts = records.filter(record => kind(record, 'settlement-acceptance') && record.payoutAccount).sort((a, b) => a.partitionIndex - b.partitionIndex)
      .map(record => `${record.partitionIndex}:${record.payoutAccount}`);
    const stated = attempt.statement ?? attempt.stated;
    console.log(`  ${attempt.name}`);
    console.log(`    signed by the requester: ${terms.creditsPerOutputToken} credit(s) per output, at most ${terms.maxOutputTokens} outputs, maximum ${terms.maximum}; weights ${terms.shares.map(share => share.weight).join(', ')}`
      + `${terms.debitAccount ? `; charged from ${terms.debitAccount}` : ''}`);
    console.log(`    unfinished-answer terms: ${terms.unfinishedTerms ?? 'none'}`);
    if (accounts.length) console.log(`    payout account signed by each stage: ${accounts.join(', ')}`);
    console.log(`    outputs acknowledged by the requester with the final stage's chain value: ${acknowledged}`);
    console.log(`    stages that signed a close: ${closed.join(', ') || 'none'} of ${terms.shares.map(share => share.partitionIndex).join(', ')}; stages that signed a fault: ${faults.join(', ') || 'none'}`
      + `; requester's signed stop: ${records.some(record => kind(record, 'settlement-stop')) ? 'yes' : 'no'}`);
    console.log(`    stated by ${attempt.statement ? `the coordinator ${stated.coordinatorId} (signed)` : 'the publisher (not signed)'}: ${stated.status}, debit ${stated.debit}, payouts ${JSON.stringify(Object.fromEntries(stated.payouts.map(row => [row.account, row.amount])))}`
      + `, hold remaining ${stated.hold.remaining ?? 'not stated'}`);
  }
}
