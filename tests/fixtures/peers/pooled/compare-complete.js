// Owned single-machine complete-request comparison. Default is no-GPU preflight.
// Usage: node compare-complete.js FREEZE --sha256 HEX --output DIR [--check-host-preflight] [--execute]
import assert from 'node:assert';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isDeepStrictEqual } from 'node:util';
import { performance } from 'node:perf_hooks';
import { CompleteRequestClient } from '../../complete-request-client.js';
import { ProviderStateError, providerState, assertProviderUnchanged } from '../../provider-state.js';

export { ProviderStateError };

const GIB = 1024 ** 3, MIB = 1024 ** 2;
export const DEFAULT_MIN_HOST_MEM_FREE_BYTES = 16 * GIB;
export const DEFAULT_MAX_HOST_SHMEM_BYTES = 4 * GIB;
export const DEFAULT_MAX_HOST_DIRTY_WRITEBACK_BYTES = GIB;
export const DEFAULT_MIN_GPU_GTT_HEADROOM_BYTES = 8 * GIB;
export const DEFAULT_MIN_GPU_VRAM_FREE_BYTES = 64 * MIB;
export const DEFAULT_MAX_GPU_PREEMPT_USED_BYTES = 64 * MIB;
export const DEFAULT_UMA_CARVEOUT_MAX_BYTES = GIB;
export const DEFAULT_UMA_CLIENT_PINNED_RESERVE_BYTES = 4 * MIB;
export const DEFAULT_UNEXPECTED_GPU_CLIENT_GTT_BYTES = 64 * MIB;
export const DEFAULT_MAX_DESKTOP_CLIENT_GTT_BYTES = 512 * MIB;
export const DESKTOP_DISPLAY_COMMS = new Set([
  'gnome-shell', 'Xwayland', 'Xorg', 'mutter-x11-fram', 'ibus-x11', 'kwin_wayland', 'sway', 'weston'
]);
export const DEFAULT_MAX_GPU_BUSY_PERCENT = 5;
export const DEFAULT_MAX_AMBIENT_DISK_BYTES_PER_SEC = 64 * MIB;
export const DEFAULT_LARGE_COPY_FILE_BYTES = 64 * MIB;
export const UNCONDITIONAL_COPY_COMMANDS = new Set(['rsync', 'scp', 'sftp-server', 'rclone', 'dd', 'pv', 'zstd', 'unzstd', 'pzstd']);
export const CONDITIONAL_COPY_COMMANDS = new Set(['cp', 'mv', 'tar', 'gzip', 'pigz', 'xz']);
const WHOLE_DISK_NAME_RE = /^(?:nvme\d+n\d+|sd[a-z]+|vd[a-z]+|xvd[a-z]+|mmcblk\d+)$/;
const DEFAULT_ALLOWED_CACHE_ROOTS = ['/dev/shm', '/tmp'];

export class PreflightError extends Error {
  constructor(message, snapshot = null) { super(message); this.name = 'PreflightError'; this.snapshot = snapshot; }
}

const sleep = seconds => new Promise(resolve => setTimeout(resolve, seconds * 1000));
const isDigits = value => typeof value === 'string' && /^\d+$/.test(value);
const systemError = error => typeof error?.code === 'string';

function toInt(value, name = 'value') {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'boolean') return Number(value);
  if (typeof value === 'string' && /^\s*[+-]?\d+\s*$/.test(value)) return Number(value.trim());
  throw new TypeError(`Invalid integer for ${name}: ${JSON.stringify(value)}`);
}

function strictInt(text, name) {
  const trimmed = text.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) throw new Error(`Invalid integer in ${name}: ${JSON.stringify(trimmed)}`);
  return Number(trimmed);
}

function requiredKey(object, key) {
  if (!Object.hasOwn(object, key)) throw new Error('Missing required freeze key: ' + key);
  return object[key];
}

const option = (object, key, fallback) => (Object.hasOwn(object, key) ? object[key] : fallback);

const isFile = file => { try { return fs.statSync(file).isFile(); } catch { return false; } };
const isDirectory = file => { try { return fs.statSync(file).isDirectory(); } catch { return false; } };
const isSymlink = file => { try { return fs.lstatSync(file).isSymbolicLink(); } catch { return false; } };

export function native(config, requests, output, deadline) {
  const args = [config.node, config.nativeWorker, config.nativeConfigPath];
  return protocolRun(args, requests, output, deadline, config.environment);
}

export async function protocolRun(command, requests, output, deadline, environment = null) {
  const rows = [];
  const setupStarted = performance.now();
  const client = new CompleteRequestClient(command, output, { env: cleanEnvironment(environment),
    maxResponseBytes: 16 * 1024 * 1024, armTimeoutSeconds: deadline });
  const exitReceipt = await client.run(async () => {
    for (const request of requests) {
      const limit = { open: 310, request: 130, lifecycle: 520 }[request.op] ?? 45;
      const response = await client.request(request, Math.min(deadline, limit));
      assert(response.requestOp === request.op, 'Worker response operation differs');
      assert(!Object.hasOwn(response, 'error'), JSON.stringify(response.error));
      let value = response.value;
      if (request.op === 'open') {
        value = { ...value, clientSetupWallMs: performance.now() - setupStarted,
          clientSetupScope: 'owned-worker-startup-preflight-open/v1', clientOpenWallMs: response.clientRequestWallMs };
      }
      if (request.op === 'request') {
        assert(value !== null && typeof value === 'object' && !Array.isArray(value), 'Complete request must return an object');
        value = { ...value, clientRequestWallMs: response.clientRequestWallMs, clientTimingScope: 'owned-local-stdio-jsonl/v1',
          clientRequestBytes: response.clientRequestBytes, clientResponseBytes: response.clientResponseBytes,
          clientRequestPayload: response.clientRequestPayload };
        value.clientOverheadMs = value.clientRequestWallMs - value.requestWallMs;
        assert(value.clientOverheadMs >= -0.01, 'Client duration does not contain the core interval');
      }
      rows.push(value);
    }
    return client.finish(5);
  });
  assert(requests.at(-1).op === 'close', 'Owned protocol must close explicitly');
  rows[rows.length - 1] = { ...rows.at(-1), ownedProcessExit: exitReceipt };
  return rows;
}

export function checkTokens(rows, workload, kind, freeze, out) {
  const payload = path.join(out, 'complete-output.json');
  fs.writeFileSync(payload, JSON.stringify({ rows, workload, kind }));
  const stdout = execFileSync(freeze.node, [freeze.controlChecker, freeze.freezePath, payload],
    { encoding: 'utf8', timeout: 45000, env: cleanEnvironment(), maxBuffer: 256 * MIB });
  return JSON.parse(stdout).outputs[0];
}

