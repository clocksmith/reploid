/** One-shot operations a host agent performs on its own machine. Each is narrow and refuses anything it cannot verify. */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { measureHeldRanges, observeInventory } from './inventory.js';

const run = promisify(execFile);
const MAX_SCAN_ENTRIES = 200000;
const coded = (code, message) => Object.assign(Error(`${code}: ${message}`), { code });
const inside = (child, parent) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
const rangeKey = range => `${range.path}\0${range.offset}`;
const realOrNull = async directory => {
  try { return await fs.realpath(directory); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};

/**
 * Every directory under `roots` holding a file named like a model shard, following links once. Fails closed if huge.
 * `skip` names directories not to enter: a full copy locked for the split is unreadable by design.
 */
export async function findWeightDirectories(roots, shardNames, skip = []) {
  const visited = new Set(), found = [];
  let entries = 0;
  const visit = async directory => {
    const real = await realOrNull(directory);
    if (!real || visited.has(real) || skip.some(row => inside(real, row))) return;
    visited.add(real);
    let hasShard = false;
    for (const entry of await fs.readdir(real, { withFileTypes: true })) {
      if (++entries > MAX_SCAN_ENTRIES) throw coded('weight-scan-too-large', 'too many entries to search');
      const full = path.join(real, entry.name);
      if (shardNames.has(entry.name)) hasShard = true;
      if (entry.isDirectory()) await visit(full);
      else if (entry.isSymbolicLink() && (await fs.stat(full).catch(() => null))?.isDirectory()) await visit(full);
    }
    if (hasShard) found.push(real);
  };
  for (const root of roots) await visit(root);
  return found;
}

export const WEIGHT_BASELINE_SCHEMA = 'reploid.stage1-weight-baseline/v1';
/** The build record a stage directory carries; its bytes are part of that directory's fingerprint. */
const BUILD_RECORD = 'stage-directory.json';
const sha256Hex = value => createHash('sha256').update(value).digest('hex');
const statRow = stat => [String(stat.dev), String(stat.ino), String(stat.size), String(stat.mtimeNs), String(stat.ctimeNs)];

/**
 * What one directory holds, read without its weight bytes: each regular file's name, device, inode, size, modification
 * and status-change times (a link's own and its target's), plus the bytes of the build record if there is one. Writing
 * through the file system, replacing, truncating, adding or removing a file, or setting its times back changes at least
 * one of these: a user cannot set the status-change time. Not seen: a change made beneath the file system, such as
 * root writing the block device, or a file system that does not keep status-change times.
 */
export async function fingerprintDirectory(directory) {
  const rows = [];
  const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    const file = path.join(directory, entry.name);
    const own = await fs.lstat(file, { bigint: true });
    const target = entry.isSymbolicLink() ? await fs.stat(file, { bigint: true }).catch(() => null) : null;
    rows.push([entry.name, ...statRow(own), ...(entry.isSymbolicLink() ? [await fs.readlink(file), ...(target ? statRow(target) : ['dangling'])] : [])]);
  }
  const record = rows.some(row => row[0] === BUILD_RECORD) ? 'sha256:' + sha256Hex(await fs.readFile(path.join(directory, BUILD_RECORD))) : null;
  return { digest: 'sha256:' + sha256Hex(JSON.stringify({ rows, record })), fileCount: rows.length, buildRecordDigest: record };
}

const rangesIdentity = ranges => 'sha256:' + sha256Hex(JSON.stringify(ranges.map(range => [range.path, range.offset, range.size, range.identity])));

async function readBaseline(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') throw coded('weight-baseline-missing', 'no window-free hash of these weight directories; run the preparation first');
    throw coded('weight-baseline-invalid', 'the weight baseline is unreadable');
  }
}

