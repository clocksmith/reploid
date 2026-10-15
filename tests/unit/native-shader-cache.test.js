// @vitest-environment node
// Sealed Mesa shader cache protocol (server/native-shader-cache.js) without a GPU: a fake /proc tree supplies
// process identity, injected observations stand in for Mesa's disk cache writer threads, and files written into
// MESA_SHADER_CACHE_DIR stand in for the driver's cache entries.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { nativeShaderCacheIdentity, observeMesaCacheWriters, openNativeShaderCache } from '../../server/native-shader-cache.js';

const KEY = 'a'.repeat(64), IDENTITY = { schema: 'fixture', program: { stage: 1 } };
const COMPLETE = { complete: true, count: 3, durationMs: 41000, pipelines: [{ key: 'state#main' }], planId: 'sha256:plan', index: 1 };
const procStat = (pid, start, state = 'S', comm = 'node') => `${pid} (${comm}) ${state} ${Array(18).fill('0').join(' ')} ${start} 0 0\n`;
let tmp, proc, root, clock;

async function writable(target) {
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat?.isDirectory()) return;
  await fs.chmod(target, 0o700);
  for (const name of await fs.readdir(target)) await writable(path.join(target, name));
}
async function alive(pid, start) {
  await fs.mkdir(path.join(proc, String(pid)), { recursive: true });
  await fs.writeFile(path.join(proc, String(pid), 'stat'), procStat(pid, start));
}
const exited = pid => fs.rm(path.join(proc, String(pid)), { recursive: true, force: true });
/** One simulated process binding; `writers` stands in for Mesa's writer threads at each observation. */
async function bind({ pid = 101, start = '5000', key = KEY, identity = IDENTITY, env = {}, writers = () => ({ writers: 4, busy: 0 }), events = [] } = {}) {
  await alive(pid, start);
  const cache = await openNativeShaderCache({ root, key, identity, env, platform: 'linux', proc, pid,
    observeWriters: async () => writers(env.MESA_SHADER_CACHE_DIR), quiescence: { intervalMs: 250, samples: 3, timeoutMs: 5000 },
    now: () => clock, sleep: async ms => { clock += ms; }, clock: () => new Date('2026-10-15T12:00:00Z'), onEvent: event => events.push(event) });
  return { cache, env, events, pid };
}
/** Stand-in for the driver writing pipeline entries. */
async function compile(env, name = 'part0/mesa_cache.db', bytes = 'nir+binary') {
  const file = path.join(env.MESA_SHADER_CACHE_DIR, 'mesa_shader_cache_db', name);
  await fs.mkdir(path.dirname(file), { recursive: true }); await fs.appendFile(file, bytes);
}
const sealedDirectory = (key = KEY) => path.join(root, 'v1/sealed', key);
const exists = target => fs.lstat(target).then(() => true, () => false);

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-shader-cache-'));
  proc = path.join(tmp, 'proc'); root = path.join(tmp, 'root'); clock = 0;
  await fs.mkdir(path.join(proc, 'sys/kernel/random'), { recursive: true });
  await fs.writeFile(path.join(proc, 'sys/kernel/random/boot_id'), '01234567-89ab-cdef-0123-456789abcdef\n');
});
afterEach(async () => { await writable(tmp); await fs.rm(tmp, { recursive: true, force: true }); });

