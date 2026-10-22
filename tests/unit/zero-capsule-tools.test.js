// @vitest-environment node
import { readFileSync } from 'node:fs';
import { Worker as NodeWorker } from 'node:worker_threads';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createZeroTools, verifiedToolSource } from '../../self/zero/tools.js';
import { filterToolDepsForMode, filterToolDepsForTool } from '../../self/core/tool-capabilities.js';
import { filterToolDepsForTool as compatibilityFilter } from '../../self/core/tool-runner.js';
import * as moduleLoader from '../../self/core/vfs-module-loader.js';
import { clearVfsModuleCache } from '../../self/core/vfs-module-loader.js';
import { sha256 } from '../../self/core/promotion-policy.js';
import createToolCore from '../../self/core/create-tool.js';
import { isSecurityEnabled, setSecurityEnabled } from '../../self/core/security-config.js';

const workerSource = readFileSync(new URL('../../self/core/verification-worker.js', import.meta.url), 'utf8');
const parserSource = readFileSync(new URL('../../self/core/vendor/acorn.js', import.meta.url), 'utf8');
// Real unchanged verifier/parser in a separate Worker. Only browser transport is adapted.
class ClassicWorker {
  constructor(url) {
    this.worker = new NodeWorker(`const { parentPort } = require('node:worker_threads');
      const vm = require('node:vm');
      globalThis.crypto = require('node:crypto').webcrypto;
      globalThis.self = { location: { href: ${JSON.stringify(new URL(url, globalThis.location.href).href)} },
        postMessage: data => parentPort.postMessage(data) };
      globalThis.importScripts = () => {
        const scope = {};
        vm.runInNewContext(${JSON.stringify(parserSource)}, scope);
        globalThis.acorn = scope.acorn;
      };
      vm.runInThisContext(${JSON.stringify(workerSource)});
      parentPort.on('message', data => self.onmessage({ data }));`, { eval: true });
    this.worker.on('message', data => this.onmessage?.({ data }));
    this.worker.on('error', error => this.onerror?.(error));
  }
  postMessage(data) { this.worker.postMessage(data); }
  terminate() { this.worker.terminate(); }
}
const logger = { info() {}, warn() {}, debug() {}, error() {} };
const echo = `export const tool = {
  name: 'Echo', description: 'Echo a value',
  inputSchema: { type: 'object', required: ['value'], properties: { value: { type: 'string' } } },
  activation: { checks: [{ name: 'echo', args: { value: 'ok' }, expected: { value: 'ok' } }] }
};
export default async function(args) { return args; }`;
function setup(entries = []) {
  const files = new Map(entries);
  const VFS = {
    read: vi.fn(async path => { if (!files.has(path)) throw new Error(`File not found: ${path}`); return files.get(path); }),
    write: vi.fn(async (path, code) => { files.set(path, code); }),
    delete: vi.fn(async path => files.delete(path)),
    exists: vi.fn(async path => files.has(path)),
    list: vi.fn(async prefix => [...files.keys()].filter(path => path.startsWith(prefix)))
  };
  const emit = vi.fn();
  return { files, VFS, emit, create: () => createZeroTools({ VFS, logger, emit }) };
}
let previousSecurity;
beforeEach(() => {
  previousSecurity = isSecurityEnabled();
  setSecurityEnabled(false, { persist: false });
  const location = new URL('https://zero.test/zero?instance=fixture');
  const controller = { state: 'activated', scriptURL: 'https://zero.test/sw.js' };
  vi.stubGlobal('location', location);
  vi.stubGlobal('window', { location, getReploidMode: () => 'zero' });
  vi.stubGlobal('navigator', { serviceWorker: { controller,
    getRegistration: async () => ({ scope: 'https://zero.test/zero', active: controller }) } });
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('Worker', ClassicWorker);
});
afterEach(() => {
  vi.useRealTimers();
  setSecurityEnabled(previousSecurity, { persist: false });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  clearVfsModuleCache();
});

