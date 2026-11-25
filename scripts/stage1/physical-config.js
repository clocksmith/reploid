/**
 * The private host file for a physical Stage 1 run. It names machines, paths and accounts, so it stays out of the
 * repository, and nothing here repeats one of its values in an error: a message names the field only.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import catalog from '../../shared/config/chat-models.json' with { type: 'json' };
import { STAGE1_MODEL_ID } from './expectations.js';

export const STAGE1_HOSTS_SCHEMA = 'reploid.stage1-hosts/v1';
export const STAGE1_HOST_LABELS = Object.freeze(['host-a', 'host-b']);
/** The coordinator ledger's clock allowance across machines, unless `credit.maxClockSkewMs` names another. */
export const STAGE1_CLOCK_SKEW_MS = 10000;
const SSH_TARGET = /^[A-Za-z0-9][A-Za-z0-9._-]*(@[A-Za-z0-9][A-Za-z0-9._-]*)?$/;
const SAFE_PATH = /^\/[A-Za-z0-9._\/ +@=-]*$/;
// A Windows stage host's paths travel unquoted in its remote command (command-transport.js), so they carry no space.
const WINDOWS_PATH = /^[A-Za-z]:(\\[A-Za-z0-9._-]+)+$/;
export const STAGE1_HOST_PLATFORMS = Object.freeze(['posix', 'windows']);
const MACHINE_ID = /^m-[a-f0-9]{16,64}$/;
const PARTICIPANT_ID = /^peer:[a-f0-9]{24}$/;
const SERVICE_UNIT = /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,127}\.service$/;
const WINDOWS_TASK = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const NETWORK_HOST = /^[A-Za-z0-9.:-]{1,253}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

const refuse = field => { throw Object.assign(Error(`Invalid Stage 1 host configuration: ${field}`), { code: 'stage1-config-invalid' }); };
const object = (value, field, allowed) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) refuse(field);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) refuse(`${field} has an unknown field`);
  for (const key of allowed) if (!Object.hasOwn(value, key)) refuse(`${field}.${key} is required`);
  return value;
};
const positive = (value, field) => { if (!Number.isSafeInteger(value) || value <= 0) refuse(field); return value; };
const directoryPath = (value, field, platform = 'posix') => {
  if (platform === 'windows') {
    if (typeof value !== 'string' || !WINDOWS_PATH.test(value) || path.win32.normalize(value) !== value || value.split('\\').length < 3) refuse(field);
    return value;
  }
  if (typeof value !== 'string' || !SAFE_PATH.test(value) || path.resolve(value) !== value || value.split('/').length < 3) refuse(field);
  return value;
};
const directories = (value, field, platform = 'posix') => {
  if (!Array.isArray(value)) refuse(field);
  value.forEach((row, index) => directoryPath(row, `${field}[${index}]`, platform));
  return value;
};
// Windows paths compare without regard to case.
const inside = (child, parent, platform = 'posix') => (platform === 'windows'
  ? child.toLowerCase().startsWith(parent.toLowerCase() + '\\') : child.startsWith(parent + '/'));
const overlaps = (a, b, platform = 'posix') => (platform === 'windows' ? a.toLowerCase() === b.toLowerCase() : a === b)
  || inside(a, b, platform) || inside(b, a, platform);

function validateTarget(target, field, platform = 'posix') {
  if (!MACHINE_ID.test(target.machineId ?? '')) refuse(`${field}.machineId must be opaque`);
  if (!PARTICIPANT_ID.test(target.participantId ?? '')) refuse(`${field}.participantId`);
  if (target.ssh !== null && (typeof target.ssh !== 'string' || !SSH_TARGET.test(target.ssh))) refuse(`${field}.ssh`);
  for (const key of ['node', 'releaseRoot', 'identityFile', 'stateDirectory']) directoryPath(target[key], `${field}.${key}`, platform);
}