/**
 * Hashes all of the model's ranges wherever the host keeps weights, so a range from the other stage cannot go unseen.
 * `outsideInFullCopy` is what removing the configured copy would clear; `outsideElsewhere` is what it would not.
 *
 * `baseline` moves that hashing out of a timed window. `{ action: 'record', file }` hashes every directory and keeps,
 * per directory, its fingerprint (fingerprintDirectory) and the ranges it held. `{ action: 'compare', file }` reads no
 * weight bytes from a directory whose fingerprint is unchanged since then and takes the ranges recorded for it; a
 * directory that is new or changed is hashed now, and one that is gone holds nothing. The inventory's `evidence` says
 * which (`hashed-now` or `unchanged-since-hash`) and `hashedAt` when the oldest hash it rests on was taken. A compare
 * also names each directory it hashed again and why (`new` or `changed`, by its path under the root that holds it),
 * counts the recorded directories now gone, and says whether every fingerprint `matched` the baseline.
 */
export async function scanHostWeights({ roots, allRanges, stageRanges, fullCopyDirectory = null, skipDirectories = [], scope, measure = measureHeldRanges,
  baseline = null, now = Date.now, signal }) {
  if (baseline !== null && (!['record', 'compare'].includes(baseline?.action) || typeof baseline.file !== 'string' || !path.isAbsolute(baseline.file))) {
    throw coded('weight-baseline-refused', 'a baseline needs an action and an absolute file');
  }
  const skip = (await Promise.all(skipDirectories.map(realOrNull))).filter(Boolean);
  const identity = { scope, roots: [...roots].sort(), skip: [...skip].sort(), ranges: rangesIdentity(allRanges) };
  let previous = null;
  if (baseline?.action === 'compare') {
    previous = await readBaseline(baseline.file);
    if (previous?.schema !== WEIGHT_BASELINE_SCHEMA || JSON.stringify(previous.identity) !== JSON.stringify(identity)) {
      throw coded('weight-baseline-mismatch', 'the baseline was recorded for other roots, skips, scope or ranges; run the preparation again');
    }
  }
  const directories = await findWeightDirectories(roots, new Set(allRanges.map(range => range.path)), skip);
  const fullCopy = fullCopyDirectory ? await realOrNull(fullCopyDirectory) : null;
  const byKey = new Map(allRanges.map(range => [rangeKey(range), range]));
  const assigned = new Set(stageRanges.map(rangeKey)), held = new Map(), elsewhere = new Set(), inCopy = new Set(), recorded = {}, rehashed = [];
  const realRoots = previous ? await Promise.all(roots.map(realOrNull)) : [];
  const underRoot = directory => {
    const index = realRoots.findIndex(root => root !== null && inside(directory, root));
    return index < 0 ? { root: null, path: path.basename(directory) } : { root: index, path: path.relative(realRoots[index], directory) || '.' };
  };
  let unchanged = 0, hashed = 0, buildRecordDigest = null;
  for (const directory of directories) {
    signal?.throwIfAborted();
    const copy = fullCopy !== null && inside(directory, fullCopy);
    const fingerprint = baseline ? await fingerprintDirectory(directory) : null;
    buildRecordDigest ??= fingerprint?.buildRecordDigest ?? null;
    const before = previous?.directories?.[directory];
    let found;
    if (before && before.fingerprint === fingerprint.digest) {
      found = before.held.map(key => byKey.get(key)).filter(Boolean);
      unchanged += 1;
    } else {
      found = await measure({ directory, ranges: allRanges, signal });
      hashed += 1;
      if (previous) rehashed.push({ ...underRoot(directory), reason: before ? 'changed' : 'new' });
    }
    if (fingerprint) recorded[directory] = { fingerprint: fingerprint.digest, held: found.map(rangeKey) };
    for (const range of found) {
      const key = rangeKey(range);
      held.set(key, range);
      if (!assigned.has(key)) (copy ? inCopy : elsewhere).add(key);
    }
  }
  const at = new Date(now()).toISOString();
  if (baseline?.action === 'record') {
    await fs.mkdir(path.dirname(baseline.file), { recursive: true, mode: 0o700 });
    const temporary = `${baseline.file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify({ schema: WEIGHT_BASELINE_SCHEMA, recordedAt: at, identity, directories: recorded }), { mode: 0o600 });
    await fs.rename(temporary, baseline.file);
  }
  const evidence = previous && unchanged > 0 ? 'unchanged-since-hash' : 'hashed-now';
  const gone = previous ? Object.keys(previous.directories ?? {}).filter(directory => !directories.includes(directory)).length : 0;
  return { inventory: { ...observeInventory({ held: [...held.values()], stageRanges, source: 'hashed-on-host', scope, scannedRanges: allRanges.length }),
    evidence, hashedAt: evidence === 'hashed-now' ? at : previous.recordedAt, ...(buildRecordDigest ? { buildRecordDigest } : {}) },
    outsideInFullCopy: inCopy.size, outsideElsewhere: elsewhere.size, skippedDirectories: skip.length,
    ...(baseline ? { baseline: { action: baseline.action, recordedAt: previous?.recordedAt ?? at,
      directories: directories.length, unchangedDirectories: unchanged, hashedDirectories: hashed,
      ...(previous ? { rehashed, goneDirectories: gone, matched: hashed === 0 && gone === 0 } : {}) } } : {}) };
}

/**
 * The OS-level restriction a Stage 1 host applies without root while its stage process runs: the full copy's directory
 * mode is set to 000, so no process of this user can list or open anything in it until the mode is restored. It is
 * owner permission, not a sandbox: root, or this user deliberately changing the mode back, is not stopped by it.
 * `mode` reads the current mode, `lock` sets 000, `unlock` restores the mode the caller recorded.
 */
export async function lockDirectory({ directory, action, mode = null }) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || path.resolve(directory) !== directory) throw coded('lock-refused', 'not an exact absolute path');
  const stat = await fs.lstat(directory).catch(() => null);
  if (!stat?.isDirectory() || await fs.realpath(directory) !== directory) throw coded('lock-refused', 'not a real directory');
  const current = stat.mode & 0o7777;
  if (action === 'mode') return { mode: current };
  if (action === 'lock') { await fs.chmod(directory, 0o000); return { locked: true, previousMode: current }; }
  if (action === 'unlock') {
    if (!Number.isSafeInteger(mode) || mode < 0 || mode > 0o7777 || (mode & 0o500) !== 0o500) throw coded('lock-refused', 'no readable mode to restore');
    await fs.chmod(directory, mode);
    await fs.access(directory, fs.constants.R_OK | fs.constants.X_OK);
    return { restored: true, mode: (await fs.stat(directory)).mode & 0o7777 };
  }
  throw coded('lock-refused', 'unknown action');
}

/** Throws MISSING_WEIGHTS or WRONG_WEIGHTS unless the directory is this exact model with every shard at full size. */
export async function assertCompleteCopy({ directory, expectedIdentity }) {
  let bytes;
  try { bytes = await fs.readFile(path.join(directory, 'manifest.json')); }
  catch (error) { if (error.code === 'ENOENT') throw coded('MISSING_WEIGHTS', 'the full copy has no manifest'); throw error; }
  if ('sha256:' + createHash('sha256').update(bytes).digest('hex') !== expectedIdentity) throw coded('WRONG_WEIGHTS', 'the full copy has another manifest');
  for (const shard of JSON.parse(bytes).shards) {
    const stat = await fs.stat(path.join(directory, shard.filename)).catch(() => null);
    if (!stat?.isFile() || stat.size !== shard.size) throw coded('MISSING_WEIGHTS', 'the full copy is missing a shard');
  }
}

/** macOS `kern.memorystatus_vm_pressure_level`: the kernel's own pressure state, 1 normal, 2 warning, 4 critical. */
const DARWIN_PRESSURE_LEVELS = Object.freeze({ 1: 'normal', 2: 'warning', 4: 'critical' });
const PRESSURE_RANK = Object.freeze({ normal: 0, warning: 1, critical: 2 });

/**
 * One memory pressure reading. Linux: `/proc/pressure/memory`, giving `avg10`, the share of the last ten seconds some
 * task stalled on memory. macOS has no pressure-stall file: `sysctl kern.memorystatus_vm_pressure_level` gives `level`.
 */
export function parseMemoryPressure(text) {
  const darwin = /kern\.memorystatus_vm_pressure_level:\s*(\d+)/.exec(text)?.[1];
  if (darwin !== undefined) {
    const level = DARWIN_PRESSURE_LEVELS[darwin];
    if (!level) throw coded('memory-pressure-unreadable', 'unknown pressure level');
    return { level };
  }
  const value = Number(/some avg10=([0-9.]+)/.exec(text)?.[1]);
  if (!Number.isFinite(value)) throw coded('memory-pressure-unreadable', 'no pressure reading');
  return { avg10: value };
}

/** The raw reading on this platform, for `parseMemoryPressure`. */
export async function readMemoryPressureText({ platform = process.platform, exec = run, readFile = fs.readFile } = {}) {
  if (platform === 'darwin') return (await exec('sysctl', ['kern.memorystatus_vm_pressure_level'], { env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin' } })).stdout;
  return readFile('/proc/pressure/memory', 'utf8');
}

/**
 * Whether a reading is inside a host's limit: `maxAvg10` judges a Linux reading, `maxPressureLevel` a macOS one. A
 * reading of the other kind is never inside the limit, so a misconfigured host stops rather than running unguarded.
 */
export function withinMemoryLimit(reading, limit) {
  if (Object.hasOwn(limit ?? {}, 'maxAvg10')) return typeof reading?.avg10 === 'number' && reading.avg10 <= limit.maxAvg10;
  if (Object.hasOwn(limit ?? {}, 'maxPressureLevel')) return Object.hasOwn(PRESSURE_RANK, reading?.level ?? '') && PRESSURE_RANK[reading.level] <= PRESSURE_RANK[limit.maxPressureLevel];
  return false;
}
export const describeMemoryPressure = reading => (reading?.level !== undefined ? `level ${reading.level}` : `avg10 ${reading?.avg10}`);

/**
 * A process's start time as `ps` prints it, used with its PID as an identity no reused PID shares. The same on Linux
 * and macOS once the locale and time zone are fixed: macOS prints the start in the caller's locale and zone, which an
 * SSH session may change between the agent that reported it and the control that checks it. Spacing is normalized.
 */
export async function processStart(pid, { exec = run, platform = process.platform } = {}) {
  if (platform === 'win32') return windowsProcessStart(pid, exec);
  try {
    const { stdout } = await exec('ps', ['-o', 'lstart=', '-p', String(pid)], { env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC' } });
    return stdout.replace(/\s+/g, ' ').trim() || null;
  } catch (error) { if (error.code === 1) return null; throw error; }
}
/**
 * Windows has no `ps`. The process table's creation time, in UTC ticks, is the same kind of identity. The PID goes
 * into a PowerShell command, so it must be a plain integer. Not yet run on a Windows host.
 */
async function windowsProcessStart(pid, exec) {
  if (!Number.isSafeInteger(pid) || pid < 0) throw coded('process-id-invalid', 'not a process id');
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { $p.StartTime.ToUniversalTime().Ticks }`]);
  const ticks = stdout.trim();
  return /^\d{1,20}$/.test(ticks) ? `ticks ${ticks}` : null;
}
const readProcessStart = pid => processStart(pid);

