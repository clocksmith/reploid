/* @vitest-environment happy-dom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ToolRunner from '../../self/core/tool-runner.js';
import DIContainer from '../../self/infrastructure/di-container.js';
import { isSecurityEnabled, setSecurityEnabled } from '../../self/core/security-config.js';

const fixture = vi.hoisted(() => ({ gate: null, loaded: vi.fn(), execute: vi.fn(async () => 'executed') }));
vi.mock('../../self/core/vfs-module-loader.js', () => ({
  loadVfsModule: async () => {
    fixture.loaded();
    if (fixture.gate) await fixture.gate;
    return { default: fixture.execute };
  }
}));
const logger = { info() {}, debug() {}, warn() {}, error() {} };
const sources = new Map([['/tools/CreateTool.js', '// retained source'], ['/self/tools/Partial.js', '// installed source']]);
const createRunner = (extra = {}) => ToolRunner.factory({
  Utils: { logger, Errors: { ToolError: Error }, trunc: String },
  VFS: { read: async path => sources.get(path), exists: async path => sources.has(path),
    list: async prefix => [...sources.keys()].filter(path => path.startsWith(prefix)) },
  EventBus: { emit() {} },
  ToolWriter: {},
  SchemaRegistry: { registerToolSchema() {}, unregisterToolSchema() {} },
  ...extra
});
let previousSecurity;
beforeEach(() => {
  previousSecurity = isSecurityEnabled();
  window.getReploidMode = () => 'x';
  localStorage.clear();
});
afterEach(() => {
  setSecurityEnabled(previousSecurity, { persist: false });
  delete window.getReploidMode;
  localStorage.clear();
  fixture.gate = null;
  vi.clearAllMocks();
});

it('terminally closes only its own instance, even with saved tools available to reload', async () => {
  const runner = createRunner();
  const healthy = createRunner();
  await runner.load('CreateTool');
  await healthy.load('CreateTool');
  const container = DIContainer.factory({ Utils: { logger } });
  container.register({ metadata: { id: 'ToolRunner' }, factory: () => runner });
  await container.resolve('ToolRunner');
  container.clearInstances();
  expect(runner.list()).toEqual([]);
  for (const call of [() => runner.execute('CreateTool'), () => runner.init(), () => runner.refresh(),
    () => runner.load('CreateTool'), () => runner.loadPath('/self/tools/Partial.js')]) {
    await expect(call()).rejects.toThrow('disposed');
  }
  expect(() => runner.allow('Partial')).toThrow('disposed');
  expect(fixture.execute).not.toHaveBeenCalled();
  await expect(healthy.execute('CreateTool')).resolves.toBe('executed');
  const retry = createRunner();
  await expect(retry.execute('CreateTool')).resolves.toBe('executed');
  expect(sources.get('/tools/CreateTool.js')).toBe('// retained source');
});

it('does not activate a tool whose asynchronous load finishes after disposal', async () => {
  let release;
  fixture.gate = new Promise(resolve => { release = resolve; });
  const runner = createRunner();
  const pending = runner.loadPath('/self/tools/Partial.js', 'Partial', { allow: true });
  await vi.waitFor(() => expect(fixture.loaded).toHaveBeenCalledOnce());
  runner.dispose();
  release();
  await expect(pending).rejects.toThrow('disposed');
  expect(runner.list()).toEqual([]);
  expect(fixture.execute).not.toHaveBeenCalled();
});

it('does not cross disposal when a pending human approval later arrives', async () => {
  setSecurityEnabled(true, { persist: false });
  let request;
  const runner = createRunner({
    PolicyEngine: { check: async () => ({ allowed: true, warnings: [] }) },
    HITLController: {
    getState: () => ({ config: { approvalMode: 'manual' } }),
    requestApproval: value => { request = value; }
  } });
  await runner.load('CreateTool');
  const pending = runner.execute('CreateTool');
  await vi.waitFor(() => expect(request?.onApprove).toBeTypeOf('function'));
  runner.dispose();
  request.onApprove();
  await expect(pending).rejects.toThrow('disposed');
  expect(fixture.execute).not.toHaveBeenCalled();
  expect(runner.list()).toEqual([]);
});


it('does not cross disposal when an in-flight policy check allows the tool', async () => {
  setSecurityEnabled(true, { persist: false });
  let release;
  const check = vi.fn(() => new Promise(resolve => { release = resolve; }));
  const runner = createRunner({
    PolicyEngine: { check },
    HITLController: { getState: () => ({ config: { approvalMode: 'autonomous' } }) }
  });
  await runner.load('CreateTool');
  const pending = runner.execute('CreateTool');
  await vi.waitFor(() => expect(check).toHaveBeenCalledOnce());
  runner.dispose();
  release({ allowed: true, warnings: [] });
  await expect(pending).rejects.toThrow('disposed');
  expect(fixture.execute).not.toHaveBeenCalled();
});
