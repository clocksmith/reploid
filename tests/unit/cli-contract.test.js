// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { parseArgs, buildTestCommands, buildProofCommand, proofCommands } from '../../bin/reploid-cli.ts';

describe('Reploid command entrypoint', () => {
  it('runs the advertised npm CLI and discovers actual proof targets', () => {
    const help = execFileSync('npm', ['run', 'cli', '--', '--help'], { encoding: 'utf8' });
    expect(help).toContain('Run Vitest suites (no browser execution)');
    for (const [name, entry] of Object.entries(proofCommands)) {
      expect(help).toContain(`proof ${name}`);
      expect(existsSync(entry.script)).toBe(true);
    }
  });

  it('preserves test options across full-suite dispatch without opening a debugger', () => {
    const commands = buildTestCommands(parseArgs(['test', '--full', '--filter', 'Pack', '--coverage', '--headed', '--verbose']));
    expect(commands).toEqual([
      ['vitest', 'run', '-t', 'Pack', '--coverage', '--reporter=verbose'],
      ['playwright', 'test', 'tests/e2e', '--headed', '--grep', 'Pack', '--reporter=list']
    ]);
    expect(buildTestCommands(parseArgs(['test']))).toEqual([['vitest', 'run']]);
    expect(buildTestCommands(parseArgs(['unit']))).toEqual([['vitest', 'run', 'tests/unit']]);
    expect(buildProofCommand(['peer-pack', '--config', '/tmp/explicit.json', '--dry-run'])).toEqual(['scripts/verify-peer-pack-execution.js', '--config', '/tmp/explicit.json']);
  });

  it('fails unknown, incomplete and contradictory input instead of running default tests', () => {
    for (const args of [['not-a-command'], ['test', '--unknown'], ['test', '--filter'], ['test', '--unit', '--e2e'], ['test', '--full', '--watch'], ['test', '--e2e', '--coverage']]) {
      expect(() => parseArgs(args)).toThrow();
    }
    expect(() => buildProofCommand(['unknown'])).toThrow('Unknown proof');
    const failure = spawnSync('npm', ['run', 'cli', '--', 'unknown'], { encoding: 'utf8' });
    expect(failure.status).not.toBe(0);
    expect(failure.stderr).toContain('Unknown command or suite');
  });

  it('archives actual report locations and produces a CI Vitest report', () => {
    const workflow = readFileSync('.github/workflows/test.yml', 'utf8');
    expect(workflow).toContain('test-results/');
    expect(workflow).toContain('playwright-report/');
    expect(workflow).toContain('npm run verify:registry');
    expect(workflow).not.toContain('          tests/');
    expect(readFileSync('vitest.config.js', 'utf8')).toContain('test-results/vitest-results.json');
    expect(JSON.parse(readFileSync('package.json', 'utf8')).scripts['test:ci']).toContain('--outputFile=test-results/vitest-results.json');
  });
});