/** Signals only the process with this PID and start time, so a reused PID is never killed. */
export async function killExactProcess({ pid, startId, readStart = readProcessStart, kill = process.kill.bind(process), selfPid = process.pid }) {
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid === selfPid) throw coded('kill-refused', 'not a killable process id');
  if (typeof startId !== 'string' || !startId) throw coded('kill-refused', 'no process start identity');
  const current = await readStart(pid);
  if (current === null) return { killed: false, reason: 'gone' };
  if (current !== startId) return { killed: false, reason: 'pid-reused' };
  kill(pid, 'SIGKILL');
  return { killed: true };
}

const UNIT = /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,127}\.service$/;
/** Acts only on the one named unit. `is-active` reports a state; the others throw if the manager refuses. */
export async function serviceAction({ manager, unit, action }, exec = run) {
  if (!['systemd-user', 'systemd-system'].includes(manager) || !UNIT.test(unit) || !['stop', 'start', 'is-active'].includes(action)) {
    throw coded('service-refused', 'unsupported service request');
  }
  const args = [...(manager === 'systemd-user' ? ['--user'] : []), action, '--', unit];
  try {
    const { stdout } = await exec('systemctl', args);
    return action === 'is-active' ? { state: stdout.trim() } : { done: true };
  } catch (error) {
    if (action === 'is-active' && typeof error.stdout === 'string' && error.stdout.trim()) return { state: error.stdout.trim() };
    throw coded('service-command-failed', `${action} did not succeed`);
  }
}
