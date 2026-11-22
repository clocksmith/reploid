// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import { createChangedCodeLinter } from '../../scripts/lint-changed-code.js';

const eslint = new ESLint({ overrideConfigFile: 'scripts/eslint.config.js' });
async function errors(filePath, source) {
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages.filter(message => message.severity === 2);
}

describe('execution environment lint boundaries', () => {
  it.each([
    "import '../packages/reploid/src/chat/workspace.js';",
    "export * from '../packages/reploid/src/chat/workspace.js';",
    "export const open = () => import('../packages/reploid/src/chat/workspace.js');",
    "export const open = () => import(`../packages/reploid/src/chat/workspace.js`);"
  ])('rejects private hosted-library imports in lint: %s', async source => {
    const messages = await errors('server/boundary-probe.js', source);
    expect(messages).toEqual([expect.objectContaining({ ruleId: 'architecture/server-library-imports' })]);
    expect(await errors('server/boundary-probe.js', "export * from '../packages/reploid/src/chat/index.js';")).toEqual([]);
  });

  it('checks unused locals and nested choices in new modules without a manual registration', async () => {
    const linter = createChangedCodeLinter(['apps/poolday/host/new-module.js']);
    const [result] = await linter.lintText('export function value(a, b) { const unused = 1; return a ? b ? 1 : 2 : 3; }',
      { filePath: 'apps/poolday/host/new-module.js' });
    expect(result.messages.map(message => message.ruleId).sort()).toEqual(['no-nested-ternary', 'no-unused-vars']);
    const [old] = await linter.lintText('export function value() { const unused = 1; return 1; }', { filePath: 'self/ui/legacy-example.js' });
    expect(old.messages).toEqual([expect.objectContaining({ ruleId: 'no-unused-vars' })]);
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
