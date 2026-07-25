/**
 * @fileoverview Transport adapters for signed Poolday peer-control messages.
 */

export const PEER_CONTROL_BUS_VERSION = 'reploid_peer_control_bus/v1';

export function createDataChannelPeerBus(dataChannel) {
  if (!dataChannel || typeof dataChannel.send !== 'function') {
    throw new TypeError('dataChannel with send() is required');
  }
  const listeners = new Set();
  const handleMessage = (event) => {
    let envelope = event?.data;
    if (typeof envelope === 'string') {
      try {
        envelope = JSON.parse(envelope);
      } catch {
        return;
      }
    }
    if (envelope?.peerControlBusVersion !== PEER_CONTROL_BUS_VERSION || !envelope.message) return;
    for (const listener of listeners) listener(envelope.message);
  };
  if (typeof dataChannel.addEventListener === 'function') {
    dataChannel.addEventListener('message', handleMessage);
  } else {
    const previous = dataChannel.onmessage;
    dataChannel.onmessage = (event) => {
      if (typeof previous === 'function') previous.call(dataChannel, event);
      handleMessage(event);
    };
  }
  return Object.freeze({
    send(message) {
      dataChannel.send(JSON.stringify({
        peerControlBusVersion: PEER_CONTROL_BUS_VERSION,
        message
      }));
    },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  });
}

export function createInMemoryPeerBus() {
  const listeners = new Set();
  return Object.freeze({
    send(message) {
      for (const listener of listeners) listener(message);
    },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  });
}
