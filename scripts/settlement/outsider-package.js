#!/usr/bin/env node
/**
 * Builds a package an outside person can check trade receipts with, on their own computer, with Node alone
 * (docs/verify-a-trade.md): no clone, no npm, no keys, no network and no access to the coordinator's ledger.
 *
 *   node scripts/settlement/outsider-package.js --manifest MANIFEST.json --out NEW_DIRECTORY
 *
 * MANIFEST.json: `{ "title": "...", "receipts": [{ "id": "stage1", "label": "...", "directory": "/absolute/receipt/dir" }] }`.
 * Each receipt directory holds `receipt.json` and, when the receipt does not carry its policy, `policy.json`.
 *
 * The package holds:
 *   verifier/      verify-trade.js and every file it imports, at this checkout's commit, under their repository paths;
 *   receipts/ID/   each receipt.json (and policy.json) as given;
 *   expected.json  what this verifier gives for each receipt now (per attempt: verdict, facts and problems);
 *   verify.mjs     the one command (outsider-package-verify.mjs);
 *   README.md      plain instructions and the expected output;
 *   SHA256SUMS     every other file's digest, which verify.mjs checks first.
 * The verifier files must be committed and unchanged, so the package names the exact public commit they come from.
 *
 * That package hands over whole receipts: answer text, token IDs and the coordinator ledger's journal. With
 * `--records-only` it builds the package an outsider should get instead (buildRecordsPackage):
 *
 *   node scripts/settlement/outsider-package.js --records-only --manifest MANIFEST.json --out NEW_DIRECTORY
 *
 *   trades/ID/trade.json  each receipt as a records-only export (records-export.js): signed records and the publisher's
 *                         stated amounts, nothing else; plus, unless the manifest says `"simulated": false`, the simulated
 *                         v3 failure cases with the coordinator's signed statement;
 *   verifier/             verify-records.js and the second verifier it imports (independent/replay.js): Node built-ins
 *                         only, none of the service's ledger or replay code;
 *   SPECIFICATION.md      docs/settlement-replay.md, the wire specification, from the same commit;
 *   inputs.mjs            prints the numbers each amount is worked out from (outsider-records-inputs.mjs);
 *   expected.json, verify.mjs (outsider-records-verify.mjs), README.md and SHA256SUMS as above.
 * A manifest for it may list no receipts at all; the package then holds the simulated trades only.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { exportFailureCases, exportFromReceipt } from './records-export.js';
import { describeAttempt, verifyRecords } from './verify-records.js';
import { readTrade, verifyTrade } from './verify-trade.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENTRY = 'scripts/settlement/verify-trade.js';
const RECORDS_ENTRY = 'scripts/settlement/verify-records.js';
const SPECIFICATION = 'docs/settlement-replay.md';

/** verify-trade.js and its relative imports, transitively. Any import that is not relative or `node:` is refused. */
export function verifierFiles(root = repoRoot, entry = ENTRY) {
  const seen = new Set();
  const pattern = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s+['"]([^'"]+)['"]/gm;
  const visit = file => {
    if (seen.has(file)) return;
    seen.add(file);
    if (file.endsWith('.json')) return;
    for (const match of readFileSync(path.join(root, file), 'utf8').matchAll(pattern)) {
      const spec = match[1] ?? match[2] ?? match[3];
      if (spec.startsWith('node:')) continue;
      if (!spec.startsWith('.')) throw Error(`${file} imports ${spec}: the verifier must run with Node alone`);
      visit(path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)));
    }
  };
  visit(entry);
  return [...seen].sort();
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim();

