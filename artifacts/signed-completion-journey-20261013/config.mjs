// One explicit configuration file for every harness. No field has a default:
// an absent or unknown key is an error, null is accepted only where declared.
import fs from 'node:fs/promises';
import path from 'node:path';

export const CONFIG_SCHEMA = 'reploid.signed-completion-journey-config/v1';
export const MACHINES = Object.freeze(['mac-host', 'amd-host', 'intel-host']);
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const PEER = /^peer:[a-f0-9]{24}$/;
const LOOPBACK = new Set(['127.0.0.1', '[::1]', 'localhost']);
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const ROOM = /^reploid-swarm-[a-z0-9][a-z0-9_-]{0,127}$/i;

// Private-address guards apply to every string in the file and in reports.
// The tailnet suffix is assembled at runtime so no file carries the literal domain.
const TAILNET_SOURCE = '[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.' + ['ts', 'net'].join('\\.') + '\\b';
const LOGIN_SOURCE = '(?<![\\w.+-])[a-z_][a-z0-9_.-]*@[a-z][a-z0-9.-]*(?![\\w@])';
export function privateAddressReason(value) {
  if (typeof value !== 'string') return null;
  if (new RegExp(TAILNET_SOURCE, 'i').test(value)) return 'tailnet domain';
  if (new RegExp(LOGIN_SOURCE, 'i').test(value)) return 'login address';
  return null;
}
/** Report text guard: private addresses are replaced, never written. */
export function redactPrivateAddresses(text) {
  return String(text).replace(new RegExp(TAILNET_SOURCE, 'gi'), 'tailnet.invalid').replace(new RegExp(LOGIN_SOURCE, 'gi'), 'login-redacted');
}

/** H12: the native stage a loss targets: `<machine>` when that machine runs exactly one native stage,
 * or `<machine>#<stage index>`. Returns null when nothing or more than one stage matches. */
export function resolveLossTarget(route, lossTarget) {
  const [machine, indexText] = String(lossTarget ?? '').split('#');
  const matches = (Array.isArray(route) ? route : []).filter(stage => stage?.host === 'native' && stage.machine === machine
    && (indexText === undefined || stage.index === Number(indexText)));
  return matches.length === 1 ? matches[0] : null;
}
const fail = (errors, where, message) => { errors.push(`${where}: ${message}`); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function exact(errors, where, value, keys) {
  if (!isObject(value)) { fail(errors, where, 'must be an object'); return false; }
  for (const key of keys) if (!Object.hasOwn(value, key)) fail(errors, where, `missing ${key}`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(errors, where, `unknown key ${key}`);
  return true;
}
const absolute = (errors, where, value) => {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.normalize(value) !== value) fail(errors, where, 'must be a normalized absolute path');
};
const positive = (errors, where, value, max = 86400000) => {
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) fail(errors, where, `must be an integer in 1..${max}`);
};
function loopbackUrl(errors, where, value, protocols) {
  let url;
  try { url = new URL(value); } catch { fail(errors, where, 'must be a URL'); return; }
  if (!protocols.includes(url.protocol)) fail(errors, where, `protocol must be ${protocols.join(' or ')}`);
  if (!LOOPBACK.has(url.hostname)) fail(errors, where, 'must be a loopback address (forward remote machines to a local port)');
  if (url.username || url.password) fail(errors, where, 'must not carry credentials');
  if (!url.port) fail(errors, where, 'must name an explicit port');
  if (url.search || url.hash) fail(errors, where, 'must not carry a query or fragment');
}
const machine = (errors, where, value) => { if (!MACHINES.includes(value)) fail(errors, where, `must be one of ${MACHINES.join(', ')}`); };
const appPath = (errors, where, value) => {
  if (typeof value !== 'string' || !/^\/[\w./-]+\.json$/.test(value) || value.includes('..')) fail(errors, where, 'must be an absolute application path to a JSON file');
};

