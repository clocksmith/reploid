// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// WriteFile's VFS policy currently refuses /core/ and /infrastructure/ before the
// core-write gate runs. Open the policy here so the gate itself is exercised.
vi.mock('../../self/config/vfs-policy.js', async (importOriginal) => ({
  ...(await importOriginal()),
  assertWritableVfsPath: () => {}
}));

const { default: writeFile } = await import('../../self/tools/WriteFile.js');
const { default: SubstrateLoaderModule } = await import('../../self/capabilities/system/substrate-loader.js');
const { loadVfsModule, clearVfsModuleCache } = await import('../../self/core/vfs-module-loader.js');
const { setSecurityEnabled } = await import('../../self/core/security-config.js');

const PATH = '/core/example.js';
const CONTENT = 'export const x = 1;\n';
const logger = { info() {}, warn() {}, error() {}, debug() {} };

function setup(verifyProposal) {
  const files = new Map();
  const VFS = {
    exists: vi.fn(async (p) => files.has(p)),
    read: vi.fn(async (p) => files.get(p) ?? null),
    write: vi.fn(async (p, c) => { files.set(p, c); })
  };
  const VFSSandbox = {
    createSnapshot: vi.fn(async () => 'snap'),
    applyChanges: vi.fn(async () => {}),
    restoreSnapshot: vi.fn(async () => {})
  };
  const VerificationManager = verifyProposal ? { verifyProposal: vi.fn(verifyProposal) } : undefined;
  const AuditLogger = { logEvent: vi.fn(async () => {}), logCoreWrite: vi.fn(async () => {}) };
  const EventBus = { emit: vi.fn() };
  return { files, deps: { VFS, VFSSandbox, VerificationManager, AuditLogger, EventBus } };
}

const write = (deps) => writeFile({ path: PATH, content: CONTENT }, deps);

function expectBlocked({ files, deps }, error) {
  expect(error?.message).toMatch(/^Core modification blocked/);
  expect(deps.VFS.write).not.toHaveBeenCalled();
  expect(files.has(PATH)).toBe(false);
  expect(deps.AuditLogger.logCoreWrite).not.toHaveBeenCalled();
  expect(deps.AuditLogger.logEvent).toHaveBeenCalledWith('CORE_WRITE_BLOCKED', expect.objectContaining({ path: PATH, verified: false }), 'WARN');
  expect(deps.EventBus.emit).toHaveBeenCalledWith('tool:core_blocked', expect.objectContaining({ path: PATH }));
}

