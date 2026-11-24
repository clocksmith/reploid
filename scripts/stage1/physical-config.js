/**
 * The private host file for a physical Stage 1 run. It names machines, paths and accounts, so it stays out of the
 * repository, and nothing here repeats one of its values in an error: a message names the field only.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

export const STAGE1_HOSTS_SCHEMA = 'reploid.stage1-hosts/v1';
export const STAGE1_HOST_LABELS = Object.freeze(['host-a', 'host-b']);
const SSH_TARGET = /^[A-Za-z0-9][A-Za-z0-9._-]*(@[A-Za-z0-9][A-Za-z0-9._-]*)?$/;
const SAFE_PATH = /^\/[A-Za-z0-9._\/ +@=-]*$/;
const MACHINE_ID = /^m-[a-f0-9]{16,64}$/;
const PARTICIPANT_ID = /^peer:[a-f0-9]{24}$/;
const SERVICE_UNIT = /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,127}\.service$/;
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
const directoryPath = (value, field) => {
  if (typeof value !== 'string' || !SAFE_PATH.test(value) || path.resolve(value) !== value || value.split('/').length < 3) refuse(field);
  return value;
};
const directories = (value, field) => {
  if (!Array.isArray(value)) refuse(field);
  value.forEach((row, index) => directoryPath(row, `${field}[${index}]`));
  return value;
};
const overlaps = (a, b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');

function validateTarget(target, field) {
  if (!MACHINE_ID.test(target.machineId ?? '')) refuse(`${field}.machineId must be opaque`);
  if (!PARTICIPANT_ID.test(target.participantId ?? '')) refuse(`${field}.participantId`);
  if (target.ssh !== null && (typeof target.ssh !== 'string' || !SSH_TARGET.test(target.ssh))) refuse(`${field}.ssh`);
  for (const key of ['node', 'releaseRoot', 'identityFile', 'stateDirectory']) directoryPath(target[key], `${field}.${key}`);
}

function validateHost(host, index) {
  const field = `hosts[${index}]`;
  object(host, field, ['label', 'machineId', 'participantId', 'ssh', 'node', 'releaseRoot', 'identityFile', 'stateDirectory',
    'stageDirectory', 'fullCopyDirectory', 'weightRoots', 'memoryPressure', 'standingService']);
  if (host.label !== STAGE1_HOST_LABELS[index]) refuse(`${field}.label`);
  validateTarget(host, field);
  if (host.ssh === null) refuse(`${field}.ssh is required for a stage host`);
  directoryPath(host.stageDirectory, `${field}.stageDirectory`);
  object(host.weightRoots, `${field}.weightRoots`, ['model', 'cache', 'temporary']);
  for (const key of ['model', 'cache', 'temporary']) directories(host.weightRoots[key], `${field}.weightRoots.${key}`);
  if (host.fullCopyDirectory !== null) {
    directoryPath(host.fullCopyDirectory, `${field}.fullCopyDirectory`);
    for (const key of ['stageDirectory', 'stateDirectory', 'releaseRoot']) {
      if (overlaps(host.fullCopyDirectory, host[key])) refuse(`${field}.fullCopyDirectory overlaps ${key}`);
    }
    if ([...host.weightRoots.model, ...host.weightRoots.cache, ...host.weightRoots.temporary].some(root => root.startsWith(host.fullCopyDirectory + '/'))) {
      refuse(`${field}.fullCopyDirectory contains a weight root`);
    }
  }
  if (host.memoryPressure !== null) {
    object(host.memoryPressure, `${field}.memoryPressure`, ['maxAvg10', 'pollMs']);
    if (typeof host.memoryPressure.maxAvg10 !== 'number' || !(host.memoryPressure.maxAvg10 >= 0)) refuse(`${field}.memoryPressure.maxAvg10`);
    positive(host.memoryPressure.pollMs, `${field}.memoryPressure.pollMs`);
  }
  if (host.standingService !== null) {
    object(host.standingService, `${field}.standingService`, ['manager', 'unit', 'approveStopForSolo']);
    if (!['systemd-user', 'systemd-system'].includes(host.standingService.manager)) refuse(`${field}.standingService.manager`);
    if (!SERVICE_UNIT.test(host.standingService.unit ?? '')) refuse(`${field}.standingService.unit`);
    if (typeof host.standingService.approveStopForSolo !== 'boolean') refuse(`${field}.standingService.approveStopForSolo`);
  }
}

export function validatePhysicalConfig(config) {
  object(config, 'configuration', ['schema', 'coordinator', 'credit', 'limits', 'requester', 'hosts']);
  if (config.schema !== STAGE1_HOSTS_SCHEMA) refuse('schema');
  const coordinator = object(config.coordinator, 'coordinator', ['listenHost', 'publicHost', 'servicePort', 'signalingPort', 'tls']);
  for (const key of ['listenHost', 'publicHost']) if (typeof coordinator[key] !== 'string' || !NETWORK_HOST.test(coordinator[key])) refuse(`coordinator.${key}`);
  for (const key of ['servicePort', 'signalingPort']) if (positive(coordinator[key], `coordinator.${key}`) > 65535) refuse(`coordinator.${key}`);
  if (coordinator.servicePort === coordinator.signalingPort) refuse('coordinator ports must differ');
  object(coordinator.tls, 'coordinator.tls', ['keyFile', 'certFile', 'caFile']);
  for (const key of ['keyFile', 'certFile', 'caFile']) directoryPath(coordinator.tls[key], `coordinator.tls.${key}`);
  const credit = object(config.credit, 'credit', ['weights', 'maxDebt', 'maxRequestMs']);
  if (!Array.isArray(credit.weights) || credit.weights.length !== 2) refuse('credit.weights');
  credit.weights.forEach((weight, index) => positive(weight, `credit.weights[${index}]`));
  positive(credit.maxDebt, 'credit.maxDebt'); positive(credit.maxRequestMs, 'credit.maxRequestMs');
  const limits = object(config.limits, 'limits', ['phaseMs', 'abortGraceMs', 'hardStopMs', 'stopMarginMs', 'serviceRestoreMs']);
  for (const key of Object.keys(limits)) positive(limits[key], `limits.${key}`);
  if (limits.stopMarginMs < limits.hardStopMs) refuse('limits.stopMarginMs must cover limits.hardStopMs');
  // A hard stop confirms each process is gone, then restores a service, and must finish before the margin runs out.
  if (limits.hardStopMs < 2 * limits.serviceRestoreMs + 3000) refuse('limits.hardStopMs must cover two limits.serviceRestoreMs and the process kills');
  object(config.requester, 'requester', ['machineId', 'participantId', 'ssh', 'node', 'releaseRoot', 'identityFile', 'modelDirectory', 'stateDirectory']);
  validateTarget(config.requester, 'requester');
  directoryPath(config.requester.modelDirectory, 'requester.modelDirectory');
  if (!Array.isArray(config.hosts) || config.hosts.length !== 2) refuse('hosts must name exactly two stage hosts');
  config.hosts.forEach(validateHost);
  const everyone = [config.requester, ...config.hosts];
  if (new Set(everyone.map(row => row.machineId)).size !== 3) refuse('machineId values must be distinct');
  if (new Set(everyone.map(row => row.participantId)).size !== 3) refuse('participantId values must be distinct');
  const targets = everyone.map(row => row.ssh).filter(Boolean);
  if (new Set(targets).size !== targets.length) refuse('ssh targets must be distinct');
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
      return receipt;
    }
  };
}