function browser(errors, where, value) {
  if (!exact(errors, where, value, ['machine', 'origin', 'connect'])) return;
  machine(errors, where + '.machine', value.machine);
  loopbackUrl(errors, where + '.origin', value.origin, ['http:', 'https:']);
  if (typeof value.origin === 'string' && !value.origin.endsWith('/')) fail(errors, where + '.origin', 'must end with /');
  const connect = value.connect;
  if (!isObject(connect)) { fail(errors, where + '.connect', 'must be an object'); return; }
  if (connect.kind === 'launch') {
    if (!exact(errors, where + '.connect', connect, ['kind', 'channel', 'headless', 'remoteDebuggingPort'])) return;
    if (!['chrome', 'chromium', 'msedge'].includes(connect.channel)) fail(errors, where + '.connect.channel', 'must be chrome, chromium or msedge');
    if (typeof connect.headless !== 'boolean') fail(errors, where + '.connect.headless', 'must be boolean');
    positive(errors, where + '.connect.remoteDebuggingPort', connect.remoteDebuggingPort, 65535);
  } else if (connect.kind === 'cdp') {
    if (!exact(errors, where + '.connect', connect, ['kind', 'endpoint'])) return;
    loopbackUrl(errors, where + '.connect.endpoint', connect.endpoint, ['http:']);
  } else fail(errors, where + '.connect.kind', 'must be launch or cdp');
}

function route(errors, where, value, splitLayers) {
  if (!Array.isArray(value) || value.length < 2) { fail(errors, where, 'must list at least two ordered stages'); return; }
  if (Array.isArray(splitLayers) && value.length !== splitLayers.length + 1) fail(errors, where, 'stage count must equal splitLayers + 1');
  value.forEach((stage, index) => {
    const at = `${where}[${index}]`;
    const keys = stage?.host === 'native' ? ['index', 'machine', 'host', 'participantId', 'orderedConfig'] : ['index', 'machine', 'host', 'participantId'];
    if (!exact(errors, at, stage, keys)) return;
    if (stage.index !== index) fail(errors, at + '.index', 'must equal its position');
    machine(errors, at + '.machine', stage.machine);
    if (!['browser', 'native'].includes(stage.host)) fail(errors, at + '.host', 'must be browser or native');
    if (!PEER.test(stage.participantId || '')) fail(errors, at + '.participantId', 'must be an authenticated peer identity');
    if (stage.host === 'native') absolute(errors, at + '.orderedConfig', stage.orderedConfig);
  });
  if (value[0]?.host !== 'browser') fail(errors, where + '[0].host', 'stage 0 coordinator must be the browser contributor this harness observes');
  // H12 (run 8, placement C): two native stages may share one machine (each its own process, scope,
  // identity and ordered config); a browser stage still needs a machine of its own.
  const byMachine = new Map();
  for (const stage of value) byMachine.set(stage?.machine, [...(byMachine.get(stage?.machine) || []), stage]);
  for (const stages of byMachine.values()) {
    if (stages.length > 1 && (stages.some(stage => stage?.host !== 'native') || new Set(stages.map(stage => stage?.orderedConfig)).size !== stages.length)) {
      fail(errors, where, 'stages sharing a machine must all be native, each with its own ordered config');
    }
  }
  if (new Set(value.map(stage => stage?.participantId)).size !== value.length) fail(errors, where, 'each stage must have a distinct participant');
}

