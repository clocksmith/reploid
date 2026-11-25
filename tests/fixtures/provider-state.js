// Read-only ownership/activity snapshots for one protected systemd service.
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { execFileSync } from 'node:child_process';

export class ProviderStateError extends Error {
  constructor(message, options) { super(message, options); this.name = 'ProviderStateError'; }
}

function require(condition, message) {
  if (!condition) throw new ProviderStateError(message);
}

const decoder = new TextDecoder('utf-8', { fatal: true });
const digits = value => typeof value === 'string' && /^\d+$/.test(value);

/** Read at most `limit` bytes of strict UTF-8 metadata. */
export function readBoundedText(filename, limit = 65536) {
  const handle = fs.openSync(filename, 'r');
  try {
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    for (;;) {
      const count = fs.readSync(handle, buffer, length, buffer.length - length, null);
      if (!count) break;
      length += count;
      if (length === buffer.length) break;
    }
    require(length <= limit, 'Protected provider metadata exceeds observation bound');
    return decoder.decode(buffer.subarray(0, length));
  } finally {
    fs.closeSync(handle);
  }
}

function parseService(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf('=');
    if (at >= 0) values[line.slice(0, at)] = line.slice(at + 1);
  }
  const required = Object.fromEntries(['ActiveState', 'MainPID', 'ControlGroup', 'InvocationID']
    .map(key => [key, values[key] ?? null]));
  require(required.ActiveState === 'active', 'Protected provider is not active');
  require(digits(required.MainPID) && Number(required.MainPID) > 0, 'Protected provider MainPID is unavailable');
  const group = required.ControlGroup;
  require(typeof group === 'string' && group.startsWith('/') && group !== '/'
    && group.split('/').every(part => part !== '.' && part !== '..'), 'Protected provider cgroup is unavailable');
  require(typeof required.InvocationID === 'string' && /^[a-fA-F0-9]{32}$/.test(required.InvocationID),
    'Protected provider invocation identity is unavailable');
  return required;
}

function membership(root, group, readText) {
  const base = fs.realpathSync(root);
  const selected = fs.realpathSync(path.join(base, group.replace(/^\/+/, '')));
  require(selected === base || selected.startsWith(base + path.sep), 'Protected provider cgroup escaped its root');
  const members = {};
  const seen = new Set();
  const visit = directory => {
    require(Object.keys(members).length < 256, 'Protected provider cgroup observation bound exceeded');
    const raw = readText(path.join(directory, 'cgroup.procs')).split(/\s+/).filter(Boolean);
    require(raw.every(value => digits(value) && Number(value) > 0), 'Protected provider cgroup membership is unobservable');
    const pids = raw.map(Number).sort((a, b) => a - b);
    require(new Set(pids).size === pids.length && !pids.some(pid => seen.has(pid)),
      'Protected provider membership changed during observation');
    pids.forEach(pid => seen.add(pid));
    require(seen.size <= 64, 'Protected provider process observation bound exceeded');
    members[path.relative(selected, directory) || '.'] = pids;
    for (const name of fs.readdirSync(directory).sort()) {
      const child = path.join(directory, name);
      const status = fs.lstatSync(child);
      require(!status.isSymbolicLink(), 'Protected provider cgroup has an unobservable alias');
      if (status.isDirectory()) visit(child);
    }
  };
  visit(selected);
  return members;
}

function identity(procRoot, pid, readText) {
  const directory = path.join(String(procRoot), String(pid));
  const data = readText(path.join(directory, 'stat'));
  const begin = data.indexOf('('), end = data.lastIndexOf(')');
  require(begin > 0 && end > begin && data.slice(0, begin).trim() === String(pid),
    'Protected provider process identity is unobservable');
  const fields = data.slice(end + 1).split(/\s+/).filter(Boolean);
  require(fields.length >= 20 && digits(fields[1]) && digits(fields[19]),
    'Protected provider process start identity is unavailable');
  return { pid, parentPid: Number(fields[1]), startTimeTicks: fields[19],
    comm: data.slice(begin + 1, end), executable: fs.readlinkSync(path.join(directory, 'exe')) };
}

// System, decode and command failures are unobservable state; programming errors propagate.
const observationFailure = error => typeof error?.code === 'string' || error instanceof SyntaxError;

/**
 * Snapshot all observed cgroup members, not just an ExecStart wrapper PID.
 *
 * Every DRM fd's fields are retained, including engine counters and memory.
 * Endpoints detect changes to observed ownership; this is not global GPU
 * utilization or an attestation of work between observations.
 */
export function providerState(unit, { procRoot = '/proc', cgroupRoot = '/sys/fs/cgroup', show, readText = readBoundedText } = {}) {
  require(typeof unit === 'string' && /^[A-Za-z0-9_.@:-]+\.service$/.test(unit), 'Explicit protected service name required');
  const observe = show ?? (() => execFileSync('systemctl', ['--user', 'show', unit, '-p', 'ActiveState', '-p', 'MainPID',
    '-p', 'ControlGroup', '-p', 'InvocationID'], { encoding: 'utf8', timeout: 5000 }));
  try {
    const service = parseService(observe());
    const members = membership(cgroupRoot, service.ControlGroup, readText);
    const pids = Object.values(members).flat().sort((a, b) => a - b);
    require(pids.includes(Number(service.MainPID)), 'Protected provider MainPID left its service cgroup');
    const processes = {};
    let owners = 0;
    for (const pid of pids) {
      const before = identity(procRoot, pid, readText);
      const directory = path.join(String(procRoot), String(pid), 'fdinfo');
      const descriptors = fs.readdirSync(directory).sort();
      require(descriptors.length <= 4096 && descriptors.every(digits), 'Protected provider descriptor observation bound exceeded');
      const drm = {};
      for (const descriptor of descriptors) {
        const fields = {};
        for (const line of readText(path.join(directory, descriptor)).split(/\r?\n/)) {
          const at = line.indexOf(':');
          if (line.startsWith('drm-') && at >= 0) fields[line.slice(0, at)] = line.slice(at + 1);
        }
        if (!Object.hasOwn(fields, 'drm-client-id')) {
          require(!Object.keys(fields).length, 'Protected provider DRM ownership lacks a client identity');
          continue;
        }
        require(Object.keys(fields).some(key => key.startsWith('drm-engine-') && !key.startsWith('drm-engine-capacity-')),
          'Protected provider GPU activity is unobservable');
        drm[descriptor] = Object.fromEntries(Object.keys(fields).sort().map(key => [key, fields[key].trim()]));
      }
      require(isDeepStrictEqual(identity(procRoot, pid, readText), before), 'Protected provider process identity changed during observation');
      require(isDeepStrictEqual(fs.readdirSync(directory).sort(), descriptors), 'Protected provider descriptors changed during observation');
      if (Object.keys(drm).length) owners += 1;
      processes[String(pid)] = { identity: before, drm };
    }
    require(owners > 0, 'Protected provider GPU ownership is unavailable');
    require(isDeepStrictEqual(membership(cgroupRoot, service.ControlGroup, readText), members),
      'Protected provider cgroup membership changed during observation');
    require(isDeepStrictEqual(parseService(observe()), service), 'Protected provider service changed during observation');
    return { service, cgroupMembers: members, processes };
  } catch (error) {
    if (error instanceof ProviderStateError || !observationFailure(error)) throw error;
    throw new ProviderStateError('Protected provider ownership is unobservable: ' + error.message, { cause: error });
  }
}

export function assertProviderUnchanged(before, after) {
  require(isDeepStrictEqual(before, after), 'Protected provider membership, process identity, DRM ownership or activity changed');
  return after;
}