function validateHost(host, index) {
  const field = `hosts[${index}]`;
  // `platform` is optional: a host file without it describes a POSIX host, as every host file did before the field existed.
  object(host, field, ['label', 'machineId', 'participantId', 'ssh', 'node', 'releaseRoot', 'identityFile', 'stateDirectory',
    'stageDirectory', 'fullCopyDirectory', 'weightRoots', 'memoryPressure', 'standingService',
    ...(host && typeof host === 'object' && Object.hasOwn(host, 'platform') ? ['platform'] : [])]);
  const platform = Object.hasOwn(host, 'platform') ? host.platform : 'posix';
  if (!STAGE1_HOST_PLATFORMS.includes(platform)) refuse(`${field}.platform`);
  if (host.label !== STAGE1_HOST_LABELS[index]) refuse(`${field}.label`);
  validateTarget(host, field, platform);
  if (host.ssh === null) refuse(`${field}.ssh is required for a stage host`);
  directoryPath(host.stageDirectory, `${field}.stageDirectory`, platform);
  object(host.weightRoots, `${field}.weightRoots`, ['model', 'cache', 'temporary']);
  for (const key of ['model', 'cache', 'temporary']) directories(host.weightRoots[key], `${field}.weightRoots.${key}`, platform);
  if (host.fullCopyDirectory !== null) {
    directoryPath(host.fullCopyDirectory, `${field}.fullCopyDirectory`, platform);
    for (const key of ['stageDirectory', 'stateDirectory', 'releaseRoot']) {
      if (overlaps(host.fullCopyDirectory, host[key], platform)) refuse(`${field}.fullCopyDirectory overlaps ${key}`);
    }
    if ([...host.weightRoots.model, ...host.weightRoots.cache, ...host.weightRoots.temporary].some(root => inside(root, host.fullCopyDirectory, platform))) {
      refuse(`${field}.fullCopyDirectory contains a weight root`);
    }
  }
  // The host agent has no memory reading for Windows yet, so a Windows host must not claim a memory guard.
  if (platform === 'windows' && host.memoryPressure !== null) refuse(`${field}.memoryPressure is not available on a Windows host`);
  // Linux hosts give `maxAvg10` (pressure-stall avg10); macOS hosts give `maxPressureLevel`, the highest kernel
  // memory pressure level (`normal` or `warning`) the run tolerates. null runs the host without a memory guard.
  if (host.memoryPressure !== null) {
    const darwin = Boolean(host.memoryPressure) && typeof host.memoryPressure === 'object' && Object.hasOwn(host.memoryPressure, 'maxPressureLevel');
    object(host.memoryPressure, `${field}.memoryPressure`, [darwin ? 'maxPressureLevel' : 'maxAvg10', 'pollMs']);
    if (darwin && !['normal', 'warning'].includes(host.memoryPressure.maxPressureLevel)) refuse(`${field}.memoryPressure.maxPressureLevel`);
    if (!darwin && (typeof host.memoryPressure.maxAvg10 !== 'number' || !(host.memoryPressure.maxAvg10 >= 0))) refuse(`${field}.memoryPressure.maxAvg10`);
    positive(host.memoryPressure.pollMs, `${field}.memoryPressure.pollMs`);
  }
  if (host.standingService !== null) {
    // A Windows task also names the file its service writes its process ID to: the task's own state does not say
    // whether the service still holds the GPU (host-control.js).
    object(host.standingService, `${field}.standingService`, ['manager', 'unit', 'approveStopForSolo', ...(platform === 'windows' ? ['pidFile'] : [])]);
    if (platform === 'windows') directoryPath(host.standingService.pidFile, `${field}.standingService.pidFile`, platform);
    // A Windows host's standing service is a scheduled task in the root folder; every other host's is a systemd unit.
    const managers = platform === 'windows' ? ['windows-task'] : ['systemd-user', 'systemd-system'];
    if (!managers.includes(host.standingService.manager)) refuse(`${field}.standingService.manager`);
    if (!(platform === 'windows' ? WINDOWS_TASK : SERVICE_UNIT).test(host.standingService.unit ?? '')) refuse(`${field}.standingService.unit`);
    if (typeof host.standingService.approveStopForSolo !== 'boolean') refuse(`${field}.standingService.approveStopForSolo`);
  }
}