export function validateConfig(raw) {
  const errors = [];
  const visit = (value, where) => {
    const reason = privateAddressReason(value);
    if (reason) fail(errors, where, `contains a ${reason}`);
    if (typeof value === 'string' && value.startsWith('REPLACE')) fail(errors, where, 'is an unfilled template placeholder');
    if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${where}[${index}]`));
    else if (isObject(value)) for (const [key, item] of Object.entries(value)) visit(item, `${where}.${key}`);
  };
  visit(raw, 'config');
  if (!exact(errors, 'config', raw, ['schema', 'reportDirectory', 'application', 'freeze', 'browsers', 'contributorControl',
    'timeouts', 'observation', 'concurrency', 'modelFiles', 'storage'])) return { errors };
  if (raw.schema !== CONFIG_SCHEMA) fail(errors, 'config.schema', `must equal ${CONFIG_SCHEMA}`);
  absolute(errors, 'config.reportDirectory', raw.reportDirectory);

  const app = raw.application;
  if (exact(errors, 'config.application', app, ['roomFile', 'descriptorPath', 'partitionPolicyPath', 'signalingUrl'])) {
    absolute(errors, 'config.application.roomFile', app.roomFile);
    appPath(errors, 'config.application.descriptorPath', app.descriptorPath);
    appPath(errors, 'config.application.partitionPolicyPath', app.partitionPolicyPath);
    if (app.signalingUrl !== null) loopbackUrl(errors, 'config.application.signalingUrl', app.signalingUrl, ['ws:', 'wss:']);
  }

  const freeze = raw.freeze;
  if (exact(errors, 'config.freeze', freeze, ['browserBundle', 'runtimeArchive', 'modelId', 'modelIdentity', 'planId',
    'planSchema', 'splitLayers', 'nativeArtifacts', 'route'])) {
    for (const key of ['browserBundle', 'runtimeArchive', 'modelIdentity', 'planId']) {
      if (!SHA256.test(freeze[key] || '')) fail(errors, `config.freeze.${key}`, 'must be an exact sha256:<64 hex> identity');
    }
    if (typeof freeze.modelId !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(freeze.modelId)) fail(errors, 'config.freeze.modelId', 'must be a catalog model id');
    if (freeze.planSchema !== 'doppler.layer-partition-contract/v3') fail(errors, 'config.freeze.planSchema', 'must be doppler.layer-partition-contract/v3');
    if (!Array.isArray(freeze.splitLayers) || !freeze.splitLayers.length
      || !freeze.splitLayers.every((layer, index) => Number.isSafeInteger(layer) && layer > 0 && (index === 0 || layer > freeze.splitLayers[index - 1]))) {
      fail(errors, 'config.freeze.splitLayers', 'must be strictly increasing positive layer indexes');
    }
    route(errors, 'config.freeze.route', freeze.route, freeze.splitLayers);
    const natives = Array.isArray(freeze.route) ? [...new Set(freeze.route.filter(stage => stage?.host === 'native').map(stage => stage.machine))] : [];
    if (exact(errors, 'config.freeze.nativeArtifacts', freeze.nativeArtifacts, natives)) {
      for (const name of natives) if (!SHA256.test(freeze.nativeArtifacts[name] || '')) fail(errors, `config.freeze.nativeArtifacts.${name}`, 'must be an exact native artifact identity');
    }
  }

  const browsers = raw.browsers;
  if (exact(errors, 'config.browsers', browsers, ['requester', 'coordinator', 'storageSupplier', 'storageAcquirer'])) {
    for (const [name, value] of Object.entries(browsers)) browser(errors, `config.browsers.${name}`, value);
    if (browsers.coordinator?.connect?.kind !== 'cdp') fail(errors, 'config.browsers.coordinator.connect.kind', 'must be cdp: the running stage-0 contributor is observed, never launched');
    // One connected tab per browser profile (README, "Contract decision"): independent requesters are
    // separate profiles with new user data directories, which only a launched browser can create.
    if (browsers.requester?.connect?.kind !== 'launch') fail(errors, 'config.browsers.requester.connect.kind', 'must be launch: independent requesters need separate user data directories created by the harness');
    if (Array.isArray(freeze?.route) && browsers.coordinator?.machine !== freeze.route[0]?.machine) fail(errors, 'config.browsers.coordinator.machine', 'must equal the stage 0 machine');
    if (browsers.storageAcquirer?.machine === browsers.storageSupplier?.machine) fail(errors, 'config.browsers.storageAcquirer.machine', 'must be another computer than storageSupplier');
    const endpoints = Object.values(browsers).map(item => item?.connect?.kind === 'cdp' ? item.connect.endpoint : `launch:${item?.connect?.remoteDebuggingPort}`);
    if (new Set(endpoints).size !== endpoints.length) fail(errors, 'config.browsers', 'each browser role needs its own debugging endpoint');
  }

  const control = raw.contributorControl;
  if (exact(errors, 'config.contributorControl', control, ['module', 'stopExport', 'restoreExport', 'lossTarget'])) {
    absolute(errors, 'config.contributorControl.module', control.module);
    for (const key of ['stopExport', 'restoreExport']) if (!IDENTIFIER.test(control[key] || '')) fail(errors, `config.contributorControl.${key}`, 'must be an export name');
    const native = Array.isArray(freeze?.route) && resolveLossTarget(freeze.route, control.lossTarget);
    if (!native) fail(errors, 'config.contributorControl.lossTarget', 'must name a native stage machine in the frozen route, as <machine> or <machine>#<stage index> when the machine runs several stages');
  }

  if (exact(errors, 'config.timeouts', raw.timeouts, ['readyMs', 'answerMs', 'lossReportMs', 'capacityReturnMs', 'transferMs', 'settlementMs', 'seedingMs'])) {
    for (const [key, value] of Object.entries(raw.timeouts)) positive(errors, `config.timeouts.${key}`, value);
  }
  if (exact(errors, 'config.observation', raw.observation, ['pollMs'])) {
    positive(errors, 'config.observation.pollMs', raw.observation.pollMs, 1000);
  }
  if (exact(errors, 'config.concurrency', raw.concurrency, ['tabs'])) {
    if (!Number.isSafeInteger(raw.concurrency.tabs) || raw.concurrency.tabs < 2 || raw.concurrency.tabs > 8) fail(errors, 'config.concurrency.tabs', 'must be an integer in 2..8');
  }
  if (exact(errors, 'config.modelFiles', raw.modelFiles, ['pathPatterns'])) {
    const patterns = raw.modelFiles.pathPatterns;
    if (!Array.isArray(patterns) || !patterns.length) fail(errors, 'config.modelFiles.pathPatterns', 'must list at least one model-file path pattern');
    else patterns.forEach((pattern, index) => {
      const at = `config.modelFiles.pathPatterns[${index}]`;
      if (typeof pattern !== 'string' || !pattern || pattern.includes('://')) { fail(errors, at, 'must be a path-only regular expression'); return; }
      try { new RegExp(pattern); } catch { fail(errors, at, 'must compile as a regular expression'); }
    });
  }
  // Each acquisition ledger is immutable once created (self/host/work-model-files.js:355), so every
  // step that opens a fresh ledger names its own allowance in whole MiB, as the UI input does
  // (self/ui/pool-home/network-controls.js:29-30,178).
  // Full-model seeding needs one allowance that covers the whole model and one that cannot
  // (run-seeding.mjs); the configured maximum is 4 GiB (self/config/chat-files.json:24).
  const allowances = ['sharingAllowanceMiB', 'stopAllowanceMiB', 'contentionAllowanceMiB', 'interruptionAllowanceMiB',
    'seedingAllowanceMiB', 'seedingRefusalAllowanceMiB'];
  if (exact(errors, 'config.storage', raw.storage, allowances)) {
    for (const key of allowances) positive(errors, `config.storage.${key}`, raw.storage[key], 4096);
  }
  return { errors, config: errors.length ? undefined : deepFreeze(structuredClone(raw)) };
}

function deepFreeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') deepFreeze(child);
  return Object.freeze(value);
}

export async function loadConfig(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw Error('Pass the explicit absolute configuration path as the only argument');
  const bytes = await fs.readFile(file);
  const { errors, config } = validateConfig(JSON.parse(bytes));
  if (errors.length) throw Error('Configuration rejected:\n- ' + errors.join('\n- '));
  return { config, bytes };
}

/** The room file is private: its token is never echoed in an error or report. */
export function validateRoom(room) {
  const errors = [];
  if (!isObject(room)) return ['room: must be an object with roomId and token'];
  if (!ROOM.test(room.roomId || '') || room.roomId === 'reploid-swarm-public') errors.push('room.roomId: must be a private reploid-swarm room');
  if (typeof room.token !== 'string' || room.token.length < 32) errors.push('room.token: must be the private room capability (32+ characters)');
  return errors;
}

export async function loadRoom(config) {
  const room = JSON.parse(await fs.readFile(config.application.roomFile, 'utf8'));
  const errors = validateRoom(room);
  if (errors.length) throw Error('Room file rejected:\n- ' + errors.join('\n- '));
  return Object.freeze({ roomId: room.roomId, token: room.token });
}

/** The ordered selection id the catalog projects for the frozen plan
 * (packages/reploid/src/mesh/partitions/partition-ordered-chat.js:17). */
export const orderedSelectionId = freeze => `${freeze.modelId}/partition/${freeze.planId}`;
