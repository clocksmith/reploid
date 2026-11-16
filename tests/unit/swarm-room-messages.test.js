import { expect, it, vi } from 'vitest';
import { createSwarmTransport } from '../../packages/reploid/src/transport/room.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';

it('delivers application web messages through a room and rejects unknown message types', async () => {
  const channels = new Set();
  class Channel {
    constructor(name) { this.name = name; channels.add(this); }
    postMessage(data) {
      for (const channel of channels) if (channel !== this && channel.name === this.name) {
        queueMicrotask(() => channel.onmessage?.({ data: structuredClone(data) }));
      }
    }
    close() { channels.delete(this); }
  }
  const config = resolveConfig({ overrides: { mesh: { enabled: true, roomId: 'room' },
    webrtc: { broadcastRoomId: 'room', transportOrder: ['broadcast'] } } });
  const make = peerId => createSwarmTransport({ config, peerId, BroadcastChannel: Channel,
    Utils: { generateId: () => peerId, logger: { info() {}, warn() {}, debug() {}, error() {} } }, EventBus: { emit() {} } });
  const a = make('peer-a'), b = make('peer-b'), web = vi.fn(), unknown = vi.fn();
  try {
    b.onMessage('reploid:web-offer', web);
    b.onMessage('unknown-message', unknown);
    await a.init(); await b.init();
    expect(a.getPeerId()).toBe('peer-a');
    expect(a._getPeerId()).toBe(a.getPeerId());
    a.sendToPeer('peer-b', 'reploid:web-offer', { resource: 'public-page' });
    a.sendToPeer('peer-b', 'unknown-message', {});
    await vi.waitFor(() => expect(web).toHaveBeenCalledOnce());
    expect(web).toHaveBeenCalledWith('peer-a', { resource: 'public-page' }, expect.any(Object));
    expect(unknown).not.toHaveBeenCalled();
  } finally { a.disconnect(); b.disconnect(); }
});