/**
 * The optional earning device: a device enrolled under the requester's account, serving a small catalog whole model
 * (never the split model) to a coordinator-side buyer, so the account earns before it spends. It may share the
 * requester's machine, with its own participant key, identity file and state directory; never a stage host's.
 */
function validateEarner(earner) {
  object(earner, 'earner', ['machineId', 'participantId', 'ssh', 'node', 'releaseRoot', 'identityFile', 'stateDirectory', 'modelDirectory', 'modelId']);
  validateTarget(earner, 'earner');
  if (earner.ssh === null) refuse('earner.ssh is required for the earning device');
  directoryPath(earner.modelDirectory, 'earner.modelDirectory');
  const model = catalog.find(row => row.id === earner.modelId);
  if (!model || model.partitionPlanId || model.id === STAGE1_MODEL_ID) refuse('earner.modelId must name a whole-model catalog entry other than the split model');
}

export function validatePhysicalConfig(config) {
  object(config, 'configuration', ['schema', 'coordinator', 'credit', 'limits', 'requester', 'hosts',
    ...(config && typeof config === 'object' && Object.hasOwn(config, 'earner') ? ['earner'] : [])]);
  if (config.schema !== STAGE1_HOSTS_SCHEMA) refuse('schema');
  const coordinator = object(config.coordinator, 'coordinator', ['listenHost', 'publicHost', 'servicePort', 'signalingPort', 'tls']);
  for (const key of ['listenHost', 'publicHost']) if (typeof coordinator[key] !== 'string' || !NETWORK_HOST.test(coordinator[key])) refuse(`coordinator.${key}`);
  for (const key of ['servicePort', 'signalingPort']) if (positive(coordinator[key], `coordinator.${key}`) > 65535) refuse(`coordinator.${key}`);
  if (coordinator.servicePort === coordinator.signalingPort) refuse('coordinator ports must differ');
  object(coordinator.tls, 'coordinator.tls', ['keyFile', 'certFile', 'caFile']);
  for (const key of ['keyFile', 'certFile', 'caFile']) directoryPath(coordinator.tls[key], `coordinator.tls.${key}`);
  // The release window is the ledger's partitionUnclaimedReleaseMs: a dropped split's hold is released that long after
  // its deadline, and signed settlement terms carry it.
  // `maxClockSkewMs` (optional, default 10 s) is the ledger's clock allowance; the release window must be longer.
  const credit = object(config.credit, 'credit', ['weights', 'maxDebt', 'maxRequestMs', 'partitionUnclaimedReleaseMs',
    ...(config.credit && typeof config.credit === 'object' && Object.hasOwn(config.credit, 'maxClockSkewMs') ? ['maxClockSkewMs'] : [])]);
  if (!Array.isArray(credit.weights) || credit.weights.length !== 2) refuse('credit.weights');
  credit.weights.forEach((weight, index) => positive(weight, `credit.weights[${index}]`));
  positive(credit.maxDebt, 'credit.maxDebt'); positive(credit.maxRequestMs, 'credit.maxRequestMs');
  positive(credit.partitionUnclaimedReleaseMs, 'credit.partitionUnclaimedReleaseMs');
  if (Object.hasOwn(credit, 'maxClockSkewMs')) positive(credit.maxClockSkewMs, 'credit.maxClockSkewMs');
  if (credit.partitionUnclaimedReleaseMs <= (credit.maxClockSkewMs ?? STAGE1_CLOCK_SKEW_MS)) {
    refuse('credit.partitionUnclaimedReleaseMs must be longer than the clock skew allowance');
  }
  // `bookkeepingMs` (optional) bounds each of the split's checks before and after its answer, apart from the generation.
  const limits = object(config.limits, 'limits', ['phaseMs', 'abortGraceMs', 'hardStopMs', 'stopMarginMs', 'serviceRestoreMs',
    ...(config.limits && typeof config.limits === 'object' && Object.hasOwn(config.limits, 'bookkeepingMs') ? ['bookkeepingMs'] : [])]);
  for (const key of Object.keys(limits)) positive(limits[key], `limits.${key}`);
  if (limits.stopMarginMs < limits.hardStopMs) refuse('limits.stopMarginMs must cover limits.hardStopMs');
  // A hard stop confirms each process is gone, then restores a service, and must finish before the margin runs out.
  if (limits.hardStopMs < 2 * limits.serviceRestoreMs + 3000) refuse('limits.hardStopMs must cover two limits.serviceRestoreMs and the process kills');
  // The drop phase waits for the ledger to release the dropped hold: the request deadline plus the release window.
  if (limits.phaseMs <= credit.maxRequestMs + credit.partitionUnclaimedReleaseMs) refuse('limits.phaseMs must cover credit.maxRequestMs and the release window');
  object(config.requester, 'requester', ['machineId', 'participantId', 'ssh', 'node', 'releaseRoot', 'identityFile', 'modelDirectory', 'stateDirectory', 'weightRoots']);
  validateTarget(config.requester, 'requester');
  directoryPath(config.requester.modelDirectory, 'requester.modelDirectory');
  // The requester is searched as widely as a stage host: an empty model directory alone does not show it holds no weights.
  object(config.requester.weightRoots, 'requester.weightRoots', ['model', 'cache', 'temporary']);
  for (const key of ['model', 'cache', 'temporary']) directories(config.requester.weightRoots[key], `requester.weightRoots.${key}`);
  if (!Array.isArray(config.hosts) || config.hosts.length !== 2) refuse('hosts must name exactly two stage hosts');
  config.hosts.forEach(validateHost);
  if (config.earner !== undefined) validateEarner(config.earner);
  const everyone = [config.requester, ...config.hosts, ...(config.earner ? [config.earner] : [])];
  // One machine per role, except that the earner may share the requester's machine; participant keys are always distinct.
  const machines = [config.requester, ...config.hosts];
  if (new Set(machines.map(row => row.machineId)).size !== machines.length) refuse('machineId values must be distinct');
  if (new Set(everyone.map(row => row.participantId)).size !== everyone.length) refuse('participantId values must be distinct');
  const targets = machines.map(row => row.ssh).filter(Boolean);
  if (new Set(targets).size !== targets.length) refuse('ssh targets must be distinct');
  const earner = config.earner;
  if (earner) {
    if (config.hosts.some(host => host.machineId === earner.machineId || host.ssh === earner.ssh)) refuse('earner must not be on a stage host: machineId values must be distinct');
    const shared = earner.machineId === config.requester.machineId;
    if (!shared && earner.ssh === config.requester.ssh) refuse('ssh targets must be distinct: the earner shares the requester target but not its machineId');
    if (shared) {
      if (earner.identityFile === config.requester.identityFile) refuse('earner.identityFile must differ from the requester on a shared machine');
      if (overlaps(earner.stateDirectory, config.requester.stateDirectory)) refuse('earner.stateDirectory overlaps the requester on a shared machine');
      if (overlaps(earner.modelDirectory, config.requester.modelDirectory)) refuse('earner.modelDirectory overlaps the requester model directory on a shared machine');
    }
  }
  return config;
}