function readme({ title, commit, receipts, expected, fileCount }) {
  const lines = item => [
    item.label,
    ...item.attempts.flatMap(row => [`  ${row.ok ? 'PASS' : 'FAIL'} ${row.name}: ${row.facts.status ?? '-'}, requester charged ${row.facts.debit ?? '-'}, paid ${JSON.stringify(row.facts.payouts ?? {})}`,
      ...(row.facts.accounts ? [`    accounts, each signed by its own party: requester ${row.facts.accounts.requester}; stages ${row.facts.accounts.stages.join(', ')}`] : []),
      ...(row.facts.ownAccountStages?.length ? [`    note: ${row.facts.ownAccountStages.length} stage(s) on the requester's own account, neither charged nor paid; no signed record confirms that grouping`] : [])]),
    `  ${item.ok ? 'The trade verifies' : 'The trade does NOT verify'}, and the result is the expected one.`];
  return `# ${title}

This folder lets you check, on your own computer, that the credits charged and paid in ${receipts.length} trades
follow from records the participants signed. You need nothing but Node.

## What you need

Node 22 or later. To see which you have, open a terminal and type \`node --version\`. If it is missing or older,
install the current version from https://nodejs.org and open a new terminal.

## The one command

Open a terminal in this folder and type:

\`\`\`
node verify.mjs
\`\`\`

It takes a few seconds, sends nothing anywhere, and changes nothing.

## What you should see

It first checks that no file in this folder was changed:

\`\`\`
Step 1 of 2: all ${fileCount} package files are intact.
\`\`\`

Then, for each receipt, one line per attempt (payouts are by signing key):

\`\`\`
${expected.receipts.map(item => lines(item).join('\n')).join('\n\n')}
\`\`\`

and finally:

\`\`\`
RESULT: all ${receipts.length} receipts give the expected result.
\`\`\`

Please send back the whole output, whatever it says, and the output of \`node --version\`.

## What a pass shows, and what it does not

A pass shows that the signed records in each receipt, checked by the keys they name, imply exactly the amounts the
coordinator's ledger recorded, under the public credit policy whose digest the requester signed. Two separately
written verifiers must agree on every attempt.

It does not show who owns a key, that the computation itself was correct, that nobody withheld a record, or when a
record was really signed. Where a receipt places stages on the requester's own account without a signed record of
that, the verifier says so in a note. Where the parties signed their own accounts, it prints them instead.

## Where the verifier comes from

\`verifier/\` is \`${ENTRY}\` and every file it imports, copied unchanged from the public repository
https://github.com/clocksmith/reploid at commit \`${commit}\`. To check with your own copy of that commit
instead (this needs git, and downloads that one commit only, not the repository's history):

\`\`\`
git init reploid
git -C reploid fetch --depth 1 https://github.com/clocksmith/reploid ${commit}
git -C reploid checkout --quiet FETCH_HEAD
node verify.mjs --verifier reploid
\`\`\`
`;
}

export async function buildOutsiderPackage({ manifest, out }) {
  if (existsSync(out)) throw Error(`${out} already exists`);
  const files = verifierFiles();
  const dirty = git(['status', '--porcelain', '--', ...files]);
  if (dirty) throw Error(`The verifier files are not committed as they are:\n${dirty}`);
  const commit = git(['rev-parse', 'HEAD']);
  await fs.mkdir(out, { recursive: true });
  for (const file of files) {
    await fs.mkdir(path.join(out, 'verifier', path.dirname(file)), { recursive: true });
    // The committed bytes, not the working tree's.
    await fs.writeFile(path.join(out, 'verifier', file), execFileSync('git', ['-C', repoRoot, 'show', `${commit}:${file}`]));
  }
  const expected = { title: manifest.title, verifierCommit: commit, receipts: [] };
  for (const item of manifest.receipts) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(item.id)) throw Error(`receipt id ${item.id}`);
    const target = path.join(out, 'receipts', item.id);
    await fs.mkdir(target, { recursive: true });
    for (const name of ['receipt.json', 'policy.json']) {
      if (existsSync(path.join(item.directory, name))) await fs.copyFile(path.join(item.directory, name), path.join(target, name));
    }
    const verdict = await verifyTrade({ ...readTrade(target) });
    expected.receipts.push({ id: item.id, label: item.label, ok: verdict.ok, attempts: verdict.attempts });
  }
  await fs.writeFile(path.join(out, 'expected.json'), JSON.stringify(expected, null, 2) + '\n');
  await fs.copyFile(path.join(repoRoot, 'scripts/settlement/outsider-package-verify.mjs'), path.join(out, 'verify.mjs'));
  // Listed in SHA256SUMS: the verifier, the receipts, expected.json, verify.mjs and README.md.
  const copied = (await fs.readdir(path.join(out, 'receipts'), { recursive: true, withFileTypes: true })).filter(entry => entry.isFile()).length;
  await fs.writeFile(path.join(out, 'README.md'), readme({ title: manifest.title, commit, receipts: manifest.receipts, expected,
    fileCount: files.length + copied + 3 }));
  const listed = await writeSums(out);
  return { commit, files: listed + 1, expected };
}

