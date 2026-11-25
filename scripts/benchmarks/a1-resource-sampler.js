#!/usr/bin/env node
// Passive Linux sampling. Does not load, hash, warm, evict or lock model pages.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

class ValueError extends Error { constructor(message) { super(message); this.name = 'ValueError'; } }
class IndexError extends Error { constructor(message) { super(message); this.name = 'IndexError'; } }
class KeyError extends Error { constructor(message) { super(message); this.name = 'KeyError'; } }

const ERRNO_NAMES = { ENOENT: 'FileNotFoundError', EACCES: 'PermissionError', EPERM: 'PermissionError',
  ESRCH: 'ProcessLookupError', EISDIR: 'IsADirectoryError', ENOTDIR: 'NotADirectoryError', ETIMEDOUT: 'TimeoutExpired' };

/** Stable reason names for recorded unavailability (kept identical to the earlier Python sampler). */
export function errorName(error) {
  if (error instanceof SyntaxError) return 'JSONDecodeError';
  if (['ValueError', 'IndexError', 'KeyError', 'TypeError', 'CalledProcessError', 'TimeoutExpired'].includes(error?.name)) return error.name;
  if (typeof error?.code === 'string') return ERRNO_NAMES[error.code] ?? 'OSError';
  return error?.name ?? 'Error';
}

const readFile = file => fs.readFileSync(file, 'utf8');

function startTicks(text) {
  const end = text.lastIndexOf(')');
  if (end < 0) throw new IndexError('stat has no command terminator');
  const fields = text.slice(end + 1).split(/\s+/).filter(Boolean);
  if (fields.length < 20) throw new IndexError('stat start time is missing');
  return fields[19];
}

function parseIo(text) {
  const io = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const at = line.indexOf(':');
    if (at < 0) throw new ValueError('io line has no separator');
    const value = line.slice(at + 1).trim();
    if (!/^[+-]?\d+$/.test(value)) throw new ValueError('io counter is not an integer: ' + value);
    io[line.slice(0, at)] = Number(value);
  }
  return io;
}

export function processSnapshot(pid, proc = '/proc', { readText = readFile } = {}) {
  const root = path.join(String(proc), String(pid));
  try {
    const before = startTicks(readText(path.join(root, 'stat')));
    const io = parseIo(readText(path.join(root, 'io')));
    const after = startTicks(readText(path.join(root, 'stat')));
    if (before !== after) return { pid, available: false, reason: 'pid-reused-during-snapshot' };
    return { pid, startTicks: before, available: true, io };
  } catch (error) {
    return { pid, available: false, reason: errorName(error) };
  }
}

export function ioDelta(previous, current) {
  if (!previous || !previous.available || !current.available) return null;
  if (previous.pid !== current.pid || previous.startTicks !== current.startTicks) return null;
  const delta = {};
  for (const key of Object.keys(current.io)) {
    if (Object.hasOwn(previous.io, key)) delta[key] = current.io[key] - previous.io[key];
  }
  return Object.values(delta).every(value => value >= 0) ? delta : null;
}

const PHASE_KEYS = ['runId', 'armId', 'phase', 'eventId'];

export function phaseSnapshot(marker) {
  if (marker === null || marker === undefined) return { available: false, reason: 'no-phase-marker' };
  try {
    const value = JSON.parse(readFile(marker));
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || PHASE_KEYS.some(key => typeof value[key] !== 'string' || !value[key])) {
      throw new ValueError('phase marker needs runId, armId, phase, eventId');
    }
    return { available: true, ...Object.fromEntries(PHASE_KEYS.map(key => [key, value[key]])) };
  } catch (error) {
    return { available: false, reason: errorName(error) };
  }
}

function runFincore(files) {
  const result = spawnSync('fincore', ['--json', '--bytes', '--output', 'FILE,SIZE,RES', '--', ...files],
    { encoding: 'utf8', timeout: 2000 });
  if (result.error) throw result.error;
  if (result.signal) throw Object.assign(new Error('fincore timed out'), { name: 'TimeoutExpired' });
  if (result.status !== 0) throw Object.assign(new Error('fincore exited ' + result.status), { name: 'CalledProcessError' });
  return result;
}

