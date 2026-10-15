/** Detects which owner controls this host can enforce and samples their readings.
 * A control is supported only when a reading source was found and actually read;
 * a configured setting alone never counts as enforcement. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';

const readText = async file => (await fs.readFile(file, 'utf8')).trim();
const readNumber = async file => { const value = Number(await readText(file)); if (!Number.isFinite(value)) throw new Error('Not numeric: ' + file); return value; };

/** Runs a fixed system tool with no shell and a bounded wait; resolves its stdout. */
export function runNativeTool(file, args, { timeoutMs }) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (error, stdout) => error ? reject(error) : resolve(String(stdout)));
  });
}

/** Linux hwmon devices whose inputs were readable without elevated privileges. */
export async function probeLinuxHwmon(sysfsRoot) {
  const base = path.join(sysfsRoot, 'class', 'hwmon');
  let entries;
  try { entries = await fs.readdir(base); } catch { return []; }
  const devices = [];
  for (const id of entries.sort()) {
    const directory = path.join(base, id);
    let name, files;
    try { name = await readText(path.join(directory, 'name')); files = await fs.readdir(directory); } catch { continue; }
    const readable = async pattern => {
      const found = [];
      for (const file of files.filter(item => pattern.test(item)).sort()) {
        try { await readNumber(path.join(directory, file)); found.push(file); } catch { /* unreadable input is not a source */ }
      }
      return found;
    };
    const powers = await readable(/^power\d+_(average|input)$/);
    // One power input per channel; the driver's averaged value is preferred.
    const channels = new Map();
    for (const file of powers) { const channel = file.split('_')[0]; if (!channels.has(channel) || file.endsWith('_average')) channels.set(channel, file); }
    devices.push({ id, name, directory, temperatures: await readable(/^temp\d+_input$/),
      powers: [...channels.values()], energies: await readable(/^energy\d+_input$/) });
  }
  return devices;
}

/** System power supplies, excluding peripheral (scope=Device) batteries. */
export async function probeLinuxPowerSupply(sysfsRoot) {
  const base = path.join(sysfsRoot, 'class', 'power_supply');
  let entries;
  try { entries = await fs.readdir(base); } catch { return null; }
  const supplies = [];
  for (const id of entries.sort()) {
    const directory = path.join(base, id);
    let type, scope = null;
    try { type = await readText(path.join(directory, 'type')); } catch { continue; }
    try { scope = await readText(path.join(directory, 'scope')); } catch { /* optional */ }
    if (scope === 'Device') continue;
    supplies.push({ id, type, directory });
  }
  return supplies;
}

/** true: external power; false: running on a system battery; null: unknown. */
async function readLinuxExternalPower(supplies) {
  const batteries = supplies.filter(row => row.type === 'Battery');
  const external = supplies.filter(row => row.type !== 'Battery');
  let unreadable = false;
  for (const supply of external) {
    try { if (await readNumber(path.join(supply.directory, 'online')) === 1) return true; } catch { unreadable = true; }
  }
  if (!batteries.length) return true; // No system battery: the host runs on external power.
  if (unreadable) return null;
  if (external.length) return false;
  // Only batteries are exposed: their charge status says whether external power is connected.
  try {
    const statuses = await Promise.all(batteries.map(row => readText(path.join(row.directory, 'status'))));
    return !statuses.includes('Discharging');
  } catch { return null; }
}

const parseIdleSeconds = output => {
  const match = /"HIDIdleTime"\s*=\s*(\d+)/.exec(output);
  return match ? Number(match[1]) / 1e9 : null;
};
const parseExternalPower = output => {
  const match = /Now drawing from '([^']+)'/.exec(output);
  return match ? match[1] === 'AC Power' : null;
};

async function readSignal(file) {
  try { await fs.lstat(file); return true; }
  catch (error) { return error.code === 'ENOENT' ? false : null; }
}

const MAC_TOOLS = { idle: ['/usr/sbin/ioreg', ['-c', 'IOHIDSystem', '-d', '4']], power: ['/usr/bin/pmset', ['-g', 'batt']] };

/** Declares every owner control for this platform. Supported controls name their
 * source; unsupported controls name why. `requested` marks controls the policy uses. */
