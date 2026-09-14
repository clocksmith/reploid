// @vitest-environment node
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModuleMetadataResolver } from '../../scripts/module-metadata.js';

// Keep a filesystem URL explicit: Vite treats new URL(relative, import.meta.url)
// as a browser asset reference under the default happy-dom environment.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../self');
const metadata = "{ metadata: { id: 'Agent', genesis: { introduced: 'capsule' } } }";

function fixture(sources, options = {}) {
  const reads = new Map();
  const resolve = createModuleMetadataResolver({
    ...options,
    rootDir: root,
    readSource: async (file) => {
      const relative = path.relative(root, file).split(path.sep).join('/');
      reads.set(relative, (reads.get(relative) || 0) + 1);
      if (!(relative in sources)) throw new Error('Unexpected metadata dependency');
      return sources[relative];
    }
  });
  return { read: (file) => resolve(path.join(root, file)), reads };
}

describe('static forwarded module metadata', () => {
  it('follows real public library adapters', async () => {
    const resolve = createModuleMetadataResolver({ rootDir: root });
    for (const [file, id, introduced] of [
      ['core/agent-loop.js', 'AgentLoop', 'capsule'],
      ['core/response-parser.js', 'ResponseParser', 'capsule'],
      ['core/improvement-episode.js', 'ImprovementEpisodeLedger', 'full']
    ]) {
      expect(await resolve(path.join(root, file))).toEqual({ id, introduced });
    }
  });

  it('follows named exports, imports, aliases and static object spreads once', async () => {
    const { read, reads } = fixture({
      'entry.js': "import { Agent as Parent } from './public.js'; const Child = { ...Parent, factory: () => { throw new Error('never execute'); } }; export default Child;",
      'public.js': "export { default as Agent } from './owner.js';",
      'owner.js': `const Agent = Object.freeze(${metadata}); export default Agent;`
    });
    expect(await read('entry.js')).toEqual({ id: 'Agent', introduced: 'capsule' });
    expect([...reads.values()]).toEqual([1, 1, 1]);
  });

  it('uses the exported object and respects later metadata overrides', async () => {
    const { read } = fixture({
      'entry.js': `const unrelated = ${metadata}; export default { ...unrelated, metadata: { id: 'Child', genesis: { introduced: 'full' } } };`
    });
    expect(await read('entry.js')).toEqual({ id: 'Child', introduced: 'full' });
  });

  it('rejects unknown override expressions without executing them', async () => {
    const { read } = fixture({
      'entry.js': `const base = ${metadata}; export default { ...base, ...(() => { throw new Error('never execute'); })() };`
    });
    expect(await read('entry.js')).toEqual({ id: null, introduced: null });
  });

  it('resolves forwarded dependency arrays for registry generation', async () => {
    const { read } = fixture({
      'entry.js': "export { default } from './owner.js';",
      'owner.js': "export default { metadata: { id: 'Agent', genesis: { introduced: 'capsule' }, dependencies: ['Utils', 'VFS?'] } };"
    }, { includeDependencies: true });
    expect(await read('entry.js')).toEqual({ id: 'Agent', introduced: 'capsule', dependencies: ['Utils', 'VFS?'] });
  });

  it('does not execute dynamic dependency declarations', async () => {
    const { read } = fixture({
      'entry.js': "export default { metadata: { id: 'Agent', genesis: { introduced: 'capsule' }, dependencies: getDependencies() } };"
    }, { includeDependencies: true });
    expect(await read('entry.js')).toEqual({ id: 'Agent', introduced: 'capsule', dependencies: null });
  });

  it('fails closed on cyclic exports and untrusted package imports', async () => {
    const { read } = fixture({
      'a.js': "export { default } from './b.js';",
      'b.js': "export { default } from './a.js';",
      'external.js': "export { default } from 'untrusted';"
    });
    expect(await read('a.js')).toEqual({ id: null, introduced: null });
    expect(await read('external.js')).toEqual({ id: null, introduced: null });
  });

  it('rejects imports outside the browser source root', async () => {
    const { read } = fixture({ 'entry.js': "export { default } from '../outside.js';" });
    await expect(read('entry.js')).rejects.toThrow('escapes browser source root');
  });
});