const STRIPPED_ENVIRONMENT = new Set(['NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH',
  'DAWN_OPTS', 'UV_THREADPOOL_SIZE', 'RN_DEBUG']);

export function cleanEnvironment(extra = null) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (STRIPPED_ENVIRONMENT.has(key) || key.startsWith('POOLED_') || key.startsWith('DOPPLER_')) delete env[key];
  }
  assert(extra === null || extra === undefined || (typeof extra === 'object' && !Array.isArray(extra)
    && Object.entries(extra).every(([key, value]) => typeof value === 'string'
      && !(key + value).includes('\x00') && !key.includes('='))), 'Explicit environment must map valid strings to strings');
  return { ...env, ...(extra ?? {}) };
}

export function nativeRequests(workload, requireLifecycle) {
  const requests = [{ op: 'preflight' }, { op: 'open', indices: null }];
  for (let repeat = 0; repeat < 3; repeat += 1) requests.push({ ...workload, op: 'request', repeat });
  if (requireLifecycle) {
    assert(workload.maxNew >= 2, 'Full-model lifecycle requires a multi-token workload');
    requests.push({ ...workload, op: 'lifecycle' });
  }
  return [...requests, { op: 'receipts' }, { op: 'close' }];
}

const isTokenId = token => Number.isInteger(token) && token >= 0;

export function validateWorkloads(workloads) {
  assert(Array.isArray(workloads) && workloads.length, 'Frozen comparison workloads required');
  const names = new Set(), inputs = new Set(), classifications = new Set();
  for (const workload of workloads) {
    const name = workload.name;
    assert(typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(name),
      'Workload name must be a safe output-directory component');
    assert(!names.has(name), 'Duplicate workload name would reuse an arm output directory: ' + name);
    names.add(name);
    const classification = workload.classification;
    assert(classification === 'frozen' || classification === 'heldout', 'Workload must declare frozen or heldout scope');
    classifications.add(classification);
    const ids = workload.promptIds;
    assert(Array.isArray(ids) && ids.length && ids.every(isTokenId), 'Exact nonempty prompt IDs required');
    const key = JSON.stringify(ids);
    assert(!inputs.has(key), 'Frozen and held-out workloads must use distinct prompt IDs');
    inputs.add(key);
    assert(typeof workload.prompt === 'string' && workload.prompt.trim(), 'Prompt text required');
    assert(Number.isInteger(workload.maxNew) && workload.maxNew > 0, 'Positive token bound required');
    assert(Array.isArray(workload.stopIds) && workload.stopIds.every(isTokenId), 'Explicit stop IDs required');
  }
  assert(classifications.size === 2, 'Both frozen and held-out workloads required');
}

export function lifecycleOutputs(value) {
  assert(value.schema === 'reploid.native-complete-lifecycle/v1', 'Missing full-model lifecycle receipt');
  assert(value.observedTokens === 1, 'Cancellation did not follow the first observed token');
  assert(isDeepStrictEqual(value.phases.map(phase => phase.name), ['first-complete-request', 'repeated-complete-request',
    'pre-aborted-request', 'active-cancellation-settled', 'recovered-complete-request']), 'Incomplete full-model lifecycle');
  return ['first', 'repeat', 'recovered'].map(key => value[key]);
}

export function pausedProviderState(unit, { show } = {}) {
  if (typeof unit !== 'string' || !/^[A-Za-z0-9_.@:-]+\.service$/.test(unit)) {
    throw new ProviderStateError('Explicit protected service name required');
  }
  const observe = show ?? (() => execFileSync('systemctl', ['--user', 'show', unit, '-p', 'ActiveState', '-p', 'SubState',
    '-p', 'MainPID', '-p', 'InvocationID'], { encoding: 'utf8', timeout: 5000 }));
  const values = {};
  try {
    for (const line of observe().split(/\r?\n/)) {
      const at = line.indexOf('=');
      if (at >= 0) values[line.slice(0, at)] = line.slice(at + 1);
    }
  } catch (error) {
    if (!systemError(error)) throw error;
    throw new ProviderStateError('Protected provider pause state is unobservable: ' + error.message);
  }
  if (values.ActiveState !== 'inactive' || values.MainPID !== '0') {
    throw new ProviderStateError(`Protected provider ${unit} is not paused inactive `
      + `(ActiveState=${JSON.stringify(values.ActiveState ?? null)}, MainPID=${JSON.stringify(values.MainPID ?? null)})`);
  }
  return { policy: 'paused_inactive', unit, ActiveState: values.ActiveState, SubState: values.SubState ?? null,
    MainPID: values.MainPID, InvocationID: values.InvocationID ?? '' };
}

export function snapshotProtectedProvider(freeze, { showPaused } = {}) {
  const policy = option(freeze, 'protectedProviderPolicy', 'active_unchanged');
  assert(policy === 'active_unchanged' || policy === 'paused_inactive', `Unknown protectedProviderPolicy: ${JSON.stringify(policy)}`);
  const unit = requiredKey(freeze, 'protectedProviderUnit');
  if (policy === 'paused_inactive') return pausedProviderState(unit, { show: showPaused });
  return providerState(unit);
}

export function verifyProtectedProviderUnchanged(freeze, before, after) {
  if (option(freeze, 'protectedProviderPolicy', 'active_unchanged') === 'paused_inactive') {
    if (!isDeepStrictEqual(before, after)) throw new ProviderStateError('Paused protected provider state changed during comparison');
    return after;
  }
  return assertProviderUnchanged(before, after);
}

const within = (child, root) => child === root || child.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

export function validateProtectedCacheDir(rawPath, { allowedRoots = DEFAULT_ALLOWED_CACHE_ROOTS } = {}) {
  assert(typeof rawPath === 'string' && rawPath.startsWith('/'), 'Protected cache directory must be an absolute path');
  assert(!rawPath.split('/').includes('..'), 'Protected cache directory must not contain parent traversal');
  const candidate = path.normalize(rawPath).replace(/(.)\/+$/, '$1');
  if (isSymlink(candidate)) throw new PreflightError(`Protected cache directory must not be a symlink: ${rawPath}`);
  const parent = fs.realpathSync(path.dirname(candidate));
  const resolvedRoots = allowedRoots.filter(root => fs.existsSync(root)).map(root => fs.realpathSync(root));
  if (!resolvedRoots.some(root => within(parent, root))) {
    throw new PreflightError(`Protected cache directory ${rawPath} must reside under an allowed ephemeral root ${JSON.stringify(allowedRoots)}`);
  }
  const resolvedCandidate = path.join(parent, path.basename(candidate));
  if (resolvedRoots.includes(resolvedCandidate)) {
    throw new PreflightError(`Protected cache directory must not be an ephemeral root itself: ${rawPath}`);
  }
  return candidate;
}

