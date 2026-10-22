import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { buildZeroSource, collectZeroSource } from '../../scripts/build-zero-source.js';
import { exportZeroImage, materializeZeroImage, validateZeroImage, validateZeroSource } from '../../self/zero/image.js';

const readSource = path => readFile(resolve(import.meta.dirname, '../../self', path), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const digest = content => createHash('sha256').update(content).digest('hex');
const vfs = files => ({ read: async path => files.get(path) ?? null,
  list: async prefix => [...files.keys()].filter(path => path.startsWith(prefix)) });
let sources, descriptor;

function receipt(name, code) {
  const hash = digest(code), transcriptHash = digest('fixture transcript');
  return {
    schema: 'reploid.zero.createToolEvidence.v3', action: 'CreateTool.activate', toolName: name,
    targetPath: `/self/tools/${name}.js`, evidencePath: `/artifacts/${name}-evidence.json`,
    candidateHash: hash, targetHash: hash, activated: true, validationPassed: true,
    activationChecksPassed: true, replayPassed: true,
    checks: { verification: { kind: 'static-worker', passed: true, skipped: false, hash },
      validation: { passed: true, activationContractValid: true },
      activation: { passed: true, executed: true, declaredChecksPassed: true,
        runtimeLoaded: true, installedBytesMatch: true, transcriptHash, checkCount: 1 },
      replay: { passed: true, executed: true, matchesActivationTranscript: true, transcriptHash, checkCount: 1 } }
  };
}

describe('compact Zero source image', () => {
  it('keeps the checked-in descriptor bound to the actual source closure', async () => {
    expect(await readSource('zero/source.json')).toBe(`${JSON.stringify(await buildZeroSource(), null, 2)}\n`);
  });
  beforeAll(async () => {
    descriptor = await buildZeroSource();
    sources = new Map(await Promise.all(descriptor.files.map(async ({ path }) => [`/${path}`, await readSource(path)])));
    sources.set('/zero/source.json', `${JSON.stringify(descriptor, null, 2)}\n`);
  });

  it('copies the actual source closure into an isolated fresh VFS and exports it repeatedly without original storage', async () => {
    const live = new Map([...sources,
      ['/state/zero.json', '{"messages":["private conversation"]}'],
      ['/config/credentials.json', '{"apiKey":"private credential"}'],
      ['/artifacts/Example-evidence.json', '{"private":"run evidence"}'],
      ['/self/tools/Unactivated.js', 'throw new Error("not activated");']]);
    const image = await exportZeroImage(vfs(live));
    expect(Object.keys(image.files).sort()).toEqual([...sources.keys()].sort());
    const host = await materializeZeroImage(image);
    expect(host.files['/index.html']).toBe(sources.get('/zero/index.html'));
    expect(host.files['/zero/index.html']).toBe(sources.get('/zero/index.html'));

    const fresh = new Map();
    const seed = validateZeroSource(JSON.parse(host.files['/zero/source.json']));
    for (const { path } of seed.files) fresh.set(`/${path}`, host.files[`/${path}`]);
    fresh.set('/zero/source.json', host.files['/zero/source.json']);
    const descendant = await exportZeroImage(vfs(fresh));
    const secondHost = await materializeZeroImage(descendant);
    const second = await exportZeroImage(vfs(new Map(Object.entries(secondHost.files))));
    expect(descendant).toEqual(image);
    expect(second).toEqual(image);
    expect((await validateZeroImage(image)).fileCount).toBe(sources.size);
    expect(JSON.stringify(image)).not.toContain('private credential');
    expect(JSON.stringify(image)).not.toContain('private conversation');
  });

  it.each(['/', '/index.html', '/zero', '/zero/', '/zero/index.html'])(
    'standalone entry redirects root documents before boot and boots directly within Zero: %s', async pathname => {
      const html = sources.get('/zero/index.html');
      const page = new DOMParser().parseFromString(html, 'text/html');
      const calls = [];
      const location = { pathname, search: '?instance=copy&mode=local', hash: '#source',
        replace: url => calls.push(['replace', url]) };
      const load = async path => {
        calls.push(['import', path]);
        return { bootZero: () => calls.push(['boot']) };
      };
      // Evaluate the actual entry script with only its dynamic-import host port replaced.
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const script = page.querySelector('script[type="module"]').textContent.replace(/\bimport\(/g, 'load(');
      await new AsyncFunction('location', 'load', script)(location, load);
      expect(calls).toEqual(pathname === '/' || pathname === '/index.html'
        ? [['replace', '/zero?instance=copy&mode=local#source']]
        : [['import', '/zero/boot.js'], ['boot']]);
      const entry = descriptor.files.find(({ path }) => path === 'zero/index.html');
      expect(entry).toMatchObject({ bytes: Buffer.byteLength(html), sha256: digest(html) });
    });

  it('requires an actual head element when materializing the counted entry HTML', async () => {
    const files = new Map(sources), source = clone(descriptor);
    const html = '<html><body>No head</body></html>';
    files.set('/zero/index.html', html);
    Object.assign(source.files.find(({ path }) => path === 'zero/index.html'),
      { bytes: Buffer.byteLength(html), sha256: digest(html) });
    files.set('/zero/source.json', JSON.stringify(source));
    await expect(materializeZeroImage(await exportZeroImage(vfs(files)))).rejects.toThrow('missing its head element');
  });

  it('resolves every actual static and literal-dynamic import and HTML/CSS asset using only the copied payload', async () => {
    const host = await materializeZeroImage(await exportZeroImage(vfs(sources)));
    const closed = await collectZeroSource(descriptor.files.map(({ path }) => path), async path => {
      if (!Object.hasOwn(host.files, `/${path}`)) throw new Error(`Undeclared copied dependency: ${path}`);
      return host.files[`/${path}`];
    });
    expect(closed.size).toBe(descriptor.files.length);
    const imported = [];
    new Function('self', 'importScripts', host.files['/sw.js'])(
      { location: { href: 'https://copy.test/sw.js?v=copy' } }, path => imported.push(new URL(path, 'https://copy.test').pathname));
    for (const path of imported) expect(host.files[path]).toEqual(expect.any(String));
  });

  it('rejects modified UTF-8 bytes, missing payload, undeclared state and descriptor self-digests', async () => {
    const image = await exportZeroImage(vfs(sources));
    const changed = clone(image);
    changed.files['/zero/main.js'] += '\n// λ';
    await expect(validateZeroImage(changed)).rejects.toThrow('integrity mismatch');
    const absent = clone(image);
    delete absent.files['/core/vendor/acorn.js'];
    await expect(materializeZeroImage(absent)).rejects.toThrow('Missing Zero source');
    const extra = clone(image);
    extra.files['/state/zero.json'] = '{}';
    await expect(validateZeroImage(extra)).rejects.toThrow('Undeclared');
    const recursive = clone(descriptor);
    recursive.files.push({ path: 'zero/source.json', bytes: 0, sha256: digest('') });
    expect(() => validateZeroSource(recursive)).toThrow('cannot hash itself');
  });

  it('binds the inner descriptor even when the outer envelope is rehashed', async () => {
    const image = await exportZeroImage(vfs(sources));
    image.files['/zero/agent.js'] += '\n// modified';
    const entry = image.manifest.find(entry => entry.path === 'zero/agent.js');
    entry.bytes = Buffer.byteLength(image.files['/zero/agent.js']);
    entry.sha256 = digest(image.files['/zero/agent.js']);
    await expect(validateZeroImage(image)).rejects.toThrow('integrity mismatch: zero/agent.js');
    await expect(validateZeroImage({ schema: 'reploid/self-image-export/v1', version: 1 })).rejects.toThrow('Invalid Zero image');
  });

  it.each([
    'state/zero.json', 'artifacts/Example-evidence.json', 'recordings/run.json', 'receipts/receipt.json',
    'config/credentials.json', 'config/settings.json', 'config/api-keys.json', 'config/provider-config.json',
    'zero/state.json', 'zero/settings.js', 'core/credentials.js', 'vendor/reploid/cache/messages.json',
    'self/state/zero.json', 'self/tools/Example.json', 'zero/history.md', 'zero/download.bin',
    'unrelated/private.js', 'config/self-source-manifest.json'
  ])('rejects correctly hashed runtime or private data declared as source: %s', async path => {
    const content = '{"private":"must not leave the instance"}';
    const source = clone(descriptor);
    source.files.push({ path, bytes: Buffer.byteLength(content), sha256: digest(content) });
    const files = new Map([...sources, [`/${path}`, content], ['/zero/source.json', JSON.stringify(source)]]);
    expect(() => validateZeroSource(source)).toThrow('Not exportable Zero source');
    await expect(exportZeroImage(vfs(files), { includeTools: true })).rejects.toThrow('Not exportable Zero source');
    // Rebuilding both hash layers cannot turn runtime/private data into source.
    const image = { schema: 'reploid.zero.image/v1', version: 1, files: Object.fromEntries(files),
      manifest: [...files].map(([path, text]) => ({ path: path.slice(1), bytes: Buffer.byteLength(text), sha256: digest(text) })) };
    await expect(validateZeroImage(image)).rejects.toThrow('Not exportable Zero source');
    await expect(materializeZeroImage(image)).rejects.toThrow('Not exportable Zero source');
  });

  it('preserves new capsule code and presentation assets within the explicit source boundary', async () => {
    const additions = { 'zero/helpers/format.js': 'export const format = value => String(value);',
      'zero/styles/panel.css': 'main { display: grid; }', 'zero/panel.html': '<main></main>', 'zero/icon.svg': '<svg/>' };
    const source = clone(descriptor), files = new Map(sources);
    for (const [path, content] of Object.entries(additions)) {
      source.files.push({ path, bytes: Buffer.byteLength(content), sha256: digest(content) });
      files.set(`/${path}`, content);
    }
    files.set('/zero/source.json', JSON.stringify(source));
    const image = await exportZeroImage(vfs(files));
    for (const [path, content] of Object.entries(additions)) expect(image.files[`/${path}`]).toBe(content);
  });

  it('exports activated installed bytes, omits receipts, and preserves descendants as source without activation authority', async () => {
    const code = 'export default async () => "fixture output";\n';
    const live = new Map([...sources, ['/self/tools/Example.js', code],
      ['/artifacts/Example-evidence.json', JSON.stringify(receipt('Example', code))],
      ['/self/tools/Memory.js', code], ['/artifacts/Memory-evidence.json', JSON.stringify(receipt('Memory', code))]]);
    expect((await exportZeroImage(vfs(live))).files).not.toHaveProperty('/self/tools/Example.js');
    const image = await exportZeroImage(vfs(live), { includeTools: true });
    expect(image.files['/self/tools/Example.js']).toBe(code);
    expect(image.files['/self/tools/Memory.js']).toBe(code);
    expect(image.files).not.toHaveProperty('/artifacts/Example-evidence.json');
    const host = await materializeZeroImage(image);
    const fresh = new Map(Object.entries(host.files));
    expect(fresh.has('/artifacts/Example-evidence.json')).toBe(false);
    expect(await exportZeroImage(vfs(fresh), { includeTools: true })).toEqual(image);
  });

  it.each([
    ['missing receipt', record => null],
    ['changed target hash', record => ({ ...record, targetHash: digest('different') })],
    ['not activated', record => ({ ...record, activated: false })],
    ['skipped worker', record => ({ ...record, checks: { ...record.checks,
      verification: { ...record.checks.verification, skipped: true } } })],
    ['failed replay', record => ({ ...record, replayPassed: false })],
    ['missing transcript binding', record => ({ ...record, checks: {
      ...record.checks, activation: { ...record.checks.activation, transcriptHash: undefined },
      replay: { ...record.checks.replay, transcriptHash: undefined } } })]
  ])('does not export installed source with %s', async (_label, mutate) => {
    const code = 'export default () => 7;';
    const evidence = mutate(receipt('Example', code));
    const live = new Map([...sources, ['/self/tools/Example.js', code]]);
    if (evidence) live.set('/artifacts/Example-evidence.json', JSON.stringify(evidence));
    const image = await exportZeroImage(vfs(live), { includeTools: true });
    expect(image.files).not.toHaveProperty('/self/tools/Example.js');
    live.set('/self/tools/Example.js', code + '// changed');
    expect((await exportZeroImage(vfs(live), { includeTools: true })).files).not.toHaveProperty('/self/tools/Example.js');
  });
});

describe('Zero source discovery', () => {
  it('follows static re-exports, literal dynamic imports, HTML, CSS and classic worker edges', async () => {
    const files = {
      'zero/index.html': '<link rel="stylesheet" href="./style.css"><script type="module" src="./main.js"></script>',
      'zero/style.css': '@import "./shared.css"; body{background:url(./icon.svg)}',
      'zero/shared.css': '', 'zero/icon.svg': '<svg/>',
      'zero/main.js': 'export * from "./agent.js"; const load = () => import("./provider.js");',
      'zero/agent.js': 'importScripts("./parser.js");', 'zero/parser.js': '', 'zero/provider.js': ''
    };
    const read = async path => { if (!(path in files)) throw new Error(`Missing ${path}`); return files[path]; };
    expect([...(await collectZeroSource(['zero/index.html'], read)).keys()].sort()).toEqual(Object.keys(files).sort());
    delete files['zero/provider.js'];
    await expect(collectZeroSource(['zero/index.html'], read)).rejects.toThrow('Missing zero/provider.js');
  });

  it.each([
    ['import "https://remote.test/module.js";', 'Undeclared Zero dependency'],
    ['import "../../outside.js";', 'escapes its root'],
    ['import "../lab/profiles.js";', 'legacy boot/DI'],
    ['import "../config/self-source-catalog.json";', 'legacy inventory'],
    ['const load = () => import("optional-package");', 'Undeclared Zero dependency']
  ])('rejects undeclared or noncompact graph edges: %s', async (code, error) => {
    await expect(collectZeroSource(['zero/main.js'], async () => code)).rejects.toThrow(error);
  });
});