describe('staging and promotion', () => {
  it('compiles into new staging and seals a read-only snapshot only after complete, quiescent preparation', async () => {
    const { cache, env, events } = await bind();
    const status = cache.status();
    expect(status).toMatchObject({ mode: 'cold', sealed: false, key: KEY, rejected: null, discarded: [] });
    expect(env.MESA_SHADER_CACHE_DIR).toBe(status.directory);
    expect(status.directory.startsWith(path.join(root, 'v1/sessions') + path.sep)).toBe(true);
    await compile(env);
    expect(await cache.seal({ ...COMPLETE, complete: false })).toMatchObject({ status: 'refused', reason: /complete pipeline preparation/ });
    expect(await cache.seal({ ...COMPLETE, count: 0 })).toMatchObject({ status: 'refused' });
    expect(await exists(sealedDirectory())).toBe(false);
    const outcome = await cache.seal(COMPLETE);
    expect(outcome).toMatchObject({ status: 'sealed', files: 1, bytes: 10, program: { count: 3, planId: 'sha256:plan', index: 1 } });
    expect(await cache.seal(COMPLETE)).toBe(await cache.seal(COMPLETE));
    const record = JSON.parse(await fs.readFile(path.join(sealedDirectory(), 'seal.json'), 'utf8'));
    expect(record).toMatchObject({ schema: 'reploid.native-shader-cache-seal/v1', key: KEY, identity: IDENTITY,
      files: [{ path: 'mesa_shader_cache_db/part0/mesa_cache.db', bytes: 10 }], sealedAt: '2026-10-15T12:00:00.000Z' });
    const sealedFile = path.join(sealedDirectory(), 'cache/mesa_shader_cache_db/part0/mesa_cache.db');
    expect((await fs.stat(sealedFile)).mode & 0o777).toBe(0o444);
    expect((await fs.stat(sealedDirectory())).mode & 0o777).toBe(0o555);
    // The process keeps writing to its own staging directory, never to the sealed snapshot.
    await compile(env, 'part0/mesa_cache.db', '+lazy');
    expect(await fs.readFile(sealedFile, 'utf8')).toBe('nir+binary');
    expect(cache.status()).toMatchObject({ sealed: true, seal: { status: 'sealed' } });
    expect(events.map(event => event.phase)).toEqual(['bound', 'seal', 'seal', 'seal']);
    expect(await fs.readdir(path.join(root, 'v1/sealed'))).toEqual([KEY]);
  });

  it('refuses to seal while writers stay busy, the directory keeps changing, or the driver ignores the directory', async () => {
    let busy = await bind({ writers: () => ({ writers: 4, busy: 1 }) });
    await compile(busy.env);
    expect(await busy.cache.seal(COMPLETE)).toMatchObject({ status: 'refused', reason: /not idle/ });
    let counter = 0;
    const changing = await bind({ pid: 102, writers: async directory => {
      await fs.writeFile(path.join(directory, `entry-${counter++}`), 'x'); return { writers: 4, busy: 0 };
    } });
    await compile(changing.env);
    expect(await changing.cache.seal(COMPLETE)).toMatchObject({ status: 'refused', reason: /not idle/ });
    const foreign = await bind({ pid: 103, writers: () => ({ writers: 0, busy: 0 }) });
    expect(await foreign.cache.seal(COMPLETE)).toMatchObject({ status: 'refused', reason: /does not use MESA_SHADER_CACHE_DIR/ });
    const empty = await bind({ pid: 104 });
    expect(await empty.cache.seal(COMPLETE)).toMatchObject({ status: 'refused', reason: /wrote nothing/ });
    expect(await fs.readdir(path.join(root, 'v1/sealed'))).toEqual([]);
    // A refused attempt does not block a later complete preparation once writers are idle.
    busy = await bind({ pid: 105 }); await compile(busy.env);
    expect(await busy.cache.seal(COMPLETE)).toMatchObject({ status: 'sealed' });
  });

  it('retakes the snapshot when the driver writes during the copy', async () => {
    let observations = 0;
    const { cache, env } = await bind({ writers: async directory => {
      // Observations 1-4 reach quiescence (3 unchanged samples after the first); the fifth is the post-copy check.
      if (++observations === 5) await fs.appendFile(path.join(directory, 'mesa_shader_cache_db/part0/mesa_cache.db'), '+late');
      return { writers: 4, busy: 0 };
    } });
    await compile(env);
    expect(await cache.seal(COMPLETE)).toMatchObject({ status: 'sealed' });
    // The first snapshot was discarded; quiescence was re-established (4 more) and checked once more after the copy.
    expect(observations).toBe(10);
    expect(await fs.readFile(path.join(sealedDirectory(), 'cache/mesa_shader_cache_db/part0/mesa_cache.db'), 'utf8')).toBe('nir+binary+late');
  });

  it('reports a concurrent seal of the same identity and keeps the first', async () => {
    const first = await bind({ pid: 201 }), second = await bind({ pid: 202 });
    await compile(first.env, 'part0/mesa_cache.db', 'first'); await compile(second.env, 'part0/mesa_cache.db', 'second');
    expect(await first.cache.seal(COMPLETE)).toMatchObject({ status: 'sealed' });
    expect(await second.cache.seal(COMPLETE)).toMatchObject({ status: 'already-sealed' });
    expect(await fs.readdir(path.join(root, 'v1/sealed'))).toEqual([KEY]);
    expect(await fs.readFile(path.join(sealedDirectory(), 'cache/mesa_shader_cache_db/part0/mesa_cache.db'), 'utf8')).toBe('first');
  });

  it('close cancels a pending seal and removes only its own session', async () => {
    const other = await bind({ pid: 301 });
    const { cache, env } = await bind({ pid: 302, writers: () => ({ writers: 4, busy: 1 }) });
    await compile(env);
    const pending = cache.seal(COMPLETE);
    await cache.close();
    expect(await pending).toMatchObject({ status: 'refused', reason: /cancelled/ });
    expect(await exists(path.dirname(env.MESA_SHADER_CACHE_DIR))).toBe(false);
    expect(await exists(other.env.MESA_SHADER_CACHE_DIR)).toBe(true);
    expect(await fs.readdir(path.join(root, 'v1/sealed'))).toEqual([]);
    expect(await cache.seal(COMPLETE)).toMatchObject({ status: 'refused', reason: 'closed' });
  });
});