export function discoverProtectedCacheDirs(freeze, { allowedRoots = DEFAULT_ALLOWED_CACHE_ROOTS } = {}) {
  const discovered = [];
  const add = directory => {
    const validated = validateProtectedCacheDir(directory, { allowedRoots });
    if (!discovered.includes(validated)) discovered.push(validated);
  };
  const nativeArms = freeze.native ?? {};
  for (const name of Object.keys(nativeArms).sort()) {
    const configPath = nativeArms[name].nativeConfigPath;
    if (!fs.existsSync(configPath)) continue;
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    for (const section of ['workerGather', 'gather']) {
      const directory = config[section]?.protectedCache?.directory;
      if (directory !== undefined && directory !== null) add(directory);
    }
  }
  for (const directory of freeze.protectedCacheDirectories ?? []) add(directory);
  return discovered;
}

export function clearProtectedCacheDirs(directories, { allowedRoots = DEFAULT_ALLOWED_CACHE_ROOTS } = {}) {
  const receipts = [];
  for (const directory of directories) {
    const validated = validateProtectedCacheDir(String(directory), { allowedRoots });
    const existed = fs.existsSync(validated);
    if (existed) {
      if (!fs.lstatSync(validated).isDirectory()) throw new Error('Protected cache path is not a directory: ' + validated);
      fs.rmSync(validated, { recursive: true });
    }
    if (fs.existsSync(validated) || isSymlink(validated)) {
      throw new PreflightError(`Protected cache directory failed to clear cleanly: ${validated}`);
    }
    receipts.push({ directory: validated, removed: existed, existsAfter: false });
  }
  return receipts;
}

export function readMeminfoBytes(procRoot = '/proc') {
  const values = {};
  for (const line of fs.readFileSync(path.join(String(procRoot), 'meminfo'), 'utf8').split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at < 0) continue;
    const parts = line.slice(at + 1).split(/\s+/).filter(Boolean);
    if (!parts.length || !isDigits(parts[0])) continue;
    values[line.slice(0, at).trim()] = Number(parts[0]) * (parts[1] === 'kB' ? 1024 : 1);
  }
  for (const required of ['MemTotal', 'MemFree', 'MemAvailable', 'Shmem']) {
    if (!Object.hasOwn(values, required)) throw new PreflightError(`/proc/meminfo missing required counter ${required}`);
  }
  return values;
}

const DRM_SIZE_SCALE = { B: 1, KiB: 1024, kB: 1024, MiB: MIB, GiB: GIB };

function parseDrmSizeBytes(rawValue) {
  const parts = (rawValue || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length || !isDigits(parts[0])) return 0;
  return Number(parts[0]) * (DRM_SIZE_SCALE[parts[1] ?? 'B'] ?? 1);
}

function drmFields(text) {
  const fields = {};
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (line.startsWith('drm-') && at >= 0) fields[line.slice(0, at)] = line.slice(at + 1);
  }
  return fields;
}

const compareClientIds = (a, b) => (isDigits(a) && isDigits(b) ? Number(a) - Number(b) : (a < b ? -1 : a > b ? 1 : 0));

function statComm(text) {
  const begin = text.indexOf('('), end = text.lastIndexOf(')');
  return begin >= 0 && end > begin ? text.slice(begin + 1, end) : '';
}

export function scanDrmClients(procRoot = '/proc') {
  const clients = new Map();
  if (!isDirectory(procRoot)) return [];
  for (const name of fs.readdirSync(procRoot).sort()) {
    if (!isDigits(name)) continue;
    const pid = Number(name);
    const entry = path.join(String(procRoot), name);
    const fdinfoDir = path.join(entry, 'fdinfo');
    if (!isDirectory(fdinfoDir)) continue;
    try {
      let comm = isFile(path.join(entry, 'comm')) ? fs.readFileSync(path.join(entry, 'comm'), 'utf8').trim() : '';
      if (!comm && isFile(path.join(entry, 'stat'))) comm = statComm(fs.readFileSync(path.join(entry, 'stat'), 'utf8'));
      for (const descriptor of fs.readdirSync(fdinfoDir).sort()) {
        let text;
        try { text = fs.readFileSync(path.join(fdinfoDir, descriptor), 'utf8'); } catch (error) {
          if (systemError(error)) continue;
          throw error;
        }
        const fields = drmFields(text);
        const clientId = (fields['drm-client-id'] ?? '').trim();
        if (!clientId) continue;
        const vramBytes = parseDrmSizeBytes(fields['drm-memory-vram']);
        const sharedVramBytes = parseDrmSizeBytes(fields['drm-shared-vram']);
        const gttBytes = parseDrmSizeBytes(fields['drm-memory-gtt']);
        const previous = clients.get(clientId);
        if (!previous || vramBytes + gttBytes > previous.vramBytes + previous.gttBytes) {
          clients.set(clientId, { clientId, pid, comm, vramBytes, sharedVramBytes,
            privateVramBytes: Math.max(0, vramBytes - sharedVramBytes), gttBytes });
        }
      }
    } catch (error) {
      if (systemError(error)) continue;
      throw error;
    }
  }
  return [...clients.keys()].sort(compareClientIds).map(key => clients.get(key));
}

const AMDGPU_FIELDS = ['mem_info_gtt_total', 'mem_info_gtt_used', 'mem_info_vram_total', 'mem_info_vram_used'];

