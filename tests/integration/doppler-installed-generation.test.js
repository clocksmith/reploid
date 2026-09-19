import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// Ordinary unit runs may omit the candidate. The designated job must never skip setup.
const required = process.env.DOPPLER_TEST_REQUIRED === '1';
describe.runIf(required || Boolean(process.env.DOPPLER_TEST_CONSUMER))('installed Doppler generation contract', () => {
  it('carries Reploid requests to public inference and checked completion records', () => {
    expect(process.env.DOPPLER_TEST_CONSUMER, 'Designated job requires an installed candidate').toBeTruthy();
    const result = execFileSync(process.execPath, [resolve('tests/fixtures/doppler-installed-generation.js')], { encoding: 'utf8' });
    expect(JSON.parse(result.trim()).passed).toBe(true);
  });
});