describe('interruption', () => {
  it('discards staging and promotions left by an exited process and never inherits them', async () => {
    const killed = await bind({ pid: 401 });
    await compile(killed.env, 'part0/mesa_cache.db', 'nir-without-binary');
    const killedSession = killed.cache.status().session;
    const promotion = path.join(root, 'v1/sealed', '.promote-' + killedSession);
    await fs.mkdir(path.join(promotion, 'cache'), { recursive: true });
    await fs.writeFile(path.join(promotion, 'cache/partial'), 'partial');
    await exited(401);
    const live = await bind({ pid: 402 });
    const restart = await bind({ pid: 403 });
    expect(restart.cache.status()).toMatchObject({ mode: 'cold', loaded: null });
    // The killed process's staging and promotion were discarded by the first start after it exited.
    expect(live.cache.status().discarded).toEqual([
      { name: killedSession, reason: 'owner process exited before sealing' },
      { name: '.promote-' + killedSession, reason: 'promotion interrupted' }]);
    expect(restart.cache.status().discarded).toEqual([]);
    expect(await exists(killed.env.MESA_SHADER_CACHE_DIR)).toBe(false);
    expect(await exists(promotion)).toBe(false);
    expect(await fs.readdir(restart.env.MESA_SHADER_CACHE_DIR)).toEqual([]);
    expect(await exists(live.env.MESA_SHADER_CACHE_DIR)).toBe(true);
  });

  it('treats a reused pid with a different start time, or another boot, as exited', async () => {
    const before = await bind({ pid: 501, start: '700' });
    await alive(501, '900');
    const sessions = path.join(root, 'v1/sessions');
    await fs.mkdir(path.join(sessions, 'ffffffffffff-1-1-00000000'));
    const after = await bind({ pid: 502 });
    expect(after.cache.status().discarded.map(row => row.name).sort())
      .toEqual([before.cache.status().session, 'ffffffffffff-1-1-00000000'].sort());
  });
});

