// @vitest-environment node
// Hardened A1 host, Shmem, AMD GPU GTT/512MiB carve-out, copy, and cache preflight over fake /proc and sysfs roots.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PreflightError, ProviderStateError, checkHostAndGpuPreflight, clearProtectedCacheDirs, discoverProtectedCacheDirs,
  requireHostAndGpuPreflight, snapshotProtectedProvider, validateProtectedCacheDir, verifyProtectedProviderUnchanged }
  from '../fixtures/peers/pooled/compare-complete.js';

const GIB = 1024 ** 3, MIB = 1024 ** 2;

function writeMeminfo(procRoot, { memTotal = 122 * GIB, memFree = 42 * GIB, memAvailable = 100 * GIB,
  cached = 28 * GIB, shmem = 30 * MIB, dirty = 0, writeback = 0 } = {}) {
  const kb = value => Math.floor(value / 1024);
  fs.writeFileSync(path.join(procRoot, 'meminfo'), [
    `MemTotal:       ${kb(memTotal)} kB`, `MemFree:        ${kb(memFree)} kB`, `MemAvailable:   ${kb(memAvailable)} kB`,
    `Cached:         ${kb(cached)} kB`, `Shmem:          ${kb(shmem)} kB`, `Dirty:          ${kb(dirty)} kB`,
    `Writeback:      ${kb(writeback)} kB`
  ].join('\n') + '\n');
}

function writeAmdgpu(drmRoot, { card = 'card1', vramTotal = 512 * MIB, vramUsed = 369 * MIB, gttTotal = 61 * GIB,
  gttUsed = GIB, busy = 0 } = {}) {
  const device = path.join(drmRoot, card, 'device');
  fs.mkdirSync(device, { recursive: true });
  for (const [name, value] of [['mem_info_vram_total', vramTotal], ['mem_info_vram_used', vramUsed],
    ['mem_info_gtt_total', gttTotal], ['mem_info_gtt_used', gttUsed], ['gpu_busy_percent', busy]]) {
    fs.writeFileSync(path.join(device, name), `${value}\n`);
  }
  fs.mkdirSync(path.join(drmRoot, `${card}-DP-1`, 'device'), { recursive: true });
}

function writeDiskstats(procRoot, sectorsRead = 1000, sectorsWritten = 500) {
  fs.writeFileSync(path.join(procRoot, 'diskstats'),
    ` 259 0 nvme0n1 10 0 ${sectorsRead} 1 5 0 ${sectorsWritten} 1 0 1 1\n`
    + ` 259 1 nvme0n1p1 10 0 ${sectorsRead} 1 5 0 ${sectorsWritten} 1 0 1 1\n`);
}

function writeProc(procRoot, pid, comm, { state = 'S', argv0 = null, openFiles = [] } = {}) {
  const directory = path.join(procRoot, String(pid));
  fs.mkdirSync(path.join(directory, 'fd'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'stat'), `${pid} (${comm}) ${state} 1 ${pid} ${pid} 0 -1 0 0 0 0 0 0 0 0 20 0 1 0 100\n`);
  fs.writeFileSync(path.join(directory, 'cmdline'), Buffer.concat([Buffer.from(argv0 ?? comm, 'utf8'), Buffer.of(0)]));
  openFiles.forEach((target, index) => fs.symlinkSync(target, path.join(directory, 'fd', String(index))));
}

let root, proc, drm;
const freeze = { minHostAvailableBytes: 32 * GIB, gpuCapBytes: 32 * GIB,
  protectedProviderUnit: 'reploid-qwen27b-0633-20261104.service' };
