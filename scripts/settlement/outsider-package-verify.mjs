#!/usr/bin/env node
/**
 * The one command of an outside-verifier package (scripts/settlement/outsider-package.js writes the package and copies
 * this file into it as `verify.mjs`).
 *
 *   node verify.mjs                      check every receipt in this package with the verifier copied into it
 *   node verify.mjs --verifier REPLOID   the same, with the verifier from a Reploid checkout of your own instead
 *
 * Plain Node 22 or later, no npm packages, no keys and no network. It first checks that every file in the package is
 * the one listed in SHA256SUMS, then replays each receipt's signed settlement records and compares the result with the
 * one listed in expected.json. Exit 0 means every file is intact, every trade verifies, and every result is the
 * expected one.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const say = line => console.log(line);
const stopWith = (line, code = 1) => { say(line); process.exit(code); };

const major = Number(process.versions.node.split('.')[0]);
if (major < 22) stopWith(`This needs Node 22 or later; this computer has Node ${process.versions.node}. Install a newer Node from nodejs.org and run it again.`, 2);

const args = process.argv.slice(2);
const at = args.indexOf('--verifier');
const verifierRoot = at === -1 ? path.join(here, 'verifier') : path.resolve(args[at + 1] ?? '');

// 1. Every file is the one the package lists.
const sums = readFileSync(path.join(here, 'SHA256SUMS'), 'utf8').trim().split('\n').map(line => line.match(/^([0-9a-f]{64}) {2}(.+)$/));
if (sums.some(row => !row)) stopWith('SHA256SUMS is damaged; ask for a fresh copy of the package.');
const changed = sums.filter(([, digest, file]) => {
  try { return createHash('sha256').update(readFileSync(path.join(here, file))).digest('hex') !== digest; } catch { return true; }
}).map(([, , file]) => file);
if (changed.length) stopWith(`These package files are missing or changed: ${changed.join(', ')}. Ask for a fresh copy of the package.`);
say(`Step 1 of 2: all ${sums.length} package files are intact.`);

// 2. Each receipt, replayed from its signed records, against the expected result.
const { readTrade, verifyTrade } = await import(pathToFileURL(path.join(verifierRoot, 'scripts/settlement/verify-trade.js')).href);
const expected = JSON.parse(readFileSync(path.join(here, 'expected.json'), 'utf8'));
say(`Step 2 of 2: replaying ${expected.receipts.length} receipts with the verifier in ${at === -1 ? 'this package' : verifierRoot}.`);
let good = 0;
for (const item of expected.receipts) {
  const verdict = await verifyTrade({ ...readTrade(path.join(here, 'receipts', item.id)) });
  say('');
  say(`${item.label}`);
  for (const row of verdict.attempts) {
    const f = row.facts;
    say(`  ${row.ok ? 'PASS' : 'FAIL'} ${row.name}: ${f.status ?? '-'}, requester charged ${f.debit ?? '-'}, paid ${JSON.stringify(f.payouts ?? {})}`);
    if (f.accounts) say(`    accounts, each signed by its own party: requester ${f.accounts.requester}; stages ${f.accounts.stages.join(', ')}`);
    if (f.ownAccountStages?.length) say(`    note: ${f.ownAccountStages.length} stage(s) on the requester's own account, neither charged nor paid; no signed record confirms that grouping`);
    for (const problem of row.problems) say(`    problem: ${problem}`);
  }
  const same = verdict.ok === item.ok && JSON.stringify(verdict.attempts) === JSON.stringify(item.attempts);
  say(`  ${verdict.ok ? 'The trade verifies' : 'The trade does NOT verify'}, and the result ${same ? 'is the expected one' : 'DIFFERS from the expected one'}.`);
  if (same) good += 1;
}
say('');
if (good === expected.receipts.length) stopWith(`RESULT: all ${good} receipts give the expected result.`, 0);
stopWith(`RESULT: ${expected.receipts.length - good} of ${expected.receipts.length} receipts did not give the expected result. Please send this whole output back.`);