describe('Zero capsule tool composition', () => {
  it('installs with the genuine gates, validates inputs and restores only after fresh checking', async () => {
    const { create, VFS } = setup();
    const service = await create();
    expect(service.schemas().map(schema => schema.function.name)).toEqual(['CreateTool']);
    const result = await service.execute('CreateTool', { name: 'Echo', code: echo });
    expect(result).toMatchObject({ activated: true, validationPassed: true, activationChecksPassed: true, replayPassed: true });
    expect((await verifiedToolSource(VFS, '/self/tools/Echo.js')).code).toBe(echo);
    await expect(service.execute('Echo', { value: 'hello' })).resolves.toEqual({ value: 'hello' });
    await expect(service.execute('Echo', { value: 4 })).rejects.toThrow('Invalid Echo arguments');
    await expect(service.execute('LoadModule', {})).rejects.toThrow('not available');
    service.dispose();
    expect(service.schemas()).toEqual([]);
    const fresh = await create();
    await expect(fresh.execute('Echo', { value: 'no' })).rejects.toThrow('not available');
    expect(await fresh.restore()).toEqual({ restored: ['Echo'], rejected: [] });
    await expect(fresh.execute('Echo', { value: 'again' })).resolves.toEqual({ value: 'again' });
    fresh.dispose();
  });

  it.each(['missing worker', 'failed worker', 'mismatched worker', 'missing service worker', 'wrong service worker'])('rejects %s before persisting any source', async state => {
    if (state === 'missing worker') vi.stubGlobal('Worker', undefined);
    if (state === 'failed worker') vi.stubGlobal('Worker', class { terminate() {} postMessage() { this.onerror({ message: 'Parser failed' }); } });
    if (state === 'mismatched worker') vi.stubGlobal('Worker', class { terminate() {} postMessage() {
      this.onmessage({ data: { passed: true, skipped: false, verification: { kind: 'static-worker', fileHashes: {} } } });
    } });
    if (state === 'missing service worker') vi.stubGlobal('navigator', {});
    if (state === 'wrong service worker') navigator.serviceWorker.controller.scriptURL = 'https://zero.test/other.js';
    const { create, files } = setup();
    const service = await create();
    await expect(service.execute('CreateTool', { name: 'Echo', code: echo })).rejects.toThrow(/Verification/);
    expect(files.size).toBe(0);
    expect(service.schemas()).toHaveLength(1);
    service.dispose();
  });

  it('rejects unverified imported code and failed declared fixtures before installation', async () => {
    const { create, files } = setup();
    const service = await create();
    await expect(service.execute('CreateTool', { name: 'Echo', code: `import './unverified.js';\n${echo}` })).rejects.toThrow('injected dependencies');
    await expect(service.execute('CreateTool', { name: 'Echo', code: echo.replace("return args;", "return { value: 'wrong' };") })).rejects.toThrow('activation check');
    expect(files.has('/self/tools/Echo.js')).toBe(false);
    expect(service.schemas()).toHaveLength(1);
    service.dispose();
  });

  it('refuses bare installed source and stale/tampered evidence without importing it', async () => {
    const { create, files, VFS } = setup([['/self/tools/Bare.js', echo.replaceAll('Echo', 'Bare')]]);
    const first = await create();
    expect((await first.restore()).rejected).toHaveLength(1);
    await first.execute('CreateTool', { name: 'Echo', code: echo });
    files.set('/self/tools/Echo.js', `${echo}\nthrow Error('tampered source executed');`);
    await expect(first.execute('Echo', { value: 'no' })).rejects.toThrow('source changed');
    await expect(verifiedToolSource(VFS, '/self/tools/Echo.js')).rejects.toThrow('matching activation evidence');
    first.dispose();
    const second = await create();
    expect((await second.restore()).rejected).toHaveLength(2);
    expect(second.schemas()).toHaveLength(1);
    second.dispose();
  });

  it('requires fresh verification on restore even when saved evidence was once valid', async () => {
    const { create, files } = setup();
    const first = await create();
    await first.execute('CreateTool', { name: 'Echo', code: echo });
    first.dispose();
    const originals = new Map(files);
    vi.stubGlobal('Worker', undefined);
    const second = await create();
    expect(await second.restore()).toMatchObject({ restored: [], rejected: [{ path: '/self/tools/Echo.js' }] });
    expect(files).toEqual(originals);
    expect(second.schemas()).toHaveLength(1);
    second.dispose();
  });

  it('keeps gates and raw storage out of generated dependencies and blocks source writes', async () => {
    const { create, files } = setup();
    const service = await create();
    const code = `export const tool = { name: 'Inspect', capabilities: ['vfs:write', 'tool:load', 'self:write'],
      activation: { checks: [{ name: 'ports', args: {}, expected: { writer: false, verifier: false, registry: false, writes: true } }] } };
      export default async function(args, deps) {
        if (args.path) return deps.VFS.write(args.path, 'changed');
        if (args.load) return deps.ToolRunner.loadPath(args.load, 'Arbitrary', { allow: true });
        return { writer: !!deps.ToolWriter, verifier: !!deps.VerificationManager, registry: !!deps.SchemaRegistry, writes: !!deps.VFS.write };
      }`;
    await service.execute('CreateTool', { name: 'Inspect', code });
    await expect(service.execute('Inspect')).resolves.toEqual({ writer: false, verifier: false, registry: false, writes: true });
    for (const path of ['/core/verification-worker.js', '/self/tools/Other.js', '/zero/boot.js', '/shadow/../self/boot.js', '/artifacts/Inspect-evidence.json']) {
      await expect(service.execute('Inspect', { path })).rejects.toThrow(/not writable|traversal|protected/);
      expect(files.get(path)).not.toBe('changed');
    }
    await expect(service.execute('Inspect', { load: '/self/tools/Other.js' })).rejects.toThrow('activation authority');
    await service.execute('Inspect', { path: '/artifacts/result.txt' });
    expect(files.get('/artifacts/result.txt')).toBe('changed');
    service.dispose();
  });

  it('rolls back a failed evidence commit and retains existing source during a failed restore', async () => {
    const { create, files, VFS } = setup();
    const service = await create();
    const write = VFS.write.getMockImplementation();
    VFS.write.mockImplementation(async (path, content) => {
      if (path === '/artifacts/Echo-evidence.json') throw new Error('Storage full');
      return write(path, content);
    });
    await expect(service.execute('CreateTool', { name: 'Echo', code: echo })).rejects.toThrow('Storage full');
    expect(files.size).toBe(0);
    expect(service.schemas()).toHaveLength(1);
    VFS.write.mockImplementation(write);
    await service.execute('CreateTool', { name: 'Echo', code: echo });
    service.dispose();
    const originals = new Map(files);
    const restored = await create();
    let failed = false;
    VFS.write.mockImplementation(async (path, content) => {
      if (path === '/artifacts/Echo-evidence.json' && !failed) { failed = true; throw new Error('Storage full'); }
      return write(path, content);
    });
    expect((await restored.restore()).rejected).toHaveLength(1);
    expect(files).toEqual(originals);
    expect(restored.schemas()).toHaveLength(1);
    restored.dispose();
  });

  it('disposes an in-flight commit terminally, rolling back its writes and rejecting queued work', async () => {
    const { create, files, VFS } = setup();
    const service = await create();
    let release;
    const delayed = new Promise(resolve => { release = resolve; });
    const write = VFS.write.getMockImplementation();
    VFS.write.mockImplementation(async (path, content) => {
      await write(path, content);
      if (path === '/self/tools/Echo.js') await delayed;
    });
    const pending = service.execute('CreateTool', { name: 'Echo', code: echo });
    const queued = service.execute('Echo', { value: 'no' });
    const pendingCheck = expect(pending).rejects.toThrow('disposed');
    const queuedCheck = expect(queued).rejects.toThrow('disposed');
    await vi.waitFor(() => expect(files.has('/self/tools/Echo.js')).toBe(true));
    service.dispose();
    release();
    await Promise.all([pendingCheck, queuedCheck]);
    expect(files.size).toBe(0);
    expect(service.schemas()).toEqual([]);
    await expect(service.restore()).rejects.toThrow('disposed');
  });

  it('requires fresh replay transcript equality instead of trusting fixture assertions alone', async () => {
    const { create, files } = setup();
    const load = moduleLoader.loadVfsModule;
    vi.spyOn(moduleLoader, 'loadVfsModule').mockImplementation(async options => {
      const mod = await load(options);
      if (options.code?.includes('reploid-create-tool-replay:')) {
        return { ...mod, default: async (...args) => ({ ...await mod.default(...args), unexpected: true }) };
      }
      return mod;
    });
    const service = await create();
    await expect(service.execute('CreateTool', { name: 'Echo', code: echo })).rejects.toThrow('transcript did not match');
    expect(files.size).toBe(0);
    expect(service.schemas()).toHaveLength(1);
    service.dispose();
  });

  it('rejects corrupt persisted installation bytes and rolls back the uncommitted tool', async () => {
    const { create, files, VFS } = setup();
    const service = await create();
    const write = VFS.write.getMockImplementation();
    VFS.write.mockImplementation((path, content) => write(path, path === '/self/tools/Echo.js' ? 'corrupted' : content));
    await expect(service.execute('CreateTool', { name: 'Echo', code: echo })).rejects.toThrow('write mismatch');
    expect(files.size).toBe(0);
    await expect(service.execute('Echo', { value: 'no' })).rejects.toThrow('not available');
    service.dispose();
  });

  it('reactivates descriptor-bound descendant tools without importing prior receipts as authority', async () => {
    const { VFS, files } = setup([['/self/tools/Echo.js', echo]]);
    const source = { files: [{ path: 'self/tools/Echo.js', bytes: new TextEncoder().encode(echo).length, sha256: await sha256(echo) }] };
    const service = await createZeroTools({ VFS, source, logger });
    source.files[0].sha256 = 'changed by caller';
    await expect(service.execute('Echo', { value: 'no' })).rejects.toThrow('not available');
    expect(await service.restore()).toEqual({ restored: ['Echo'], rejected: [] });
    expect(files.has('/artifacts/Echo-evidence.json')).toBe(true);
    await expect(service.execute('Echo', { value: 'descendant' })).resolves.toEqual({ value: 'descendant' });
    service.dispose();
  });

  it('refuses changed exported bytes and a missing fresh verifier despite a source descriptor', async () => {
    const { VFS, files } = setup([['/self/tools/Echo.js', echo]]);
    const source = { files: [{ path: 'self/tools/Echo.js', bytes: new TextEncoder().encode(echo).length, sha256: await sha256(echo) }] };
    const service = await createZeroTools({ VFS, source, logger });
    files.set('/self/tools/Echo.js', echo + '\n// changed');
    expect((await service.restore()).rejected[0].error).toMatch('Exported tool source changed');
    files.set('/self/tools/Echo.js', echo);
    vi.stubGlobal('Worker', undefined);
    expect((await service.restore()).rejected[0].error).toMatch('Verification Worker refused');
    expect(files.size).toBe(1);
    service.dispose();
  });

  it('keeps restored originals when disposal occurs during fresh verification', async () => {
    const { create, files } = setup();
    const first = await create();
    await first.execute('CreateTool', { name: 'Echo', code: echo });
    first.dispose();
    const originals = new Map(files);
    let release;
    vi.stubGlobal('Worker', class extends ClassicWorker {
      postMessage(data) { release = () => super.postMessage(data); }
    });
    const second = await create();
    const pending = second.restore();
    const check = expect(pending).rejects.toThrow('disposed');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    second.dispose();
    release();
    await check;
    expect(files).toEqual(originals);
    expect(second.schemas()).toEqual([]);
  });

  it('keeps the shared creator stage-only without explicit host activation selection', async () => {
    const staged = { name: 'Echo', path: '/shadow/tools/Echo.js', staged: true };
    const deps = { ToolWriter: { create: vi.fn(async () => staged) }, ToolRunner: { loadPath: vi.fn() } };
    expect(await createToolCore({ name: 'Echo', code: echo }, deps)).toEqual(staged);
    expect(deps.ToolRunner.loadPath).not.toHaveBeenCalled();
  });

  it.each([['write', 'abort'], ['delete', 'abort'], ['write', 'dispose'], ['delete', 'dispose']])(
    'prevents delayed %s after %s without accepting tool-supplied cancellation options', async (method, stop) => {
      const { create, files, VFS } = setup([['/artifacts/out.txt', 'before']]);
      const service = await create();
      const code = `export const tool = { name: 'Mutate', capabilities: ['vfs:write'],
        activation: { checks: [{ name: 'ready', args: {}, expected: 'ready' }] } };
        export default async function(args, deps) {
          if (!args.path) return 'ready';
          const options = { signal: { aborted: false, throwIfAborted() {} }, ignored: true };
          if (args.method === 'delete') return deps.VFS.delete(args.path, options);
          return deps.VFS.write(args.path, 'after', options);
        }`;
      await service.execute('CreateTool', { name: 'Mutate', code });
      let release, started, received;
      const gate = new Promise(resolve => { release = resolve; });
      const entered = new Promise(resolve => { started = resolve; });
      const mutate = VFS[method].getMockImplementation();
      VFS[method].mockImplementation(async (path, ...args) => {
        if (path === '/artifacts/out.txt') {
          received = args[method === 'write' ? 1 : 0];
          started();
          await gate;
          received?.signal?.throwIfAborted();
        }
        return mutate(path, ...args);
      });
      const controller = new AbortController();
      const pending = service.execute('Mutate', { path: '/artifacts/out.txt', method },
        stop === 'abort' ? { signal: controller.signal } : undefined);
      const rejected = expect(pending).rejects.toThrow(stop === 'abort' ? /abort/i : /disposed/);
      await entered;
      expect(received).toEqual({ signal: expect.any(AbortSignal) });
      expect(received.signal.aborted).toBe(false);
      if (stop === 'abort') controller.abort();
      else service.dispose();
      expect(received.signal.aborted).toBe(true);
      release();
      await rejected;
      expect(files.get('/artifacts/out.txt')).toBe('before');
      service.dispose();
    }
  );

  it.each([false, true])('revokes settled invocation ports while a later call is active: %s', async later => {
    const { create, files, emit } = setup();
    const service = await create();
    const code = `export const tool = { name: 'Later', capabilities: ['vfs:write'],
      activation: { checks: [{ name: 'ready', args: {}, expected: 'ready' }] } };
      export default async function(args, deps) {
        if (args.write) return deps.VFS.write(args.write, 'nested');
        if (args.defer) setTimeout(async () => {
          try { await deps.VFS.write(args.defer, 'late'); } catch {}
          try { await deps.ToolRunner.execute('Later', { write: args.nested }); } catch {}
          try { deps.EventBus.emit('late'); } catch {}
          try { deps.Utils.logger.info('late'); } catch {}
        }, 25);
        if (args.hold) {
          deps.EventBus.emit('holding');
          await new Promise(resolve => setTimeout(resolve, 50));
          await deps.VFS.write(args.hold, 'current');
        }
        return 'ready';
      }`;
    await service.execute('CreateTool', { name: 'Later', code });
    const info = vi.spyOn(logger, 'info');
    vi.useFakeTimers();
    const controller = new AbortController();
    await service.execute('Later', { defer: '/artifacts/late.txt', nested: '/artifacts/nested.txt' }, { signal: controller.signal });
    let current;
    if (later) {
      let holding;
      const started = new Promise(resolve => { holding = resolve; });
      emit.mockImplementation((event, data) => { if (data?.event === 'holding') holding(); });
      current = service.execute('Later', { hold: '/artifacts/current.txt' }, { signal: controller.signal });
      await started;
    }
    await vi.advanceTimersByTimeAsync(25);
    expect(controller.signal.aborted).toBe(false);
    expect(files.has('/artifacts/late.txt')).toBe(false);
    expect(files.has('/artifacts/nested.txt')).toBe(false);
    expect(emit).not.toHaveBeenCalledWith('tool:event', expect.objectContaining({ event: 'late' }));
    expect(info).not.toHaveBeenCalledWith('late');
    if (current) {
      await vi.advanceTimersByTimeAsync(25);
      await expect(current).resolves.toBe('ready');
      expect(files.get('/artifacts/current.txt')).toBe('current');
    }
    service.dispose();
  });

  it('aborts a detached in-flight mutation when its invocation returns', async () => {
    const { create, VFS, files } = setup();
    const service = await create();
    const code = `export const tool = { name: 'Detached', capabilities: ['vfs:write'],
      activation: { checks: [{ name: 'ready', args: {}, expected: true }] } };
      export default async function(args, deps) {
        if (args.path) deps.VFS.write(args.path, 'late').catch(() => {});
        return true;
      }`;
    await service.execute('CreateTool', { name: 'Detached', code });
    const write = VFS.write.getMockImplementation();
    let release, received, mutation;
    const gate = new Promise(resolve => { release = resolve; });
    VFS.write.mockImplementation((path, value, options) => {
      received = options.signal;
      mutation = gate.then(() => { received.throwIfAborted(); return write(path, value); });
      return mutation;
    });
    await expect(service.execute('Detached', { path: '/artifacts/detached.txt' })).resolves.toBe(true);
    expect(received.aborted).toBe(true);
    release();
    await expect(mutation).rejects.toThrow('Tool invocation ended');
    expect(files.has('/artifacts/detached.txt')).toBe(false);
    service.dispose();
  });

  it('preserves generated read arguments instead of injecting mutation cancellation options', async () => {
    const { create, VFS } = setup([['/artifacts/input.txt', 'input']]);
    const service = await create();
    const code = `export const tool = { name: 'Read',
      activation: { checks: [{ name: 'ready', args: {}, expected: 'ready' }] } };
      export default async function(args, deps) {
        return args.path ? deps.VFS.read(args.path, { mode: 'text' }) : 'ready';
      }`;
    await service.execute('CreateTool', { name: 'Read', code });
    await expect(service.execute('Read', { path: '/artifacts/input.txt' })).resolves.toBe('input');
    expect(VFS.read).toHaveBeenLastCalledWith('/artifacts/input.txt', { mode: 'text' });
    service.dispose();
  });

  it('respects abort before dispatch and refuses saved gates it cannot supply', async () => {
    const { create, files } = setup();
    const service = await create();
    const controller = new AbortController();
    controller.abort();
    await expect(service.execute('CreateTool', { name: 'Echo', code: echo }, { signal: controller.signal })).rejects.toThrow();
    expect(files.size).toBe(0);
    service.dispose();
    setSecurityEnabled(true, { persist: false });
    await expect(create()).rejects.toThrow('PolicyEngine');
    setSecurityEnabled(false, { persist: false });
    vi.stubGlobal('localStorage', { getItem: key => key.endsWith('REPLOID_HITL_CONFIG') ? '{"approvalMode":"manual"}' : null });
    await expect(create()).rejects.toThrow('HITLController');
  });
});

it('retains the core capability filters without exposing new write or load authority', () => {
  expect(compatibilityFilter).toBe(filterToolDepsForTool);
  const deps = { Shell: {}, gitTools: {}, VFS: { read() {}, write() {} }, ToolRunner: { execute() {}, loadPath() {} } };
  expect(filterToolDepsForMode(deps, 'reploid')).toBe(deps);
  for (const mode of ['zero', 'x']) {
    const readOnly = filterToolDepsForTool(deps, mode, 'Read');
    expect(readOnly.Shell).toBeUndefined();
    expect(readOnly.gitTools).toBeUndefined();
    expect(readOnly.VFS.write).toBeUndefined();
    expect(readOnly.ToolRunner.loadPath).toBeUndefined();
    const capable = filterToolDepsForTool(deps, mode, 'Write', { capabilities: ['vfs:write', 'tool:load'] });
    expect(capable.VFS).toBe(deps.VFS);
    expect(capable.ToolRunner.loadPath).toBe(deps.ToolRunner.loadPath);
  }
});
