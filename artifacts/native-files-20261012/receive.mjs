// GPU-free native contributor custody control. Paths are explicit run inputs.
import fs from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { createSwarmTransport } from '../../packages/reploid/src/transport/index.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createNativeRtcAdapter } from '../../server/native-participant.js';
import { createNativeModelFiles } from '../../server/native-model-files.js';
import profile from '../../self/config/reploid-library.json' with { type: 'json' };
import bootstrap from '../../self/config/swarm-bootstrap.json' with { type: 'json' };
import models from '../../self/config/chat-models.json' with { type: 'json' };
import rtcProvider from '/var/tmp/reploid-native-deps-20261012/node_modules/@roamhq/wrtc/lib/index.js';
import Socket from '/var/tmp/reploid-native-deps-20261012/node_modules/ws/wrapper.mjs';
const root = '/var/tmp/reploid-native-files-20261012', model = models.find(m => m.id === 'qwen-3-5-0-8b-q4k-ehaf16');
await fs.mkdir(root + '/empty-model', { recursive: true });
const identity = await createSigningIdentity({ algorithm: 'Ed25519' }), rtc = createNativeRtcAdapter(rtcProvider);
const bus = new EventEmitter();
const config = resolveConfig({ profile: profile.profile, overrides: { mesh: { enabled: true, executeJobs: false, roomId: bootstrap.publicRoomId },
  webrtc: { signalingUrl: `ws://127.0.0.1:18000/swarm?scope=public&roomId=${bootstrap.publicRoomId}`, broadcastRoomId: bootstrap.publicRoomId, transportOrder: ['webrtc'] } } });
class WebSocket extends Socket { constructor(url) { super(url, { origin: 'http://localhost:8000' }); } }
const transport = createSwarmTransport({ config, Utils: { logger: console, generateId: () => crypto.randomUUID() },
  EventBus: { emit: (...args) => bus.emit(...args), on(name, fn) { bus.on(name, fn); return () => bus.off(name, fn); } },
  WebSocket, ...rtc, getSessionId: () => identity.peerId,
  getRoomCredentials: () => ({ roomId: bootstrap.publicRoomId, token: bootstrap.publicJoinMarker }),
  introductions: { getIdentity: () => identity, authorize: async request => request.roomId === bootstrap.publicRoomId && request.action !== 'forward' } });
let files, source, timer;
try {
  await transport.init();
  files = await createNativeModelFiles({ transport, modelDirectory: root + '/empty-model', cacheDirectory: root + '/cache' });
  timer = setInterval(() => files.announce(), 500);
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && (transport.getConnectedPeers().length === 0 || files.getState().peers.length < transport.getConnectedPeers().length)) await new Promise(r => setTimeout(r, 100));
  source = await files.preparePartitionSource(model, { signal: AbortSignal.timeout(60000) });
  const bytes = new Uint8Array(await source.storage.loadShardRange(0, 0, 8));
  const receipt = { node: process.version, nativeHost: true, gpuCreated: !!globalThis.navigator?.gpu,
    modelId: model.id, transportId: transport._getPeerId(), connected: transport.getConnectedPeers(),
    returnedBytes: [...bytes], source: source.getReceipt(), files: files.getState(),
    cacheFiles: await fs.readdir(root + '/cache'), localModelFiles: await fs.readdir(root + '/empty-model') };
  await fs.writeFile(root + '/receive.json', JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ event: 'received', verifiedBytes: receipt.source.verifiedBytes, returnedBytes: bytes.length, gpuCreated: receipt.gpuCreated }));
  await source.storage.close(); source = null;
  await files.share(model, true);
  await fs.writeFile(root + '/sharing.json', JSON.stringify({ transportId: transport._getPeerId(), files: files.getState() }, null, 2));
  console.log(JSON.stringify({ event: 'sharing', transportId: transport._getPeerId() }));
  await new Promise(resolve => { process.once('SIGTERM', resolve); process.once('SIGINT', resolve); });
} finally { clearInterval(timer); await source?.storage.close(); await files?.close(); transport.disconnect(); }