/** Lists every file under `out` with its digest in SHA256SUMS. Returns how many it listed. */
async function writeSums(out) {
  const listed = [];
  const walk = async directory => {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else listed.push(path.relative(out, full).split(path.sep).join('/'));
    }
  };
  await walk(out);
  const sums = await Promise.all(listed.map(async file => `${sha256(await fs.readFile(path.join(out, file)))}  ${file}`));
  await fs.writeFile(path.join(out, 'SHA256SUMS'), sums.join('\n') + '\n');
  return listed.length;
}

/** What verify.mjs prints for one trade of a records-only package; the README lists the same lines. */
export function recordsTradeLines(item) {
  return [item.label, ...(item.simulated ? [`  ${item.simulated}`] : []), ...item.attempts.flatMap(row => describeAttempt(row).map(line => `  ${line}`)),
    `  ${item.ok ? 'The stated amounts follow from the signed records' : 'The stated amounts do NOT follow from the signed records'}, and the result is the expected one.`];
}

/** The split of one attempt written out, for the README's worked example. */
function workedExample(item, row) {
  const f = row.facts, total = f.stages.map(stage => stage.weight), units = f.chargedOutputs * f.quote.creditsPerOutputToken;
  const sum = total.reduce((a, b) => a + b, 0), last = f.stages.length - 1;
  const stageLines = f.stages.map((stage, index) => {
    const share = index === last && last > 0 ? `${units} - ${f.stages.slice(0, -1).map(other => other.signedShare).join(' - ')} = ${stage.signedShare} (the last stage takes what remains)`
      : `floor(${units} x ${stage.weight} / ${sum}) = ${stage.signedShare}`;
    const paid = stage.ownAccount ? `on the requester's own account, so neither charged nor paid: 0` : stage.forfeited ? `it forfeited (${stage.forfeited}), so it is paid 0` : `paid ${stage.paid}`;
    return `stage ${stage.partitionIndex}: ${share}; ${paid}`;
  });
  return `Trade \`${item.id}\`, attempt "${row.name}":

\`\`\`
charged outputs   = the smaller of acknowledged (${f.acknowledgedOutputs}) and the signed ceiling (${f.quote.maxOutputTokens}) = ${f.chargedOutputs}
units             = ${f.chargedOutputs} outputs x ${f.quote.creditsPerOutputToken} credits = ${units}
sum of weights    = ${total.join(' + ')} = ${sum}
${stageLines.join('\n')}
debit             = ${f.stages.map(stage => stage.specified).join(' + ')} = ${f.debit}   (signed maximum: ${f.quote.maximum})
\`\`\``;
}