/** Reads an owner-only regular file. A parse error is not rethrown, because its message can quote the file. */
export async function loadPhysicalConfig(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) refuse('the host file path must be absolute');
  const stat = await fs.lstat(file).catch(() => null);
  if (!stat?.isFile()) refuse('the host file must be a regular file');
  if ((stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) refuse('the host file must be private to its owner');
  let parsed;
  try { parsed = JSON.parse(await fs.readFile(file, 'utf8')); } catch { refuse('the host file is not valid JSON'); }
  return validatePhysicalConfig(parsed);
}

/** The hard stop. It lands `stopMarginMs` before the window closes so services are restored inside the window. */
export function resolveRunWindow(value, { now, stopMarginMs }) {
  if (typeof value !== 'string' || !ISO_TIME.test(value) || !Number.isFinite(Date.parse(value))) {
    throw Object.assign(Error('window-required: pass --window-until as an ISO time with a time zone'), { code: 'window-required' });
  }
  const untilMs = Date.parse(value), maxRunMs = untilMs - now - stopMarginMs;
  if (maxRunMs <= 0) throw Object.assign(Error('window-closed: the window ends before the run could stop safely'), { code: 'window-closed' });
  return { untilMs, maxRunMs };
}

/** A frozen longer reference: 64 to 128 output tokens including the stop token, bound by the request's own limit. */
export function assertLongReference(fixture) {
  const reference = fixture?.reference, visible = reference?.visibleOutputIds;
  const valid = id => Number.isSafeInteger(id) && id >= 0;
  if (!Array.isArray(visible) || !visible.every(valid) || !valid(reference.stopId) || typeof reference.outputText !== 'string' || !reference.outputText) {
    throw Object.assign(Error('fixture-invalid: a frozen stop-token reference with its text is required'), { code: 'fixture-invalid' });
  }
  const count = visible.length + 1;
  if (count < 64 || count > 128 || fixture.maxOutputTokens < count || fixture.maxOutputTokens > 128) {
    throw Object.assign(Error(`fixture-invalid: ${count} reference tokens; 64 to 128 within the request limit are required`), { code: 'fixture-invalid' });
  }
  return count;
}