export function readAmdgpuSysfs(drmRoot = '/sys/class/drm', cardName = null) {
  if (!fs.existsSync(drmRoot)) throw new PreflightError(`DRM sysfs root unavailable: ${drmRoot}`);
  const candidates = [];
  for (const name of fs.readdirSync(drmRoot).sort()) {
    if (!/^card\d+$/.test(name)) continue;
    if (cardName !== null && cardName !== undefined && name !== cardName) continue;
    const device = path.join(String(drmRoot), name, 'device');
    if (!AMDGPU_FIELDS.every(field => isFile(path.join(device, field)))) continue;
    const metrics = Object.fromEntries(AMDGPU_FIELDS.map(field =>
      [field, strictInt(fs.readFileSync(path.join(device, field), 'utf8'), field)]));
    if (metrics.mem_info_gtt_total <= 0) continue;
    const optional = field => (isFile(path.join(device, field)) ? strictInt(fs.readFileSync(path.join(device, field), 'utf8'), field) : 0);
    const busy = optional('gpu_busy_percent');
    const preemptUsed = optional('mem_info_preempt_used');
    candidates.push({
      card: name,
      isUmaCarveout: metrics.mem_info_vram_total <= DEFAULT_UMA_CARVEOUT_MAX_BYTES
        && metrics.mem_info_gtt_total >= 8 * metrics.mem_info_vram_total,
      vramTotalBytes: metrics.mem_info_vram_total,
      vramUsedBytes: metrics.mem_info_vram_used,
      vramFreeBytes: metrics.mem_info_vram_total - metrics.mem_info_vram_used,
      preemptUsedBytes: preemptUsed,
      gttTotalBytes: metrics.mem_info_gtt_total,
      gttUsedBytes: metrics.mem_info_gtt_used,
      gttFreeBytes: metrics.mem_info_gtt_total - metrics.mem_info_gtt_used,
      gpuBusyPercent: busy
    });
  }
  if (!candidates.length) throw new PreflightError('No observable AMD GPU sysfs memory counters found under ' + drmRoot);
  if (candidates.length > 1) {
    throw new PreflightError(`Multiple AMD GPU sysfs devices found (${JSON.stringify(candidates.map(row => row.card))}); pin gpuDrmCard in freeze`);
  }
  return candidates[0];
}

function readWholeDiskIoBytes(procRoot) {
  const diskstats = path.join(String(procRoot), 'diskstats');
  if (!isFile(diskstats)) return null;
  let total = 0;
  for (const line of fs.readFileSync(diskstats, 'utf8').split(/\r?\n/)) {
    const parts = line.split(/\s+/).filter(Boolean);
    if (parts.length < 10 || !WHOLE_DISK_NAME_RE.test(parts[2])) continue;
    if (isDigits(parts[5]) && isDigits(parts[9])) total += (Number(parts[5]) + Number(parts[9])) * 512;
  }
  return total;
}

const intersectSorted = (names, commands) => [...names].filter(name => commands.has(name)).sort();

export async function detectBulkCopyActivity(procRoot = '/proc', { largeFileBytes = DEFAULT_LARGE_COPY_FILE_BYTES,
  sampleSeconds = 0.2, sleepFn = sleep, selfPid = null } = {}) {
  const ownPid = selfPid ?? process.pid;
  const copyProcesses = [];
  for (const name of fs.readdirSync(procRoot).sort()) {
    if (!isDigits(name)) continue;
    const pid = Number(name);
    if (pid === ownPid) continue;
    const entry = path.join(String(procRoot), name);
    try {
      const statText = fs.readFileSync(path.join(entry, 'stat'), 'utf8');
      const begin = statText.indexOf('('), end = statText.lastIndexOf(')');
      if (begin < 0 || end <= begin) continue;
      const comm = statText.slice(begin + 1, end);
      const state = statText.slice(end + 1).split(/\s+/).filter(Boolean)[0] ?? '';
      if (state === 'Z' || state === 'X') continue;
      const argvFirst = fs.readFileSync(path.join(entry, 'cmdline')).toString('utf8').split('\x00')[0];
      const argv0 = argvFirst ? path.basename(argvFirst) : '';
      const names = new Set([comm, argv0].filter(Boolean));
      const unconditional = intersectSorted(names, UNCONDITIONAL_COPY_COMMANDS);
      if (unconditional.length) {
        copyProcesses.push({ pid, command: unconditional[0], reason: 'active_bulk_copy_or_archive_process' });
        continue;
      }
      const conditional = intersectSorted(names, CONDITIONAL_COPY_COMMANDS);
      if (conditional.length) {
        const fdDir = path.join(entry, 'fd');
        let maxOpenBytes = 0;
        if (isDirectory(fdDir)) {
          for (const descriptor of fs.readdirSync(fdDir)) {
            try {
              const target = fs.statSync(path.join(fdDir, descriptor));
              if (target.isFile() && target.size > maxOpenBytes) maxOpenBytes = target.size;
            } catch (error) {
              if (!systemError(error)) throw error;
            }
          }
        }
        if (maxOpenBytes >= largeFileBytes) {
          copyProcesses.push({ pid, command: conditional[0], reason: 'large_regular_file_open', maxOpenFileBytes: maxOpenBytes });
        }
      }
    } catch (error) {
      if (systemError(error)) continue;
      throw error;
    }
  }
  const ioBefore = readWholeDiskIoBytes(procRoot);
  let ambientBps = 0;
  if (ioBefore !== null && sampleSeconds > 0) {
    await sleepFn(sampleSeconds);
    const ioAfter = readWholeDiskIoBytes(procRoot);
    if (ioAfter !== null && ioAfter >= ioBefore) ambientBps = (ioAfter - ioBefore) / sampleSeconds;
  }
  return { copyProcesses, ambientDiskBytesPerSec: ambientBps, sampleSeconds };
}

export function allowedGpuPids(providerSnapshot) {
  if (!providerSnapshot || typeof providerSnapshot !== 'object' || !Object.hasOwn(providerSnapshot, 'processes')) return new Set();
  return new Set(Object.keys(providerSnapshot.processes).filter(isDigits).map(Number));
}

