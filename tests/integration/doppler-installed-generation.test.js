import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

describe.runIf(Boolean(process.env.DOPPLER_TEST_CONSUMER))('installed Doppler generation contract', () => {
  it('carries Reploid requests to public inference and checked completion records', () => {
    const result = execFileSync(process.execPath, [resolve('tests/fixtures/doppler-installed-generation.js')], { encoding: 'utf8' });
    expect(JSON.parse(result.trim()).passed).toBe(true);
  });
});
