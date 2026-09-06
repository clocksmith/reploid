// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createPackJobDataChannel } from '../../self/pool/peer-pack-job-channel.js';

class Channel extends EventTarget {
  ordered = true;
  maxRetransmits = null;
  maxPacketLifeTime = null;
  readyState = 'open';
  bufferedAmount = 0;
  send(data) { queueMicrotask(() => this.peer.dispatchEvent(new MessageEvent('message', { data: structuredClone(data) }))); }
  close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; this.dispatchEvent(new Event('close')); }
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function pair(options = {}) {
  const left = new Channel(), right = new Channel(); left.peer = right; right.peer = left;
  const a = createPackJobDataChannel({ channel: left, ...options }), b = createPackJobDataChannel({ channel: right, ...options });
  return { left, right, a, b, close() { a.close(); b.close(); } };
}

describe('bounded complete-job WebRTC framing', () => {
  it('reassembles concurrent large Unicode messages in send order with matching frame accounting', async () => {
    const f = pair();
    try {
      const received = []; f.b.subscribe(message => received.push(message));
      const messages = [{ body: '≤'.repeat(200000) }, { body: 'second' }];
      await Promise.all(messages.map(message => f.a.send(message)));
      await pause(0);
      expect(received).toEqual(messages);
      expect(f.a.getState().sentFrameBytes).toBe(f.b.getState().receivedFrameBytes);
      expect(f.a.getState()).toMatchObject({ pendingMessages: 0, pendingBytes: 0 });
    } finally { f.close(); }
  });

  it('closes on an incomplete message, fragment gap, duplicate header, or transfer budget exhaustion', async () => {
    for (const mode of ['truncated', 'gap', 'header', 'budget']) {
      const f = pair({ timeoutMs: 15, maxTransferBytes: mode === 'budget' ? 80 : 100000 });
      try {
        let disconnects = 0; f.b.onDisconnect(() => { disconnects++; });
        f.left.send(JSON.stringify({ schema: 'reploid.peer.pack_job_channel/v1', byteLength: 16 }));
        if (mode === 'gap') { const bytes = new Uint8Array(5); new DataView(bytes.buffer).setUint32(0, 1); f.left.send(bytes.buffer); }
        if (mode === 'header') f.left.send(JSON.stringify({ schema: 'reploid.peer.pack_job_channel/v1', byteLength: 16 }));
        if (mode === 'budget') f.left.send(new Uint8Array(32).buffer);
        await pause(30);
        expect(f.b.getState().closed).toBe(true); expect(disconnects).toBe(1);
      } finally { f.close(); }
    }
  });

  it('settles a blocked send on deadline and releases its pending budget', async () => {
    const f = pair({ timeoutMs: 15 });
    try {
      f.left.bufferedAmount = 1024 * 1024;
      await expect(f.a.send({ body: 'blocked' })).rejects.toThrow('backpressure timeout');
      expect(f.a.getState()).toMatchObject({ closed: true, pendingMessages: 0, pendingBytes: 0 });
    } finally { f.close(); }
  });
});