function recordsReadme({ title, commit, expected, fileCount, files }) {
  const attempts = expected.trades.flatMap(item => item.attempts.map(row => ({ item, row })));
  const example = attempts.find(({ row }) => row.facts.forfeited?.length) ?? attempts.find(({ row }) => row.facts.status === 'settled') ?? attempts[0];
  const shown = attempts.filter(({ row }) => row.facts.hold?.releaseShown).length;
  const simulated = expected.trades.filter(item => item.simulated), real = expected.trades.filter(item => !item.simulated);
  return `# ${title}

This folder lets you check, on your own computer, that the credits charged and paid in ${attempts.length} attempts
(${expected.trades.length} trades) follow from records the participants signed. You recompute every debit and every
payout yourself; the publisher's amounts are in the folder only so that you can compare them with yours.

## What is in this folder, and what is not

- \`trades/ID/trade.json\`: for each trade, the public credit policy, the signed records of each attempt (the
  requester's terms with its maximum and each stage's weight, each stage's acceptance and payout account, the stage
  receipts and closes, the requester's acknowledgments, and any stop or stage fault), the published list of which key
  belongs to which account, and the amounts the publisher states: debit, payouts, forfeits and hold.
- \`SPECIFICATION.md\`: the wire specification. It defines every record, how it is signed, and how an outcome and its
  amounts are decided. It is meant to be enough to write your own verifier.
- \`verifier/\`: a verifier written from that specification (${files.length} files). \`verify.mjs\` runs it on every trade.
- \`inputs.mjs\`: prints the numbers each amount is worked out from, for doing the arithmetic yourself.
- \`expected.json\`, \`SHA256SUMS\`: the result each trade should give, and every file's digest.

There is no prompt, no answer text, no token IDs, no description of the work, and nothing from the coordinator's
ledger: no journal, no balances. The records hold only counts, times, keys, signatures and digests.

${simulated.length ? `**${simulated.length === expected.trades.length ? 'Every trade' : `${simulated.length} of the ${expected.trades.length} trades`} here ${simulated.length === 1 && expected.trades.length > 1 ? 'is' : 'are'} simulated** (${simulated.map(item => `\`${item.id}\``).join(', ')}): the keys are test keys made for the run, every party ran in
one process on one machine with a fake clock, and no model ran. They show the rules for a cancellation, an
unattributed disconnect and a provider failure working on records signed by the real signing code. They are not
trades between real hosts.${real.length ? ` The other${real.length === 1 ? '' : 's'} (${real.map(item => `\`${item.id}\``).join(', ')}) ${real.length === 1 ? 'was' : 'were'} exported from the receipts of trades that ran on 2026-11-25.` : ''}
` : ''}
## What you need

