#!/usr/bin/env node
/**
 * The one command of a records-only outside-verifier package (scripts/settlement/outsider-package.js --records-only
 * writes the package and copies this file into it as `verify.mjs`).
 *
 *   node verify.mjs                      recompute every trade in this package with the verifier copied into it
 *   node verify.mjs --verifier REPLOID   the same, with the verifier from a Reploid checkout of your own instead
 *
 * Plain Node 22 or later, no npm packages, no keys and no network. It first checks that every file in the package is
 * the one listed in SHA256SUMS, then recomputes each attempt's debit and payouts from its signed records, compares
 * them with the publisher's stated amounts, and compares the whole result with the one listed in expected.json. Exit 0
 * means every file is intact, every stated amount follows from the signed records, and every result is the expected
 * one.
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
let sums;
try { sums = readFileSync(path.join(here, 'SHA256SUMS'), 'utf8').trim().split('\n').map(line => line.match(/^([0-9a-f]{64}) {2}(.+)$/)); }
catch { stopWith('SHA256SUMS is missing. Run this in the folder that holds README.md, or ask for a fresh copy of the package.'); }
if (sums.some(row => !row)) stopWith('SHA256SUMS is damaged; ask for a fresh copy of the package.');
const changed = sums.filter(([, digest, file]) => {
  try { return createHash('sha256').update(readFileSync(path.join(here, file))).digest('hex') !== digest; } catch { return true; }
}).map(([, , file]) => file);
if (changed.length) stopWith(`These package files are missing or changed: ${changed.join(', ')}. Ask for a fresh copy of the package.`);
say(`Step 1 of 2: all ${sums.length} package files are intact.`);

// 2. Each trade, recomputed from its signed records, against the stated amounts and the expected result.
let verifier;
try { verifier = await import(pathToFileURL(path.join(verifierRoot, 'scripts/settlement/verify-records.js')).href); }
catch (error) { stopWith(`The verifier in ${verifierRoot} could not be loaded: ${error.message}`); }
const { describeAttempt, readRecordsTrade, verifyRecords } = verifier;
const expected = JSON.parse(readFileSync(path.join(here, 'expected.json'), 'utf8'));
say(`Step 2 of 2: recomputing ${expected.trades.length} trades from their signed records with the verifier in ${at === -1 ? 'this package' : verifierRoot}.`);
let good = 0, attempts = 0, shown = 0;
for (const item of expected.trades) {
  const verdict = await verifyRecords({ trade: readRecordsTrade(path.join(here, 'trades', item.id)) });
  say('');
  say(item.label);
  if (item.simulated) say(`  ${item.simulated}`);
  for (const row of verdict.attempts) for (const line of describeAttempt(row)) say(`  ${line}`);
  for (const problem of verdict.problems ?? []) say(`  problem: ${problem}`);
  attempts += verdict.attempts.length;
  shown += verdict.holdReleaseShown ?? 0;
  const same = verdict.ok === item.ok && JSON.stringify(verdict.attempts) === JSON.stringify(item.attempts);
  say(`  ${verdict.ok ? 'The stated amounts follow from the signed records' : 'The stated amounts do NOT follow from the signed records'}, and the result ${same ? 'is the expected one' : 'DIFFERS from the expected one'}.`);
  if (same && verdict.ok) good += 1;
}
say('');
if (good !== expected.trades.length) {
  stopWith(`RESULT: ${expected.trades.length - good} of ${expected.trades.length} trades did not give the expected result. Please send this whole output back.`);
}
say(`RESULT: all ${good} trades give the expected result: every debit and payout was recomputed from signed records.`);
stopWith(`Hold release is shown by a coordinator-signed statement in ${shown} of ${attempts} attempts${shown < attempts ? '; in the others it rests on the publisher\'s unsigned word' : ''}.`, 0);