export async function checkHostAndGpuPreflight(freeze, { procRoot = '/proc', drmRoot = '/sys/class/drm',
  allowedGpuPids: allowed = null, sampleSeconds = 0.2, sleepFn = sleep, selfPid = null } = {}) {
  const minAvailable = toInt(requiredKey(freeze, 'minHostAvailableBytes'), 'minHostAvailableBytes');
  const minMemFree = toInt(option(freeze, 'minHostMemFreeBytes', DEFAULT_MIN_HOST_MEM_FREE_BYTES));
  const maxShmem = toInt(option(freeze, 'maxHostShmemBytes', DEFAULT_MAX_HOST_SHMEM_BYTES));
  const maxDirty = toInt(option(freeze, 'maxHostDirtyWritebackBytes', DEFAULT_MAX_HOST_DIRTY_WRITEBACK_BYTES));
  const gpuPolicy = option(freeze, 'gpuPreflightPolicy', 'amdgpu_sysfs');
  assert(gpuPolicy === 'amdgpu_sysfs' || gpuPolicy === 'none', `Unknown gpuPreflightPolicy: ${JSON.stringify(gpuPolicy)}`);
  const minGttFree = toInt(requiredKey(freeze, 'gpuCapBytes'), 'gpuCapBytes')
    + toInt(option(freeze, 'minGpuGttHeadroomBytes', DEFAULT_MIN_GPU_GTT_HEADROOM_BYTES));
  const minVramFree = toInt(option(freeze, 'minGpuVramFreeBytes', DEFAULT_MIN_GPU_VRAM_FREE_BYTES));
  const maxPreemptUsed = toInt(option(freeze, 'maxGpuPreemptUsedBytes', DEFAULT_MAX_GPU_PREEMPT_USED_BYTES));
  const unexpectedClientGtt = toInt(option(freeze, 'unexpectedGpuClientGttBytes', DEFAULT_UNEXPECTED_GPU_CLIENT_GTT_BYTES));
  const maxGpuBusy = toInt(option(freeze, 'maxGpuBusyPercent', DEFAULT_MAX_GPU_BUSY_PERCENT));
  const maxDiskBps = toInt(option(freeze, 'maxAmbientDiskBytesPerSec', DEFAULT_MAX_AMBIENT_DISK_BYTES_PER_SEC));
  const largeCopyBytes = toInt(option(freeze, 'largeCopyFileThresholdBytes', DEFAULT_LARGE_COPY_FILE_BYTES));
  const allowedPids = new Set(allowed === null ? [] : [...allowed].map(pid => toInt(pid)));

  const violations = [];
  const mem = readMeminfoBytes(procRoot);
  const dirtyWriteback = (mem.Dirty ?? 0) + (mem.Writeback ?? 0);
  if (mem.MemAvailable < minAvailable) violations.push(`MemAvailable ${mem.MemAvailable} < minHostAvailableBytes ${minAvailable}`);
  if (mem.MemFree < minMemFree) violations.push(`MemFree ${mem.MemFree} < minHostMemFreeBytes ${minMemFree} (page-cache churn risk)`);
  if (mem.Shmem > maxShmem) violations.push(`Shmem ${mem.Shmem} > maxHostShmemBytes ${maxShmem} (/tmp or /dev/shm tmpfs pressure)`);
  if (dirtyWriteback > maxDirty) violations.push(`Dirty+Writeback ${dirtyWriteback} > maxHostDirtyWritebackBytes ${maxDirty}`);

  let gpu = null;
  if (gpuPolicy === 'amdgpu_sysfs') {
    try {
      gpu = readAmdgpuSysfs(drmRoot, option(freeze, 'gpuDrmCard', null));
      const drmClients = scanDrmClients(procRoot);
      let evictableUmaVram = 0;
      if (gpu.isUmaCarveout) {
        evictableUmaVram = Math.min(gpu.vramUsedBytes, drmClients.reduce((sum, client) =>
          sum + Math.max(0, client.privateVramBytes - DEFAULT_UMA_CLIENT_PINNED_RESERVE_BYTES), 0));
      }
      const effectiveVramAvail = gpu.vramFreeBytes + evictableUmaVram;
      const requiredGttFree = minGttFree + evictableUmaVram;
      const maxDesktopGtt = toInt(option(freeze, 'maxDesktopClientGttBytes', DEFAULT_MAX_DESKTOP_CLIENT_GTT_BYTES));
      const unexpectedClients = drmClients.filter(client => !allowedPids.has(client.pid)
        && client.gttBytes >= (DESKTOP_DISPLAY_COMMS.has(client.comm) ? maxDesktopGtt : unexpectedClientGtt));
      Object.assign(gpu, { evictableUmaVramBytes: evictableUmaVram, effectiveVramAvailableBytes: effectiveVramAvail,
        requiredGttFreeBytes: requiredGttFree, drmClients, unexpectedComputeClients: unexpectedClients });

      if (gpu.gttFreeBytes < requiredGttFree) {
        violations.push(`GPU ${gpu.card} gttFreeBytes ${gpu.gttFreeBytes} < required ${requiredGttFree} `
          + `(gttUsedBytes=${gpu.gttUsedBytes}, gttTotalBytes=${gpu.gttTotalBytes}, evictableUmaVramBytes=${evictableUmaVram})`);
      }
      if (Object.hasOwn(freeze, 'maxGpuGttUsedBytes') && gpu.gttUsedBytes > toInt(freeze.maxGpuGttUsedBytes)) {
        violations.push(`GPU ${gpu.card} gttUsedBytes ${gpu.gttUsedBytes} > maxGpuGttUsedBytes ${toInt(freeze.maxGpuGttUsedBytes)}`);
      }
      if (effectiveVramAvail < minVramFree) {
        violations.push(`GPU ${gpu.card} 512 MiB carve-out effectiveVramAvailableBytes ${effectiveVramAvail} `
          + `< minGpuVramFreeBytes ${minVramFree} (vramFreeBytes=${gpu.vramFreeBytes}, `
          + `evictableUmaVramBytes=${evictableUmaVram}, vramTotalBytes=${gpu.vramTotalBytes}; BO_VA / SDMA suballoc risk)`);
      }
      if (gpu.preemptUsedBytes > maxPreemptUsed) {
        violations.push(`GPU ${gpu.card} preemptUsedBytes ${gpu.preemptUsedBytes} > maxGpuPreemptUsedBytes ${maxPreemptUsed}`);
      }
      if (unexpectedClients.length) {
        const description = unexpectedClients.map(row => `${row.comm}(pid=${row.pid},client=${row.clientId},gtt=${row.gttBytes})`).join(', ');
        violations.push(`Unexpected GPU compute client(s) holding GTT memory: ${description}`);
      }
      if (gpu.gpuBusyPercent > maxGpuBusy) {
        violations.push(`GPU ${gpu.card} gpuBusyPercent ${gpu.gpuBusyPercent} > maxGpuBusyPercent ${maxGpuBusy}`);
      }
    } catch (error) {
      if (!(error instanceof PreflightError)) throw error;
      violations.push(error.message);
    }
  }

  const copyOptions = { largeFileBytes: largeCopyBytes, sampleSeconds, sleepFn, selfPid };
  let ioActivity = await detectBulkCopyActivity(procRoot, copyOptions);
  if (!ioActivity.copyProcesses.length && ioActivity.ambientDiskBytesPerSec > maxDiskBps && sampleSeconds > 0) {
    // Settle a transient flush, then re-measure before refusing.
    await sleepFn(1.0);
    const recheck = await detectBulkCopyActivity(procRoot, { ...copyOptions, sampleSeconds: Math.max(sampleSeconds, 0.5) });
    recheck.initialAmbientDiskBytesPerSec = ioActivity.ambientDiskBytesPerSec;
    ioActivity = recheck;
  }
  if (ioActivity.copyProcesses.length) {
    const summary = ioActivity.copyProcesses.map(row => `${row.command}(pid=${row.pid},${row.reason})`).join(', ');
    violations.push(`Active bulk file copy or archive process detected: ${summary}`);
  }
  if (ioActivity.ambientDiskBytesPerSec > maxDiskBps) {
    violations.push(`Ambient disk I/O ${ioActivity.ambientDiskBytesPerSec.toFixed(0)} B/s > maxAmbientDiskBytesPerSec ${maxDiskBps}`);
  }

  const amd = gpuPolicy === 'amdgpu_sysfs';
  return {
    checkedAt: Date.now() / 1000,
    passed: !violations.length,
    violations,
    thresholds: {
      minHostAvailableBytes: minAvailable,
      minHostMemFreeBytes: minMemFree,
      maxHostShmemBytes: maxShmem,
      maxHostDirtyWritebackBytes: maxDirty,
      gpuPreflightPolicy: gpuPolicy,
      minGpuGttFreeBytes: amd ? minGttFree : null,
      minGpuVramFreeBytes: amd ? minVramFree : null,
      maxGpuBusyPercent: amd ? maxGpuBusy : null,
      maxAmbientDiskBytesPerSec: maxDiskBps,
      largeCopyFileThresholdBytes: largeCopyBytes
    },
    hostMemory: {
      MemTotal: mem.MemTotal,
      MemFree: mem.MemFree,
      MemAvailable: mem.MemAvailable,
      Cached: mem.Cached ?? 0,
      Shmem: mem.Shmem,
      SwapCached: mem.SwapCached ?? 0,
      Dirty: mem.Dirty ?? 0,
      Writeback: mem.Writeback ?? 0
    },
    gpu,
    io: ioActivity
  };
}

