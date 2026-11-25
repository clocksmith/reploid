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
import { buildOutsiderPackage, verifierFiles } from '../../scripts/settlement/outsider-package.js';

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