const fileIdentity = file => {
  const info = fs.statSync(file, { bigint: true });
  return { info, key: [info.dev, info.ino, info.size, info.mtimeNs, info.uid].join(':') };
};

export function residency(files, { geteuid = () => process.geteuid(), run = runFincore } = {}) {
  if (!files?.length) return { available: false, reason: 'no-files' };
  try {
    // fincore queries page residency, never reads file contents. Limit each sample's overhead.
    const identities = [];
    for (const file of files) {
      const { info, key } = fileIdentity(file);
      if (!info.isFile() || Number(info.uid) !== geteuid()) {
        return { available: false, reason: 'residency-requires-caller-owned-regular-file' };
      }
      identities.push(key);
    }
    const result = run(files.map(String));
    if (files.some((file, index) => fileIdentity(file).key !== identities[index])) {
      return { available: false, reason: 'residency-file-changed' };
    }
    const parsed = JSON.parse(result.stdout);
    if (!parsed || typeof parsed !== 'object' || !Object.hasOwn(parsed, 'fincore')) throw new KeyError('fincore');
    return { available: true, files: parsed.fincore, diagnostic: String(result.stderr ?? '').trim() || null,
      validityGate: 'caller-owned-regular-file-before-and-after' };
  } catch (error) {
    return { available: false, reason: errorName(error) };
  }
}

const REPORT_LIMIT = 64 * 1024 * 1024;
const reportCache = new Map();

/** Observe compare-complete.js's existing report; never infer request phase from arm state. */
export function harnessContext(file, expectedFreeze) {
  if (file === null || file === undefined) return null;
  try {
    const stamp = fs.statSync(file, { bigint: true });
    const identity = [String(file), expectedFreeze, stamp.dev, stamp.ino, stamp.size, stamp.mtimeNs].join('\0');
    if (reportCache.has(identity)) return reportCache.get(identity);
    if (stamp.size > REPORT_LIMIT) throw new ValueError('report exceeds observation bound');
    const handle = fs.openSync(file, 'r');
    let raw;
    try {
      const buffer = Buffer.alloc(Number(stamp.size) + 1);
      let length = 0, count;
      while (length < buffer.length && (count = fs.readSync(handle, buffer, length, buffer.length - length, null)) > 0) length += count;
      if (length > REPORT_LIMIT) throw new ValueError('report exceeds observation bound');
      raw = buffer.subarray(0, length).toString('utf8');
    } finally {
      fs.closeSync(handle);
    }
    const after = fs.statSync(file, { bigint: true });
    if (stamp.dev !== after.dev || stamp.ino !== after.ino || stamp.size !== after.size || stamp.mtimeNs !== after.mtimeNs) {
      throw new ValueError('report changed while reading');
    }
    const value = JSON.parse(raw);
    const arms = value && typeof value === 'object' && Object.hasOwn(value, 'arms') ? value.arms : [];
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(arms)) {
      throw new ValueError('invalid harness report shape');
    }
    if (!expectedFreeze || value.freezeSha256 !== expectedFreeze) throw new ValueError('freeze mismatch');
    const result = { available: true, freezeSha256: expectedFreeze, started: value.started ?? null,
      completedArms: arms.length, stage: value.stage ?? null, completed: Object.hasOwn(value, 'completed') ? value.completed : false,
      requestPhaseAttribution: false };
    reportCache.clear();
    reportCache.set(identity, result);
    return result;
  } catch (error) {
    return { available: false, reason: errorName(error) };
  }
}

/** JSON with recursively sorted keys; BigInt counters are written as exact integers. */
export function sortedJson(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return '[' + value.map(sortedJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().filter(key => value[key] !== undefined)
      .map(key => JSON.stringify(key) + ':' + sortedJson(value[key])).join(',') + '}';
  }
  return JSON.stringify(value) ?? 'null';
}

const USAGE = 'usage: a1-resource-sampler.js [-h] --pid PID [--file FILE] [--phase-marker PHASE_MARKER] '
  + '[--harness-report HARNESS_REPORT] [--freeze-sha256 FREEZE_SHA256] [--samples SAMPLES] [--interval INTERVAL] --out OUT';

