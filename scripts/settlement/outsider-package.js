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
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readTrade, verifyTrade } from './verify-trade.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENTRY = 'scripts/settlement/verify-trade.js';

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
  return { commit, files: listed.length + 1, expected };
}

async function main() {
  const { values } = parseArgs({ options: { manifest: { type: 'string' }, out: { type: 'string' } } });
  if (!values.manifest || !values.out) throw Error('Usage: outsider-package.js --manifest MANIFEST.json --out NEW_DIRECTORY');
  const manifest = JSON.parse(await fs.readFile(values.manifest, 'utf8'));
  const built = await buildOutsiderPackage({ manifest, out: path.resolve(values.out) });
  console.log(`Package at ${path.resolve(values.out)}: ${built.files} files, verifier from ${built.commit}`);
  for (const item of built.expected.receipts) console.log(`  ${item.ok ? 'PASS' : 'FAIL'} ${item.id}`);
  if (!built.expected.receipts.every(item => item.ok)) process.exitCode = 1;
}

const entered = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (entered) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