export async function requireHostAndGpuPreflight(freeze, options = {}) {
  const snapshot = await checkHostAndGpuPreflight(freeze, options);
  if (!snapshot.passed) {
    throw new PreflightError('Hardened host/GPU preflight refused execution: ' + snapshot.violations.join('; '), snapshot);
  }
  return snapshot;
}

function sha256File(file) {
  const digest = createHash('sha256');
  const handle = fs.openSync(file, 'r');
  try {
    const block = Buffer.alloc(65536);
    let count;
    while ((count = fs.readSync(handle, block, 0, block.length, null)) > 0) digest.update(block.subarray(0, count));
  } finally {
    fs.closeSync(handle);
  }
  return digest.digest('hex');
}

/**
 * Hold an exclusive lock on the first path and a shared lock on the second, both
 * non-blocking, for as long as the returned holder lives. Node has no flock(2), so
 * util-linux flock(1) holds them around a Node process that waits for stdin EOF.
 * Ending stdin (or this process dying) releases both locks.
 */
export async function holdComparisonLocks(exclusivePath, sharedPath) {
  const holder = spawn('flock', ['--nonblock', '--exclusive', exclusivePath, 'flock', '--nonblock', '--shared', sharedPath,
    process.execPath, '-e', 'process.stdout.write("held\\n");process.stdin.resume();process.stdin.on("end",()=>process.exit(0))'],
  { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  holder.stderr.on('data', chunk => { stderr += chunk; });
  await new Promise((resolve, reject) => {
    holder.once('error', reject);
    holder.stdout.once('data', () => resolve());
    holder.once('exit', code => reject(new Error(`Comparison locks unavailable (flock exit ${code}): ${stderr.trim()}`)));
  });
  return {
    release: () => new Promise(resolve => {
      if (holder.exitCode !== null || holder.signalCode !== null) return resolve();
      holder.once('exit', () => resolve());
      holder.stdin.end();
    })
  };
}

async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen({ host: '127.0.0.1', port, exclusive: true }, () => probe.close(resolve));
  });
}

const canConnect = (port, timeoutMs) => new Promise(resolve => {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  const done = value => { socket.destroy(); resolve(value); };
  socket.setTimeout(timeoutMs, () => done(false));
  socket.once('connect', () => done(true));
  socket.once('error', () => done(false));
});

function waitForExit(child, milliseconds) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), milliseconds);
    child.once('exit', () => { clearTimeout(timer); resolve(true); });
  });
}