describe('warm starts', () => {
  it('starts from a verified private copy; Mesa is never given the sealed directory', async () => {
    const first = await bind({ pid: 601 });
    await compile(first.env); await compile(first.env, 'part1/mesa_cache.idx', 'index');
    expect(await first.cache.seal(COMPLETE)).toMatchObject({ status: 'sealed', files: 2 });
    await first.cache.close(); await exited(601);
    const second = await bind({ pid: 602 });
    const status = second.cache.status();
    expect(status).toMatchObject({ mode: 'warm', sealed: true, loaded: { files: 2, bytes: 15 }, rejected: null });
    expect(second.env.MESA_SHADER_CACHE_DIR.startsWith(sealedDirectory())).toBe(false);
    const copy = path.join(second.env.MESA_SHADER_CACHE_DIR, 'mesa_shader_cache_db/part0/mesa_cache.db');
    expect(await fs.readFile(copy, 'utf8')).toBe('nir+binary');
    expect((await fs.stat(copy)).mode & 0o200).toBe(0o200);
    await compile(second.env, 'part0/mesa_cache.db', '+access-time');
    expect(await fs.readFile(path.join(sealedDirectory(), 'cache/mesa_shader_cache_db/part0/mesa_cache.db'), 'utf8')).toBe('nir+binary');
    expect(await second.cache.seal(COMPLETE)).toEqual({ status: 'sealed-before-start' });
  });

  it.each([
    ['a changed file', async () => {
      const file = path.join(sealedDirectory(), 'cache/mesa_shader_cache_db/part0/mesa_cache.db');
      await fs.chmod(path.dirname(file), 0o755); await fs.chmod(file, 0o644); await fs.writeFile(file, 'nir-xbinary');
    }, /sealed file changed/],
    ['an extra file', async () => {
      await fs.chmod(path.join(sealedDirectory(), 'cache'), 0o755);
      await fs.writeFile(path.join(sealedDirectory(), 'cache/extra'), 'x');
    }, /differ from the seal record/],
    ['a missing record', async () => {
      await fs.chmod(sealedDirectory(), 0o755); await fs.rm(path.join(sealedDirectory(), 'seal.json'));
    }, /ENOENT/],
  ])('rejects a sealed cache with %s, removes it and compiles cold', async (_, tamper, reason) => {
    const first = await bind({ pid: 701 });
    await compile(first.env); await first.cache.seal(COMPLETE); await first.cache.close(); await exited(701);
    await tamper();
    const second = await bind({ pid: 702 });
    expect(second.cache.status()).toMatchObject({ mode: 'cold', sealed: false, rejected: expect.stringMatching(reason) });
    expect(await exists(sealedDirectory())).toBe(false);
    expect(await fs.readdir(second.env.MESA_SHADER_CACHE_DIR)).toEqual([]);
    await compile(second.env);
    expect(await second.cache.seal(COMPLETE)).toMatchObject({ status: 'sealed' });
  });

  it('keys sealed caches by identity', async () => {
    const first = await bind({ pid: 801 });
    await compile(first.env); await first.cache.seal(COMPLETE); await first.cache.close(); await exited(801);
    const otherKey = await bind({ pid: 802, key: 'b'.repeat(64) });
    expect(otherKey.cache.status()).toMatchObject({ mode: 'cold', rejected: null });
    const sameKeyOtherIdentity = await bind({ pid: 803, identity: { ...IDENTITY, program: { stage: 2 } } });
    expect(sameKeyOtherIdentity.cache.status()).toMatchObject({ mode: 'cold', rejected: /does not match this identity/ });
  });
});

describe('misconfiguration fails before any driver can initialize', () => {
  it.each([
    [{ env: { MESA_SHADER_CACHE_DIR: '/home/user/.cache' } }, /MESA_SHADER_CACHE_DIR is set.*Unset MESA_SHADER_CACHE_DIR; choose the location with --shader-cache-root/],
    [{ env: { MESA_SHADER_CACHE_DISABLE: 'true' } }, /MESA_SHADER_CACHE_DISABLE is set.*Unset/],
    [{ platform: 'darwin' }, /requires Linux.*this host is darwin/],
    [{ root: 'relative/cache' }, /absolute directory/],
  ])('rejects %j', async (overrides, message) => {
    await alive(901, '1');
    const env = overrides.env || {};
    await expect(openNativeShaderCache({ root, key: KEY, identity: IDENTITY, env, platform: 'linux', proc, pid: 901, ...overrides }))
      .rejects.toThrow(message);
    expect(env.MESA_SHADER_CACHE_DIR ?? null).toBe(overrides.env?.MESA_SHADER_CACHE_DIR ?? null);
  });

  it('rejects an unwritable root', async () => {
    await alive(902, '1'); await fs.writeFile(path.join(tmp, 'file'), 'x');
    await expect(openNativeShaderCache({ root: path.join(tmp, 'file'), key: KEY, identity: IDENTITY, env: {}, platform: 'linux', proc, pid: 902 }))
      .rejects.toThrow(/not a writable directory/);
  });
});

it('observes Mesa disk cache writer threads and their state', async () => {
  const task = (tid, comm, state) => Promise.all([fs.mkdir(path.join(proc, 'self/task', tid), { recursive: true })])
    .then(() => Promise.all([fs.writeFile(path.join(proc, 'self/task', tid, 'comm'), comm + '\n'),
      fs.writeFile(path.join(proc, 'self/task', tid, 'stat'), procStat(tid, 1, state, comm))]));
  await task('10', 'node', 'R'); await task('11', 'node:disk$0', 'S'); await task('12', 'node:disk$1', 'R');
  await task('13', 'node:disk$2', 'D'); await task('14', 'dawn worker', 'S');
  expect(await observeMesaCacheWriters(proc)).toEqual({ writers: 3, busy: 2 });
});