/**
 * Replaces private values from the host file, and credentials registered later, in free text bound for output. A value
 * matches only as a whole token: an alias such as `cafe` must not rewrite a hex digest or a label in a structured field.
 */
export function createRedactor(config) {
  const values = new Set();
  const add = value => { if (typeof value === 'string' && value.length >= 3) values.add(value); };
  const collect = (value, key = '') => {
    if (Array.isArray(value)) value.forEach(row => collect(row, key));
    else if (value && typeof value === 'object') for (const [name, row] of Object.entries(value)) collect(row, name);
    else if (typeof value === 'string' && !['schema', 'label', 'machineId', 'participantId', 'manager'].includes(key)) {
      add(value);
      if (key === 'ssh' && value.includes('@')) value.split('@').forEach(add);
    }
  };
  collect(config);
  return {
    add,
    text(input) {
      let output = String(input).replace(/access_token=[^&\s"']+/g, 'access_token=[private]');
      for (const value of [...values].sort((a, b) => b.length - a.length)) {
        const escaped = value.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
        output = output.replace(new RegExp(`(?<![A-Za-z0-9._-])${escaped}(?![A-Za-z0-9_-]|\\.[A-Za-z0-9])`, 'g'), '[private]');
      }
      return output;
    },
    /** Only the receipt's free-text fields can carry a host's words; its digests and IDs are left exact. */
    receipt(input) {
      const receipt = structuredClone(input), scrub = (row, key) => { if (typeof row?.[key] === 'string') row[key] = this.text(row[key]); };
      for (const phase of Object.values(receipt.phases ?? {})) scrub(phase, 'reason');
      scrub(receipt.hardStop, 'reason'); scrub(receipt.hardStop, 'error');
      for (const control of Object.values(receipt.soloControls ?? {})) scrub(control, 'reason');
      for (const row of receipt.steps ?? []) scrub(row, 'detail');
      return receipt;
    }
  };
}
