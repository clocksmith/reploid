// @vitest-environment node
import { readFileSync } from 'node:fs';
import { Worker as NodeWorker } from 'node:worker_threads';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VerificationManager from '../../self/core/verification-manager.js';
import ToolWriter from '../../self/core/tool-writer.js';
import ToolRunner from '../../self/core/tool-runner.js';
import SubstrateLoaderModule from '../../self/capabilities/system/substrate-loader.js';
import { loadVfsModule, clearVfsModuleCache } from '../../self/core/vfs-module-loader.js';
import CreateTool from '../../self/tools/CreateTool.js';
import { exportSelfImage, materializeSelfImage } from '../../self/image/export.js';
import { sha256 } from '../../self/core/promotion-policy.js';

const source = readFileSync(new URL('../../self/core/verification-worker.js', import.meta.url), 'utf8');
const parser = readFileSync(new URL('../../self/core/vendor/acorn.js', import.meta.url), 'utf8');
const code = `export const tool = { name: 'Echo', activation: { checks: [{ name: 'echo', args: { value: 'ok' }, expected: { value: 'ok' } }] } };
export default async function(args) { return args; }`;
const Utils = { logger: { info() {}, warn() {}, error() {}, debug() {} }, Errors: { ValidationError: Error, ToolError: Error } };

// Real separate Node Worker runs the unchanged classic browser Worker/parser.
// Only the browser transport globals are adapted; candidate source is not run.
let workerSource = source;
let parserSource = parser;
class ClassicWorker {
  constructor(url) {
    const workerUrl = new URL(url, globalThis.location.href);
    const parserUrl = new URL('./acorn.js', workerUrl);
    for (const key of ['instance', 'surface']) {
      if (workerUrl.searchParams.has(key)) parserUrl.searchParams.set(key, workerUrl.searchParams.get(key));
    }
    this.worker = new NodeWorker(`const { parentPort } = require('node:worker_threads');
      const vm = require('node:vm');
      globalThis.crypto = require('node:crypto').webcrypto;
      globalThis.self = { location: { href: ${JSON.stringify(workerUrl.href)} }, postMessage: data => parentPort.postMessage(data) };
      globalThis.importScripts = url => {
        if (url !== ${JSON.stringify(parserUrl.href)}) throw Error('Undeclared parser source or scope');
        const parserGlobal = {};
        vm.runInNewContext(${JSON.stringify(parserSource)}, parserGlobal);
        globalThis.acorn = parserGlobal.acorn;
      };
      vm.runInThisContext(${JSON.stringify(workerSource)});
      parentPort.on('message', data => self.onmessage({ data }));`, { eval: true });
    this.url = url;
    this.worker.on('message', data => this.onmessage?.({ data }));
    this.worker.on('error', error => this.onerror?.(error));
  }
  postMessage(data) { this.worker.postMessage(data); }
  terminate() { this.worker.terminate(); }
}

// Explicit browser-control fixture for Node Worker tests, not a production bypass.
function controlledLab(surface = 'x', instance = null) {
  const location = new URL(`https://export.test/${surface}${instance ? `?instance=${instance}` : ''}`);
  const controller = { state: 'activated', scriptURL: 'https://export.test/sw.js?v=fixture' };
  const registration = { scope: `https://export.test/${surface}`, active: controller };
  const serviceWorker = { controller, getRegistration: vi.fn(async () => registration) };
  vi.stubGlobal('location', location);
  vi.stubGlobal('window', { location, getReploidMode: () => surface });
  vi.stubGlobal('navigator', { serviceWorker });
  return { controller, registration, serviceWorker };
}
beforeEach(() => { controlledLab(); });

function setup(verifier) {
  vi.stubGlobal('crypto', webcrypto);
  const files = new Map();
  const VFS = {
    write: vi.fn(async (path, content) => files.set(path, content)),
    read: vi.fn(async path => files.get(path)),
    exists: vi.fn(async path => files.has(path)),
    delete: vi.fn(async path => files.delete(path))
  };
  const SubstrateLoader = { loadModule: vi.fn(async () => true) };
  const writer = ToolWriter.factory({ Utils, VFS, SubstrateLoader, VerificationManager: verifier });
  return { files, VFS, writer, SubstrateLoader };
}
const approving = { verifyProposal: async files => ({
  passed: true, skipped: false,
  verification: { kind: 'static-worker', fileHashes: Object.fromEntries(await Promise.all(
    Object.entries(files).map(async ([path, content]) => [path, await sha256(content)])
  )) }
}) };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); workerSource = source; parserSource = parser; clearVfsModuleCache(); delete globalThis.__unapprovedImport; });

