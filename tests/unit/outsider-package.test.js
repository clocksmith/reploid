// @vitest-environment node
// The outside-verifier package (scripts/settlement/outsider-package.js): built from the Stage 1 trade fixture, its one
// command passes with Node alone from a directory outside the repository, and refuses a changed file or a changed result.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOutsiderPackage, buildRecordsPackage, verifierFiles } from '../../scripts/settlement/outsider-package.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/stage1-trade', import.meta.url));
const run = directory => {
  try { return { code: 0, out: execFileSync(process.execPath, ['verify.mjs'], { cwd: directory, encoding: 'utf8', env: { PATH: process.env.PATH } }) }; }
  catch (error) { return { code: error.status, out: String(error.stdout) }; }
};

describe('outside-verifier package', () => {
  let root, out;
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'outsider-package-'));
    out = path.join(root, 'package');
    await buildOutsiderPackage({ out, manifest: { title: 'Test package', receipts: [{ id: 'fixture', label: 'Fixture trade', directory: FIXTURE }] } });
  }, 60000);
  afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it('copies verify-trade.js with only relative and node: imports', () => {
    const files = verifierFiles();
    expect(files).toContain('scripts/settlement/verify-trade.js');
    expect(files).toContain('scripts/settlement/independent/replay.js');
    expect(files.every(file => !file.includes('node_modules'))).toBe(true);
  });

  it('passes with its one command, from outside the repository', async () => {
    const { code, out: text } = run(out);
    expect(text).toContain('Step 1 of 2: all');
    expect(text).toContain('RESULT: all 1 receipts give the expected result.');
    expect(code).toBe(0);
    const readme = await fs.readFile(path.join(out, 'README.md'), 'utf8');
    expect(readme).toContain('node verify.mjs');
    expect(readme).toContain(text.match(/Step 1 of 2: all \d+ package files are intact\./)[0]);
  });

  it('refuses a changed receipt, and a result that differs from the expected one', async () => {
    const copy = path.join(root, 'changed');
    await fs.cp(out, copy, { recursive: true });
    const file = path.join(copy, 'receipts/fixture/receipt.json');
    await fs.writeFile(file, (await fs.readFile(file, 'utf8')) + ' ');
    expect(run(copy)).toMatchObject({ code: 1, out: expect.stringContaining('missing or changed: receipts/fixture/receipt.json') });

    const differs = path.join(root, 'differs');
    await fs.cp(out, differs, { recursive: true });
    const expectedFile = path.join(differs, 'expected.json');
    const expected = JSON.parse(await fs.readFile(expectedFile, 'utf8'));
    expected.receipts[0].attempts[0].facts.debit += 1;
    await fs.writeFile(expectedFile, JSON.stringify(expected, null, 2) + '\n');
    // Re-list the digest, so only the result comparison can catch it.
    const sums = (await fs.readFile(path.join(differs, 'SHA256SUMS'), 'utf8')).split('\n').map(line => (line.endsWith('  expected.json')
      ? `${createHash('sha256').update(JSON.stringify(expected, null, 2) + '\n').digest('hex')}  expected.json` : line)).join('\n');
    await fs.writeFile(path.join(differs, 'SHA256SUMS'), sums);
    expect(run(differs)).toMatchObject({ code: 1, out: expect.stringContaining('DIFFERS from the expected one') });
  });
});

// The package an outsider should get (--records-only): signed records and stated amounts, the wire specification and
// the second verifier, with no receipt text, no ledger trace and none of the service's code. The receipt is the Stage 1
// fixture and the v3 trades are the in-process failure cases: simulated parties and test keys.
describe('records-only outside-verifier package', () => {
  let root, out, files;
  const listFiles = async directory => (await fs.readdir(directory, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile())
    .map(entry => path.relative(directory, path.join(entry.parentPath, entry.name)).split(path.sep).join('/')).sort();
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'outsider-records-'));
    out = path.join(root, 'package');
    await buildRecordsPackage({ out, manifest: { title: 'Test records package', receipts: [{ id: 'fixture', label: 'Fixture trade', directory: FIXTURE }] } });
    files = await listFiles(out);
  }, 60000);
  afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it('holds the specification, the second verifier and the trades, and no service code or receipt', async () => {
    expect(files).toEqual(['README.md', 'SHA256SUMS', 'SPECIFICATION.md', 'expected.json', 'trades/fixture/trade.json', 'trades/simulated-v3-failure-cases/trade.json',
      'verifier/scripts/settlement/independent/replay.js', 'verifier/scripts/settlement/verify-records.js', 'verify.mjs']);
    expect(verifierFiles(undefined, 'scripts/settlement/verify-records.js').some(file => file.startsWith('server/'))).toBe(false);
    expect(await fs.readFile(path.join(out, 'SPECIFICATION.md'), 'utf8')).toContain('## The coordinator\'s statement');
  });

  it('leaks nothing of the receipt but its signed records into any file', async () => {
    const receipt = JSON.parse(await fs.readFile(path.join(FIXTURE, 'receipt.json'), 'utf8'));
    const source = receipt.receipt ?? receipt;
    const secrets = [JSON.stringify(source.split.tokens.outputIds).slice(1, -1), source.workload.modelId, source.workload.promptDigest, source.workload.messagesDigest.slice(7),
      '"journal"', '"outputIds"', '"visibleText"', '"partialText"', '"workload"'];
    for (const file of files.filter(name => name.startsWith('trades/') || name === 'expected.json')) {
      const text = await fs.readFile(path.join(out, file), 'utf8');
      for (const secret of secrets) expect(text.includes(secret), `${file} contains ${secret}`).toBe(false);
    }
  });

  it('passes with its one command from outside the repository, as its README says', async () => {
    const { code, out: text } = run(out);
    expect(text).toContain('RESULT: all 2 trades give the expected result: every debit and payout was recomputed from signed records.');
    expect(text).toContain('Hold release is shown by a coordinator-signed statement in 4 of 7 attempts; in the others it rests on the publisher\'s unsigned word.');
    expect(text).toContain('SIMULATED: test keys');
    expect(code).toBe(0);
    const readme = await fs.readFile(path.join(out, 'README.md'), 'utf8');
    // Everything the command prints is in the README, line for line.
    for (const line of text.trim().split('\n')) expect(readme, line).toContain(line);
    expect(readme).toContain('There is no prompt, no answer text, no token IDs');
  });

  it('refuses a changed trade, and a stated amount that no longer follows', async () => {
    const copy = path.join(root, 'changed');
    await fs.cp(out, copy, { recursive: true });
    const file = path.join(copy, 'trades/fixture/trade.json');
    const trade = JSON.parse(await fs.readFile(file, 'utf8'));
    trade.attempts[0].stated.debit += 1;
    const bytes = JSON.stringify(trade, null, 1) + '\n';
    await fs.writeFile(file, bytes);
    expect(run(copy)).toMatchObject({ code: 1, out: expect.stringContaining('missing or changed: trades/fixture/trade.json') });
    // Re-list the digest, so only the recomputation can catch it.
    const sums = (await fs.readFile(path.join(copy, 'SHA256SUMS'), 'utf8')).split('\n').map(line => (line.endsWith('  trades/fixture/trade.json')
      ? `${createHash('sha256').update(bytes).digest('hex')}  trades/fixture/trade.json` : line)).join('\n');
    await fs.writeFile(path.join(copy, 'SHA256SUMS'), sums);
    const result = run(copy);
    expect(result.code).toBe(1);
    expect(result.out).toContain('the publisher states a debit of 4, the signed records imply 3');
    expect(result.out).toContain('The stated amounts do NOT follow from the signed records');
  });
});
