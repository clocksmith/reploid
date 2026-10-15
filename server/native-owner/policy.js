/** Owner-approved limits for native contribution. The policy comes only from an
 * explicit owner file: no field has a code default, an absent section requests no
 * control, and an unrecognized key is rejected rather than silently ignored. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const NATIVE_OWNER_POLICY_SCHEMA = 'reploid.native-owner-policy/v1';
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const VERBS = { reject: 'rejected', defer: 'deferred', reduce: 'reduced' };
const fail = message => { throw new Error('Owner policy: ' + message); };
const check = (ok, message) => { if (!ok) fail(message); };
const shape = (value, name, keys) => {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), name + ' must be an object');
  for (const key of Object.keys(value)) check(keys.includes(key), `${name}.${key} is not a recognized control`);
  return value;
};
const integer = (value, name, min, max) => {
  check(Number.isSafeInteger(value) && value >= min && value <= max, `${name} must be an integer from ${min} to ${max}`);
  return value;
};
const finite = (value, name, min, max) => {
  check(typeof value === 'number' && Number.isFinite(value) && value > min && value < max, `${name} must be a number above ${min} and below ${max}`);
  return value;
};
const text = (value, name) => {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= 256, name + ' must be a non-empty string of at most 256 characters');
  return value;
};
const sensors = (value, name) => {
  check(Array.isArray(value) && value.length > 0 && value.length <= 16 && new Set(value).size === value.length
    && value.every(item => typeof item === 'string' && /^[a-z0-9_-]{1,64}$/.test(item)), name + ' must list distinct sensor names');
  return [...value];
};
const minute = (value, name, allowEnd) => {
  const match = typeof value === 'string' && /^(\d{2}):(\d{2})$/.exec(value);
  const total = match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
  check(match && Number(match[2]) < 60 && (total < 1440 || allowEnd && total === 1440), name + ' must be HH:MM local time');
  return total;
};

/** Bytes per second below which one paced custody transfer can outlive the
 * protocol's per-chunk deadline or its grant. Derived from custody policy. */
export function custodyRateFloor(custody) {
  const { channel, maxArtifactBytes, grantMs } = custody;
  return Math.max(Math.ceil(2 * channel.maxPendingRequests * channel.maxChunkBytes * 1000 / channel.timeoutMs),
    Math.ceil(2 * maxArtifactBytes * 1000 / grantMs));
}

/** Simultaneous supply transfers one paced upload allowance can finish within
 * half of each chunk deadline and half of each grant. */
export function custodySupplyTransfers(custody, bytesPerSecond) {
  const { channel, maxArtifactBytes, grantMs, maxTransfers } = custody;
  const byChunk = bytesPerSecond * channel.timeoutMs / 2000 / (channel.maxPendingRequests * channel.maxChunkBytes);
  const byGrant = bytesPerSecond * grantMs / 2000 / maxArtifactBytes;
  return Math.max(1, Math.min(maxTransfers, Math.floor(Math.min(byChunk, byGrant))));
}

function authorization(value, name) {
  shape(value, name, ['granted', 'ownership', 'grantedBy', 'workplaceApproval']);
  check(value.granted === true, name + ' requires an explicit owner grant');
  check(['personal', 'workplace'].includes(value.ownership), name + '.ownership must be "personal" or "workplace"');
  const result = { granted: true, ownership: value.ownership, grantedBy: text(value.grantedBy, name + '.grantedBy') };
  if (value.ownership === 'workplace') result.workplaceApproval = text(value.workplaceApproval, name + '.workplaceApproval');
  else check(value.workplaceApproval === undefined, name + '.workplaceApproval applies only to workplace resources');
  return result;
}

function thresholds(value, name, reduceKey, deferKey, max) {
  const result = {};
  if (value[reduceKey] !== undefined) result[reduceKey] = finite(value[reduceKey], `${name}.${reduceKey}`, 0, max);
  if (value[deferKey] !== undefined) result[deferKey] = finite(value[deferKey], `${name}.${deferKey}`, 0, max);
  check(reduceKey in result || deferKey in result, `${name} requires ${reduceKey} or ${deferKey}`);
  check(!(reduceKey in result && deferKey in result) || result[reduceKey] < result[deferKey], `${name}.${reduceKey} must be below ${deferKey}`);
  return result;
}

/** Validates and freezes the owner's explicit choices. `custody` is the application's
 * custody policy; rate limits below its protocol floor are refused, not weakened. */