export async function detectNativeOwnerSupport({ policy, platform, sysfsRoot, run }) {
  const timeoutMs = Math.floor(policy.sampleIntervalMs / 2);
  const supported = (source, extra = {}) => ({ supported: true, source, ...extra });
  const unsupported = reason => ({ supported: false, reason });
  const controls = {
    schedule: supported('host clock with policy IANA time zone'),
    processMemory: supported('process resident set size'),
    gpuBuffers: supported('Doppler device GPU buffer budget', { scope: 'application GPU buffer allocations, not physical VRAM' }),
    uploadRate: supported('paced custody chunk supply', { scope: 'custody piece and file bytes; execution activations are not paced' }),
    downloadRate: supported('paced custody chunk requests', { scope: 'custody piece and file bytes; execution activations are not paced' }),
    temperature: unsupported('no non-root temperature source on ' + platform),
    gpuPower: unsupported('no non-root GPU power source on ' + platform),
    externalPower: unsupported('no power source reading on ' + platform),
    inputIdle: unsupported('no input-idle source on ' + platform),
    ownerSignal: supported('owner foreground signal file'),
    wallPower: unsupported('wall power requires an external meter')
  };
  const hardware = { hwmon: [], supplies: null };
  if (platform === 'linux') {
    hardware.hwmon = await probeLinuxHwmon(sysfsRoot);
    const names = devices => [...new Set(devices.map(device => device.name))];
    const thermal = hardware.hwmon.filter(device => device.temperatures.length);
    const electrical = hardware.hwmon.filter(device => device.powers.length || device.energies.length);
    controls.temperature = thermal.length ? supported('linux hwmon', { sensors: names(thermal) })
      : unsupported('no readable hwmon temperature input');
    controls.gpuPower = electrical.length ? supported('linux hwmon', { sensors: names(electrical),
      scope: 'component power reading, not wall power' }) : unsupported('no readable hwmon power or energy input');
    hardware.supplies = await probeLinuxPowerSupply(sysfsRoot);
    if (hardware.supplies) {
      const external = await readLinuxExternalPower(hardware.supplies);
      controls.externalPower = external === null ? unsupported('power_supply online state unreadable')
        : supported('linux power_supply');
    } else controls.externalPower = unsupported('no readable power_supply class');
    controls.inputIdle = unsupported('no reliable non-root input-idle source; use foreground source "owner-signal"');
  } else if (platform === 'darwin') {
    controls.temperature = unsupported('no non-root temperature interface (powermetrics requires root)');
    controls.gpuPower = unsupported('no non-root GPU power interface (powermetrics requires root)');
    try {
      controls.externalPower = parseExternalPower(await run(...MAC_TOOLS.power, { timeoutMs })) === null
        ? unsupported('pmset reported no power source') : supported('pmset -g batt');
    } catch (error) { controls.externalPower = unsupported('pmset unavailable: ' + error.message); }
    try {
      controls.inputIdle = parseIdleSeconds(await run(...MAC_TOOLS.idle, { timeoutMs })) === null
        ? unsupported('ioreg reported no HIDIdleTime') : supported('ioreg IOHIDSystem HIDIdleTime');
    } catch (error) { controls.inputIdle = unsupported('ioreg unavailable: ' + error.message); }
  } else if (platform === 'win32') {
    controls.temperature = unsupported('no non-administrator temperature interface implemented on Windows');
    controls.gpuPower = unsupported('no GPU power interface implemented on Windows');
    controls.externalPower = unsupported('no power source interface implemented on Windows');
    controls.inputIdle = unsupported('input idle requires the interactive session; not implemented on Windows');
  }
  // A named sensor must exist; a sensor class alone does not enforce the owner's choice.
  const requireSensors = (control, names) => {
    const entry = controls[control];
    if (!entry.supported) return;
    const missing = names.filter(name => !entry.sensors.includes(name));
    if (missing.length) controls[control] = unsupported('no readable sensor named ' + missing.join(', '));
    else controls[control] = { ...entry, sensors: [...names] };
  };
  if (policy.temperature) requireSensors('temperature', policy.temperature.sensors);
  if (policy.power?.gpuSensors) requireSensors('gpuPower', policy.power.gpuSensors);
  if (policy.foreground?.source === 'owner-signal') {
    const parent = path.dirname(policy.foreground.signalFile);
    try { if (!(await fs.stat(parent)).isDirectory()) throw new Error('not a directory'); }
    catch { controls.ownerSignal = unsupported('signal file directory is unavailable: ' + parent); }
  }
  const requested = {
    schedule: !!policy.schedule, processMemory: policy.memory?.maxProcessResidentBytes !== undefined,
    gpuBuffers: policy.memory?.maxGpuBufferBytes !== undefined, uploadRate: policy.bandwidth?.uploadBytesPerSecond !== undefined,
    downloadRate: policy.bandwidth?.downloadBytesPerSecond !== undefined, temperature: !!policy.temperature,
    // Measurement-only GPU sensors are declared but limit nothing, so they are not requested controls.
    gpuPower: policy.power?.reduceAboveWatts !== undefined || policy.power?.deferAboveWatts !== undefined,
    externalPower: !!policy.power?.requireExternalPower,
    inputIdle: policy.foreground?.source === 'input-idle', ownerSignal: policy.foreground?.source === 'owner-signal', wallPower: false };
  for (const [name, entry] of Object.entries(controls)) controls[name] = { requested: requested[name], ...entry };
  return { platform, controls, hardware };
}

