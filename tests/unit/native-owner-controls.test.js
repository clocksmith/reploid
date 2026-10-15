// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import custody from '../../self/config/chat-files.json' with { type: 'json' };
import failureMessages from '../../packages/reploid/src/transport/partition-errors.json' with { type: 'json' };
import { createResidentPartition } from '../../packages/reploid/src/mesh/partitions/resident-partition.js';
import { canonicalPartitionJson } from '../../packages/reploid/src/mesh/partitions/partition-contract.js';
import { custodyRateFloor, custodySupplyTransfers, scheduleOpen, validateNativeOwnerPolicy } from '../../server/native-owner/policy.js';
import { createByteRateLimiter, createTransferMeter, paceCustodyChannel } from '../../server/native-owner/rate.js';
import { openNativeOwnerControls, nativeOwnerStatus, NO_OWNER_POLICY } from '../../server/native-owner/controls.js';
import { createNativeModelFiles } from '../../server/native-model-files.js';

// Injected sensors, clocks and Doppler sessions: these prove the gate's contract, not
// installed sensors, physical temperature, sleep behavior or GPU residency.
const roots = [], owners = [], hosts = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const owner of owners.splice(0)) owner.close();
  await Promise.allSettled(hosts.splice(0).map(host => host.close()));
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});
async function folder() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-owner-')); roots.push(root); return root; }
const grant = { granted: true, ownership: 'personal', grantedBy: 'owner' };
const base = { schema: 'reploid.native-owner-policy/v1', authorization: { equipment: grant, network: grant }, sampleIntervalMs: 1000 };
const reduced = { maxConcurrentAttempts: 1, maxSupplyTransfers: 1 };
async function open(policy, options = {}) {
  const owner = await openNativeOwnerControls({ policy: { ...base, ...policy }, custody, platform: 'linux',
    sysfsRoot: options.sysfsRoot || await folder(), run: async () => { throw new Error('no tool'); }, ...options });
  owners.push(owner); return owner;
}
async function hwmon(root, name, files) {
  const directory = path.join(root, 'class', 'hwmon', 'hwmon' + (await fs.readdir(path.join(root, 'class', 'hwmon')).catch(() => [])).length);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'name'), name + '\n');
  for (const [file, value] of Object.entries(files)) await fs.writeFile(path.join(directory, file), String(value) + '\n');
  return directory;
}

// Real resident owners with injected sessions, as in the device admission tests.
const sha = 'sha256:' + 'a'.repeat(64);
const plan = { schema: 'doppler.layer-partition-contract/v3', modelId: 'm', stageCount: 3,
  partitions: [0, 1, 2].map(index => ({ index, layerRange: [index * 2, index * 2 + 1] })) };
