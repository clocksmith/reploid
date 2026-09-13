import defaults from './defaults.json' with { type: 'json' };
import requestPolicy from './request-overrides.json' with { type: 'json' };
import routing from '../rules/routing.rules.json' with { type: 'json' };

const resolvedConfigurations = new WeakSet();
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);

export class ConfigurationError extends TypeError {
  constructor(path, message) {
    super(`Reploid configuration ${path}: ${message}`);
    this.name = 'ConfigurationError';
    this.path = path;
  }
}

export function snapshotJson(value, path = '$') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((entry, index) => snapshotJson(entry, `${path}[${index}]`));
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.keys(value).sort().map(key => {
      if (forbiddenKeys.has(key)) throw new ConfigurationError(path, 'unsafe object key');
      return [key, snapshotJson(value[key], `${path}.${key}`)];
    }));
  }
  throw new ConfigurationError(path, 'expected JSON data; inject functions, resources and credentials as ports');
}

export function freezeJson(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeJson);
    Object.freeze(value);
  }
  return value;
}

function merge(target, patch, source, provenance, path = '') {
  for (const [key, value] of Object.entries(patch)) {
    const field = path ? `${path}.${key}` : key;
    if (!Object.hasOwn(target, key)) throw new ConfigurationError(field, 'unknown field');
    const old = target[key];
    if (old && typeof old === 'object' && !Array.isArray(old) && value && typeof value === 'object' && !Array.isArray(value)) {
      merge(old, value, source, provenance, field);
    } else {
      target[key] = value;
      provenance[field] = source;
    }
  }
}

function recordSources(value, sources, path = '') {
  for (const [key, item] of Object.entries(value)) {
    const field = path ? `${path}.${key}` : key;
    if (item && typeof item === 'object' && !Array.isArray(item)) recordSources(item, sources, field);
    else sources[field] = 'schema-defaults';
  }
}

function requireType(value, expected, path) {
  if (typeof value !== expected) throw new ConfigurationError(path, `expected ${expected}`);
}