function fail(message) {
  process.stderr.write(`${USAGE}\na1-resource-sampler.js: error: ${message}\n`);
  process.exit(2);
}

export function parseCli(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: {
      help: { type: 'boolean', short: 'h' }, pid: { type: 'string', multiple: true }, file: { type: 'string', multiple: true },
      'phase-marker': { type: 'string' }, 'harness-report': { type: 'string' }, 'freeze-sha256': { type: 'string' },
      samples: { type: 'string' }, interval: { type: 'string' }, out: { type: 'string' } } });
  } catch (error) {
    fail(error.message);
  }
  const values = parsed.values;
  if (values.help) {
    process.stdout.write(USAGE + '\n\nPassive Linux sampling. Does not load, hash, warm, evict or lock model pages.\n');
    process.exit(0);
  }
  const missing = ['pid', 'out'].filter(key => values[key] === undefined).map(key => '--' + key);
  if (missing.length) fail('the following arguments are required: ' + missing.join(', '));
  const integer = (name, text) => (/^\s*[+-]?\d+\s*$/.test(text) ? Number(text) : fail(`argument --${name}: invalid int value: '${text}'`));
  const float = (name, text) => (text.trim() !== '' && Number.isFinite(Number(text)) ? Number(text) : fail(`argument --${name}: invalid float value: '${text}'`));
  const args = {
    pid: values.pid.map(value => integer('pid', value)),
    file: values.file ?? [],
    phaseMarker: values['phase-marker'] ?? null,
    harnessReport: values['harness-report'] ?? null,
    freezeSha256: values['freeze-sha256'] ?? null,
    samples: values.samples === undefined ? 60 : integer('samples', values.samples),
    interval: values.interval === undefined ? 1.0 : float('interval', values.interval),
    out: values.out
  };
  if (!(args.samples >= 1 && args.samples <= 3600) || !(args.interval >= 0.1 && args.interval <= 60) || args.pid.some(pid => pid <= 0)) {
    fail('invalid bounded sampling parameters');
  }
  if (args.harnessReport && (!args.freezeSha256 || args.freezeSha256.length !== 64)) {
    fail('--harness-report requires the pinned --freeze-sha256');
  }
  return args;
}

const unixNs = () => BigInt(Math.round((performance.timeOrigin + performance.now()) * 1e3)) * 1000n;

export async function main(argv = process.argv.slice(2)) {
  const args = parseCli(argv);
  let previous = new Map(), previousPhase = null;
  // Exclusive output creation preserves prior evidence. stdout is not used for data.
  const output = fs.openSync(args.out, 'wx');
  try {
    for (let index = 0; index < args.samples; index += 1) {
      const began = process.hrtime.bigint(), unixBegan = unixNs(), phaseBefore = phaseSnapshot(args.phaseMarker);
      const processes = args.pid.map(pid => processSnapshot(pid));
      const resident = residency(args.file);
      const phaseAfter = phaseSnapshot(args.phaseMarker);
      const phaseStable = sortedJson(phaseBefore) === sortedJson(phaseAfter) && phaseBefore.available === true;
      const intervalAttributable = Boolean(phaseStable && previousPhase !== null && sortedJson(previousPhase) === sortedJson(phaseBefore));
      for (const snapshot of processes) {
        snapshot.ioDelta = ioDelta(previous.get(snapshot.pid), snapshot);
        snapshot.phaseAttributable = intervalAttributable && snapshot.ioDelta !== null;
      }
      const row = { schema: 'reploid.a1-resource-sample/v1', index, collectionBeginMonotonicNs: began, collectionBeginUnixNs: unixBegan,
        harnessContext: harnessContext(args.harnessReport, args.freezeSha256), phase: phaseAfter, phaseStableDuringSample: phaseStable,
        processes, residency: resident, collectionDurationNs: process.hrtime.bigint() - began };
      fs.writeSync(output, sortedJson(row) + '\n');
      previous = new Map(processes.map(snapshot => [snapshot.pid, snapshot]));
      previousPhase = phaseStable ? phaseAfter : null;
      if (index + 1 < args.samples) await new Promise(resolve => setTimeout(resolve, args.interval * 1000));
    }
  } finally {
    fs.closeSync(output);
  }
}

const entry = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (entry) await main();