describe('required L0 static verification', () => {
  it.each([
    ['missing', undefined], ['skipped', { passed: true, skipped: true }],
    ['failed', { passed: false, reason: 'Verification Failed' }],
    ['timeout', { passed: false, reason: 'Timeout' }],
    ['unbound success', { passed: true }],
    ['wrong hash', { passed: true, skipped: false, verification: { kind: 'static-worker', fileHashes: { '/tools/Echo.js': 'wrong' } } }]
  ])('refuses %s approval before any stage or optional load', async (_name, result) => {
    const verifier = result && { verifyProposal: vi.fn(async () => result) };
    const { writer, VFS, SubstrateLoader } = setup(verifier);
    await expect(writer.create('Echo', code, { load: true })).rejects.toThrow(/Verification/);
    expect(VFS.write).not.toHaveBeenCalled();
    expect(SubstrateLoader.loadModule).not.toHaveBeenCalled();
  });

  it.each(['absent', 'uncontrolled', 'different active', 'wrong scope', 'wrong script', 'inactive', 'changed controller'])('refuses required lab creation with %s VFS delivery before staging', async state => {
    const { controller, registration, serviceWorker } = controlledLab();
    if (state === 'absent') vi.stubGlobal('navigator', {});
    if (state === 'uncontrolled') serviceWorker.controller = null;
    if (state === 'different active') registration.active = {};
    if (state === 'wrong scope') registration.scope = 'https://export.test/';
    if (state === 'wrong script') controller.scriptURL = 'https://export.test/other-worker.js';
    if (state === 'inactive') controller.state = 'installing';
    if (state === 'changed controller') serviceWorker.getRegistration.mockImplementation(async () => {
      serviceWorker.controller = {}; return registration;
    });
    const Worker = vi.fn();
    vi.stubGlobal('Worker', Worker);
    const manager = VerificationManager.factory({ Utils, VFS: {} });
    const { writer, VFS } = setup(manager);
    await expect(writer.create('Echo', code)).rejects.toThrow('VFS delivery unavailable');
    expect(Worker).not.toHaveBeenCalled();
    expect(VFS.write).not.toHaveBeenCalled();
  });

  it.each(['x', 'zero'])('uses the controlled in-scope %s Worker URL for default and named instances', async surface => {
    for (const instance of [null, 'other']) {
      const { serviceWorker } = controlledLab(surface, instance);
      let workerUrl;
      vi.stubGlobal('Worker', class extends ClassicWorker { constructor(url) { super(url); workerUrl = url; } });
      const manager = VerificationManager.factory({ Utils, VFS: {} });
      const { writer } = setup(manager);
      await expect(writer.create('Echo', code)).resolves.toMatchObject({ verification: { passed: true } });
      const expected = `/${surface}/__verifier__/worker.js?surface=${surface}${instance ? `&instance=${instance}` : ''}`;
      expect(workerUrl).toBe(expected);
      expect(serviceWorker.getRegistration).toHaveBeenCalledWith(`https://export.test${expected}`);
    }
  });

  it('binds the approval to exact staged bytes and cannot reuse a caller-authored receipt', async () => {
    const { writer } = setup(approving);
    const result = await writer.create('Echo', code);
    await expect(writer.assertVerified(result, code)).resolves.toMatchObject({ passed: true });
    await expect(writer.assertVerified(result, `${code}\n//changed`)).rejects.toThrow('bytes changed');
    await expect(writer.assertVerified({ ...result, verification: { ...result.verification } }, code)).rejects.toThrow('approval missing');
  });

  it('refuses a changed VFS stage before the direct optional load path', async () => {
    const { writer, VFS, SubstrateLoader } = setup(approving);
    VFS.read.mockResolvedValue(`${code}\n//changed`);
    await expect(writer.create('Echo', code, { load: true })).rejects.toThrow('bytes changed');
    expect(SubstrateLoader.loadModule).not.toHaveBeenCalled();
  });

  it('refuses changed source before CreateTool imports or installs it', async () => {
    const { writer, VFS } = setup(approving);
    vi.stubGlobal('window', { getReploidMode: () => 'x' });
    const create = writer.create;
    writer.create = async (...args) => {
      const result = await create(...args);
      await VFS.write(result.path, `${code}\nthrow new Error('candidate executed');`);
      return result;
    };
    const runner = { loadPath: vi.fn() };
    await expect(CreateTool({ name: 'Echo', code }, { ToolWriter: writer, VFS, ToolRunner: runner })).rejects.toThrow('bytes changed');
    expect(VFS.write.mock.calls.some(([path]) => path.startsWith('/self/tools/'))).toBe(false);
    expect(runner.loadPath).not.toHaveBeenCalled();
  });

  it('checks the approval again when source changes during activation checks', async () => {
    const { writer, VFS, files } = setup(approving);
    vi.stubGlobal('window', { getReploidMode: () => 'x' });
    let stagedReads = 0;
    VFS.read.mockImplementation(async path => {
      if (path === '/shadow/tools/Echo.js' && ++stagedReads === 3) return `${code}\n// changed after checks`;
      return files.get(path);
    });
    const runner = { loadPath: vi.fn() };
    await expect(CreateTool({ name: 'Echo', code }, { ToolWriter: writer, VFS, ToolRunner: runner, Utils })).rejects.toThrow('bytes changed');
    expect(files.has('/self/tools/Echo.js')).toBe(false);
    expect(runner.loadPath).not.toHaveBeenCalled();
  });

  it('carries the complete verifier and license through export, reseed and descendant re-export', async () => {
    const descriptor = JSON.parse(readFileSync(new URL('../../self/config/self-source-manifest.json', import.meta.url), 'utf8'));
    const files = new Map(descriptor.files.map((file, index) => [
      `/${descriptor.seedFiles[index]}`, readFileSync(new URL(`../../self/${file}`, import.meta.url), 'utf8')
    ]));
    const exportVfs = sourceFiles => exportSelfImage({}, {
      VFS: { list: async () => [...sourceFiles.keys()] },
      readFile: async ({ path }) => ({ content: sourceFiles.get(path) })
    });
    vi.stubGlobal('crypto', webcrypto);
    const image = await exportVfs(files);
    const host = await materializeSelfImage(image);
    for (const path of ['verification-manager.js', 'verification-worker.js', 'vendor/acorn.js', 'vendor/ACORN-LICENSE.txt']) {
      expect(host.files[`/core/${path}`]).toBe(files.get(`/core/${path}`));
    }
    workerSource = host.files['/core/verification-worker.js'];
    parserSource = host.files['/core/vendor/acorn.js'];
    vi.stubGlobal('Worker', ClassicWorker);
    const manager = VerificationManager.factory({ Utils, VFS: {} });
    const { writer } = setup(manager);
    await expect(writer.create('Echo', code)).resolves.toMatchObject({ verification: { kind: 'static-worker', passed: true } });
    const fresh = new Map(JSON.parse(host.files['/config/vfs-manifest.json']).files.map(path => [
      `/${path}`, host.files[`/${path.startsWith('self/') ? path.slice(5) : path}`]
    ]));
    expect((await exportVfs(fresh)).files).toEqual(image.files);
    files.delete('/core/vendor/acorn.js');
    await expect(exportVfs(files)).rejects.toThrow('Missing text source');
  });

  it('refuses a final ToolRunner read changed after CreateTool checked installed bytes', async () => {
    const { writer, VFS, files } = setup(approving);
    vi.stubGlobal('window', { getReploidMode: () => 'x' });
    let installedReads = 0;
    VFS.read.mockImplementation(async path => {
      if (path === '/self/tools/Echo.js' && ++installedReads === 2) return `${code}\nglobalThis.__unapprovedImport = true;`;
      return files.get(path);
    });
    const runner = ToolRunner.factory({ Utils, VFS, ToolWriter: writer,
      SchemaRegistry: { registerToolSchema() {}, unregisterToolSchema() {} }, EventBus: { emit() {} } });
    await expect(CreateTool({ name: 'Echo', code }, { ToolWriter: writer, VFS, ToolRunner: runner, Utils })).rejects.toThrow('source hash mismatch');
    expect(globalThis.__unapprovedImport).toBeUndefined();
    expect(runner.has('Echo')).toBe(false);
  });

  it('binds the direct ToolWriter load=true path at SubstrateLoader import', async () => {
    const { VFS, files } = setup(approving);
    let stagedReads = 0;
    VFS.read.mockImplementation(async path => {
      if (++stagedReads === 2) return `${code}\nglobalThis.__unapprovedImport = true;`;
      return files.get(path);
    });
    const substrate = SubstrateLoaderModule.factory({ Utils, VFS });
    const writer = ToolWriter.factory({ Utils, VFS, VerificationManager: approving, SubstrateLoader: substrate });
    const result = await writer.create('Echo', code, { load: true });
    expect(result.toolLoaded).toBe(false);
    expect(result.toolLoadError).toContain('source hash mismatch');
    expect(globalThis.__unapprovedImport).toBeUndefined();
  });

  it('does not reuse a path-only in-flight import for a different approved source', async () => {
    vi.stubGlobal('crypto', webcrypto);
    let release;
    const delayed = new Promise(resolve => { release = resolve; });
    const VFS = { read: () => delayed };
    const pending = loadVfsModule({ VFS, path: '/self/tools/Race.js' });
    const approved = 'export default "approved";';
    const bound = await loadVfsModule({ VFS, path: '/self/tools/Race.js', code: approved, expectedSha256: await sha256(approved) });
    expect(bound.default).toBe('approved');
    release('export default "old in-flight bytes";');
    expect((await pending).default).toBe('old in-flight bytes');
  });

  it('runs the genuine Worker and parser even with security default off, then creates and activates', async () => {
    vi.stubGlobal('Worker', ClassicWorker);
    vi.stubGlobal('window', { getReploidMode: () => 'x', REPLOID_INSTANCE_ID: 'fixture' });
    const manager = VerificationManager.factory({ Utils, VFS: {} });
    const { writer, VFS } = setup(manager);
    const runner = { loadPath: vi.fn(async () => true) };
    const result = await CreateTool({ name: 'Echo', code }, { ToolWriter: writer, VFS, ToolRunner: runner, Utils });
    expect(result.activated).toBe(true);
    expect(result.verification).toMatchObject({ kind: 'static-worker', passed: true, skipped: false });
    expect(await VFS.read('/self/tools/Echo.js')).toBe(code);
    expect(runner.loadPath).toHaveBeenCalledOnce();
  });

  it('rejects prohibited code in the actual Worker without evaluating it', async () => {
    vi.stubGlobal('Worker', ClassicWorker);
    const manager = VerificationManager.factory({ Utils, VFS: {} });
    const { writer, VFS } = setup(manager);
    await expect(writer.create('Echo', `${code}\nfetch('https://invalid.test');`)).rejects.toThrow('Verification Failed');
    expect(VFS.write).not.toHaveBeenCalled();
  });

  it.each(['import "./unverified.js";', 'export * from "./unverified.js";'])('refuses unverified static dependency execution: %s', async dependency => {
    vi.stubGlobal('Worker', ClassicWorker);
    const manager = VerificationManager.factory({ Utils, VFS: {} });
    const { writer, VFS } = setup(manager);
    await expect(writer.create('Echo', `${dependency}\n${code}`)).rejects.toThrow('injected dependencies');
    expect(VFS.write).not.toHaveBeenCalled();
  });

  it('fails closed when Worker construction or execution is unavailable', async () => {
    vi.stubGlobal('crypto', webcrypto);
    vi.stubGlobal('Worker', class { constructor() { throw new Error('Worker unavailable'); } });
    const manager = VerificationManager.factory({ Utils, VFS: {} });
    await expect(manager.verifyProposal({ '/tools/Echo.js': code }, { requireVerification: true })).resolves.toMatchObject({ passed: false, reason: 'Worker unavailable' });
    vi.stubGlobal('Worker', class { terminate() {} postMessage() { this.onerror({ message: 'Parser missing' }); } });
    await expect(manager.verifyProposal({ '/tools/Echo.js': code }, { requireVerification: true })).resolves.toMatchObject({ passed: false, reason: 'Worker Error' });
  });

  it('terminates a timed-out Worker and refuses a forged Worker hash', async () => {
    const terminate = vi.fn();
    vi.stubGlobal('Worker', class { terminate = terminate; postMessage() {} });
    vi.stubGlobal('crypto', webcrypto);
    const manager = VerificationManager.factory({ Utils, VFS: {} });
    const result = manager.verifyProposal({ '/tools/Echo.js': code }, { requireVerification: true, timeout: 1 });
    await expect(result).resolves.toMatchObject({ passed: false, reason: 'Timeout' });
    expect(terminate).toHaveBeenCalledOnce();
    vi.stubGlobal('Worker', class { terminate() {} postMessage() { this.onmessage({ data: { passed: true, skipped: false, verification: { kind: 'static-worker', fileHashes: { '/tools/Echo.js': 'wrong' } } } }); } });
    await expect(manager.verifyProposal({ '/tools/Echo.js': code }, { requireVerification: true })).resolves.toMatchObject({ passed: false, reason: 'Worker source hash mismatch' });
  });
});
