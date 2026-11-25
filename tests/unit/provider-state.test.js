// @vitest-environment node
// Tiny mocked proc/cgroup fixtures; no live provider or GPU operations.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProviderStateError, assertProviderUnchanged, providerState, readBoundedText } from '../fixtures/provider-state.js';

let root, proc, group, show;

function identity(pid, comm, parent, start) {
  // Fields after comm start at kernel stat field3; starttime is field22.
  const fields = ['S', String(parent), ...Array(17).fill('0'), String(start)];
  fs.writeFileSync(path.join(proc, String(pid), 'stat'), `${pid} (${comm}) ${fields.join(' ')}\n`);
}

function counter(pid, count) {
  fs.writeFileSync(path.join(proc, String(pid), 'fdinfo', '7'),
    `drm-driver:\tamdgpu\ndrm-client-id:\t2237\ndrm-pdev:\t0000:c5:00.0\ndrm-engine-gfx:\t${count} ns\ndrm-memory-vram:\t8192 KiB\n`);
}

function processEntry(pid, comm, parent, start, gpu = false) {
  const directory = path.join(proc, String(pid));
  fs.mkdirSync(path.join(directory, 'fdinfo'), { recursive: true });
  identity(pid, comm, parent, start);
  fs.symlinkSync('/usr/bin/' + (gpu ? 'node' : 'flock'), path.join(directory, 'exe'));
  fs.writeFileSync(path.join(directory, 'fdinfo', '0'), 'pos:\t0\nflags:\t0100000\n');
  if (gpu) counter(pid, 123);
}

const snapshot = (options = {}) => providerState('protected.service',
  { procRoot: proc, cgroupRoot: path.join(root, 'cgroup'), show: () => show, ...options });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-state-'));
  proc = path.join(root, 'proc');
  group = path.join(root, 'cgroup', 'service');
  fs.mkdirSync(group, { recursive: true });
  fs.writeFileSync(path.join(group, 'cgroup.procs'), '10\n20\n');
  show = 'ActiveState=active\nMainPID=10\nControlGroup=/service\nInvocationID=' + 'a'.repeat(32) + '\n';
  processEntry(10, 'flock', 1, 100);
  processEntry(20, 'node worker (provider)', 10, 200, true);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('providerState', () => {
  it('observes the flock parent and GPU child without using MainPID as the GPU owner', () => {
    const state = snapshot();
    expect(state.service.MainPID).toBe('10');
    expect(state.cgroupMembers).toEqual({ '.': [10, 20] });
    expect(state.processes['10'].drm).toEqual({});
    expect(state.processes['20'].identity.startTimeTicks).toBe('200');
    expect(state.processes['20'].drm['7']['drm-engine-gfx']).toBe('123 ns');
    expect(state.processes['20'].drm['7']['drm-memory-vram']).toBe('8192 KiB');
    assertProviderUnchanged(state, snapshot());
  });

  it('invalidates the previous snapshot on GPU activity or a process restart', () => {
    const before = snapshot();
    counter(20, 124);
    expect(() => assertProviderUnchanged(before, snapshot())).toThrow(ProviderStateError);
    expect(() => assertProviderUnchanged(before, snapshot())).toThrow(/activity changed/);
    counter(20, 123);
    identity(20, 'node worker (provider)', 10, 201);
    expect(() => assertProviderUnchanged(before, snapshot())).toThrow(/identity.*changed/);
  });

  it('retains nested service cgroup GPU owners and membership', () => {
    const child = path.join(group, 'workers');
    fs.mkdirSync(child);
    fs.writeFileSync(path.join(child, 'cgroup.procs'), '20\n');
    fs.writeFileSync(path.join(group, 'cgroup.procs'), '10\n');
    expect(snapshot().cgroupMembers).toEqual({ '.': [10], workers: [20] });
    fs.writeFileSync(path.join(child, 'cgroup.procs'), '');
    expect(() => snapshot()).toThrow(ProviderStateError);
    expect(() => snapshot()).toThrow(/GPU ownership/);
  });

  it('does not silently ignore unobservable GPU or process metadata', () => {
    fs.writeFileSync(path.join(proc, '20', 'fdinfo', '7'), 'drm-client-id:\t2237\n');
    expect(() => snapshot()).toThrow(/GPU activity is unobservable/);
    counter(20, 123);
    fs.unlinkSync(path.join(proc, '20', 'stat'));
    expect(() => snapshot()).toThrow(ProviderStateError);
    expect(() => snapshot()).toThrow(/ownership is unobservable/);
  });

  it('rejects restarts during observation and a changed unit invocation', () => {
    const readText = (filename, limit) => {
      const value = readBoundedText(filename, limit);
      if (String(filename).endsWith('/20/fdinfo/7')) identity(20, 'node worker (provider)', 10, 202);
      return value;
    };
    expect(() => snapshot({ readText })).toThrow(/identity changed during/);
    const calls = [show, show.replace('a'.repeat(32), 'b'.repeat(32))][Symbol.iterator]();
    const failure = (() => { try { snapshot({ show: () => calls.next().value }); } catch (error) { return error; } })();
    expect(failure).toBeInstanceOf(ProviderStateError);
    expect(failure.message).toMatch(/service changed during/);
  });

  it('rejects new service members during observation', () => {
    const readText = (filename, limit) => {
      const value = readBoundedText(filename, limit);
      if (String(filename).endsWith('/20/fdinfo/7')) fs.writeFileSync(path.join(group, 'cgroup.procs'), '10\n20\n30\n');
      return value;
    };
    const failure = (() => { try { snapshot({ readText }); } catch (error) { return error; } })();
    expect(failure).toBeInstanceOf(ProviderStateError);
    expect(failure.message).toMatch(/membership changed during/);
  });
});
