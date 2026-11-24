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

/** Every directory under `roots` holding a file named like a model shard, following links once. Fails closed if huge. */
export async function findWeightDirectories(roots, shardNames) {
  const visited = new Set(), found = [];
  let entries = 0;
  const visit = async directory => {
    const real = await realOrNull(directory);
    if (!real || visited.has(real)) return;
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

/**
 * Hashes all of the model's ranges wherever the host keeps weights, so a range from the other stage cannot go unseen.
 * `outsideInFullCopy` is what removing the configured copy would clear; `outsideElsewhere` is what it would not.
 */
export async function scanHostWeights({ roots, allRanges, stageRanges, fullCopyDirectory = null, scope, measure = measureHeldRanges, signal }) {
  const directories = await findWeightDirectories(roots, new Set(allRanges.map(range => range.path)));
  const fullCopy = fullCopyDirectory ? await realOrNull(fullCopyDirectory) : null;
  const assigned = new Set(stageRanges.map(rangeKey)), held = new Map(), elsewhere = new Set(), inCopy = new Set();
  for (const directory of directories) {
    const copy = fullCopy !== null && inside(directory, fullCopy);
    for (const range of await measure({ directory, ranges: allRanges, signal })) {
      const key = rangeKey(range);
      held.set(key, range);
      if (!assigned.has(key)) (copy ? inCopy : elsewhere).add(key);
    }
  }
  return { inventory: observeInventory({ held: [...held.values()], stageRanges, source: 'hashed-on-host', scope, scannedRanges: allRanges.length }),
    outsideInFullCopy: inCopy.size, outsideElsewhere: elsewhere.size };
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

/** Removes exactly one directory: a real path, holding only this model's files, under this model's manifest identity. */
export async function deleteFullCopy({ directory, expectedIdentity, allowedExtraFiles = [], protectedDirectories = [] }) {
  if (!path.isAbsolute(directory) || path.resolve(directory) !== directory) throw coded('full-copy-path-refused', 'not an exact absolute path');
  const stat = await fs.lstat(directory).catch(() => null);
  if (!stat?.isDirectory() || await fs.realpath(directory) !== directory) throw coded('full-copy-path-refused', 'not a real directory');
  for (const guarded of protectedDirectories) {
    const real = await realOrNull(guarded) ?? path.resolve(guarded);
    if (inside(real, directory) || inside(directory, real)) throw coded('full-copy-path-refused', 'overlaps a protected directory');
  }
  const manifestFile = path.join(directory, 'manifest.json');
  const manifestStat = await fs.lstat(manifestFile).catch(() => null);
  if (!manifestStat?.isFile()) throw coded('full-copy-identity-mismatch', 'no regular manifest');
  const bytes = await fs.readFile(manifestFile);
  if ('sha256:' + createHash('sha256').update(bytes).digest('hex') !== expectedIdentity) throw coded('full-copy-identity-mismatch', 'manifest differs from the model');
  const allowed = new Set(['manifest.json', ...allowedExtraFiles, ...JSON.parse(bytes).shards.map(shard => shard.filename)]);
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !allowed.has(entry.name)) throw coded('full-copy-unexpected-entry', 'holds something that is not this model');
  }
  await fs.rm(directory, { recursive: true });
  return { deleted: true };
}

export function parseMemoryPressure(text) {
  const value = Number(/some avg10=([0-9.]+)/.exec(text)?.[1]);
  if (!Number.isFinite(value)) throw coded('memory-pressure-unreadable', 'no pressure reading');
  return { avg10: value };
}

const readProcessStart = async pid => {
  try { return (await run('ps', ['-o', 'lstart=', '-p', String(pid)])).stdout.trim() || null; }
  catch (error) { if (error.code === 1) return null; throw error; }
};
export const processStart = readProcessStart;

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
