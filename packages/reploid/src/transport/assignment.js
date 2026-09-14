import { SIGNAL_TYPES } from './signaling.js';
import { requireResolvedConfig } from '../config/index.js';
export const P2P_TRANSPORT_STATES = Object.freeze({
  IDLE: 'idle',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  CLOSING: 'closing',
  CLOSED: 'closed',
  FAILED: 'failed',
});


export function createP2PTransport({
  config,
  signaling,
  initiator,
  rtcConfig = requireResolvedConfig(config).webrtc.rtcConfig,
  dataChannelLabel = requireResolvedConfig(config).webrtc.dataChannelLabel,
  dataChannelOptions = Object.fromEntries(Object.entries(requireResolvedConfig(config).webrtc.dataChannelOptions).filter(([, value]) => value !== null)),
  serialize = defaultSerialize,
  deserialize = defaultDeserialize,
  onMessage = null,
  onStateChange = null,
  onPeerConnection = null,
  onDataChannel = null,
  maxPendingRemoteIceCandidates = requireResolvedConfig(config).webrtc.maxPendingRemoteIceCandidates,
  pendingRemoteIceTtlMs = requireResolvedConfig(config).webrtc.pendingRemoteIceTtlMs,
  now = () => Date.now(),
  RTCPeerConnectionImpl = globalThis.RTCPeerConnection,
  RTCSessionDescriptionImpl = globalThis.RTCSessionDescription,
  RTCIceCandidateImpl = globalThis.RTCIceCandidate,
} = {}) {
  const policy = requireResolvedConfig(config).webrtc;
  let connectTimer = null;
  if (!signaling || typeof signaling.subscribe !== 'function') {
    throw new TypeError('signaling must provide subscribe()');
  }

  if (typeof signaling.sendOffer !== 'function' || typeof signaling.sendAnswer !== 'function') {
    throw new TypeError('signaling must provide sendOffer() and sendAnswer()');
  }

  if (typeof signaling.sendIceCandidate !== 'function') {
    throw new TypeError('signaling must provide sendIceCandidate()');
  }

  if (typeof RTCPeerConnectionImpl !== 'function') {
    throw new Error('RTCPeerConnection is not available in this browser context');
  }

  const transportInitiator = Boolean(initiator);
  let state = P2P_TRANSPORT_STATES.IDLE;
  let peerConnection = null;
  let dataChannel = null;
  let unsubscribeSignals = null;
  let openPromise = null;
  let resolveOpen = null;
  let rejectOpen = null;
  let pendingRemoteIceCandidates = [];
  let lastConnectionState = null;
  let lastIceConnectionState = null;
  let lastIceGatheringState = null;
  let localIceCandidateCount = 0;
  let remoteIceCandidateCount = 0;
  let expiredRemoteIceCandidateCount = 0;
  let overflowRemoteIceCandidateCount = 0;
  const localIceCandidateTypes = new Set();
  const remoteIceCandidateTypes = new Set();
  const maxPendingIceCandidates = Math.max(1, Number(maxPendingRemoteIceCandidates || DEFAULT_MAX_PENDING_REMOTE_ICE_CANDIDATES));
  const pendingIceTtlMs = Math.max(1, Number(pendingRemoteIceTtlMs || DEFAULT_PENDING_REMOTE_ICE_TTL_MS));

  const prunePendingRemoteIceCandidates = () => {
    const cutoff = now() - pendingIceTtlMs;
    const retained = pendingRemoteIceCandidates.filter((entry) => entry.receivedAt >= cutoff);
    expiredRemoteIceCandidateCount += pendingRemoteIceCandidates.length - retained.length;
    pendingRemoteIceCandidates = retained;
  };

  const recordCandidateType = (target, candidate) => {
    const explicitType = String(candidate?.type || '').trim();
    if (explicitType) {
      target.add(explicitType);
      return;
    }
    const match = String(candidate?.candidate || '').match(/\btyp\s+([a-z0-9_-]+)/i);
    if (match?.[1]) target.add(match[1].toLowerCase());
  };

  function setState(nextState) {
    if (state === nextState) {
      return;
    }

    state = nextState;

    if (typeof onStateChange === 'function') {
      onStateChange(state);
    }
  }

  async function connect() {
    if (state !== P2P_TRANSPORT_STATES.IDLE) {
      return ready();
    }

    setState(P2P_TRANSPORT_STATES.CONNECTING);
    openPromise = new Promise((resolve, reject) => {
      resolveOpen = resolve;
      rejectOpen = reject;
    });

    connectTimer = setTimeout(() => fail(createConnectionError('Connection deadline exceeded')), policy.connectTimeoutMs);
    try {
      peerConnection = new RTCPeerConnectionImpl(rtcConfig);
    wirePeerConnection(peerConnection);

    if (typeof onPeerConnection === 'function') {
      onPeerConnection(peerConnection);
    }

    unsubscribeSignals = signaling.subscribe((message) => {
      void handleSignal(message).catch((error) => {
        fail(error);
      });
    });

      if (transportInitiator) {
        attachDataChannel(peerConnection.createDataChannel(dataChannelLabel, dataChannelOptions));
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        await signaling.sendOffer(descriptionToPayload(peerConnection.localDescription));
      }
    } catch (error) {
      fail(error);
      return ready();
    }

    return ready();
  }

  function ready() {
    if (state === P2P_TRANSPORT_STATES.CONNECTED) {
      return Promise.resolve();
    }

    if (!openPromise) {
      return Promise.reject(new Error('transport is not connecting'));
    }

    return openPromise;
  }

  function send(value) {
    if (!dataChannel || dataChannel.readyState !== 'open') {
      throw new Error('data channel is not open');
    }

    const encoded = serialize(value);
    const bytes = typeof encoded === 'string' ? new TextEncoder().encode(encoded).byteLength : encoded.byteLength ?? encoded.size;
    if (!Number.isFinite(bytes) || bytes > policy.maxMessageBytes) throw new Error('Data channel message limit exceeded');
    if (dataChannel.bufferedAmount + bytes > policy.maxBufferedBytes) throw new Error('Data channel backpressure limit exceeded');
    dataChannel.send(encoded);
  }

  async function close(reason = null) {
    if (state === P2P_TRANSPORT_STATES.CLOSED || state === P2P_TRANSPORT_STATES.CLOSING) {
      return;
    }

    setState(P2P_TRANSPORT_STATES.CLOSING);
    closeLocal(createConnectionError(
      reason ? `peer transport closed while connecting: ${String(reason)}` : 'peer transport closed while connecting'
    ));

    try {
      if (typeof signaling.sendClose === 'function') {
        void Promise.resolve(signaling.sendClose(reason)).catch(() => {});
      }
    } catch {
      // Closing is best-effort.
    }

  }

  function rejectPendingOpen(error) {
    if (!rejectOpen) return;
    rejectOpen(error);
    rejectOpen = null;
    resolveOpen = null;
  }

  function closeLocal(reason = null) {
    clearTimeout(connectTimer);
    connectTimer = null;
    // A close can occur before a DataChannel opens: explicit cancellation,
    // remote close, and RTCPeerConnection.close() all take this path.  The
    // connect() caller must settle in every case so a failed session cannot
    // strand a provider slot or hide a retryable transport failure.
    if (rejectOpen) {
      rejectPendingOpen(reason instanceof Error
        ? reason
        : createConnectionError('peer transport closed before data channel opened'));
    }

    if (unsubscribeSignals) {
      unsubscribeSignals();
      unsubscribeSignals = null;
    }

    if (dataChannel && dataChannel.readyState !== 'closed') {
      dataChannel.close();
    }

    if (peerConnection) {
      peerConnection.close();
    }

    dataChannel = null;
    peerConnection = null;
    pendingRemoteIceCandidates = [];

    if (state !== P2P_TRANSPORT_STATES.FAILED) {
      setState(P2P_TRANSPORT_STATES.CLOSED);
    }
  }

  function fail(error) {
    if (state === P2P_TRANSPORT_STATES.CLOSED || state === P2P_TRANSPORT_STATES.CLOSING) {
      return;
    }

    setState(P2P_TRANSPORT_STATES.FAILED);

    if (rejectOpen) {
      rejectOpen(error);
      rejectOpen = null;
    }

    closeLocal(error);
  }

  function wirePeerConnection(pc) {
    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }

      localIceCandidateCount += 1;
      recordCandidateType(localIceCandidateTypes, event.candidate);
      void Promise.resolve(signaling.sendIceCandidate(candidateToPayload(event.candidate))).catch((error) => {
        fail(error);
      });
    };

    pc.ondatachannel = (event) => {
      if (transportInitiator) {
        return;
      }

      attachDataChannel(event.channel);
    };

    pc.onconnectionstatechange = () => {
      lastConnectionState = pc.connectionState || null;
      if (pc.connectionState === 'failed') {
        fail(createConnectionError('peer connection failed'));
      }

      if (pc.connectionState === 'closed') {
        closeLocal();
      }
    };

    pc.oniceconnectionstatechange = () => {
      lastIceConnectionState = pc.iceConnectionState || null;
      if (pc.iceConnectionState === 'failed') {
        fail(createConnectionError('ICE connection failed'));
      }
    };

    pc.onicegatheringstatechange = () => {
      lastIceGatheringState = pc.iceGatheringState || null;
    };
  }

  function attachDataChannel(channel) {
    dataChannel = channel;

    if (typeof onDataChannel === 'function') {
      onDataChannel(channel);
    }

    channel.onopen = () => {
      clearTimeout(connectTimer);
      connectTimer = null;
      setState(P2P_TRANSPORT_STATES.CONNECTED);

      if (resolveOpen) {
        resolveOpen();
        resolveOpen = null;
      }
    };

    channel.onmessage = (event) => {
      if (typeof onMessage === 'function') {
        try {
          const bytes = typeof event.data === 'string' ? new TextEncoder().encode(event.data).byteLength : event.data?.byteLength ?? event.data?.size;
          if (!Number.isFinite(bytes) || bytes > policy.maxMessageBytes) throw new Error('Incoming data channel message limit exceeded');
          onMessage(deserialize(event.data), event);
        } catch (error) { fail(error); }
      }
    };

    channel.onerror = () => {
      fail(new Error('data channel failed'));
    };

    channel.onclose = () => {
      if (state !== P2P_TRANSPORT_STATES.CLOSED && state !== P2P_TRANSPORT_STATES.FAILED) {
        closeLocal(createConnectionError('data channel closed before completion'));
      }
    };
  }

  async function handleSignal(message) {
    if (!peerConnection) {
      return;
    }

    if (message.type === SIGNAL_TYPES.OFFER) {
      if (transportInitiator) {
        return;
      }

      await peerConnection.setRemoteDescription(makeSessionDescription(message.payload));
      await flushRemoteIceCandidates();
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      await signaling.sendAnswer(descriptionToPayload(peerConnection.localDescription));
      return;
    }

    if (message.type === SIGNAL_TYPES.ANSWER) {
      if (!transportInitiator) {
        return;
      }

      await peerConnection.setRemoteDescription(makeSessionDescription(message.payload));
      await flushRemoteIceCandidates();
      return;
    }

    if (message.type === SIGNAL_TYPES.ICE_CANDIDATE) {
      remoteIceCandidateCount += 1;
      recordCandidateType(remoteIceCandidateTypes, message.payload);
      if (!hasRemoteDescription(peerConnection)) {
        prunePendingRemoteIceCandidates();
        pendingRemoteIceCandidates.push({ payload: message.payload, receivedAt: now() });
        if (pendingRemoteIceCandidates.length > maxPendingIceCandidates) {
          const droppedCount = pendingRemoteIceCandidates.length - maxPendingIceCandidates;
          pendingRemoteIceCandidates.splice(0, droppedCount);
          overflowRemoteIceCandidateCount += droppedCount;
        }
        return;
      }
      await peerConnection.addIceCandidate(makeIceCandidate(message.payload));
      return;
    }

    if (message.type === SIGNAL_TYPES.CLOSE) {
      closeLocal();
    }
  }

  async function flushRemoteIceCandidates() {
    if (!peerConnection || !hasRemoteDescription(peerConnection) || pendingRemoteIceCandidates.length === 0) {
      return;
    }

    prunePendingRemoteIceCandidates();
    const candidates = pendingRemoteIceCandidates;
    pendingRemoteIceCandidates = [];
    for (const candidate of candidates) {
      await peerConnection.addIceCandidate(makeIceCandidate(candidate.payload));
    }
  }

  function hasRemoteDescription(pc) {
    return Boolean(pc?.remoteDescription || pc?.currentRemoteDescription);
  }

  function makeSessionDescription(payload) {
    if (RTCSessionDescriptionImpl) {
      return new RTCSessionDescriptionImpl(payload);
    }

    return payload;
  }

  function makeIceCandidate(payload) {
    if (RTCIceCandidateImpl) {
      return new RTCIceCandidateImpl(payload);
    }

    return payload;
  }

  function getDiagnostics() {
    prunePendingRemoteIceCandidates();
    const configuredServers = Array.isArray(rtcConfig?.iceServers) ? rtcConfig.iceServers : [];
    return {
      state,
      connectionState: peerConnection?.connectionState || lastConnectionState,
      iceConnectionState: peerConnection?.iceConnectionState || lastIceConnectionState,
      iceGatheringState: peerConnection?.iceGatheringState || lastIceGatheringState,
      signalingState: peerConnection?.signalingState || null,
      localIceCandidateCount,
      remoteIceCandidateCount,
      localIceCandidateTypes: [...localIceCandidateTypes].sort(),
      remoteIceCandidateTypes: [...remoteIceCandidateTypes].sort(),
      pendingRemoteIceCandidateCount: pendingRemoteIceCandidates.length,
      expiredRemoteIceCandidateCount,
      overflowRemoteIceCandidateCount,
      iceTransportPolicy: rtcConfig?.iceTransportPolicy || 'all',
      stunConfigured: configuredServers.some((server) => (
        (Array.isArray(server.urls) ? server.urls : [server.urls])
          .some((url) => String(url || '').startsWith('stun:'))
      )),
      turnConfigured: configuredServers.some((server) => (
        (Array.isArray(server.urls) ? server.urls : [server.urls])
          .some((url) => /^turns?:/i.test(String(url || '')))
      ))
    };
  }

  function createConnectionError(message) {
    const error = new Error(message);
    error.code = 'webrtc_connection_failed';
    error.diagnostics = getDiagnostics();
    if (!error.diagnostics.turnConfigured) {
      error.action = 'Direct ICE connectivity failed and no TURN relay is configured.';
    }
    return error;
  }

  return Object.freeze({
    connect,
    ready,
    send,
    close,
    getState: () => state,
    getPeerConnection: () => peerConnection,
    getDataChannel: () => dataChannel,
    getDiagnostics,
  });
}

export function descriptionToPayload(description) {
  if (!description) {
    return null;
  }

  return {
    type: description.type,
    sdp: description.sdp,
  };
}

export function candidateToPayload(candidate) {
  if (!candidate) {
    return null;
  }

  if (typeof candidate.toJSON === 'function') {
    return candidate.toJSON();
  }

  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex,
    usernameFragment: candidate.usernameFragment,
  };
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

export function defaultSerialize(value) {
  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return value;
  }

  if (ArrayBuffer.isView(value)) {
    return value;
  }

  if (globalThis.Blob && value instanceof Blob) {
    return value;
  }

  return JSON.stringify(value);
}

export function defaultDeserialize(value) {
  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