/** Samples readings for supported controls. Unsupported sources are never read and
 * remain null. GPU energy uses energy counters where present, otherwise the
 * integral of sampled power: both are component estimates, not wall power. */
export function createNativeOwnerMonitor({ policy, support, platform, run, now, readGpuBuffers = null }) {
  const timeoutMs = Math.floor(policy.sampleIntervalMs / 2);
  const controls = support.controls, { hwmon, supplies } = support.hardware;
  const named = (control, names) => controls[control].supported
    ? hwmon.filter(device => (names || controls[control].sensors).includes(device.name)) : [];
  // Only sensors the owner named are read.
  const thermal = policy.temperature ? named('temperature', policy.temperature.sensors).filter(device => device.temperatures.length) : [];
  const electrical = policy.power?.gpuSensors ? named('gpuPower', policy.power.gpuSensors)
    .filter(device => device.powers.length || device.energies.length) : [];
  const signalFile = policy.foreground?.source === 'owner-signal' ? policy.foreground.signalFile : null;
  const counters = new Map(), lastPower = new Map(), methods = new Set();
  let joules = 0;
  async function temperature() {
    const sensors = [];
    for (const device of thermal) for (const file of device.temperatures) {
      try { sensors.push({ name: device.name, input: file, celsius: await readNumber(path.join(device.directory, file)) / 1000 }); }
      catch { return null; } // A configured sensor that stops reading must not pass as cool.
    }
    return sensors.length ? { maxCelsius: Math.max(...sensors.map(row => row.celsius)), sensors } : null;
  }
  async function gpuPower(at) {
    let watts = 0, complete = true;
    for (const device of electrical) {
      if (device.powers.length) {
        let deviceWatts = 0;
        for (const file of device.powers) deviceWatts += await readNumber(path.join(device.directory, file)) / 1e6;
        const last = lastPower.get(device.directory);
        if (last && at > last.at) { joules += (last.watts + deviceWatts) / 2 * (at - last.at) / 1000; methods.add('integrated hwmon power samples'); }
        lastPower.set(device.directory, { watts: deviceWatts, at });
        watts += deviceWatts;
        continue;
      }
      for (const file of device.energies) {
        const key = path.join(device.directory, file), microjoules = await readNumber(key);
        const last = counters.get(key); counters.set(key, { microjoules, at });
        // The first sample or a counter reset has no interval to measure.
        if (!last || at <= last.at || microjoules < last.microjoules) { complete = false; continue; }
        watts += (microjoules - last.microjoules) / (at - last.at) / 1000;
        joules += (microjoules - last.microjoules) / 1e6; methods.add('hwmon energy counters');
      }
    }
    return complete ? { watts } : null;
  }
  async function sample() {
    const at = now(), memory = process.memoryUsage(), cpu = process.cpuUsage();
    const readings = { at, processResidentBytes: memory.rss, cpuUserMicros: cpu.user, cpuSystemMicros: cpu.system,
      gpuBuffers: null, temperature: null, gpuPower: null, externalPower: null, inputIdleSeconds: null, foregroundSignal: null };
    if (readGpuBuffers) {
      try { const value = await readGpuBuffers(); readings.gpuBuffers = value && { liveBytes: value.liveBytes, peakBytes: value.peakBytes, maxBytes: value.maxBytes }; }
      catch { readings.gpuBuffers = null; }
    }
    if (thermal.length) readings.temperature = await temperature();
    if (electrical.length) {
      // A failed read leaves a gap; power is not integrated across it.
      try { readings.gpuPower = await gpuPower(at); } catch { readings.gpuPower = null; lastPower.clear(); }
    }
    if (controls.externalPower.supported && policy.power?.requireExternalPower) {
      try {
        readings.externalPower = platform === 'linux' ? await readLinuxExternalPower(supplies)
          : parseExternalPower(await run(...MAC_TOOLS.power, { timeoutMs }));
      } catch { readings.externalPower = null; }
    }
    if (controls.inputIdle.supported && policy.foreground?.source === 'input-idle') {
      try { readings.inputIdleSeconds = parseIdleSeconds(await run(...MAC_TOOLS.idle, { timeoutMs })); }
      catch { readings.inputIdleSeconds = null; }
    }
    if (controls.ownerSignal.supported && signalFile) readings.foregroundSignal = await readSignal(signalFile);
    return readings;
  }
  return Object.freeze({ sample,
    getEnergy: () => methods.size ? { gpuJoules: joules, method: [...methods].join(' + '), scope: 'GPU component estimate, not wall power' } : null });
}
