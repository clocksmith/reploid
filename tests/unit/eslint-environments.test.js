// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

const eslint = new ESLint({ overrideConfigFile: 'scripts/eslint.config.js' });
async function errors(filePath, source) {
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages.filter(message => message.severity === 2);
}

describe('execution environment lint boundaries', () => {
  it.each([
    ['self/ui/example.js', 'window.document; process.cwd();', 'process'],
    ['server/example.js', 'process.cwd(); window.document;', 'window'],
    ['self/core/verification-worker.js', 'self.postMessage(1); document.title;', 'document'],
    ['packages/reploid/src/agent/example.js', 'new URL("https://example.org"); window.document;', 'window']
  ])('rejects ambient capabilities outside %s', async (file, source, forbidden) => {
    expect(await errors(file, source)).toEqual([expect.objectContaining({ ruleId: 'no-undef', message: `'${forbidden}' is not defined.` })]);
  });

  it('checks unused locals in cleaned modules without claiming legacy coverage', async () => {
    expect(await errors('self/ui/components/html.js', 'export function encode() { const unused = 1; return ""; }'))
      .toEqual([expect.objectContaining({ ruleId: 'no-unused-vars' })]);
    expect(await errors('self/ui/example.js', 'export function encode() { const unused = 1; return ""; }')).toEqual([]);
  });

  it('allows the explicit optional Node codec port without enabling Node ambient APIs', async () => {
    expect(await errors('packages/reploid/src/artifacts/identity.js', 'Buffer.from("test"); process.cwd();'))
      .toEqual([expect.objectContaining({ ruleId: 'no-undef', message: "'process' is not defined." })]);
  });
});
