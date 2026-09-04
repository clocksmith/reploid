/** Opt-in paired-repository test; neither package needs a neighboring checkout. */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

describe.runIf(Boolean(process.env.DOPPLER_TEST_CHECKOUT))('Doppler signed-Pack public API handoff', () => {
  it('binds migration, opening, execution receipts, and assignment rejection', () => {
    const script = path.resolve('tests/fixtures/doppler-pack-handoff.js');
    const output = execFileSync(process.execPath, [script], { encoding: 'utf8' });
    expect(output).toContain('Doppler public signed-Pack handoff passed');
  });
});