export function validateNativeOwnerPolicy(value, { custody }) {
  shape(value, 'policy', ['schema', 'authorization', 'sampleIntervalMs', 'schedule', 'memory', 'bandwidth',
    'temperature', 'power', 'foreground', 'reduced']);
  check(value.schema === NATIVE_OWNER_POLICY_SCHEMA, 'schema must be ' + NATIVE_OWNER_POLICY_SCHEMA);
  shape(value.authorization, 'authorization', ['equipment', 'network']);
  const policy = { schema: NATIVE_OWNER_POLICY_SCHEMA, authorization: {
    equipment: authorization(value.authorization.equipment, 'authorization.equipment'),
    network: authorization(value.authorization.network, 'authorization.network') },
  sampleIntervalMs: integer(value.sampleIntervalMs, 'sampleIntervalMs', 1000, 60000) };
  if (value.schedule !== undefined) {
    const schedule = shape(value.schedule, 'schedule', ['timeZone', 'windows']);
    text(schedule.timeZone, 'schedule.timeZone');
    try { new Intl.DateTimeFormat('en-US', { timeZone: schedule.timeZone }); }
    catch { fail('schedule.timeZone must be an IANA time zone'); }
    check(Array.isArray(schedule.windows) && schedule.windows.length > 0 && schedule.windows.length <= 32, 'schedule.windows must list 1 to 32 windows');
    policy.schedule = { timeZone: schedule.timeZone, windows: schedule.windows.map((window, index) => {
      const name = `schedule.windows[${index}]`;
      shape(window, name, ['days', 'start', 'end']);
      check(Array.isArray(window.days) && window.days.length > 0 && new Set(window.days).size === window.days.length
        && window.days.every(day => DAYS.includes(day)), name + '.days must list distinct days (sun..sat)');
      const start = minute(window.start, name + '.start', false), end = minute(window.end, name + '.end', true);
      check(start !== end, name + ' must not start and end at the same time');
      return { days: [...window.days], start: window.start, end: window.end };
    }) };
  }
  if (value.memory !== undefined) {
    const memory = shape(value.memory, 'memory', ['maxProcessResidentBytes', 'maxGpuBufferBytes']);
    policy.memory = {};
    for (const key of ['maxProcessResidentBytes', 'maxGpuBufferBytes']) {
      if (memory[key] !== undefined) policy.memory[key] = integer(memory[key], 'memory.' + key, 1, Number.MAX_SAFE_INTEGER);
    }
    check(Object.keys(policy.memory).length > 0, 'memory requires maxProcessResidentBytes or maxGpuBufferBytes');
  }
  if (value.bandwidth !== undefined) {
    const bandwidth = shape(value.bandwidth, 'bandwidth', ['uploadBytesPerSecond', 'downloadBytesPerSecond']);
    const floor = custodyRateFloor(custody);
    policy.bandwidth = {};
    for (const key of ['uploadBytesPerSecond', 'downloadBytesPerSecond']) {
      if (bandwidth[key] === undefined) continue;
      integer(bandwidth[key], 'bandwidth.' + key, 1, Number.MAX_SAFE_INTEGER);
      check(bandwidth[key] >= floor, `bandwidth.${key} must be at least ${floor} bytes per second, the custody transfer deadline floor`);
      policy.bandwidth[key] = bandwidth[key];
    }
    check(Object.keys(policy.bandwidth).length > 0, 'bandwidth requires uploadBytesPerSecond or downloadBytesPerSecond');
  }
  if (value.temperature !== undefined) {
    const temperature = shape(value.temperature, 'temperature', ['sensors', 'reduceAboveCelsius', 'deferAboveCelsius']);
    policy.temperature = { sensors: sensors(temperature.sensors, 'temperature.sensors'),
      ...thresholds(temperature, 'temperature', 'reduceAboveCelsius', 'deferAboveCelsius', 150) };
  }
  if (value.power !== undefined) {
    const power = shape(value.power, 'power', ['requireExternalPower', 'gpuSensors', 'reduceAboveWatts', 'deferAboveWatts']);
    policy.power = {};
    if (power.requireExternalPower !== undefined) {
      check(power.requireExternalPower === true, 'power.requireExternalPower may only be true; omit it to request no control');
      policy.power.requireExternalPower = true;
    }
    // gpuSensors alone measures GPU energy without limiting work; thresholds require it.
    if (power.gpuSensors !== undefined || power.reduceAboveWatts !== undefined || power.deferAboveWatts !== undefined) {
      policy.power.gpuSensors = sensors(power.gpuSensors, 'power.gpuSensors');
      if (power.reduceAboveWatts !== undefined || power.deferAboveWatts !== undefined) {
        Object.assign(policy.power, thresholds(power, 'power', 'reduceAboveWatts', 'deferAboveWatts', 100000));
      }
    }
    check(Object.keys(policy.power).length > 0, 'power requires requireExternalPower or gpuSensors');
  }
  if (value.foreground !== undefined) {
    const foreground = shape(value.foreground, 'foreground', ['source', 'idleSeconds', 'signalFile', 'action']);
    check(['input-idle', 'owner-signal'].includes(foreground.source), 'foreground.source must be "input-idle" or "owner-signal"');
    check(['reduce', 'defer'].includes(foreground.action), 'foreground.action must be "reduce" or "defer"');
    policy.foreground = { source: foreground.source, action: foreground.action };
    if (foreground.source === 'input-idle') {
      policy.foreground.idleSeconds = integer(foreground.idleSeconds, 'foreground.idleSeconds', 1, 86400);
      check(foreground.signalFile === undefined, 'foreground.signalFile applies only to "owner-signal"');
    } else {
      check(typeof foreground.signalFile === 'string' && path.isAbsolute(foreground.signalFile), 'foreground.signalFile must be an absolute path');
      check(foreground.idleSeconds === undefined, 'foreground.idleSeconds applies only to "input-idle"');
      policy.foreground.signalFile = foreground.signalFile;
    }
  }
  const reducing = policy.temperature?.reduceAboveCelsius !== undefined || policy.power?.reduceAboveWatts !== undefined
    || policy.foreground?.action === 'reduce';
  if (value.reduced !== undefined) {
    const reduced = shape(value.reduced, 'reduced', ['maxConcurrentAttempts', 'maxSupplyTransfers']);
    policy.reduced = { maxConcurrentAttempts: integer(reduced.maxConcurrentAttempts, 'reduced.maxConcurrentAttempts', 1, 64),
      maxSupplyTransfers: integer(reduced.maxSupplyTransfers, 'reduced.maxSupplyTransfers', 1, 64) };
  }
  check(!reducing || policy.reduced, 'a "reduce" action requires explicit reduced limits');
  return deepFreeze(policy);
}