const roots = options => ({ procRoot: proc, drmRoot: drm, selfPid: 999999, ...options });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'compare-complete-preflight-'));
  proc = path.join(root, 'proc');
  drm = path.join(root, 'drm');
  fs.mkdirSync(proc);
  fs.mkdirSync(drm);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('compare-complete hardened preflight', () => {
  it('passes a healthy host and AMD GPU', async () => {
    writeMeminfo(proc);
    writeAmdgpu(drm, { vramTotal: 512 * MIB, vramUsed: 369 * MIB, gttTotal: 61 * GIB, gttUsed: GIB, busy: 0 });
    writeDiskstats(proc, 1000, 500);
    writeProc(proc, 101, 'node', { state: 'S', argv0: '/usr/bin/node' });
    const snap = await requireHostAndGpuPreflight(freeze, roots({ sampleSeconds: 0.05, sleepFn: () => {} }));
    expect(snap.passed).toBe(true);
    expect(snap.violations).toEqual([]);
    expect(snap.gpu.vramFreeBytes).toBe((512 - 369) * MIB);
    expect(snap.gpu.gttFreeBytes).toBe(60 * GIB);
  });

  it('refuses high Shmem and low MemFree even when MemAvailable looks large', async () => {
    writeMeminfo(proc, { memAvailable: 80 * GIB, memFree: 9 * GIB, shmem: 31 * GIB, dirty: 2 * GIB });
    writeAmdgpu(drm);
    writeDiskstats(proc);
    const snap = await checkHostAndGpuPreflight(freeze, roots({ sampleSeconds: 0 }));
    expect(snap.passed).toBe(false);
    const joined = snap.violations.join(' | ');
    expect(joined).toContain('MemFree');
    expect(joined).toContain('Shmem');
    expect(joined).toContain('Dirty+Writeback');
    await expect(requireHostAndGpuPreflight(freeze, roots({ sampleSeconds: 0 }))).rejects.toThrow(PreflightError);
  });

  it('refuses an exhausted 512 MiB VRAM carve-out and insufficient GTT headroom', async () => {
    writeMeminfo(proc);
    writeAmdgpu(drm, { vramTotal: 512 * MIB, vramUsed: 502 * MIB, gttTotal: 61 * GIB, gttUsed: 25 * GIB, busy: 42 });
    writeDiskstats(proc);
    const snap = await checkHostAndGpuPreflight(freeze, roots({ sampleSeconds: 0 }));
    expect(snap.passed).toBe(false);
    const joined = snap.violations.join(' | ');
    expect(joined).toContain('512 MiB carve-out effectiveVramAvailableBytes');
    expect(joined).toContain('gttFreeBytes');
    expect(joined).toContain('gpuBusyPercent');
  });

  it('counts evictable UMA carve-out DRM VRAM and rejects an unexpected compute client', async () => {
    writeMeminfo(proc);
    writeAmdgpu(drm, { vramTotal: 512 * MIB, vramUsed: 502 * MIB, gttTotal: 61 * GIB, gttUsed: 17 * GIB, busy: 0 });
    writeDiskstats(proc);
    writeProc(proc, 9258, 'gnome-shell');
    fs.mkdirSync(path.join(proc, '9258/fdinfo'));
    fs.writeFileSync(path.join(proc, '9258/fdinfo/12'), 'drm-client-id:\t45\ndrm-memory-vram:\t200716 KiB\ndrm-memory-gtt:\t93480 KiB\n');
    writeProc(proc, 116975, 'node');
    fs.mkdirSync(path.join(proc, '116975/fdinfo'));
    fs.writeFileSync(path.join(proc, '116975/fdinfo/50'), 'drm-client-id:\t64\ndrm-memory-vram:\t136888 KiB\ndrm-memory-gtt:\t17643192 KiB\n');
    const allowed = await checkHostAndGpuPreflight(freeze, roots({ allowedGpuPids: new Set([116975]), sampleSeconds: 0 }));
    expect(allowed.passed, allowed.violations.join('; ')).toBe(true);
    expect(allowed.gpu.effectiveVramAvailableBytes).toBeGreaterThanOrEqual(64 * MIB);
    const leaked = await checkHostAndGpuPreflight(freeze, roots({ allowedGpuPids: new Set(), sampleSeconds: 0 }));
    expect(leaked.passed).toBe(false);
    expect(leaked.violations.join(' | ')).toContain('Unexpected GPU compute client');
  });

  it('refuses active rsync, a large cp and high ambient disk throughput', async () => {
    writeMeminfo(proc);
    writeAmdgpu(drm);
    writeDiskstats(proc, 1000, 1000);
    const smallFile = path.join(root, 'small.txt');
    fs.writeFileSync(smallFile, 'ok');
    const largeFile = path.join(root, 'weights.gguf');
    fs.writeFileSync(largeFile, '');
    fs.truncateSync(largeFile, 128 * MIB);
    writeProc(proc, 200, 'rsync', { state: 'Z' });
    writeProc(proc, 201, 'cp', { state: 'S', openFiles: [smallFile] });
    const clean = await checkHostAndGpuPreflight(freeze, roots({ sampleSeconds: 0 }));
    expect(clean.passed).toBe(true);

    writeProc(proc, 202, 'rsync', { state: 'R', argv0: '/usr/bin/rsync' });
    writeProc(proc, 203, 'cp', { state: 'D', openFiles: [largeFile] });
    // +60 MiB in 0.2s = 300 MiB/s (> 64 MiB/s limit); the nvme0n1p1 partition row must not double count.
    const advanceDisk = () => writeDiskstats(proc, 1000 + Math.floor(60 * MIB / 512), 1000);
    const busy = await checkHostAndGpuPreflight(freeze, roots({ sampleSeconds: 0.2, sleepFn: advanceDisk }));
    expect(busy.passed).toBe(false);
    const joined = busy.violations.join(' | ');
    expect(joined).toContain('rsync(pid=202');
    expect(joined).toContain('cp(pid=203,large_regular_file_open)');
    expect(joined).toContain('Ambient disk I/O');
  });

  it('discovers, validates and clears the protected cache safely', () => {
    const shm = path.join(root, 'shm');
    fs.mkdirSync(shm);
    const cacheDir = path.join(shm, 'a1-protected-piece-cache-v65');
    fs.mkdirSync(cacheDir);
    fs.writeFileSync(path.join(cacheDir, 'piece.bin'), 'cached-expert');
    const candidateConfig = path.join(root, 'candidate.json');
    fs.writeFileSync(candidateConfig, JSON.stringify({ workerGather: { protectedCache: { directory: cacheDir } } }));
    const allowedRoots = [shm];
    const dirs = discoverProtectedCacheDirs({ native: { candidate: { nativeConfigPath: candidateConfig } } }, { allowedRoots });
    expect(dirs).toEqual([cacheDir]);
    expect(clearProtectedCacheDirs(dirs, { allowedRoots })).toEqual([{ directory: cacheDir, removed: true, existsAfter: false }]);
    expect(fs.existsSync(cacheDir)).toBe(false);

    const outside = path.join(root, 'outside-cache');
    fs.mkdirSync(outside);
    expect(() => validateProtectedCacheDir(outside, { allowedRoots })).toThrow(PreflightError);
    expect(() => validateProtectedCacheDir(shm, { allowedRoots })).toThrow(PreflightError);
    const link = path.join(shm, 'symlink-cache');
    fs.symlinkSync(outside, link);
    expect(() => validateProtectedCacheDir(link, { allowedRoots })).toThrow(PreflightError);
  });

  it('verifies a paused provider is inactive and detects an unexpected start', () => {
    const paused = { protectedProviderUnit: 'reploid-qwen27b-0633-20261104.service', protectedProviderPolicy: 'paused_inactive' };
    const inactive = 'ActiveState=inactive\nSubState=dead\nMainPID=0\nInvocationID=\n';
    const before = snapshotProtectedProvider(paused, { showPaused: () => inactive });
    const after = snapshotProtectedProvider(paused, { showPaused: () => inactive });
    verifyProtectedProviderUnchanged(paused, before, after);
    const active = 'ActiveState=active\nSubState=running\nMainPID=116968\nInvocationID=abcd\n';
    expect(() => snapshotProtectedProvider(paused, { showPaused: () => active })).toThrow(ProviderStateError);
  });

  it('settles a transient journal flush without copy processes but refuses sustained I/O', async () => {
    writeMeminfo(proc);
    writeAmdgpu(drm);
    writeDiskstats(proc, 1000, 1000);
    let calls = 0;
    const transientFlush = () => {
      calls += 1;
      // Simulate a 20 MiB report.json flush in 0.2s (100 MiB/s), then idle on settle + recheck.
      if (calls === 1) writeDiskstats(proc, 1000, 1000 + Math.floor(20 * MIB / 512));
    };
    const transient = await checkHostAndGpuPreflight(freeze, roots({ sampleSeconds: 0.2, sleepFn: transientFlush }));
    expect(transient.passed, transient.violations.join('; ')).toBe(true);
    expect(transient.io.initialAmbientDiskBytesPerSec).toBeGreaterThan(64 * MIB);
    expect(transient.io.ambientDiskBytesPerSec).toBe(0);

    writeDiskstats(proc, 1000, 1000);
    let sectors = 1000;
    const sustainedIo = seconds => {
      sectors += Math.floor((100 * MIB * seconds) / 512);
      writeDiskstats(proc, sectors, 1000);
    };
    const sustained = await checkHostAndGpuPreflight(freeze, roots({ sampleSeconds: 0.2, sleepFn: sustainedIo }));
    expect(sustained.passed).toBe(false);
    expect(sustained.violations.join(' | ')).toContain('Ambient disk I/O');
  });
});
