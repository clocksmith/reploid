import { createP2PTransport as createLibraryTransport, descriptionToPayload, candidateToPayload, defaultSerialize, defaultDeserialize } from '../vendor/reploid/transport/index.js';
import { resolveConfig } from '../vendor/reploid/config/index.js';
import {
  SIGNAL_TYPES,
  createPoolSdkSignalingAdapter,
  createSignalingChannel
} from './p2p-signaling.js';
import { assertP2PPayload } from './p2p-payload.js';

export { P2P_TRANSPORT_STATES } from '../vendor/reploid/transport/index.js';
export const DEFAULT_DATA_CHANNEL_LABEL = 'reploid-pool';
export const DEFAULT_MAX_PENDING_REMOTE_ICE_CANDIDATES = 64;
export const DEFAULT_PENDING_REMOTE_ICE_TTL_MS = 30000;
export const DEFAULT_RTC_CONFIG = Object.freeze({
  iceServers: Object.freeze([
    Object.freeze({ urls: 'stun:stun.l.google.com:19302' }),
    Object.freeze({ urls: 'stun:stun1.l.google.com:19302' })
  ])
});

const normalizeIceServer = (server = {}) => {
  const urls = Array.isArray(server.urls)
    ? server.urls.map((url) => String(url || '').trim()).filter(Boolean)
    : String(server.urls || '').trim();
  if ((Array.isArray(urls) && urls.length === 0) || !urls) {
    throw new TypeError('RTC iceServers entries require at least one URL');
  }
  const normalized = { urls };
  if (server.username !== undefined) normalized.username = String(server.username);
  if (server.credential !== undefined) normalized.credential = String(server.credential);
  if (server.credentialType !== undefined) normalized.credentialType = String(server.credentialType);
  return Object.freeze(normalized);
};

export const normalizeRtcConfig = (config = DEFAULT_RTC_CONFIG) => {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('RTC config must be an object');
  }
  const iceServers = Array.isArray(config.iceServers)
    ? config.iceServers.map(normalizeIceServer)
    : DEFAULT_RTC_CONFIG.iceServers;
  const normalized = {
    ...config,
    iceServers: Object.freeze(iceServers)
  };
  if (normalized.iceTransportPolicy && !['all', 'relay'].includes(normalized.iceTransportPolicy)) {
    throw new TypeError('RTC iceTransportPolicy must be all or relay');
  }
  return Object.freeze(normalized);
};

export const resolveRtcConfig = ({
  configured = globalThis.REPLOID_POOL_RTC_CONFIG,
  fallback = DEFAULT_RTC_CONFIG
} = {}) => normalizeRtcConfig(configured || fallback);

export function createP2PRequesterTransport(options = {}) {
  return createP2PTransport({
    ...options,
    initiator: true,
  });
}

export function createP2PProviderTransport(options = {}) {
  return createP2PTransport({
    ...options,
    initiator: false,
  });
}

export async function createAssignmentP2PPayloadChannel({
  sdk,
  assignment,
  session = null,
  sessionId = session?.sessionId || null,
  localPeerId,
  remotePeerId = null,
  role = 'requester',
  pollIntervalMs = 1000,
  signalTtlMs = null,
  transportFactory = null,
  transportOptions = {},
  signalingAdapter = null,
  signalingChannel = null,
} = {}) {
  if (!sdk || typeof sdk.createSignalingSession !== 'function') {
    throw new TypeError('sdk must provide createSignalingSession()');
  }
  const channelAssignmentId = requireNonEmptyString(assignment?.assignmentId, 'assignment.assignmentId');
  const channelLocalPeerId = requireNonEmptyString(localPeerId, 'localPeerId');
  const transportSession = sessionId
    ? (session || { sessionId })
    : (await sdk.createSignalingSession({
      assignmentId: channelAssignmentId,
      createdBy: channelLocalPeerId
    })).session;
  const resolvedSessionId = requireNonEmptyString(transportSession?.sessionId, 'session.sessionId');
  const adapter = signalingAdapter || createPoolSdkSignalingAdapter({
    sdk,
    sessionId: resolvedSessionId,
    peerId: channelLocalPeerId,
    pollIntervalMs
  });
  const signaling = signalingChannel || createSignalingChannel({
    sessionId: resolvedSessionId,
    assignmentId: channelAssignmentId,
    localPeerId: channelLocalPeerId,
    remotePeerId,
    adapter,
    signalTtlMs
  });
  const initiator = role === 'requester' || role === 'agent' || role === 'initiator';
  const createTransport = transportFactory || ((options) => createP2PTransport(options));
  const transport = createTransport({
    ...transportOptions,
    signaling,
    initiator
  });
  const sendPayload = async (payload) => {
    assertP2PPayload(payload);
    await transport.ready();
    transport.send(payload);
    return payload;
  };
  return Object.freeze({
    session: transportSession,
    sessionId: resolvedSessionId,
    signaling,
    transport,
    connect: () => transport.connect(),
    ready: () => transport.ready(),
    sendPayload,
    close: (reason = null) => transport.close(reason)
  });
}


const assignmentConfig = resolveConfig();
export { descriptionToPayload, candidateToPayload, defaultSerialize, defaultDeserialize };
export function createP2PTransport(options = {}) {
  return createLibraryTransport({
    ...options,
    config: assignmentConfig,
    rtcConfig: options.rtcConfig || resolveRtcConfig()
  });
}
function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}
