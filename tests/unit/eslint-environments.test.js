// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createChangedCodeLinter, lintChangedCode } from '../../scripts/lint-changed-code.js';

const eslint = new ESLint({ overrideConfigFile: 'scripts/eslint.config.js' });
async function errors(filePath, source) {
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages.filter(message => message.severity === 2);
}

describe('execution environment lint boundaries', () => {
  it.each([
    "import '../shared/vendor/reploid/chat/workspace.js';",
    "export * from '../shared/vendor/reploid/chat/workspace.js';",
    "export const open = () => import('../shared/vendor/reploid/chat/workspace.js');",
    "export const open = () => import(`../shared/vendor/reploid/chat/workspace.js`);",
    "export * from '../packages/reploid/src/chat/index.js';"
  ])('rejects private or second-copy hosted-library imports in lint: %s', async source => {
    const messages = await errors('server/boundary-probe.js', source);
    expect(messages).toEqual([expect.objectContaining({ ruleId: 'architecture/server-library-imports' })]);
    expect(await errors('server/boundary-probe.js', "export * from '../shared/vendor/reploid/chat/index.js';")).toEqual([]);
  });

  it('checks unused locals and nested choices in new modules without a manual registration', async () => {
    const linter = createChangedCodeLinter(['apps/poolday/host/new-module.js']);
    const [result] = await linter.lintText('export function value(a, b) { const unused = 1; return a ? b ? 1 : 2 : 3; }',
      { filePath: 'apps/poolday/host/new-module.js' });
    expect(result.messages.map(message => message.ruleId).sort()).toEqual(['no-nested-ternary', 'no-unused-vars']);
    const [old] = await linter.lintText('export function value() { const unused = 1; return 1; }', { filePath: 'self/ui/legacy-example.js' });
    expect(old.messages).toEqual([expect.objectContaining({ ruleId: 'no-unused-vars' })]);
  });
  it('a local run holds uncommitted and untracked new modules to the rules a push is held to', async () => {
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), 'lint-changed-')));
    const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.org', ...args], { cwd, stdio: 'ignore' });
    const nested = 'export const pick = (a, b) => a ? b ? 1 : 2 : 3;\n';
    try {
      mkdirSync(path.join(cwd, 'scripts'));
      writeFileSync(path.join(cwd, 'scripts/eslint.config.js'), 'export default [{ rules: {} }];\n');
      writeFileSync(path.join(cwd, 'existing.js'), 'export const one = 1;\n');
      git('init', '-q'); git('add', '.'); git('commit', '-q', '-m', 'first');
      writeFileSync(path.join(cwd, 'committed.js'), nested);
      git('add', '.'); git('commit', '-q', '-m', 'second');
      writeFileSync(path.join(cwd, 'existing.js'), nested);
      writeFileSync(path.join(cwd, 'untracked.js'), nested);
      const quiet = async options => {
        const write = process.stdout.write;
        process.stdout.write = () => true;
        try { return await lintChangedCode({ cwd, ...options }); } finally { process.stdout.write = write; }
      };
      // No origin/main here, so the local base is HEAD^: committed.js and untracked.js are new, existing.js is not.
      expect(await quiet({})).toEqual({ errors: 2, warnings: 0 });
      // A push range sees only what was committed in it.
      expect(await quiet({ base: 'HEAD^' })).toEqual({ errors: 1, warnings: 0 });
      expect(await quiet({ base: 'HEAD' })).toEqual({ errors: 0, warnings: 0 });
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it.each(['.tmp', '.claude/worktrees/review', '.deployment-checkouts/release'])(
    'excludes local scratch or checkout copies under %s', async directory => {
      expect(await eslint.isPathIgnored(`${directory}/server/example.js`)).toBe(true);
      expect(await eslint.isPathIgnored('server/example.js')).toBe(false);
    }
  );

  it.each([
    ['self/ui/example.js', 'window.document; process.cwd();', 'process'],
    ['server/daily/site/example.js', 'window.document; process.cwd();', 'process'],
    ['server/example.js', 'process.cwd(); window.document;', 'window'],
    ['shared/core/verification-worker.js', 'self.postMessage(1); document.title;', 'document'],
    ['packages/reploid/src/agent/example.js', 'new URL("https://example.org"); window.document;', 'window']
  ])('rejects ambient capabilities outside %s', async (file, source, forbidden) => {
    expect(await errors(file, source)).toEqual([expect.objectContaining({ ruleId: 'no-undef', message: `'${forbidden}' is not defined.` })]);
  });

  it.each(['shared/ui/components/html.js', 'self/ui/example.js', 'server/example.js',
    'scripts/example.js', 'packages/reploid/src/agent/example.js', 'apps/poolday/host/example.js'])(
    'checks unused locals throughout authored code: %s', async file => {
      expect(await errors(file, 'export function encode() { const unused = 1; return ""; }'))
        .toEqual([expect.objectContaining({ ruleId: 'no-unused-vars' })]);
    }
  );

  it('allows the explicit optional Node codec port without enabling Node ambient APIs', async () => {
    expect(await errors('packages/reploid/src/artifacts/identity.js', 'Buffer.from("test"); process.cwd();'))
      .toEqual([expect.objectContaining({ ruleId: 'no-undef', message: "'process' is not defined." })]);
  });
});
