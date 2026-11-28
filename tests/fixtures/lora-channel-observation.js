/** Run before the product opens WebRTC. Count application bytes on its training channels in both directions. */
export function observeTrainingChannels() {
  const totals = { sentBytes: 0, receivedBytes: 0, sentFrames: 0, receivedFrames: 0, interruptions: 0 };
  const connections = new Set();
  let armed = false;
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  const byteLength = value => typeof value === 'string' ? encoder.encode(value).byteLength : value.byteLength ?? value.size;

  // The reliable channel can combine the request header and its first payload fragment in one frame.
  function isContributionRequest(data) {
    let header;
    if (typeof data === 'string') {
      if (!data.startsWith('{')) return false;
      header = data;
    } else if (data instanceof ArrayBuffer && data.byteLength > 13 && new DataView(data).getUint8(0) === 2) {
      const controlBytes = new DataView(data).getUint32(5);
      if (controlBytes > data.byteLength - 13) return false;
      header = decoder.decode(new Uint8Array(data, 13, controlBytes));
    } else return false;
    const frame = JSON.parse(header);
    return frame.schema === 'reploid.partition-channel/v2' && frame.type === 'request'
      && frame.metadata?.schema === 'reploid.lora-request/v1' && frame.metadata.operation === 'contribute';
  }

  function observe(channel, connection) {
    if (channel.label !== 'reploid-training') return;
    const send = channel.send.bind(channel);
    channel.send = value => {
      send(value);
      totals.sentBytes += byteLength(value);
      totals.sentFrames++;
    };
    channel.addEventListener('message', ({ data }) => {
      totals.receivedBytes += byteLength(data);
      totals.receivedFrames++;
      if (armed && isContributionRequest(data)) {
        armed = false;
        totals.interruptions++;
        // Start the SCTP close before retiring the actual peer connection so the requester sees the loss immediately.
        channel.addEventListener('close', () => connection.close(), { once: true });
        channel.close();
      }
    });
  }

  // All signaling, certificate generation, peer connections and sends remain the browser's own.
  const NativeConnection = globalThis.RTCPeerConnection;
  globalThis.RTCPeerConnection = class extends NativeConnection {
    constructor(...args) {
      super(...args);
      connections.add(this);
      this.addEventListener('datachannel', event => observe(event.channel, this));
    }
    createDataChannel(...args) {
      const channel = super.createDataChannel(...args);
      observe(channel, this);
      return channel;
    }
  };
  globalThis.loraChannelObservation = {
    measure: () => ({ ...totals }),
    async paths() {
      const { observeConnectionPath } = await import('/vendor/reploid/transport/connection-path.js');
      return Promise.all([...connections].filter(connection => connection.connectionState === 'connected')
        .map(observeConnectionPath));
    },
    interrupt() {
      if (armed) throw new Error('A training-channel interruption is already armed');
      armed = true;
    }
  };
}