describe('identity', () => {
  async function inputs() {
    const write = async (file, bytes) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes); };
    const base = path.join(tmp, 'inputs');
    await write(path.join(base, 'runtime/package.json'), JSON.stringify({ name: 'doppler-gpu', version: '0.6.28' }));
    await write(path.join(base, 'runtime/src/gpu/kernels/state.wgsl'), 'fn main() {}');
    await write(path.join(base, 'provider/package.json'), JSON.stringify({ name: 'webgpu', version: '0.4.0' }));
    await write(path.join(base, 'provider/dist/linux-x64.dawn.node'), 'dawn');
    await write(path.join(base, 'lib/libvulkan_intel.so'), 'mesa 24.2.8');
    await write(path.join(base, 'icd.d/intel_icd.x86_64.json'), JSON.stringify({ ICD: { library_path: path.join(base, 'lib/libvulkan_intel.so') } }));
    await write(path.join(base, 'drm/renderD128/device/vendor'), '0x8086\n');
    await write(path.join(base, 'drm/renderD128/device/device'), '0x9a78\n');
    await write(path.join(base, 'drm/renderD128/device/revision'), '0x01\n');
    return { base, write, options: () => ({
      runtime: { directory: path.join(base, 'runtime'), archiveIntegrity: 'sha512-runtime' },
      provider: { module: 'webgpu', directory: path.join(base, 'provider') },
      program: { model: { id: 'qwen', identity: 'sha256:manifest', capsule: { semanticRoot: 'sha256:root' } }, policy: { limits: 1 }, stage: 1 },
      env: { VK_DRIVER_FILES: path.join(base, 'icd.d') }, home: path.join(base, 'home'), drmRoot: path.join(base, 'drm') }) };
  }

  it('is stable for the same inputs and changes with runtime, provider, driver, device, environment and program', async () => {
    const { base, write, options } = await inputs();
    const baseline = await nativeShaderCacheIdentity(options());
    expect(baseline.key).toMatch(/^[0-9a-f]{64}$/);
    expect((await nativeShaderCacheIdentity(options())).key).toBe(baseline.key);
    expect(baseline.identity.driver.icds).toEqual([expect.objectContaining({ library: path.join(base, 'lib/libvulkan_intel.so'),
      librarySha256: expect.stringMatching(/^[0-9a-f]{64}$/) })]);
    expect(baseline.identity.program).toMatchObject({ capsule: 'sha256:root', stage: 1, canonical: false });
    // The managed variable itself never changes the key.
    expect((await nativeShaderCacheIdentity({ ...options(), env: { ...options().env, MESA_SHADER_CACHE_DIR: '/x' } })).key).toBe(baseline.key);
    const variants = {
      archive: async () => ({ ...options(), runtime: { ...options().runtime, archiveIntegrity: 'sha512-other' } }),
      runtimeBytes: async () => { await write(path.join(base, 'runtime/src/gpu/kernels/state.wgsl'), 'fn main() { }'); return options(); },
      providerBytes: async () => { await write(path.join(base, 'provider/dist/linux-x64.dawn.node'), 'dawn2'); return options(); },
      driverBytes: async () => { await write(path.join(base, 'lib/libvulkan_intel.so'), 'mesa 25.2.8'); return options(); },
      device: async () => { await write(path.join(base, 'drm/renderD128/device/device'), '0x9a49\n'); return options(); },
      environment: async () => ({ ...options(), env: { ...options().env, INTEL_DEBUG: 'nocompact' } }),
      model: async () => ({ ...options(), program: { ...options().program, model: { ...options().program.model, identity: 'sha256:other' } } }),
      stage: async () => ({ ...options(), program: { ...options().program, stage: 2 } }),
      policy: async () => ({ ...options(), program: { ...options().program, policy: { limits: 2 } } }),
    };
    const keys = new Set([baseline.key]);
    for (const [name, variant] of Object.entries(variants)) {
      const snapshot = await fs.cp(path.join(base), path.join(tmp, 'saved'), { recursive: true }).then(() => path.join(tmp, 'saved'));
      const { key } = await nativeShaderCacheIdentity(await variant());
      expect(keys.has(key), name).toBe(false); keys.add(key);
      await fs.rm(base, { recursive: true }); await fs.rename(snapshot, base);
    }
    expect((await nativeShaderCacheIdentity(options())).key).toBe(baseline.key);
  });

  it('requires explicit runtime, provider and program inputs', async () => {
    const { options } = await inputs();
    await expect(nativeShaderCacheIdentity({ ...options(), runtime: { directory: '/x' } })).rejects.toThrow(/archive integrity/);
    await expect(nativeShaderCacheIdentity({ ...options(), program: { ...options().program, stage: -1 } })).rejects.toThrow(/stage index/);
  });
});