function deepFreeze(value) {
  for (const item of Object.values(value)) if (item && typeof item === 'object') deepFreeze(item);
  return Object.freeze(value);
}

export const nativeOwnerPolicyDigest = policy => 'sha256:' + createHash('sha256').update(JSON.stringify(policy)).digest('hex');

/** Reads the owner file once. The path must be absolute and name a regular file. */
export async function readNativeOwnerPolicy(file, { custody }) {
  check(typeof file === 'string' && path.isAbsolute(file), '--owner-policy requires an absolute path');
  let handle;
  try { handle = await fs.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
  catch (error) { fail(`--owner-policy cannot be opened (${error.code || error.message}): ${file}`); }
  let source;
  try {
    check((await handle.stat()).isFile(), '--owner-policy must be a regular file: ' + file);
    source = await handle.readFile('utf8');
  } finally { await handle.close(); }
  let value;
  try { value = JSON.parse(source); } catch { fail('--owner-policy is not valid JSON: ' + file); }
  const policy = validateNativeOwnerPolicy(value, { custody });
  return { policy, digest: nativeOwnerPolicyDigest(policy) };
}

const clocks = new Map();
const localClock = (timeZone, at) => {
  if (!clocks.has(timeZone)) clocks.set(timeZone, new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', weekday: 'short',
    hour: '2-digit', minute: '2-digit' }));
  const parts = Object.fromEntries(clocks.get(timeZone).formatToParts(new Date(at)).map(part => [part.type, part.value]));
  return { day: DAYS.indexOf(parts.weekday.toLowerCase().slice(0, 3)), minute: Number(parts.hour) * 60 + Number(parts.minute) };
};

/** Windows are local wall-clock times in the policy's time zone. A window whose end
 * precedes its start continues into the following day and belongs to its start day. */
export function scheduleOpen(schedule, at) {
  const { day, minute: now } = localClock(schedule.timeZone, at);
  const previous = (day + 6) % 7;
  return schedule.windows.some(window => {
    const start = minute(window.start, 'start', false), end = minute(window.end, 'end', true);
    const days = window.days.map(name => DAYS.indexOf(name));
    if (start < end) return days.includes(day) && now >= start && now < end;
    return days.includes(day) && now >= start || days.includes(previous) && now < end;
  });
}