const activation = { schema: 'doppler.activation-tensor/v1', dtype: 'f32', precision: 'f32', components: 1, elementStrideBytes: 4, hiddenSize: 8 };
const stages = [0, 1, 2].map(index => ({ index, participantId: 'p' + index, transportId: 't' + index, residentId: 'r' + index, executionId: 'e' + index }));
const route = { schema: 'reploid.partition-route/v1', modelId: 'm', modelIdentity: sha, planId: sha, stages, activation };
const orderedRuntime = { hashLayerPartitionPlan: () => sha, hashPartitionGeneration: () => sha, getPartitionActivationContract: () => activation };
const identity = attemptId => ({ schema: 'reploid.partition-attempt/v2', threadId: 'thread-' + attemptId, attemptId, requesterId: 'requester', placementGeneration: 0, route });
async function orderedResident() {
  const session = { getDescriptor: () => ({ schema: 'doppler.resident-partition/v2', ready: true, modelId: 'm', modelIdentity: sha,
    planId: sha, index: 1, stageCount: 3, layerRange: plan.partitions[1].layerRange, residentWeightBytes: 400, generationDigest: sha }),
  getRecoveryCapabilities: () => ({ schema: 'doppler.resident-recovery/v1', inputReplay: false, checkpointExport: false, checkpointImport: false }),
  tokenize: vi.fn(), executeStage: vi.fn(), closeAttempt: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  const resident = createResidentPartition({ runtime: { openResidentPartition: vi.fn(async () => session) }, model: { id: 'm', identity: sha, generation: { maxTokens: 3 } },
    plan, planId: sha, index: 1, participantId: 'p1', limits: { maxAttempts: 20, maxConcurrentAttempts: 2 },
    ordered: { runtime: orderedRuntime, stage: stages[1] } });
  await resident.prepare({ approved: true });
  return { resident, session };
}
const reserve = (resident, id) => resident.reserve({ identity: identity(id), partitionIndex: 1 });
const settle = (resident, id) => resident.closeAttempt({ identity: identity(id) });

describe('owner policy', () => {
  it('requires explicit equipment and network grants, including workplace approval, and rejects unknown controls', () => {
    const check = policy => () => validateNativeOwnerPolicy({ ...base, ...policy }, { custody });
    expect(check({ authorization: { equipment: grant } })).toThrow('authorization.network');
    expect(check({ authorization: { equipment: { ...grant, granted: false }, network: grant } })).toThrow('explicit owner grant');
    expect(check({ authorization: { equipment: { ...grant, ownership: 'workplace' }, network: grant } })).toThrow('workplaceApproval');
    expect(validateNativeOwnerPolicy({ ...base, authorization: { equipment: { ...grant, ownership: 'workplace', workplaceApproval: 'IT ticket 42' },
      network: grant } }, { custody }).authorization.equipment.workplaceApproval).toBe('IT ticket 42');
    expect(check({ temprature: {} })).toThrow('temprature is not a recognized control');
    expect(check({ sampleIntervalMs: undefined })).toThrow('sampleIntervalMs');
    expect(check({ temperature: { sensors: ['amdgpu'], reduceAboveCelsius: 80 } })).toThrow('explicit reduced limits');
    expect(check({ temperature: { sensors: ['amdgpu'], reduceAboveCelsius: 90, deferAboveCelsius: 80 } })).toThrow('below');
  });

  it('refuses a rate below the custody deadline floor instead of weakening it', () => {
    const floor = custodyRateFloor(custody);
    // Two pending 256 KiB chunks per 30 s deadline, and one 64 MiB artifact per 30 min grant, each with half margin.
    expect(floor).toBe(Math.max(Math.ceil(2 * 2 * 262144 * 1000 / 30000), Math.ceil(2 * 67108864 * 1000 / 1800000)));
    expect(() => validateNativeOwnerPolicy({ ...base, bandwidth: { uploadBytesPerSecond: floor - 1 } }, { custody })).toThrow(String(floor));
    expect(validateNativeOwnerPolicy({ ...base, bandwidth: { uploadBytesPerSecond: floor } }, { custody }).bandwidth).toEqual({ uploadBytesPerSecond: floor });
    expect(custodySupplyTransfers(custody, floor)).toBe(1);
    expect(custodySupplyTransfers(custody, 100 * 1048576)).toBe(custody.maxTransfers);
  });
});

describe('schedule boundaries', () => {
  const at = text => Date.parse(text);
  const overnight = { timeZone: 'UTC', windows: [{ days: ['mon'], start: '22:00', end: '07:00' }] };
  it('opens and closes exactly at window edges and carries an overnight window into the next day', () => {
    expect(scheduleOpen(overnight, at('2026-10-12T21:59:59Z'))).toBe(false); // Monday
    expect(scheduleOpen(overnight, at('2026-10-12T22:00:00Z'))).toBe(true);
    expect(scheduleOpen(overnight, at('2026-10-13T06:59:59Z'))).toBe(true); // Tuesday morning belongs to Monday's window
    expect(scheduleOpen(overnight, at('2026-10-13T07:00:00Z'))).toBe(false);
    expect(scheduleOpen(overnight, at('2026-10-13T22:30:00Z'))).toBe(false); // Tuesday night is not approved
    expect(scheduleOpen(overnight, at('2026-10-12T03:00:00Z'))).toBe(false); // Sunday's window was not approved
    const weekend = { timeZone: 'UTC', windows: [{ days: ['sat'], start: '00:00', end: '24:00' }] };
    expect(scheduleOpen(weekend, at('2026-10-17T23:59:59Z'))).toBe(true);
    expect(scheduleOpen(weekend, at('2026-10-18T00:00:00Z'))).toBe(false);
  });
  it('evaluates local wall time in the owner time zone across daylight saving changes', () => {
    const evening = { timeZone: 'America/New_York', windows: [{ days: ['sun'], start: '01:30', end: '03:00' }] };
    // 2026-11-01 01:30 EDT is 05:30Z; the repeated 01:30 EST is 06:30Z. Both are inside the window.
    expect(scheduleOpen(evening, at('2026-11-01T05:30:00Z'))).toBe(true);
    expect(scheduleOpen(evening, at('2026-11-01T06:30:00Z'))).toBe(true);
    expect(scheduleOpen(evening, at('2026-11-01T08:00:00Z'))).toBe(false); // 03:00 EST
  });

  it('settles an admitted attempt after the window closes and admits nothing new until it reopens', async () => {
    let clock = at('2026-10-12T23:00:00Z');
    const owner = await open({ schedule: overnight }, { now: () => clock });
    const { resident, session } = await orderedResident(), gated = owner.gateResident(resident);
    await reserve(gated, 'running');
    clock = at('2026-10-13T07:00:00Z');
    expect(owner.decide().message).toBe('deferred: outside schedule');
    // No new attempt and no advertised capacity, while the admitted attempt keeps its slot.
    await expect(reserve(gated, 'new')).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE', message: failureMessages.CAPACITY_UNAVAILABLE });
    expect(gated.getState().reservations.availableSlots).toBe(0);
    expect(gated.canAccept(identity('new'))).toBe(false);
    expect(gated.canAccept(identity('running'))).toBe(true);
    await reserve(gated, 'running'); // Idempotent re-admission of owned work is not refused.
    await settle(gated, 'running');
    expect(gated.getState().reservations.records.find(row => row.identity.attemptId === 'running').phase).toBe('settled');
    expect(session.closeAttempt).toHaveBeenCalledOnce(); expect(session.close).not.toHaveBeenCalled();
    await expect(reserve(gated, 'later')).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
    clock = at('2026-10-19T22:00:00Z');
    await reserve(gated, 'next-monday');
    expect(owner.summary().measurements).toMatchObject({ stageAdmitted: 2, stageRefused: 2 });
    await resident.close();
  });

  it('refuses a new legacy two-stage reservation with the resident capacity refusal its peer maps', async () => {
    let clock = at('2026-10-12T23:00:00Z');
    const owner = await open({ schedule: overnight }, { now: () => clock });
    const generation = { maxTokens: 3 };
    const generationDigest = 'sha256:' + createHash('sha256').update(canonicalPartitionJson(generation)).digest('hex');
    const legacy = { schema: 'doppler.layer-partition-contract/v2', modelId: 'm', partitions: [{ index: 0, layerRange: [0, 1] }, { index: 1, layerRange: [2, 3] }] };
    const session = { getDescriptor: () => ({ schema: 'doppler.resident-partition/v1', ready: true, modelId: 'm', modelIdentity: sha, planId: sha,
      index: 1, layerRange: [2, 3], residentWeightBytes: 400, generationDigest }),
    getRecoveryCapabilities: () => ({ schema: 'doppler.resident-recovery/v1', inputReplay: false, checkpointExport: false, checkpointImport: false }),
    tokenize: vi.fn(), executeGroup0: vi.fn(), executeGroup1: vi.fn(), closeAttempt: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    const resident = createResidentPartition({ runtime: { openResidentPartition: async () => session }, model: { id: 'm', identity: sha, generation },
      plan: legacy, planId: sha, index: 1, participantId: 'p1', limits: { maxAttempts: 20, maxConcurrentAttempts: 2 } });
    await resident.prepare({ approved: true });
    const gated = owner.gateResident(resident);
    expect(gated.reserve({ attemptId: 'inside' }).phase).toBe('reserved');
    clock = at('2026-10-13T08:00:00Z');
    expect(() => gated.reserve({ attemptId: 'outside' })).toThrow(expect.objectContaining({
      message: 'Contributor reservation capacity exhausted', code: 'CAPACITY_UNAVAILABLE' }));
    expect(gated.reserve({ attemptId: 'inside' }).phase).toBe('reserved');
    await resident.close();
  });

  it('never cancels unrelated conversations when one stops, admission is withheld or the gate closes', async () => {
    let clock = at('2026-10-12T23:00:00Z');
    const owner = await open({ schedule: overnight }, { now: () => clock });
    const { resident, session } = await orderedResident(), gated = owner.gateResident(resident);
    await reserve(gated, 'thread-a'); await reserve(gated, 'thread-b');
    clock = at('2026-10-13T08:00:00Z');
    await settle(gated, 'thread-a'); // One conversation stops and settles.
    expect(session.closeAttempt).toHaveBeenCalledTimes(1);
    expect(session.closeAttempt.mock.calls[0][0].identity.attemptId).toBe('thread-a');
    // Stopping a contribution that was only waiting for admission ends the wait and owns nothing.
    const controller = new AbortController(), waiting = owner.waitForAdmission({ kind: 'contribution', signal: controller.signal });
    controller.abort(new Error('Native contribution stopped'));
    await expect(waiting).rejects.toThrow('Native contribution stopped');
    owner.close();
    expect(gated.canAccept(identity('thread-b'))).toBe(true);
    expect(gated.getState().reservations.records.find(row => row.identity.attemptId === 'thread-b').phase).toBe('reserved');
    expect(session.close).not.toHaveBeenCalled();
    await settle(gated, 'thread-b'); await resident.close();
  });

  it('defers contribution preparation until the window opens', async () => {
    let clock = at('2026-10-12T12:00:00Z');
    const owner = await open({ schedule: overnight, sampleIntervalMs: 1000 }, { now: () => clock });
    let admitted = false;
    const waiting = owner.waitForAdmission({ kind: 'contribution' }).then(() => { admitted = true; });
    await owner.sample(); expect(admitted).toBe(false);
    expect(owner.summary().waiting).toEqual(['contribution']);
    clock = at('2026-10-12T22:00:00Z'); await owner.sample(); await waiting;
    expect(admitted).toBe(true);
  });
});

describe('bandwidth rates', () => {
  it('admits bytes in FIFO order at the configured rate, starting empty', async () => {
    vi.useFakeTimers({ now: 0 });
    const limiter = createByteRateLimiter({ bytesPerSecond: 100_000, capacityBytes: 262144, now: () => Date.now() });
    const done = [];
    const takes = Array.from({ length: 10 }, (_, index) => limiter.take(50_000).then(() => done.push([index, Date.now()])));
    await vi.advanceTimersByTimeAsync(10_000); await Promise.all(takes);
    // 500,000 bytes at 100,000 B/s: the n-th 50,000-byte grant lands at n * 500 ms (1 ms ceiling per timer).
    expect(done.map(([index]) => index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    done.forEach(([index, time]) => expect(Math.abs(time - (index + 1) * 500)).toBeLessThanOrEqual(1));
    expect(limiter.getState()).toMatchObject({ admittedBytes: 500_000, queued: 0 });
    await expect(limiter.take(262145)).rejects.toThrow('one custody chunk');
  });

  it('spends nothing for a cancelled waiter and never accumulates more than one chunk of burst', async () => {
    vi.useFakeTimers({ now: 0 });
    const limiter = createByteRateLimiter({ bytesPerSecond: 1000, capacityBytes: 2000, now: () => Date.now() });
    const controller = new AbortController(), times = [];
    const cancelled = limiter.take(1000, controller.signal).catch(error => error.message);
    const next = limiter.take(1000).then(() => times.push(Date.now()));
    await vi.advanceTimersByTimeAsync(400); controller.abort(new Error('stopped'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await cancelled).toBe('stopped'); await next; expect(times).toEqual([1000]);
    await vi.advanceTimersByTimeAsync(60_000); // Idle time accrues at most the bucket capacity.
    const start = Date.now(), burst = [];
    for (let i = 0; i < 3; i++) limiter.take(1000).then(() => burst.push(Date.now() - start));
    await vi.advanceTimersByTimeAsync(2000);
    expect(burst).toEqual([0, 0, 1000]);
  });

  it('paces supplied chunks before sending and requested chunks before the request deadline starts', async () => {
    vi.useFakeTimers({ now: 0 });
    const upload = createByteRateLimiter({ bytesPerSecond: 1000, capacityBytes: 1000, now: () => Date.now() });
    const download = createByteRateLimiter({ bytesPerSecond: 500, capacityBytes: 1000, now: () => Date.now() });
    const meter = createTransferMeter(), sent = [], requested = [];
    const createChannel = ({ serve }) => ({ serve, close() {},
      requestChunk: async message => { requested.push(Date.now()); return { bytes: new Uint8Array(message.sizeBytes) }; } });
    const bus = paceCustodyChannel(createChannel, { upload, download, meter })({ channel: {}, limits: {},
      serve: async request => ({ bytes: new Uint8Array(request.sizeBytes) }) });
    bus.serve({ sizeBytes: 500 }, { signal: new AbortController().signal }).then(() => sent.push(Date.now()));
    bus.requestChunk({ sizeBytes: 500 }, { signal: new AbortController().signal, maxBytes: 500 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(sent).toEqual([500]); expect(requested).toEqual([1000]);
    expect(meter.getState()).toEqual({ suppliedBytes: 500, receivedBytes: 500 });
  });
});

describe('temperature, memory and foreground readings', () => {
  it('reduces and then defers new work as a fake hwmon temperature crosses its limits', async () => {
    const sysfsRoot = await folder(), gpu = await hwmon(sysfsRoot, 'amdgpu', { temp1_input: 70000, temp2_input: 72000 });
    const owner = await open({ temperature: { sensors: ['amdgpu'], reduceAboveCelsius: 80, deferAboveCelsius: 90 }, reduced }, { sysfsRoot });
    const { resident } = await orderedResident(), gated = owner.gateResident(resident);
    expect(owner.decide().action).toBe('admit');
    await fs.writeFile(path.join(gpu, 'temp2_input'), '85000\n'); await owner.sample();
    expect(owner.decide()).toMatchObject({ action: 'reduce', message: 'reduced: temperature 85°C > 80°C', limits: reduced });
    expect(gated.getState().reservations.availableSlots).toBe(1);
    await reserve(gated, 'first');
    await expect(reserve(gated, 'second')).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
    expect(owner.admitSupply({ active: 0 })).toBe(true); expect(owner.admitSupply({ active: 1 })).toBe(false);
    await fs.writeFile(path.join(gpu, 'temp1_input'), '92500\n'); await owner.sample();
    expect(owner.decide().message).toBe('deferred: temperature 92.5°C > 90°C');
    expect(owner.admitSupply({ active: 0 })).toBe(false);
    await fs.rm(path.join(gpu, 'temp1_input')); await owner.sample();
    expect(owner.decide().message).toBe('deferred: temperature reading unavailable');
    await fs.writeFile(path.join(gpu, 'temp1_input'), '60000\n'); await fs.writeFile(path.join(gpu, 'temp2_input'), '61000\n'); await owner.sample();
    expect(owner.decide().action).toBe('admit');
    expect(owner.summary().measurements.maxTemperatureCelsius).toBe(92.5);
    await settle(gated, 'first'); await resident.close();
  });

  it('defers above the process memory limit and when readings go stale', async () => {
    let clock = 1_000_000;
    const owner = await open({ memory: { maxProcessResidentBytes: 1, maxGpuBufferBytes: 1_000_000_000 } }, { now: () => clock });
    expect(owner.decide()).toMatchObject({ action: 'defer', reasons: [{ control: 'processMemory', limit: 1, unit: 'bytes' }] });
    expect(owner.gpuBufferBytes(1_420_000_000)).toBe(1_000_000_000);
    clock += 3001;
    expect(owner.decide().reasons.map(row => row.message)).toEqual(['deferred: owner readings unavailable']);
  });

  it('handles an owner foreground signal and macOS input idle time', async () => {
    const directory = await folder(), signalFile = path.join(directory, 'foreground');
    const owner = await open({ foreground: { source: 'owner-signal', signalFile, action: 'defer' } });
    expect(owner.decide().action).toBe('admit');
    await fs.writeFile(signalFile, ''); await owner.sample();
    expect(owner.decide().message).toBe('deferred: foreground signal present');
    let resumed = false; const waiting = owner.waitForAdmission({ kind: 'file supply' }).then(() => { resumed = true; });
    await fs.rm(signalFile); await owner.sample(); await waiting; expect(resumed).toBe(true);

    let idle = 12e9;
    const run = vi.fn(async file => file.endsWith('ioreg') ? `"HIDIdleTime" = ${idle}` : "Now drawing from 'AC Power'");
    const mac = await open({ foreground: { source: 'input-idle', idleSeconds: 300, action: 'reduce' }, reduced }, { platform: 'darwin', run });
    expect(mac.decide().message).toBe('reduced: foreground activity (input idle 12 s < 300 s)');
    idle = 301e9; await mac.sample();
    expect(mac.decide().action).toBe('admit');
  });
});

describe('declared support', () => {
  it('declares unsupported controls per platform and rejects work that needs one', async () => {
    const policy = { temperature: { sensors: ['amdgpu'], deferAboveCelsius: 90 }, foreground: { source: 'input-idle', idleSeconds: 60, action: 'defer' } };
    const linux = await open(policy);
    const controls = linux.declaration().controls;
    expect(controls.temperature).toEqual({ requested: true, supported: false, reason: 'no readable hwmon temperature input' });
    expect(controls.inputIdle).toMatchObject({ requested: true, supported: false });
    expect(controls.wallPower).toMatchObject({ requested: false, supported: false });
    expect(controls.uploadRate).toMatchObject({ requested: false, supported: true });
    expect(linux.decide().action).toBe('reject');
    await expect(linux.waitForAdmission({})).rejects.toThrow('rejected: temperature limit unsupported');
    expect(linux.admitSupply({ active: 0, advertise: true })).toBe(false);

    const sysfsRoot = await folder(); await hwmon(sysfsRoot, 'k10temp', { temp1_input: 50000 });
    const other = await open({ temperature: { sensors: ['amdgpu'], deferAboveCelsius: 90 } }, { sysfsRoot });
    expect(other.declaration().controls.temperature.reason).toBe('no readable sensor named amdgpu');

    const run = vi.fn(async () => { throw new Error('must not read'); });
    const windows = await open({}, { platform: 'win32', run });
    for (const name of ['temperature', 'gpuPower', 'externalPower', 'inputIdle']) expect(windows.declaration().controls[name].supported).toBe(false);
    expect(run).not.toHaveBeenCalled();
    const mac = await open({}, { platform: 'darwin', run });
    expect(mac.declaration().controls.temperature).toMatchObject({ supported: false, reason: expect.stringContaining('root') });
    expect(mac.declaration().controls.externalPower.supported).toBe(false);
  });

  it('reads hwmon GPU power and declares it a component estimate', async () => {
    const sysfsRoot = await folder(), gpu = await hwmon(sysfsRoot, 'amdgpu', { power1_average: 150_000_000, temp1_input: 50000 });
    await fs.mkdir(path.join(sysfsRoot, 'class', 'power_supply'), { recursive: true });
    let clock = 0;
    const owner = await open({ power: { requireExternalPower: true, gpuSensors: ['amdgpu'], deferAboveWatts: 200 } }, { sysfsRoot, now: () => clock });
    expect(owner.declaration().controls.gpuPower).toMatchObject({ supported: true, scope: 'component power reading, not wall power' });
    expect(owner.declaration().controls.externalPower.supported).toBe(true); // No system battery.
    clock = 2000; await fs.writeFile(path.join(gpu, 'power1_average'), '250000000'); await owner.sample();
    expect(owner.decide().message).toBe('deferred: GPU power 250 W > 200 W');
    expect(owner.summary().measurements.gpuEnergy).toMatchObject({ gpuJoules: 400, scope: 'GPU component estimate, not wall power' });
  });

  it('measures GPU energy for named sensors without limiting work, and a missing measurement sensor rejects nothing', async () => {
    const sysfsRoot = await folder(); await hwmon(sysfsRoot, 'i915', { energy1_input: 1_000_000 });
    let clock = 0;
    const owner = await open({ power: { gpuSensors: ['i915'] } }, { sysfsRoot, now: () => clock });
    expect(owner.declaration().controls.gpuPower).toMatchObject({ requested: false, supported: true, sensors: ['i915'] });
    await fs.writeFile(path.join(sysfsRoot, 'class', 'hwmon', 'hwmon0', 'energy1_input'), '31000000');
    clock = 1000; await owner.sample();
    expect(owner.summary()).toMatchObject({ decision: { action: 'admit' }, readings: { gpuPowerWatts: 30 },
      measurements: { gpuEnergy: { gpuJoules: 30, method: 'hwmon energy counters' } } });
    const missing = await open({ power: { gpuSensors: ['amdgpu'] } });
    expect(missing.declaration().controls.gpuPower).toMatchObject({ requested: false, supported: false });
    expect(missing.decide().action).toBe('admit');
  });
});

describe('restart and unchanged paths', () => {
  it('restarts with the same limits from the same owner file and grants no burst', async () => {
    const directory = await folder(), file = path.join(directory, 'owner-policy.json');
    const floor = custodyRateFloor(custody);
    await fs.writeFile(file, JSON.stringify({ ...base, bandwidth: { uploadBytesPerSecond: floor, downloadBytesPerSecond: floor * 2 },
      schedule: { timeZone: 'UTC', windows: [{ days: ['mon'], start: '22:00', end: '07:00' }] } }));
    const clock = Date.parse('2026-10-12T23:00:00Z');
    const options = { file, custody, platform: 'linux', sysfsRoot: directory, now: () => clock };
    const first = await openNativeOwnerControls(options); owners.push(first);
    const before = { digest: first.digest, policy: first.policy, decision: first.decide().message, supply: first.summary().transfer };
    first.close();
    const second = await openNativeOwnerControls(options); owners.push(second);
    expect({ digest: second.digest, policy: second.policy, decision: second.decide().message, supply: second.summary().transfer }).toEqual(before);
    expect(second.pieceTimeoutMs(30000, custody.maxArtifactBytes)).toBe(30000 + Math.ceil(custody.maxArtifactBytes * 1000 / (floor * 2)));
    await expect(openNativeOwnerControls({ ...options, file: 'relative.json' })).rejects.toThrow('absolute path');
  });

  it('reports "no owner policy" without a gate', () => {
    expect(nativeOwnerStatus(null)).toBe(NO_OWNER_POLICY);
    expect(NO_OWNER_POLICY).toEqual({ status: 'no owner policy' });
  });
});

// Two native file hosts over in-memory channels with the real custody exchange.
async function files({ supplier }) {
  const stores = [], callbacks = [], writes = [], network = { intercept: () => {} }, result = [];
  const chunks = [Buffer.from([1, 2, 3, 4]), Buffer.from([5, 6, 7, 8])], whole = Buffer.concat(chunks);
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const manifest = Buffer.from(JSON.stringify({ modelId: 'owner-fixture', hashAlgorithm: 'sha256', shards: [{ filename: 'weights.bin', size: 8, hash: hash(whole) }] }));
  const index = Buffer.from(JSON.stringify({ schema: 'doppler.verified-pieces/v1', manifestIdentity: 'sha256:' + hash(manifest), maxPieceBytes: 4,
    files: [{ path: 'weights.bin', size: 8, pieces: chunks.map((bytes, i) => ({ offset: i * 4, size: 4, identity: 'sha256:' + hash(bytes) })) }] }));
  const model = { id: 'owner-fixture', identity: 'sha256:' + hash(manifest), source: { files: [
    { path: 'manifest.json', role: 'model-manifest', sizeBytes: manifest.length, hashAlgorithm: 'sha256', hash: hash(manifest) },
    { path: 'pieces.json', role: 'model-piece-index', sizeBytes: index.length, hashAlgorithm: 'sha256', hash: hash(index) }] } };
  const channel = index => {
    const pair = [new EventTarget(), new EventTarget()];
    pair.forEach((end, side) => Object.assign(end, { ordered: true, maxRetransmits: null, maxPacketLifeTime: null, readyState: 'open', bufferedAmount: 0,
      send(data) { queueMicrotask(() => { if (pair[1 - side].readyState === 'open') pair[1 - side].dispatchEvent(new MessageEvent('message', { data: structuredClone(data) })); }); },
      close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; this.dispatchEvent(new Event('close')); queueMicrotask(() => pair[1 - side].close()); } }));
    return pair;
  };
  for (let i = 0; i < 2; i++) {
    stores.push(new Map());
    const directory = await folder(), cacheDirectory = await folder();
    await fs.writeFile(path.join(directory, 'manifest.json'), manifest); await fs.writeFile(path.join(directory, 'pieces.json'), index);
    if (i === 1) await fs.writeFile(path.join(directory, 'weights.bin'), whole);
    const transport = { _getPeerId: () => String(i), getConnectedPeers: () => stores[1 - i] ? [{ id: String(1 - i) }] : [],
      onMessage: (type, fn) => stores[i].set(type, fn), onDataChannel: (_, fn) => { callbacks[i] = fn; return () => {}; },
      sendToPeer(peer, type, payload) { const message = structuredClone(payload); writes.push({ from: i, type, message }); network.intercept({ from: i, type, message });
        queueMicrotask(() => stores[Number(peer)]?.get(type)?.(String(i), message)); return true; },
      broadcast(type, payload) { this.sendToPeer(String(1 - i), type, payload); },
      openDataChannel(peer) { const [left, right] = channel(); callbacks[Number(peer)](String(i), right); return left; } };
    const host = await createNativeModelFiles({ transport, modelDirectory: directory, cacheDirectory, owner: i === 1 ? supplier : null });
    hosts.push(host); result.push(host);
  }
  return { hosts: result, model, writes, network, offers: () => writes.filter(row => row.from === 1 && row.type === 'reploid:custody-offer') };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 10));

describe('native piece supply under owner limits', () => {
  it('lets a granted transfer finish when the window closes, then withholds and refuses new supply', async () => {
    let clock = Date.parse('2026-10-12T23:00:00Z');
    const owner = await open({ schedule: { timeZone: 'UTC', windows: [{ days: ['mon'], start: '22:00', end: '07:00' }] } }, { now: () => clock });
    const f = await files({ supplier: owner });
    await f.hosts[1].share(f.model, true); await flush();
    // The window closes after the supplier granted the transfer and before any chunk moves.
    f.network.intercept = ({ from, type, message }) => {
      if (from === 1 && type === 'reploid:custody-response' && message.authorization) clock = Date.parse('2026-10-13T08:00:00Z');
    };
    const source = await f.hosts[0].preparePartitionSource(f.model);
    try {
      expect(new Uint8Array(await source.storage.loadShardRange(0, 0, 4))).toEqual(new Uint8Array([1, 2, 3, 4]));
      expect(owner.decide().message).toBe('deferred: outside schedule');
      await expect(source.storage.loadShardRange(0, 4, 4)).rejects.toThrow();
      expect(owner.summary().measurements).toMatchObject({ supplyAdmitted: 1, supplyRefused: 1 });
      f.hosts[1].announce(); await flush();
      expect(f.offers().at(-1).message.artifacts).toEqual([]);
      expect(f.hosts[1].getState().sharing).toBe(true); // Supply approval is kept; only admission is withheld.
      clock = Date.parse('2026-10-19T23:00:00Z'); f.hosts[1].announce(); await flush();
      expect(f.offers().at(-1).message.artifacts.length).toBeGreaterThan(0);
      expect(owner.summary().transfer.upload.suppliedBytes).toBe(4);
    } finally { await source.storage.close(); }
    const retry = await f.hosts[0].preparePartitionSource(f.model);
    try { expect(new Uint8Array(await retry.storage.loadShardRange(0, 4, 4))).toEqual(new Uint8Array([5, 6, 7, 8])); }
    finally { await retry.storage.close(); }
    expect(owner.summary().transfer.upload.suppliedBytes).toBe(8);
  });

  it('paces and measures supplied bytes and limits supply concurrency to what the rate can finish', async () => {
    const floor = custodyRateFloor(custody);
    const owner = await open({ bandwidth: { uploadBytesPerSecond: floor } });
    const f = await files({ supplier: owner });
    await f.hosts[1].share(f.model, true); await flush();
    const source = await f.hosts[0].preparePartitionSource(f.model);
    try {
      await source.storage.loadShardRange(0, 0, 8);
      expect(owner.summary().transfer.upload).toMatchObject({ limitBytesPerSecond: floor, maxSupplyTransfers: 1, suppliedBytes: 8, queuedBytes: 0 });
      expect(owner.admitSupply({ active: 1 })).toBe(false);
    } finally { await source.storage.close(); }
  });
});