function killGroup(pid, signal) {
  try { process.kill(-pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}

const USAGE = 'usage: compare-complete.js [-h] --sha256 SHA256 --output OUTPUT [--check-host-preflight] [--execute] freeze';

export function parseCli(argv, usage = USAGE, flags = ['check-host-preflight', 'execute']) {
  const fail = message => {
    process.stderr.write(`${usage}\n${path.basename(usage.split(' ')[1])}: error: ${message}\n`);
    process.exit(2);
  };
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: {
      help: { type: 'boolean', short: 'h' }, sha256: { type: 'string' }, output: { type: 'string' },
      ...Object.fromEntries(flags.map(flag => [flag, { type: 'boolean' }])) } });
  } catch (error) {
    fail(error.message);
  }
  if (parsed.values.help) { process.stdout.write(usage + '\n'); process.exit(0); }
  const missing = ['sha256', 'output'].filter(key => parsed.values[key] === undefined).map(key => '--' + key);
  if (!parsed.positionals.length) missing.unshift('freeze');
  if (missing.length) fail('the following arguments are required: ' + missing.join(', '));
  if (parsed.positionals.length > 1) fail('unrecognized arguments: ' + parsed.positionals.slice(1).join(' '));
  return { freeze: parsed.positionals[0], ...parsed.values };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseCli(argv);
  const frozenBytes = fs.readFileSync(args.freeze);
  assert(createHash('sha256').update(frozenBytes).digest('hex') === args.sha256, 'Frozen comparison changed');
  const freeze = JSON.parse(frozenBytes.toString('utf8'));
  assert(freeze.schema === 'a1.complete-request-comparison/v2', 'Obsolete comparison freeze');
  validateWorkloads(freeze.workloads);
  const requireLifecycle = option(freeze, 'requireNativeLifecycle', false);
  assert(typeof requireLifecycle === 'boolean', 'requireNativeLifecycle must be an explicit boolean');
  const providerPolicy = option(freeze, 'protectedProviderPolicy', 'active_unchanged');
  assert(['active_unchanged', 'paused_inactive'].includes(providerPolicy), 'Invalid protectedProviderPolicy');
  const cachePolicy = option(freeze, 'protectedCachePolicy', 'preserve_across_arms');
  assert(['preserve_across_arms', 'clear_before_candidate', 'clear_each_arm'].includes(cachePolicy), 'Invalid protectedCachePolicy');
  const clearing = cachePolicy === 'clear_before_candidate' || cachePolicy === 'clear_each_arm';
  if (requireLifecycle) {
    const pins = new Set(freeze.filePins.map(pin => path.resolve(pin.path)));
    for (const config of Object.values(freeze.native)) {
      const helper = path.join(path.dirname(path.resolve(config.nativeWorker)), 'native-complete-lifecycle.js');
      assert(pins.has(helper), 'Full-model lifecycle helper must be pinned in the comparison freeze');
    }
    for (const workload of freeze.workloads) assert(workload.maxNew >= 2, 'Full-model lifecycle requires a multi-token workload');
  }
  freeze.freezePath = fs.realpathSync(args.freeze);
  const out = args.output;
  fs.mkdirSync(out);
  const report = {
    scope: freeze.scope,
    freezeSha256: args.sha256,
    started: Date.now() / 1000,
    modelRunsStarted: false,
    completed: false,
    protectedProviderUnit: freeze.protectedProviderUnit,
    protectedProviderPolicy: providerPolicy,
    runsBesideProtectedProvider: providerPolicy === 'active_unchanged',
    protectedCachePolicy: cachePolicy,
    environmentPolicy: 'Unset ambient POOLED_*, DOPPLER_*, DAWN_OPTS, UV_THREADPOOL_SIZE and RN_DEBUG; apply only frozen arm overrides; unset is distinct from empty',
    nativeLifecycleRequired: requireLifecycle,
    nativeLifecycleQualified: false,
    arms: []
  };
  const save = () => {
    const handle = fs.openSync(path.join(out, 'report.json'), 'w');
    try { fs.writeSync(handle, JSON.stringify(report, null, 2)); fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
  };
  try {
    cleanEnvironment(freeze.pooledConfig.environment ?? {});
    for (const pin of freeze.filePins) {
      assert(fs.statSync(pin.path).size === pin.bytes, pin.path);
      assert(sha256File(pin.path) === pin.sha256, pin.path);
    }
    const checker = execFileSync(freeze.node, [freeze.controlChecker, args.freeze],
      { encoding: 'utf8', timeout: 45000, env: cleanEnvironment(), maxBuffer: 256 * MIB });
    report.controlPreflight = JSON.parse(checker);
    for (const [name, config] of Object.entries(freeze.native)) {
      const rows = await native(config, [{ op: 'preflight' }, { op: 'close' }], path.join(out, name + '-preflight.log'), 45);
      assert(rows[0].runtime.treeSha256 === config.sourceTreeSha256);
      assert(rows[0].model.readyForWholeModel && !rows[0].gpuOpened);
      assert(rows[1].gpuOpened === false);
    }
    const protectedCacheDirs = discoverProtectedCacheDirs(freeze);
    report.protectedCacheDirectories = [...protectedCacheDirs];
    report.metadataPreflightPassed = true;
    report.sourceIntegrityReady = report.controlPreflight.sourceIntegrity.ready;
    save();
    if (args['check-host-preflight'] && !args.execute) {
      report.providerBefore = snapshotProtectedProvider(freeze);
      const hostSnapshot = await checkHostAndGpuPreflight(freeze, { allowedGpuPids: allowedGpuPids(report.providerBefore) });
      report.hostPreflightBefore = hostSnapshot;
      save();
      process.stdout.write(JSON.stringify({
        metadataPreflightPassed: true,
        sourceIntegrityReady: report.sourceIntegrityReady,
        protectedProviderPolicy: providerPolicy,
        runsBesideProtectedProvider: report.runsBesideProtectedProvider,
        hostPreflightPassed: hostSnapshot.passed,
        violations: hostSnapshot.violations,
        hostMemory: hostSnapshot.hostMemory,
        gpu: hostSnapshot.gpu,
        io: hostSnapshot.io,
        modelRunsStarted: false
      }) + '\n');
      if (!hostSnapshot.passed) {
        throw new PreflightError('Hardened host/GPU preflight refused execution: ' + hostSnapshot.violations.join('; '), hostSnapshot);
      }
      return;
    }
    if (!args.execute) {
      process.stdout.write(JSON.stringify({ metadataPreflightPassed: true, sourceIntegrityReady: report.sourceIntegrityReady,
        modelRunsStarted: false }) + '\n');
      return;
    }
    assert(report.sourceIntegrityReady, 'A pinned complete content proof is required before comparison execution');
    const locks = await holdComparisonLocks(freeze.locks[0], freeze.locks[1]);
    try {
      const before = snapshotProtectedProvider(freeze);
      report.providerBefore = before;
      const allowed = allowedGpuPids(before);
      if (clearing && protectedCacheDirs.length) report.protectedCacheClearedAtStart = clearProtectedCacheDirs(protectedCacheDirs);
      const hostBefore = await checkHostAndGpuPreflight(freeze, { allowedGpuPids: allowed });
      report.hostPreflightBefore = hostBefore;
      save();
      if (!hostBefore.passed) {
        throw new PreflightError('Hardened host/GPU preflight refused execution: ' + hostBefore.violations.join('; '), hostBefore);
      }
      const signaling = freeze.signaling;
      await assertPortFree(signaling.port);
      const serverLog = fs.openSync(path.join(out, 'signaling.log'), 'wx');
      const server = spawn(signaling.command[0], signaling.command.slice(1),
        { stdio: ['ignore', serverLog, serverLog], env: cleanEnvironment(), detached: true });
      try {
        let connected = false;
        for (let attempt = 0; attempt < 100 && !connected; attempt += 1) {
          assert(server.exitCode === null && server.signalCode === null, 'Owned signaling process exited');
          connected = await canConnect(signaling.port, 100);
          if (!connected) await sleep(0.1);
        }
        if (!connected) throw new Error('Owned signaling deadline');
        for (const workload of freeze.workloads) {
          let reference = null;
          for (const [index, kind] of freeze.pattern.entries()) {
            let lifecycle = null;
            const arm = path.join(out, `${workload.name}-${index}-${kind}`);
            fs.mkdirSync(arm);
            verifyProtectedProviderUnchanged(freeze, before, snapshotProtectedProvider(freeze));
            let cacheClearedBefore = null;
            if (kind !== 'pooled' && clearing && protectedCacheDirs.length) cacheClearedBefore = clearProtectedCacheDirs(protectedCacheDirs);
            const armPreflight = await checkHostAndGpuPreflight(freeze, { allowedGpuPids: allowed });
            fs.writeFileSync(path.join(arm, 'host-preflight.json'), JSON.stringify(armPreflight, null, 2));
            if (!armPreflight.passed) {
              report.lastArmPreflightFailure = { workload: workload.name, armIndex: index, kind, hostPreflight: armPreflight };
              save();
              throw new PreflightError(`Hardened preflight refused arm ${workload.name}-${index}-${kind}: `
                + armPreflight.violations.join('; '), armPreflight);
            }
            report.modelRunsStarted = null;
            report.stage = { workload: workload.name, kind, state: 'owned model-command admission attempted; opening unobserved' };
            save();
            let cacheClearedAfter = null;
            let responses, rows;
            try {
              if (kind === 'pooled') {
                const config = { ...freeze.pooledConfig, out: path.join(arm, 'result.json'), protocol: true, cases: [] };
                const configPath = path.join(arm, 'config.json');
                fs.writeFileSync(configPath, JSON.stringify(config));
                const requests = [{ op: 'open' }, ...[0, 1, 2].map(repeat => ({ ...workload, op: 'request', repeat })),
                  { op: 'receipts' }, { op: 'close' }];
                responses = await protocolRun([freeze.node, freeze.pooledAdapter, configPath], requests,
                  path.join(arm, 'process.log'), freeze.armTimeoutSeconds, config.environment ?? {});
                const result = responses.at(-1);
                fs.writeFileSync(path.join(arm, 'protocol-results.json'), JSON.stringify(responses, null, 2));
                assert(result.cleanup === 'settled' && !result.error);
                assert(isDeepStrictEqual(result.split.ranges, [[0, 48]]));
                const gpu = result.gpuMemory;
                assert(!gpu.errors.length && !gpu.overCapAllocations && gpu.peakBytes <= freeze.gpuCapBytes);
                assert(gpu.liveBytes === 0, 'Peer GPU allocations did not retire after room close');
                rows = responses.slice(1, 4);
                assert(rows.every(row => row.reused === 0), 'Pooled reused a prefix');
              } else {
                const requests = nativeRequests(workload, requireLifecycle);
                responses = await native(freeze.native[kind], requests, path.join(arm, 'process.log'), freeze.armTimeoutSeconds);
                rows = responses.slice(2, 5);
                assert(rows.every(row => row.generationEvidence.stats.reusedPrefixTokens === 0));
                for (const response of responses.slice(1, 5)) {
                  const gpu = response.memory.device;
                  assert(gpu.maxBytes === freeze.gpuCapBytes && gpu.peakBytes <= freeze.gpuCapBytes && gpu.rejected === 0);
                }
                const close = responses.at(-1);
                assert(!close.receiptFailure, 'Native source receipt collection failed');
                assert(close.sourceCleanup === 'settled' && close.closedSourceReceipts?.length);
                for (const collection of [responses.at(-2), close.sourceReceipts, close.closedSourceReceipts]) {
                  for (const source of collection) {
                    assert(!source.receiptFailure, 'Source receipt failed');
                    assert(source.generic.activeReadBytes === 0, 'Native source read did not settle');
                    if (source.gather !== undefined && source.gather !== null) {
                      assert(source.gather.activeReadBytes === 0, 'Gather ownership did not settle');
                    }
                  }
                }
                assert(['active', 'retainedModel', 'deferredCleanup'].every(owner => close.pool.resources[owner].bytes === 0));
                if (requireLifecycle) {
                  lifecycle = responses[5];
                  const recoveredRows = lifecycleOutputs(lifecycle);
                  const normalizedRecovery = checkTokens(recoveredRows, workload, kind, freeze, arm);
                  assert(isDeepStrictEqual(normalizedRecovery, checkTokens(rows, workload, kind, freeze, arm)),
                    'Lifecycle recovery differs from timed full-model requests');
                }
                fs.writeFileSync(path.join(arm, 'result.json'), JSON.stringify(responses, null, 2));
              }
            } finally {
              if (kind !== 'pooled' && cachePolicy === 'clear_each_arm' && protectedCacheDirs.length) {
                cacheClearedAfter = clearProtectedCacheDirs(protectedCacheDirs);
              }
            }
            report.modelRunsStarted = true;
            report.stage.state = 'complete request outputs observed';
            const normalized = checkTokens(rows, workload, kind, freeze, arm);
            if (reference === null) reference = normalized;
            assert(isDeepStrictEqual(normalized, reference), 'Exact complete IDs, stop reason/token or public text differs');
            verifyProtectedProviderUnchanged(freeze, before, snapshotProtectedProvider(freeze));
            const opened = kind === 'pooled' ? responses[0] : responses[1];
            const setup = Object.fromEntries(['clientSetupWallMs', 'clientSetupScope', 'clientOpenWallMs'].map(key => [key, opened[key]]));
            report.arms.push({ workload: workload.name, kind, exactCompletion: true, setup, hostPreflight: armPreflight,
              protectedCacheClearedBefore: cacheClearedBefore, protectedCacheClearedAfter: cacheClearedAfter,
              normalized, rows, lifecycle });
            save();
          }
        }
        report.completed = true;
        const nativeArms = report.arms.filter(arm => arm.kind !== 'pooled');
        report.nativeLifecycleQualified = requireLifecycle && nativeArms.length > 0 && nativeArms.every(arm => arm.lifecycle !== null);
      } finally {
        killGroup(server.pid, 'SIGTERM');
        if (!await waitForExit(server, 5000)) {
          killGroup(server.pid, 'SIGKILL');
          if (!await waitForExit(server, 5000)) throw new Error('Owned signaling process did not exit after SIGKILL');
        }
        fs.closeSync(serverLog);
        report.providerAfter = snapshotProtectedProvider(freeze);
        verifyProtectedProviderUnchanged(freeze, before, report.providerAfter);
      }
    } finally {
      await locks.release();
    }
  } catch (error) {
    report.completed = false;
    report.nativeLifecycleQualified = false;
    report.failure = String(error?.message ?? error);
    throw error;
  } finally {
    report.finished = Date.now() / 1000;
    save();
  }
}

export function isEntry(moduleUrl) {
  if (!process.argv[1]) return false;
  try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(moduleUrl)); } catch { return false; }
}

if (isEntry(import.meta.url)) await main();