Node 22 or later, and nothing else: no account, no keys, no network, no other software. To see which Node you have,
open a terminal and type \`node --version\`. If it is missing or older, install the current version from
https://nodejs.org and open a new terminal.

## The one command

Open a terminal in this folder (the one that holds this README) and type:

\`\`\`
node verify.mjs
\`\`\`

It takes a few seconds, sends nothing anywhere, and changes nothing.

## What you should see

\`\`\`
Step 1 of 2: all ${fileCount} package files are intact.
Step 2 of 2: recomputing ${expected.trades.length} trades from their signed records with the verifier in this package.

${expected.trades.map(item => recordsTradeLines(item).join('\n')).join('\n\n')}

RESULT: all ${expected.trades.length} trades give the expected result: every debit and payout was recomputed from signed records.
Hold release is shown by a coordinator-signed statement in ${shown} of ${attempts.length} attempts${shown < attempts.length ? '; in the others it rests on the publisher\'s unsigned word' : ''}.
\`\`\`

Please send back the whole output, whatever it says, and the output of \`node --version\`.

## How to read an attempt

- **signed maximum**: the most the requester agreed to be charged, from the terms it signed before anything was sent.
- **debit: recomputed, stated**: what the signed records imply the requester owes, and what the publisher says it
  was charged. They must be equal and no more than the signed maximum.
- **stage lines**: each stage's signed weight, the share that weight gives it, and what it is paid. A stage on the
  requester's own account is neither charged nor paid. A stage that failed (it signed a fault, or never signed a
  close) forfeits its own share; nobody else's amount changes.
- **payouts by account**: the recomputed payouts added up per account, and the publisher's stated ones.
- **accounts**: whether each party signed its own account, or the grouping is only the publisher's list.
- **hold**: see the next section but one.

To check one trade alone, name its folder under \`trades/\`, for example:

\`\`\`
node verifier/scripts/settlement/verify-records.js trades/${example.item.id}
\`\`\`

Add \`--json\` at the end for every number as data.

## Reproduce one by hand

${workedExample(example.item, example.row)}

Every number on the right-hand side comes from the signed records in \`trades/${example.item.id}/trade.json\`. To print
them for each attempt, read straight from the records with no verifier (it checks no signature; \`node verify.mjs\`
does that):

\`\`\`
node inputs.mjs ${example.item.id}
\`\`\`

\`node inputs.mjs\` alone prints them for every trade. For each attempt you get the price per output, the ceiling,
the maximum and the weights the requester signed; the number of outputs the requester acknowledged; which stages signed
a close or a fault; and the amounts stated. Then:

1. The charged outputs are the acknowledged outputs, at most the ceiling. If the outcome is \`expired\` nothing is
   charged or paid.
2. Units are the charged outputs times the price.
3. Each stage's share is the units times its weight, divided by the sum of the weights, rounded down; the last stage
   takes what is left, so the shares add up to the units.
4. A stage on the requester's own account is paid nothing and the requester is not charged its share. Under the
   failed-stage terms (\`...failed-stage-forfeits/v1\`) a stage that signed a fault, or signed no close, is paid
   nothing and the requester is not charged its share either. Nobody else's amount changes.
5. The debit is the sum of what the stages are paid.

The exact rules, including the time windows and the cases this summary leaves out, are in SPECIFICATION.md under
"Deciding an outcome" and "Split arithmetic".

## What the hold line means

Before a request is sent, the coordinator's ledger places a hold on the requester's account for the signed maximum.
Whether that hold was released afterwards is ledger state. No record that a requester or a stage signs can show it.

- \`signed by the coordinator\`: the trade carries the coordinator's own signed statement (SPECIFICATION.md, "The
  coordinator's statement") that it placed a hold equal to the signed maximum, released all of it, and holds nothing
  for this attempt. The verifier checks that signature, that the statement names the agreed terms, and that its debit
  and payouts equal the recomputed ones. This shows what the coordinator committed to: a hold that survived would
  contradict its own signature. It does not let you look into the ledger, and no record signed by a participant names
  the coordinator's key, so you learn the coordinator's key from this folder.
- \`NOT proven here\`: the trade was settled before that statement existed. The publisher says nothing was held
  afterwards, and nothing signed backs it.

## What a pass shows, and what it does not

A pass shows that the signed records, checked by the keys they carry, imply exactly the debit and payouts the
publisher states, under the public credit policy whose digest the requester signed; that the debit is within the
maximum the requester signed; and that every stage was paid the share its signed weight specifies, or forfeited it.

It does not show who owns a key, that the computation itself was correct, that nobody withheld a record, or when a
record was really signed. Where the output says the accounts are \`the publisher's grouping (not signed)\`, which
stages count as the requester's own is the publisher's statement only.

## Where the verifier comes from

\`verifier/\` holds ${files.map(file => `\`${file}\``).join(' and ')}, copied unchanged from the public
repository https://github.com/clocksmith/reploid at commit \`${commit}\`. They import each other and Node's
built-in modules, and nothing else: none of the coordinator service's ledger or replay code is in this folder.
\`independent/replay.js\` decides each outcome and its amounts. It was written from SPECIFICATION.md alone, by a
separate working session under the same operator as the service: it is a second implementation, not an independent
party's. \`verify-records.js\` reads the trade, recomputes each stage's share with its own arithmetic, checks the
coordinator's statement and compares the stated amounts.

The strongest check is your own verifier written from SPECIFICATION.md. To check instead with your own copy of that
commit (this needs git, and downloads that one commit only):

\`\`\`
git init reploid
git -C reploid fetch --depth 1 https://github.com/clocksmith/reploid ${commit}
git -C reploid checkout --quiet FETCH_HEAD
node verify.mjs --verifier reploid
\`\`\`
`;
}

/**
 * Builds the records-only package. `manifest`: `{ title, receipts?: [{ id, label, directory }], simulated?: boolean }`.
 * Every receipt is exported as signed records and stated amounts only; the verifier is the second one, with no
 * service code; the wire specification comes along.
 */
