import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const root = process.argv[2];
const require = createRequire(root + '/node_modules/@roamhq/wrtc/package.json');
const rtc = require('@roamhq/wrtc');
const { createNativeRtcAdapter } = await import(pathToFileURL(root + '/server/native-participant.js'));
const { createPeerPackDataChannel } = await import(pathToFileURL(root + '/self/pool/peer-pack-data-channel.js'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const out = { scope: 'Actual installed wrtc CPU-only local RTC transfer; no GPU, model or live participant',
  started: new Date().toISOString(), sourceSha256: sha(fs.readFileSync(root + '/server/native-participant.js')),
  wrtcVersion: require('@roamhq/wrtc/package.json').version, lowWaits: 0, maxObservedBufferedAmount: 0 };
const { RTCPeerConnection } = createNativeRtcAdapter(rtc);
const peers = [new RTCPeerConnection({ iceServers: [] }), new RTCPeerConnection({ iceServers: [] })];
const iceErrors = [];
for (const [i, peer] of peers.entries()) peer.onicecandidate = event => {
  if (event.candidate) peers[1 - i].addIceCandidate(event.candidate).catch(error => iceErrors.push(error.message));
};
let client, server;
const deadline = setTimeout(() => { console.error('Actual RTC control exceeded frozen 20s bound'); for (const peer of peers) peer.close(); process.exitCode = 1; }, 20000);
try {
  const incoming = new Promise(resolve => peers[1].addEventListener('datachannel', event => resolve(event.channel)));
  const requester = peers[0].createDataChannel('native-drain-control', { ordered: true });
  await peers[0].setLocalDescription(await peers[0].createOffer());
  await peers[1].setRemoteDescription(peers[0].localDescription);
  await peers[1].setLocalDescription(await peers[1].createAnswer());
  await peers[0].setRemoteDescription(peers[1].localDescription);
  const supplier = await incoming;
  await Promise.all([requester, supplier].map(channel => channel.readyState === 'open' ? null : new Promise(resolve => channel.addEventListener('open', resolve))));
  assert.equal(Object.getOwnPropertyDescriptor(rtc.RTCDataChannel.prototype, 'close').writable, false);
  assert.equal(supplier.close, rtc.RTCDataChannel.prototype.close);
  const add = supplier.addEventListener;
  supplier.addEventListener = function(type, ...args) {
    if (type === 'bufferedamountlow') { out.lowWaits++; out.maxObservedBufferedAmount = Math.max(out.maxObservedBufferedAmount, this.bufferedAmount); }
    return add.call(this, type, ...args);
  };
  // Smaller explicit buffer ceiling forces native backpressure without a large transfer.
  const limits = { maxFrameBytes: 16384, maxControlBytes: 8192, maxChunkBytes: 262144,
    maxBufferedBytes: 16384, maxPendingRequests: 2, maxTransferBytes: 2097152, timeoutMs: 5000 };
  const bytes = Uint8Array.from({ length: 262144 }, (_, i) => (i * 17) & 255);
  client = createPeerPackDataChannel({ channel: requester, limits });
  server = createPeerPackDataChannel({ channel: supplier, limits, serve: async () => ({ bytes, message: {} }) });
  for (let i = 0; i < 3; i++) {
    const result = await client.requestChunk({ sizeBytes: bytes.length }, { maxBytes: bytes.length });
    assert.deepEqual(result.bytes, bytes);
  }
  out.actualBackpressureObserved = out.lowWaits > 0;
  out.backpressureScope = 'Native API and exact transfer smoke; deterministic provider-shaped test separately forces drain waiting';
  assert.equal(iceErrors.length, 0);
  out.client = client.getReceipt(); out.supplier = server.getReceipt(); out.passed = true;
} catch (error) { out.error = error.stack; process.exitCode = 1; }
finally {
  client?.close(); server?.close(); for (const peer of peers) peer.close(); clearTimeout(deadline);
  out.finished = new Date().toISOString(); out.peerStates = peers.map(peer => peer.connectionState);
  console.log(JSON.stringify(out, null, 2));
}
