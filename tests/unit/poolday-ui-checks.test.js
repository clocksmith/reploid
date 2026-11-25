// @vitest-environment node
// Negative fixtures for the design-system checks: each case breaks one rule in a minimal tree and
// asserts that exactly that rule fires. Adapted from clocksmith/react-starter
// tool/test/check_boundaries.test.mjs (commit cd07713).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkArchitecture, inspectSource, loadPolicy } from '../../scripts/check-poolday-ui-boundaries.mjs';
import { compareRatchet, measureLegacy } from '../../scripts/verify-poolday-ui-ratchet.mjs';

const repo = resolve(import.meta.dirname, '..', '..');
const policy = loadPolicy(repo);

const ui = 'packages/poolday-ui/src/index.tsx';
const domain = 'apps/poolday-react/src/features/chat/domain/chat.ts';
const infrastructure = 'apps/poolday-react/src/features/chat/infrastructure/api.ts';
const presentation = 'apps/poolday-react/src/features/chat/presentation/Screen.tsx';
const app = 'apps/poolday-react/src/app/App.tsx';
const bridge = 'packages/reploid/src/chat/index.js';

/** A minimal tree that satisfies the real policy. Each test breaks exactly one thing. */
const baseline = {
  'packages/poolday-ui/package.json': JSON.stringify({ name: '@reploid/poolday-ui', exports: { '.': './src/index.ts' }, peerDependencies: { react: '^19', 'react-dom': '^19' } }),
  [ui]: `import type { ReactNode, CSSProperties } from 'react';\nexport function Box({ children, tone }: { children?: ReactNode; tone: string }) {\n  const style = { '--pool-param-tone': tone } as CSSProperties;\n  return <div className="pool-stack" style={style}>{children}</div>;\n}\n`,
  'apps/poolday-react/src/l10n/strings.ts': `export const strings = { title: 'Threads' } as const;\n`,
  [domain]: `export type Thread = { id: string; title: string };\n`,
  [infrastructure]: `import type { Thread } from '../domain/chat';\nimport { listThreads } from '../../../../../../packages/reploid/src/chat/index.js';\nexport const load = async (): Promise<Thread[]> => { void listThreads; return (await fetch('/threads')).json(); };\n`,
  [presentation]: `import { Box } from '@reploid/poolday-ui';\nimport { useState } from 'react';\nimport type { Thread } from '../domain/chat';\nimport { strings } from '../../../l10n/strings';\nexport function Screen() {\n  const [thread] = useState<Thread | null>(null);\n  return <Box tone="ready">{thread ? thread.title : strings.title}</Box>;\n}\n`,
  [app]: `import { StrictMode } from 'react';\nimport { load } from '../features/chat/infrastructure/api';\nimport { Screen } from '../features/chat/presentation/Screen';\nexport function App() {\n  void load;\n  void document.title;\n  return (\n    <StrictMode>\n      <Screen />\n    </StrictMode>\n  );\n}\n`,
  'packages/reploid/package.json': JSON.stringify({ name: 'reploid', exports: { './chat': { types: './src/chat/index.d.ts', import: './src/chat/index.js' } } }),
  [bridge]: `export function listThreads(store) { return store.threads.map(thread => ({ id: thread.id })); }\n`,
  'packages/reploid/src/chat/index.d.ts': `export declare function listThreads(store: unknown): Array<{ id: string }>;\n`,
};

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tree(changes = {}) {
  const root = mkdtempSync(join(tmpdir(), 'poolday-ui-'));
  roots.push(root);
  for (const [path, content] of Object.entries({ ...baseline, ...changes })) {
    if (content === null) continue;
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const rulesFor = (changes, file) =>
  checkArchitecture({ root: tree(changes), policy })
    .filter((violation) => !file || violation.file === file)
    .map((violation) => violation.rule);

describe('poolday-ui boundaries', () => {
  it('accepts the baseline tree and the real repository', () => {
    expect(checkArchitecture({ root: tree(), policy })).toEqual([]);
    expect(checkArchitecture({ root: repo, policy })).toEqual([]);
  });

  it('rejects raw elements, including interactive ones, outside the design system', () => {
    for (const element of ['div', 'button', 'input', 'select', 'textarea', 'a']) {
      expect(rulesFor({ [presentation]: `export const Screen = () => <${element} />;\n` }, presentation), element).toEqual(['markup']);
    }
    expect(rulesFor({ [app]: `export const App = () => <a onClick={() => undefined}>Open</a>;\n` }, app)).toEqual(['markup']);
  });

  it('rejects ad hoc styling: className, style and injected markup', () => {
    for (const attribute of ['className="x"', 'style={{ margin: 0 }}', "dangerouslySetInnerHTML={{ __html: '' }}"]) {
      const source = `import { Box } from '@reploid/poolday-ui';\nexport const Screen = () => <Box tone="ready" ${attribute} />;\n`;
      expect(rulesFor({ [presentation]: source }, presentation), attribute).toEqual(['markup']);
    }
  });

  it('rejects literal colours, sizes and durations in any layer', () => {
    const literals = ['#38bdf8', 'rgb(0 0 0)', 'color-mix(in srgb, red, blue)', '12px', '1.5rem', '200ms'];
    for (const value of literals) {
      expect(rulesFor({ 'apps/poolday-react/src/l10n/strings.ts': `export const strings = { title: '${value}' } as const;\n` }, 'apps/poolday-react/src/l10n/strings.ts'), value).toEqual(['style-literal']);
      expect(rulesFor({ [ui]: `export const Box = () => <div className="pool-stack" title="${value}" />;\n` }, ui), value).toEqual(['style-literal']);
    }
  });

  it('lets the ui package set only --pool-param-* style parameters', () => {
    expect(rulesFor({ [ui]: `export const Box = () => <div style={{ color: 'inherit' }} />;\n` }, ui)).toEqual(['style-param']);
    expect(rulesFor({ [ui]: `export const Box = ({ s }: { s: object }) => <div style={s} />;\n` }, ui)).toEqual(['style-param']);
    expect(rulesFor({ [ui]: `export const Box = () => <div style={{ '--pool-param-share': 1 }} />;\n` }, ui)).toEqual([]);
  });

  it('rejects forbidden imports: layers, packages, internals, features and the bridge', () => {
    expect(rulesFor({ [presentation]: `import { load } from '../infrastructure/api';\nexport const x = load;\n` }, presentation)).toEqual(['layer']);
    expect(rulesFor({ [domain]: `import { useState } from 'react';\nexport type Thread = { s: typeof useState };\n` }, domain)).toEqual(['external-package']);
    expect(rulesFor({ [presentation]: `import { createRoot } from 'react-dom/client';\nexport const x = createRoot;\n` }, presentation)).toEqual(['external-package']);
    expect(rulesFor({ [presentation]: `import { Box } from '@reploid/poolday-ui/src/index';\nexport const x = Box;\n` }, presentation)).toEqual(['internal-access']);
    expect(rulesFor({ [presentation]: `import { Box } from '../../../../../../packages/poolday-ui/src/index';\nexport const x = Box;\n` }, presentation)).toEqual(['cross-package']);
    const other = 'apps/poolday-react/src/features/settings/domain/settings.ts';
    expect(rulesFor({ [other]: `import type { Thread } from '../../chat/domain/chat';\nexport type S = { t: Thread };\n` }, other)).toEqual(['cross-feature']);
    expect(rulesFor({ [presentation]: `import { listThreads } from '../../../../../../packages/reploid/src/chat/index.js';\nexport const x = listThreads;\n` }, presentation)).toEqual(['bridge-access']);
    expect(rulesFor({ [infrastructure]: `import { x } from '../../../../../../packages/reploid/src/chat/thread-grants.js';\nexport const y = x;\n`, 'packages/reploid/src/chat/thread-grants.js': `export const x = 1;\n` }, infrastructure)).toEqual(['internal-access']);
  });

  it('rejects platform globals outside infrastructure and composition, and presentation React beyond hooks', () => {
    expect(rulesFor({ [presentation]: `export const where = () => window.location.href;\n` }, presentation)).toEqual(['platform']);
    expect(rulesFor({ [domain]: `export type Thread = { id: string; title: string; at: (location: string) => string };\n` }, domain)).toEqual([]);
    expect(rulesFor({ [presentation]: `import { createElement } from 'react';\nexport const S = () => createElement('div');\n` }, presentation)).toEqual(['react-symbol']);
  });

  it('keeps the API bridge framework-free and typed', () => {
    expect(rulesFor({ [bridge]: `import { useState } from 'react';\nexport const listThreads = () => useState;\n` }, bridge)).toEqual(['bridge']);
    expect(rulesFor({ [bridge]: `export const listThreads = () => <div />;\n` }, bridge)).toEqual(['bridge']);
    expect(rulesFor({ [bridge]: `export const listThreads = (node) => { node.innerHTML = '<b>x</b>'; };\n` }, bridge)).toEqual(['bridge']);
    expect(rulesFor({ [bridge]: `export const listThreads = () => document.createElement('div');\n` }, bridge)).toEqual(['bridge']);
    expect(rulesFor({ 'packages/reploid/package.json': JSON.stringify({ name: 'reploid', exports: { './chat': { import: './src/chat/index.js' } } }) }, 'packages/reploid/package.json')).toEqual(['bridge-types']);
  });

  it('rejects unclassified files, cycles, symlinks and manifest drift', () => {
    const stray = 'apps/poolday-react/src/misc/helper.ts';
    expect(rulesFor({ [stray]: `export const x = 1;\n` }, stray)).toEqual(['unclassified']);
    const status = 'apps/poolday-react/src/features/chat/domain/status.ts';
    expect(rulesFor({
      [domain]: `import type { Status } from './status';\nexport type Thread = { id: string; title: string; s: Status };\n`,
      [status]: `import type { Thread } from './chat';\nexport type Status = { of: Thread };\n`,
    })).toEqual(['cycle']);
    const root = tree();
    symlinkSync(join(root, domain), join(root, 'apps/poolday-react/src/features/chat/domain/linked.ts'));
    expect(checkArchitecture({ root, policy }).map((violation) => violation.rule)).toEqual(['symlink']);
    expect(rulesFor({ 'packages/poolday-ui/package.json': JSON.stringify({ name: '@reploid/poolday-ui', exports: { '.': './src/index.ts' }, peerDependencies: { react: '^19', 'react-dom': '^19' }, dependencies: { clsx: '^2' } }) })).toEqual(['manifest']);
  });

  it('collects every form of module reference', () => {
    const facts = inspectSource(`import a from 'a';\nimport type { B } from 'b';\nexport { c } from 'c';\nexport * from 'd';\nconst e = import('e');\nconst f = require('f');\ntype G = import('g').G;\n`, 'x.ts');
    expect(facts.specifiers.sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  });
});

describe('legacy ratchet', () => {
  const legacyTree = (extra = '') => {
    const root = mkdtempSync(join(tmpdir(), 'poolday-ratchet-'));
    roots.push(root);
    mkdirSync(join(root, 'apps/poolday/ui/pool-home'), { recursive: true });
    mkdirSync(join(root, 'apps/poolday/styles/poolday/compositions'), { recursive: true });
    writeFileSync(join(root, 'apps/poolday/ui/pool-home/view.js'), `export const v = () => '<button class="pool-button">Go</button>${extra}';\n`);
    writeFileSync(join(root, 'apps/poolday/styles/poolday/compositions/screens.css'), '.pool-home .chat-row { display: grid; }\n');
    return root;
  };

  it('counts what is still outside the design system', () => {
    expect(measureLegacy(legacyTree())).toEqual({ rawControls: 1, classAttributes: 1, compositionClasses: 2, compositionRules: 1 });
  });

  it('fails when a count rises and passes when it falls', () => {
    const recorded = measureLegacy(legacyTree());
    const grown = measureLegacy(legacyTree('<input class="x">'));
    expect(compareRatchet(grown, recorded).violations).toHaveLength(2);
    expect(compareRatchet(recorded, grown)).toMatchObject({ violations: [], lowered: expect.arrayContaining([expect.stringContaining('rawControls')]) });
  });

  it('holds for the repository against its recorded counts', () => {
    const recorded = JSON.parse(readFileSync(join(repo, 'scripts/poolday-ui-ratchet.json'), 'utf8'));
    expect(compareRatchet(measureLegacy(repo), recorded).violations).toEqual([]);
  });
});