export async function buildRecordsPackage({ manifest, out }) {
  if (existsSync(out)) throw Error(`${out} already exists`);
  const files = verifierFiles(repoRoot, RECORDS_ENTRY);
  const service = files.filter(file => !file.startsWith('scripts/settlement/'));
  if (service.length) throw Error(`The records-only verifier must not import service code: ${service.join(', ')}`);
  const dirty = git(['status', '--porcelain', '--', ...files, SPECIFICATION]);
  if (dirty) throw Error(`The verifier files and the specification are not committed as they are:\n${dirty}`);
  const commit = git(['rev-parse', 'HEAD']);
  const committed = file => execFileSync('git', ['-C', repoRoot, 'show', `${commit}:${file}`]);
  await fs.mkdir(out, { recursive: true });
  for (const file of files) {
    await fs.mkdir(path.join(out, 'verifier', path.dirname(file)), { recursive: true });
    await fs.writeFile(path.join(out, 'verifier', file), committed(file));
  }
  await fs.writeFile(path.join(out, 'SPECIFICATION.md'), committed(SPECIFICATION));
  const trades = [];
  for (const item of manifest.receipts ?? []) {
    trades.push(exportFromReceipt({ id: item.id, label: item.label, ...readTrade(item.directory) }));
  }
  if (manifest.simulated !== false) trades.push(await exportFailureCases());
  if (!trades.length) throw Error('The manifest lists no receipt and turns the simulated trades off');
  const expected = { title: manifest.title, verifierCommit: commit, trades: [] };
  for (const trade of trades) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(trade.id) || expected.trades.some(item => item.id === trade.id)) throw Error(`trade id ${trade.id}`);
    await fs.mkdir(path.join(out, 'trades', trade.id), { recursive: true });
    await fs.writeFile(path.join(out, 'trades', trade.id, 'trade.json'), JSON.stringify(trade, null, 1) + '\n');
    const verdict = await verifyRecords({ trade });
    expected.trades.push({ id: trade.id, label: trade.label, simulated: trade.simulated, ok: verdict.ok, attempts: verdict.attempts });
  }
  await fs.writeFile(path.join(out, 'expected.json'), JSON.stringify(expected, null, 2) + '\n');
  await fs.copyFile(path.join(repoRoot, 'scripts/settlement/outsider-records-verify.mjs'), path.join(out, 'verify.mjs'));
  await fs.copyFile(path.join(repoRoot, 'scripts/settlement/outsider-records-inputs.mjs'), path.join(out, 'inputs.mjs'));
  // Listed in SHA256SUMS: the verifier, the trades, the specification, expected.json, verify.mjs, inputs.mjs and README.md.
  await fs.writeFile(path.join(out, 'README.md'), recordsReadme({ title: manifest.title, commit, expected, files, fileCount: files.length + trades.length + 5 }));
  const listed = await writeSums(out);
  // `receipts` keeps main()'s report the same for both kinds of package.
  return { commit, files: listed + 1, expected: { ...expected, receipts: expected.trades } };
}

async function main() {
  const { values } = parseArgs({ options: { manifest: { type: 'string' }, out: { type: 'string' }, 'records-only': { type: 'boolean' } } });
  if (!values.manifest || !values.out) throw Error('Usage: outsider-package.js [--records-only] --manifest MANIFEST.json --out NEW_DIRECTORY');
  const manifest = JSON.parse(await fs.readFile(values.manifest, 'utf8'));
  const built = await (values['records-only'] ? buildRecordsPackage : buildOutsiderPackage)({ manifest, out: path.resolve(values.out) });
  console.log(`Package at ${path.resolve(values.out)}: ${built.files} files, verifier from ${built.commit}`);
  for (const item of built.expected.receipts) console.log(`  ${item.ok ? 'PASS' : 'FAIL'} ${item.id}`);
  if (!built.expected.receipts.every(item => item.ok)) process.exitCode = 1;
}

const entered = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (entered) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