const round = value => String(Math.round(value * 10) / 10);
const mebibytes = bytes => Math.round(bytes / 1048576) + ' MiB';
const LABELS = { schedule: 'schedule', processMemory: 'process memory limit', gpuBuffers: 'GPU buffer limit',
  uploadRate: 'upload rate limit', downloadRate: 'download rate limit', temperature: 'temperature limit',
  gpuPower: 'GPU power limit', externalPower: 'external power requirement', inputIdle: 'input-idle foreground detection',
  ownerSignal: 'foreground signal' };

/** Pure admission decision from the owner's policy, declared host support and the
 * latest readings. Precedence: reject (unenforceable control) > defer > reduce > admit. */
export function decideNativeOwnerAdmission({ policy, support, readings, at }) {
  const reasons = [];
  const add = (action, control, message, measured = {}) => reasons.push({ action, control, message: `${VERBS[action]}: ${message}`, ...measured });
  for (const [control, entry] of Object.entries(support.controls)) {
    if (entry.requested && !entry.supported) add('reject', control, `${LABELS[control] || control} unsupported: ${entry.reason}`);
  }
  if (policy.schedule && !scheduleOpen(policy.schedule, at)) add('defer', 'schedule', 'outside schedule');
  const wattLimit = policy.power?.reduceAboveWatts !== undefined || policy.power?.deferAboveWatts !== undefined;
  const sensed = policy.memory?.maxProcessResidentBytes !== undefined || policy.temperature || wattLimit
    || policy.power?.requireExternalPower || policy.foreground;
  const fresh = readings && at - readings.at <= 3 * policy.sampleIntervalMs;
  if (sensed && !fresh) add('defer', 'readings', 'owner readings unavailable');
  else if (sensed) {
    const memoryLimit = policy.memory?.maxProcessResidentBytes;
    if (memoryLimit !== undefined && readings.processResidentBytes > memoryLimit) {
      add('defer', 'processMemory', `process memory ${mebibytes(readings.processResidentBytes)} > ${mebibytes(memoryLimit)}`,
        { value: readings.processResidentBytes, limit: memoryLimit, unit: 'bytes' });
    }
    const limited = (control, value, label, unit, suffix, reduce, defer) => {
      if (!support.controls[control]?.supported) return;
      if (value === null || value === undefined) { add('defer', control, label + ' reading unavailable'); return; }
      if (defer !== undefined && value > defer) add('defer', control, `${label} ${round(value)}${suffix} > ${round(defer)}${suffix}`, { value, limit: defer, unit });
      else if (reduce !== undefined && value > reduce) add('reduce', control, `${label} ${round(value)}${suffix} > ${round(reduce)}${suffix}`, { value, limit: reduce, unit });
    };
    if (policy.temperature) limited('temperature', readings.temperature?.maxCelsius, 'temperature', 'celsius', '°C',
      policy.temperature.reduceAboveCelsius, policy.temperature.deferAboveCelsius);
    if (wattLimit) limited('gpuPower', readings.gpuPower?.watts, 'GPU power', 'watts', ' W',
      policy.power.reduceAboveWatts, policy.power.deferAboveWatts);
    if (policy.power?.requireExternalPower && support.controls.externalPower?.supported) {
      if (readings.externalPower === null || readings.externalPower === undefined) add('defer', 'externalPower', 'power source reading unavailable');
      else if (readings.externalPower === false) add('defer', 'externalPower', 'running on battery power');
    }
    const foreground = policy.foreground;
    if (foreground?.source === 'input-idle' && support.controls.inputIdle?.supported) {
      const idle = readings.inputIdleSeconds;
      if (idle === null || idle === undefined) add('defer', 'inputIdle', 'input idle reading unavailable');
      else if (idle < foreground.idleSeconds) add(foreground.action, 'inputIdle',
        `foreground activity (input idle ${Math.floor(idle)} s < ${foreground.idleSeconds} s)`, { value: idle, limit: foreground.idleSeconds, unit: 'seconds' });
    }
    if (foreground?.source === 'owner-signal' && support.controls.ownerSignal?.supported) {
      if (readings.foregroundSignal === null || readings.foregroundSignal === undefined) add('defer', 'ownerSignal', 'foreground signal unreadable');
      else if (readings.foregroundSignal) add(foreground.action, 'ownerSignal', 'foreground signal present');
    }
  }
  const action = ['reject', 'defer', 'reduce'].find(name => reasons.some(reason => reason.action === name)) || 'admit';
  return { action, at, message: action === 'admit' ? 'admitted'
    : reasons.filter(reason => reason.action === action).map(reason => reason.message).join('; '),
  reasons, limits: action === 'reduce' ? { ...policy.reduced } : null };
}
