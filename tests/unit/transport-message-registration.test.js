// Frame types against the real transports' receive validation (transport/swarm.js and transport/room.js refuse a type
// that is not in transport/message-types.js). The mesh-operation tests use a loopback with no validation, so a frame
// type a module sends but never registered passes them and is still dropped by every real transport.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import { createWebRTCSwarm } from '../../packages/reploid/src/transport/swarm.js';
import { createSwarmTransport } from '../../packages/reploid/src/transport/room.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';
import { RTC_MESSAGE_TYPES, ROOM_MESSAGE_TYPES } from '../../packages/reploid/src/transport/message-types.js';
import { MESH_OPERATION_CANCEL, MESH_OPERATION_REQUEST, MESH_OPERATION_RESULT } from '../../packages/reploid/src/mesh/operation-envelope.js';

const MESH_FRAMES = [MESH_OPERATION_REQUEST, MESH_OPERATION_RESULT, MESH_OPERATION_CANCEL];
const quiet = { info() {}, debug() {}, warn() {}, error() {} };

function openSwarm() {
  const sockets = [], connections = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    constructor() { sockets.push(this); }
    send = vi.fn();
    close() { this.readyState = 3; this.onclose?.(); }
    receive(message) { return this.onmessage({ data: JSON.stringify(message) }); }
  }
  class Connection extends EventTarget {
    channel = Object.assign(new EventTarget(), { label: 'reploid', readyState: 'open', send: vi.fn(), close: vi.fn() });
    signalingState = 'stable'; iceConnectionState = 'connected'; connectionState = 'connected';
    constructor() { super(); connections.push(this); }
    close = vi.fn();
    createDataChannel() { return this.channel; }
    async createOffer() { return { type: 'offer', sdp: 'offer' }; }
    async createAnswer() { return { type: 'answer', sdp: 'answer' }; }
    async setLocalDescription(description) { this.localDescription = description; }
    async setRemoteDescription(description) { this.remoteDescription = description; }
    async addIceCandidate() {}
  }
  const config = resolveConfig({ overrides: { mesh: { enabled: true, roomId: 'test' },
    webrtc: { signalingUrl: 'wss://fixture.invalid', heartbeatIntervalMs: 60000, connectTimeoutMs: 5000 } } });
  const swarm = createWebRTCSwarm({ config, peerId: 'local', getSessionId: () => 'session',
    getRoomCredentials: () => ({ roomId: 'test', token: 'x'.repeat(32) }), WebSocket: Socket, RTCPeerConnection: Connection,
    Utils: { generateId: () => 'local', logger: quiet }, EventBus: { emit() {} } });
  return { swarm, async open() {
    const pending = swarm.init(); sockets[0].onopen();
    await sockets[0].receive({ type: 'joined', peerId: 'local', roomId: 'test', peers: ['remote'] });
    await sockets[0].receive({ type: 'answer', peerId: 'remote', answer: { type: 'answer', sdp: 'first' } });
    connections[0].channel.onopen();
    expect(await pending).toBe(true);
    return connections[0].channel;
  } };
}

it('delivers every mesh-operation frame received over the WebRTC swarm', async () => {
  const { swarm, open } = openSwarm();
  try {
    const channel = await open();
    const delivered = [];
    for (const type of MESH_FRAMES) swarm.onMessage(type, (peer, payload) => delivered.push([type, peer, payload.requestId]));
    for (const type of MESH_FRAMES) {
      channel.onmessage({ data: JSON.stringify({ protocolVersion: 1, type, peerId: 'remote', timestamp: 1, payload: { requestId: type }, payloadSize: 20 }) });
    }
    expect(delivered).toEqual(MESH_FRAMES.map(type => [type, 'remote', type]));
  } finally { swarm.disconnect(); }
});

it('delivers every mesh-operation frame sent through a room', async () => {
  const channels = new Set();
  class Channel {
    constructor(name) { this.name = name; channels.add(this); }
    postMessage(data) {
      for (const channel of channels) if (channel !== this && channel.name === this.name) queueMicrotask(() => channel.onmessage?.({ data: structuredClone(data) }));
    }
    close() { channels.delete(this); }
  }
  const config = resolveConfig({ overrides: { mesh: { enabled: true, roomId: 'room' }, webrtc: { broadcastRoomId: 'room', transportOrder: ['broadcast'] } } });
  const make = peerId => createSwarmTransport({ config, peerId, BroadcastChannel: Channel,
    Utils: { generateId: () => peerId, logger: quiet }, EventBus: { emit() {} } });
  const a = make('peer-a'), b = make('peer-b'), delivered = [];
  try {
    for (const type of MESH_FRAMES) b.onMessage(type, (peer, payload) => delivered.push([type, peer, payload.requestId]));
    await a.init(); await b.init();
    for (const type of MESH_FRAMES) a.sendToPeer('peer-b', type, { requestId: type });
    await vi.waitFor(() => expect(delivered).toHaveLength(MESH_FRAMES.length));
    expect(delivered).toEqual(MESH_FRAMES.map(type => [type, 'peer-a', type]));
  } finally { a.disconnect(); b.disconnect(); }
});