function validate(config) {
  if (config.schema !== defaults.schema) throw new ConfigurationError('schema', 'unsupported schema');
  for (const section of Object.keys(defaults).filter(key => key !== 'schema')) {
    if (!config[section] || typeof config[section] !== 'object' || Array.isArray(config[section])) {
      throw new ConfigurationError(section, 'expected object');
    }
  }
  for (const section of ['agent', 'legacyAgent', 'memory', 'mesh', 'webrtc', 'artifacts']) {
    for (const [key, value] of Object.entries(defaults[section])) {
      if (typeof value === 'number' && (!Number.isSafeInteger(config[section][key]) || config[section][key] < 1)) {
        throw new ConfigurationError(`${section}.${key}`, 'expected positive safe integer');
      }
    }
  }
  for (const key of ['enabled', 'executeJobs', 'supplyArtifacts', 'shareCandidates']) requireType(config.mesh[key], 'boolean', `mesh.${key}`);
  requireType(config.tools.allowDynamic, 'boolean', 'tools.allowDynamic');
  requireType(config.webrtc.dataChannelOptions?.ordered, 'boolean', 'webrtc.dataChannelOptions.ordered');
  const retransmits = config.webrtc.dataChannelOptions?.maxRetransmits;
  if (retransmits !== null && (!Number.isSafeInteger(retransmits) || retransmits < 0 || retransmits > 65535)) {
    throw new ConfigurationError('webrtc.dataChannelOptions.maxRetransmits', 'expected uint16 or explicit null');
  }
  requireType(config.webrtc.dataChannelLabel, 'string', 'webrtc.dataChannelLabel');
  if (!config.webrtc.dataChannelLabel) throw new ConfigurationError('webrtc.dataChannelLabel', 'must not be empty');
  for (const [key, value] of Object.entries(config.webrtc.signaling)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new ConfigurationError(`webrtc.signaling.${key}`, 'expected positive safe integer');
  }
  if (Object.keys(config.webrtc.signaling).length !== Object.keys(defaults.webrtc.signaling).length) {
    throw new ConfigurationError('webrtc.signaling', 'missing required policy');
  }
  requireType(config.improvement.enabled, 'boolean', 'improvement.enabled');
  requireType(config.observation.enabled, 'boolean', 'observation.enabled');
  for (const field of ['allowed', 'parallelSafe', 'ordered', 'exclusive']) {
    if (!Array.isArray(config.tools[field]) || config.tools[field].some(value => typeof value !== 'string' || !value.trim())
      || new Set(config.tools[field]).size !== config.tools[field].length) {
      throw new ConfigurationError(`tools.${field}`, 'expected unique non-empty string array');
    }
  }
  for (const [section, key] of [['tools','loaderId'],['memory','storeId'],['models','providerId'],
    ['mesh','roomId'],['webrtc','signalingUrl'],['webrtc','sessionId'],['webrtc','broadcastRoomId'],
    ['improvement','evaluatorId'],['improvement','approvalId'],['improvement','isolationId']]) {
    const value = config[section][key];
    if (value !== null && (typeof value !== 'string' || !value.trim())) {
      throw new ConfigurationError(`${section}.${key}`, 'expected non-empty identifier or explicit null');
    }
  }
  if (config.models.contract !== null && (!config.models.contract || typeof config.models.contract !== 'object' || Array.isArray(config.models.contract))) {
    throw new ConfigurationError('models.contract', 'expected exact model contract or null');
  }
  if (!routing.rules.some(rule => rule.id === config.mesh.routing)) throw new ConfigurationError('mesh.routing', 'unknown routing rule');
  if (!['assignment/v1', 'swarm/v1'].includes(config.webrtc.protocol)) throw new ConfigurationError('webrtc.protocol', 'unknown wire protocol');
  if (!Array.isArray(config.webrtc.transportOrder) || !config.webrtc.transportOrder.length
    || config.webrtc.transportOrder.some(type => !['webrtc', 'broadcast'].includes(type))) {
    throw new ConfigurationError('webrtc.transportOrder', 'expected explicit transport order');
  }
  if (config.mesh.enabled && config.webrtc.transportOrder.includes('broadcast') && config.webrtc.broadcastRoomId === null) {
    throw new ConfigurationError('webrtc.broadcastRoomId', 'BroadcastChannel requires its explicit protocol room');
  }
  const rtc = config.webrtc.rtcConfig;
  if (!rtc || !Array.isArray(rtc.iceServers) || !['all', 'relay'].includes(rtc.iceTransportPolicy)) {
    throw new ConfigurationError('webrtc.rtcConfig', 'ICE servers and transport policy are required');
  }
  for (const server of rtc.iceServers) {
    if (!server || typeof server !== 'object' || Object.keys(server).some(key => key !== 'urls')) {
      throw new ConfigurationError('webrtc.rtcConfig.iceServers', 'JSON carries URLs only; inject TURN credentials through RTC ports');
    }
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    if (!urls.length || urls.some(url => typeof url !== 'string' || !/^(stun|stuns|turn|turns):/.test(url))) {
      throw new ConfigurationError('webrtc.rtcConfig.iceServers.urls', 'invalid ICE URL');
    }
  }
  if (config.mesh.enabled && config.mesh.roomId === null) throw new ConfigurationError('mesh.roomId', 'enabled networking requires an explicit room');
  if (config.improvement.enabled && ['evaluatorId', 'approvalId', 'isolationId'].some(key => config.improvement[key] === null)) {
    throw new ConfigurationError('improvement', 'enabled improvement requires evaluator, approval and isolation ports');
  }
  for (const [section,key] of [['artifacts','root'],['memory','checkpointPrefix']]) {
    const value = config[section][key];
    if (typeof value !== 'string' || !value.startsWith('/') || value.split('/').includes('..')) {
      throw new ConfigurationError(`${section}.${key}`, 'expected absolute logical path without traversal');
    }
  }
  const secrets = new Set(['apiKey', 'accessToken', 'refreshToken', 'authorization', 'privateKey', 'privateJwk', 'password', 'credential']);
  const rejectSecrets = (value, path) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (secrets.has(key)) throw new ConfigurationError(`${path}.${key}`, 'credentials belong in host ports');
      rejectSecrets(item, `${path}.${key}`);
    }
  };
  rejectSecrets(config, '

export function resolveConfig({ chain = [], profile = null, overrides = {}, request = {} } = {}) {
  if (!Array.isArray(chain)) throw new ConfigurationError('chain', 'expected array');
  const value = snapshotJson(defaults);
  const provenance = {};
  recordSources(value, provenance);
  chain.forEach((layer, index) => merge(value, snapshotJson(layer), `chain[${index}]`, provenance));
  if (profile !== null) {
    const selected = snapshotJson(profile);
    if (selected.schema !== 'reploid.profile/v1' || typeof selected.id !== 'string' || !selected.config) {
      throw new ConfigurationError('profile', 'expected versioned profile');
    }
    merge(value, selected.config, `profile:${selected.id}`, provenance);
  }
  merge(value, snapshotJson(overrides), 'application-overrides', provenance);
  const requestLayer = snapshotJson(request);
  const paths = {};
  recordSources(requestLayer, paths);
  for (const field of Object.keys(paths)) {
    if (!requestPolicy.paths.includes(field)) throw new ConfigurationError(field, 'request override is not allowlisted');
  }
  merge(value, requestLayer, 'request-overrides', provenance);
  validate(value);
  // Canonical JSON is the full identity, not an unverified short checksum.
  const identity = `reploid.config/v1:${JSON.stringify(snapshotJson(value))}`;
  const resolved = freezeJson({ value, provenance, identity });
  resolvedConfigurations.add(resolved);
  return resolved;
}

export function requireResolvedConfig(config) {
  if (!resolvedConfigurations.has(config)) throw new ConfigurationError('$', 'call resolveConfig() before construction');
  return config.value;
}

export async function hashConfiguration(config, cryptoApi = globalThis.crypto) {
  requireResolvedConfig(config);
  const bytes = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(config.identity));
  return `sha256:${Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
);
  if (config.webrtc.signalingUrl !== null) {
    let url;
    try { url = new URL(config.webrtc.signalingUrl); } catch { throw new ConfigurationError('webrtc.signalingUrl', 'expected absolute WebSocket URL'); }
    if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password
      || [...url.searchParams.keys()].some(key => secrets.has(key) || key === 'token')) {
      throw new ConfigurationError('webrtc.signalingUrl', 'use a credential-free WebSocket URL and host credential ports');
    }
  }
  return config;
}

export function resolveConfig({ chain = [], profile = null, overrides = {}, request = {} } = {}) {
  if (!Array.isArray(chain)) throw new ConfigurationError('chain', 'expected array');
  const value = snapshotJson(defaults);
  const provenance = {};
  recordSources(value, provenance);
  chain.forEach((layer, index) => merge(value, snapshotJson(layer), `chain[${index}]`, provenance));
  if (profile !== null) {
    const selected = snapshotJson(profile);
    if (selected.schema !== 'reploid.profile/v1' || typeof selected.id !== 'string' || !selected.config) {
      throw new ConfigurationError('profile', 'expected versioned profile');
    }
    merge(value, selected.config, `profile:${selected.id}`, provenance);
  }
  merge(value, snapshotJson(overrides), 'application-overrides', provenance);
  const requestLayer = snapshotJson(request);
  const paths = {};
  recordSources(requestLayer, paths);
  for (const field of Object.keys(paths)) {
    if (!requestPolicy.paths.includes(field)) throw new ConfigurationError(field, 'request override is not allowlisted');
  }
  merge(value, requestLayer, 'request-overrides', provenance);
  validate(value);
  // Canonical JSON is the full identity, not an unverified short checksum.
  const identity = `reploid.config/v1:${JSON.stringify(snapshotJson(value))}`;
  const resolved = freezeJson({ value, provenance, identity });
  resolvedConfigurations.add(resolved);
  return resolved;
}

export function requireResolvedConfig(config) {
  if (!resolvedConfigurations.has(config)) throw new ConfigurationError('$', 'call resolveConfig() before construction');
  return config.value;
}

export async function hashConfiguration(config, cryptoApi = globalThis.crypto) {
  requireResolvedConfig(config);
  const bytes = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(config.identity));
  return `sha256:${Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
