import { SIGNAL_TYPES } from './p2p-signaling.js';

export const P2P_TRANSPORT_STATES = Object.freeze({
  IDLE: 'idle',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  CLOSING: 'closing',
  CLOSED: 'closed',
  FAILED: 'failed',
});

export const DEFAULT_DATA_CHANNEL_LABEL = 'reploid-pool';

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

export function createP2PTransport({
  signaling,
  initiator,
  rtcConfig = {},
  dataChannelLabel = DEFAULT_DATA_CHANNEL_LABEL,
  dataChannelOptions = { ordered: true },
  serialize = defaultSerialize,
  deserialize = defaultDeserialize,
  onMessage = null,
  onStateChange = null,
  onPeerConnection = null,
  onDataChannel = null,
  RTCPeerConnectionImpl = globalThis.RTCPeerConnection,
  RTCSessionDescriptionImpl = globalThis.RTCSessionDescription,
  RTCIceCandidateImpl = globalThis.RTCIceCandidate,
} = {}) {
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

    dataChannel.send(serialize(value));
  }

  async function close(reason = null) {
    if (state === P2P_TRANSPORT_STATES.CLOSED || state === P2P_TRANSPORT_STATES.CLOSING) {
      return;
    }

    setState(P2P_TRANSPORT_STATES.CLOSING);

    try {
      if (typeof signaling.sendClose === 'function') {
        await signaling.sendClose(reason);
      }
    } catch {
      // Closing is best-effort.
    }

    closeLocal();
  }

  function closeLocal() {
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

    closeLocal();
  }

  function wirePeerConnection(pc) {
    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }

      void signaling.sendIceCandidate(candidateToPayload(event.candidate)).catch((error) => {
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
      if (pc.connectionState === 'failed') {
        fail(new Error('peer connection failed'));
      }

      if (pc.connectionState === 'closed') {
        closeLocal();
      }
    };
  }

  function attachDataChannel(channel) {
    dataChannel = channel;

    if (typeof onDataChannel === 'function') {
      onDataChannel(channel);
    }

    channel.onopen = () => {
      setState(P2P_TRANSPORT_STATES.CONNECTED);

      if (resolveOpen) {
        resolveOpen();
        resolveOpen = null;
      }
    };

    channel.onmessage = (event) => {
      if (typeof onMessage === 'function') {
        onMessage(deserialize(event.data), event);
      }
    };

    channel.onerror = () => {
      fail(new Error('data channel failed'));
    };

    channel.onclose = () => {
      if (state !== P2P_TRANSPORT_STATES.CLOSED && state !== P2P_TRANSPORT_STATES.FAILED) {
        closeLocal();
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
      return;
    }

    if (message.type === SIGNAL_TYPES.ICE_CANDIDATE) {
      await peerConnection.addIceCandidate(makeIceCandidate(message.payload));
      return;
    }

    if (message.type === SIGNAL_TYPES.CLOSE) {
      closeLocal();
    }
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

  return Object.freeze({
    connect,
    ready,
    send,
    close,
    getState: () => state,
    getPeerConnection: () => peerConnection,
    getDataChannel: () => dataChannel,
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