describe('WriteFile core-write verification gate', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: (key) => (key === 'REPLOID_ARENA_GATING' ? 'true' : null) });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('writes and records verification only on an explicit Worker pass', async () => {
    const ctx = setup(async () => ({ passed: true, skipped: false, errors: [], warnings: [] }));
    await write(ctx.deps);
    expect(ctx.deps.VerificationManager.verifyProposal).toHaveBeenCalledWith(
      { [PATH]: CONTENT }, expect.objectContaining({ requireVerification: true }));
    expect(ctx.files.get(PATH)).toBe(CONTENT);
    expect(ctx.deps.AuditLogger.logCoreWrite).toHaveBeenCalledWith(expect.objectContaining({ path: PATH, arenaVerified: true }));
    expect(ctx.deps.VFSSandbox.restoreSnapshot).toHaveBeenCalledWith('snap');
  });

  it('blocks a failed verification', async () => {
    const ctx = setup(async () => ({ passed: false, errors: ['eval is prohibited'] }));
    expectBlocked(ctx, await write(ctx.deps).catch((e) => e));
  });

  it('blocks a skipped pass', async () => {
    const ctx = setup(async () => ({ passed: true, skipped: true, reason: 'Security disabled', errors: [] }));
    expectBlocked(ctx, await write(ctx.deps).catch((e) => e));
  });

  it('blocks when the verifier throws, and still restores the sandbox', async () => {
    const ctx = setup(async () => { throw new Error('worker exploded'); });
    const error = await write(ctx.deps).catch((e) => e);
    expectBlocked(ctx, error);
    expect(error.message).toContain('worker exploded');
    expect(ctx.deps.VFSSandbox.restoreSnapshot).toHaveBeenCalledWith('snap');
  });

  it('blocks when the verifier never answers', async () => {
    vi.useFakeTimers();
    const ctx = setup(() => new Promise(() => {}));
    const pending = write(ctx.deps).catch((e) => e);
    await vi.advanceTimersByTimeAsync(30000);
    const error = await pending;
    expectBlocked(ctx, error);
    expect(error.message).toMatch(/timed out/);
  });

  it('blocks when the verifier is unavailable', async () => {
    const ctx = setup(null);
    expectBlocked(ctx, await write(ctx.deps).catch((e) => e));
  });

  it('blocks when the sandbox is unavailable', async () => {
    const ctx = setup(async () => ({ passed: true, skipped: false }));
    delete ctx.deps.VFSSandbox;
    expectBlocked(ctx, await write(ctx.deps).catch((e) => e));
    expect(ctx.deps.VerificationManager.verifyProposal).not.toHaveBeenCalled();
  });

  it('does not record verification when the gate is off', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null });
    const ctx = setup(async () => ({ passed: true, skipped: false }));
    await write(ctx.deps);
    expect(ctx.deps.VerificationManager.verifyProposal).not.toHaveBeenCalled();
    expect(ctx.deps.AuditLogger.logCoreWrite).toHaveBeenCalledWith(expect.objectContaining({ arenaVerified: false }));
  });
});

describe('module loaders fail closed with security on', () => {
  beforeEach(() => {
    clearVfsModuleCache();
    setSecurityEnabled(true);
  });
  afterEach(() => {
    setSecurityEnabled(false);
    vi.unstubAllGlobals();
  });

  const vfsWith = (path, code) => ({ exists: async (p) => p === path, read: async (p) => (p === path ? code : null) });

  it('loadVfsModule refuses a verified load when no verifier is present', async () => {
    const path = '/tools/NoVerifier.js';
    await expect(loadVfsModule({ VFS: vfsWith(path, 'export default 1;'), logger, path, verify: true }))
      .rejects.toThrow(/verifier unavailable/);
  });

  it('loadVfsModule refuses a skipped or failed result', async () => {
    const path = '/tools/Skipped.js';
    for (const result of [{ passed: true, skipped: true }, { passed: false, errors: ['no'] }, undefined]) {
      clearVfsModuleCache();
      const VerificationManager = { verifyProposal: async () => result };
      await expect(loadVfsModule({ VFS: vfsWith(path, 'export default 1;'), logger, VerificationManager, path, verify: true, forceReload: true }))
        .rejects.toThrow(/Verification failed/);
    }
  });

  it('SubstrateLoader refuses a critical path when arena gating is on and the verifier is missing', async () => {
    vi.stubGlobal('localStorage', { getItem: (key) => (key === 'REPLOID_ARENA_GATING' ? 'true' : null) });
    const path = '/core/gated.js';
    const loader = SubstrateLoaderModule.factory({ Utils: { logger }, VFS: vfsWith(path, 'export default 1;') });
    await expect(loader.loadModule(path)).rejects.toThrow(/Arena verification failed/);
  });

  it('SubstrateLoader verifies a critical path through the loader when arena gating is off', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null });
    const path = '/core/ungated.js';
    const verifyProposal = vi.fn(async () => ({ passed: false, errors: ['refused'] }));
    const loader = SubstrateLoaderModule.factory({ Utils: { logger }, VFS: vfsWith(path, 'export default 1;'), VerificationManager: { verifyProposal } });
    await expect(loader.loadModule(path)).rejects.toThrow(/Verification failed/);
    expect(verifyProposal).toHaveBeenCalledOnce();
  });
});