// Every frame type a module sends or handles, read from the call sites themselves, so a new type cannot be left out
// of the registry. A call whose type argument is neither a literal nor a named string constant must be a known
// forwarder below; a new one fails here until it is resolved or listed.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCANNED = ['packages/reploid/src', 'server', 'apps/poolday/host'];
const FORWARDERS = new Set([
  // The transports forward a caller's type.
  'packages/reploid/src/transport/room.js#type', 'packages/reploid/src/transport/swarm.js#type',
  // Wrappers whose own call sites are scanned through WRAPPERS.
  'packages/reploid/src/mesh/peer-generation.js#type', 'packages/reploid/src/mesh/web-access-network.js#type',
  // Resends of a frame recorded when it was first sent through sendOutput (its type was scanned there).
  'packages/reploid/src/mesh/peer-generation.js#previous.type', 'packages/reploid/src/mesh/peer-generation.js#existing.outcome.type',
  'packages/reploid/src/mesh/peer-generation.js#previous.outcome.type',
  // A data-channel callback named onMessage(message, event), not a frame handler.
  'packages/reploid/src/transport/assignment.js#deserialize(event.data)'
]);
// Local wrappers around sendToPeer, with the index of their type argument.
const WRAPPERS = { 'packages/reploid/src/mesh/peer-generation.js': [['sendOutput', 0]], 'packages/reploid/src/mesh/web-access-network.js': [['send', 1]] };
const RTC_ONLY = new Set(RTC_MESSAGE_TYPES.filter(type => !ROOM_MESSAGE_TYPES.includes(type)));

const sourceFiles = () => SCANNED.flatMap(dir => readdirSync(path.join(ROOT, dir), { recursive: true })
  .map(file => path.join(dir, String(file)).split(path.sep).join('/'))
  .filter(file => file.endsWith('.js') && !/(^|\/)(node_modules|vendor|dist)\//.test(file)));

/** The argument at `index` of the call that opens at `start` (the index just after its `(`), up to a top-level comma. */
function argument(text, start, index) {
  let depth = 0, current = 0, begin = start, quote = null;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (quote) { if (char === '\\') i++; else if (char === quote) quote = null; continue; }
    if (char === '\'' || char === '"' || char === '`') quote = char;
    else if ('([{'.includes(char)) depth++;
    else if (')]}'.includes(char)) { if (depth === 0) return current === index ? text.slice(begin, i).trim() : null; depth--; }
    else if (char === ',' && depth === 0) { if (current === index) return text.slice(begin, i).trim(); current++; begin = i + 1; }
  }
  return null;
}

function senderFrameTypes() {
  const files = sourceFiles().map(file => ({ file, text: readFileSync(path.join(ROOT, file), 'utf8') }));
  // String constants: a file's own `const` declarations, then any module's exported ones (imports by name).
  const declared = text => [...text.matchAll(/\bconst\s+([^;\n]*)/g)]
    .flatMap(([, list]) => [...list.matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*=\s*'([^'\n]*)'/g)].map(([, name, value]) => [name, value]));
  const exported = new Map();
  for (const { text } of files) for (const [, list] of text.matchAll(/\bexport\s+const\s+([^;\n]*)/g)) {
    for (const [, name, value] of list.matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*=\s*'([^'\n]*)'/g)) {
      if (!exported.has(name)) exported.set(name, new Set());
      exported.get(name).add(value);
    }
  }
  const types = new Set(), unresolved = [];
  for (const { file, text } of files) {
    const local = new Map(declared(text).map(([name, value]) => [name, new Set([value])]));
    const constants = { has: name => local.has(name) || exported.has(name), get: name => local.get(name) ?? exported.get(name) };
    const calls = [['sendToPeer', 1], ['broadcast', 0], ['onMessage', 0], ...(WRAPPERS[file] || [])];
    for (const [name, index] of calls) {
      for (const match of text.matchAll(new RegExp(`(?<![\\w$])(?:function\\s+)?${name}\\(`, 'g'))) {
        if (match[0].startsWith('function')) continue;
        const start = match.index + match[0].length;
        const arg = argument(text, start, index);
        if (!arg || /^[^()'"]*\)\s*\{/.test(text.slice(start))) continue; // not a call, or a method definition: onMessage(payload) {
        // A frame handler is registered as onMessage(type, handler); a one-argument onMessage(x) is some other callback.
        if (name === 'onMessage' && argument(text, start, 1) === null) continue;
        // A signaling broadcast({ type, ... }) carries a signaling message, not an application frame type.
        if (arg.startsWith('{')) continue;
        // In `stage === 'admit' ? 'reploid:a' : 'reploid:b'` only the branches are frame types.
        const literals = [...arg.replace(/[!=]==?\s*'[^'\n]*'/g, '').matchAll(/'([^'\n]*)'/g)].map(item => item[1]);
        if (literals.length) { literals.forEach(type => types.add(type)); continue; }
        if (/^[A-Za-z_$][\w$]*$/.test(arg) && constants.has(arg)) { constants.get(arg).forEach(type => types.add(type)); continue; }
        const loop = new RegExp(`for\\s*\\(\\s*const\\s+${arg}\\s+of\\s+\\[([^\\]]*)\\]`).exec(text);
        if (loop) { for (const item of loop[1].split(',').map(value => value.trim())) constants.get(item)?.forEach(type => types.add(type)); continue; }
        if (!FORWARDERS.has(`${file}#${arg}`)) unresolved.push(`${file}: ${name}(... ${arg} ...)`);
      }
    }
  }
  return { types, unresolved };
}

it('registers every frame type any module sends or handles', () => {
  const { types, unresolved } = senderFrameTypes();
  expect(unresolved).toEqual([]);
  // The scan itself must see the protocols it guards.
  for (const type of [...MESH_FRAMES, 'reploid:generation-request', 'reploid:generation-update', 'reploid:web-offer',
    'reploid:identity-proof', 'reploid:tool-offer', 'reploid:custody-request', 'ping']) expect(types, type).toContain(type);
  const rtc = new Set(RTC_MESSAGE_TYPES), room = new Set(ROOM_MESSAGE_TYPES);
  expect([...types].filter(type => !rtc.has(type))).toEqual([]);
  expect([...types].filter(type => !room.has(type) && !RTC_ONLY.has(type))).toEqual([]);
});
