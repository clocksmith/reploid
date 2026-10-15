// Read-only WebRTC path sampler for the stage 0 coordinator page (Chrome DevTools protocol on loopback).
// Finds the page's RTCPeerConnection objects through Runtime.queryObjects, which pauses the page for a few
// hundred ms, so it runs once at start and again only when no connection is connected (at most once a
// minute, after a reconnection). Every interval it records, per connection, the selected ICE candidate pair:
// STUN round-trip time, bytes, request/response counts and the candidate types, plus each data channel's
// message and byte counters. Addresses are reduced to a class (lan, tailnet, loopback, other); no address is
// written. Runs until SIGTERM.
// Usage: node webrtc-stats.mjs <cdp http endpoint> <page url prefix> <out jsonl> [interval ms]
import fs from 'node:fs';
const [endpoint, prefix, outPath, intervalArg] = process.argv.slice(2);
const interval = Number(intervalArg || 5000);
const list = await (await fetch(endpoint + '/json/list')).json();
const target = list.find(row => row.type === 'page' && row.url.startsWith(prefix));
if (!target) throw Error('stage 0 page not found');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0; const pending = new Map();
socket.onmessage = event => { const m = JSON.parse(event.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); } };
const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); socket.send(JSON.stringify({ id: i, method, params })); });
const out = fs.openSync(outPath, 'a');
let holder = null, queriedAt = 0, lastConnected = null;
async function query() {
  if (holder) await send('Runtime.releaseObject', { objectId: holder }).catch(() => {});
  const proto = await send('Runtime.evaluate', { expression: 'RTCPeerConnection.prototype' });
  const started = Date.now();
  holder = (await send('Runtime.queryObjects', { prototypeObjectId: proto.result.objectId })).objects.objectId;
  await send('Runtime.releaseObject', { objectId: proto.result.objectId });
  queriedAt = Date.now();
  return queriedAt - started;
}
const reader = `async function() {
  const cls = a => !a ? null : /^127\\.|^::1$/.test(a) ? 'loopback' : /^100\\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\\.|^fd7a:115c:/i.test(a) ? 'tailnet'
    : /^(10\\.|192\\.168\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.|fd|fe80)/i.test(a) ? 'lan' : /\\.local$/.test(a) ? 'mdns' : 'other';
  const rows = [];
  for (const pc of this) {
    if (pc.connectionState === 'closed') { rows.push({ state: 'closed' }); continue; }
    const stats = await pc.getStats(); const byId = new Map(); stats.forEach(s => byId.set(s.id, s));
    let pair = null; stats.forEach(s => { if (s.type === 'transport' && s.selectedCandidatePairId) pair = byId.get(s.selectedCandidatePairId); });
    const local = pair && byId.get(pair.localCandidateId), remote = pair && byId.get(pair.remoteCandidateId);
    const channels = []; stats.forEach(s => { if (s.type === 'data-channel') channels.push({ label: s.label, state: s.state, messagesSent: s.messagesSent,
      bytesSent: s.bytesSent, messagesReceived: s.messagesReceived, bytesReceived: s.bytesReceived }); });
    rows.push({ state: pc.connectionState, ice: pc.iceConnectionState,
      pair: pair ? { state: pair.state, currentRoundTripTime: pair.currentRoundTripTime, totalRoundTripTime: pair.totalRoundTripTime,
        responsesReceived: pair.responsesReceived, requestsSent: pair.requestsSent, consentRequestsSent: pair.consentRequestsSent,
        bytesSent: pair.bytesSent, bytesReceived: pair.bytesReceived, packetsSent: pair.packetsSent, packetsReceived: pair.packetsReceived,
        availableOutgoingBitrate: pair.availableOutgoingBitrate } : null,
      local: local ? { type: local.candidateType, protocol: local.protocol, network: local.networkType, cls: cls(local.address || local.ip) } : null,
      remote: remote ? { type: remote.candidateType, protocol: remote.protocol, cls: cls(remote.address || remote.ip) } : null, channels });
  }
  return rows;
}`;
let stopping = false;
const firstQueryMs = await query();
fs.writeSync(out, JSON.stringify({ at: new Date().toISOString(), event: 'queried', pauseMs: firstQueryMs }) + '\n');
async function sample() {
  if (stopping) return;
  try {
    if (lastConnected === 0 && Date.now() - queriedAt > 60000) fs.writeSync(out, JSON.stringify({ at: new Date().toISOString(), event: 'queried', pauseMs: await query() }) + '\n');
    const result = await send('Runtime.callFunctionOn', { objectId: holder, functionDeclaration: reader, awaitPromise: true, returnByValue: true });
    lastConnected = result.result.value.filter(row => row.state === 'connected').length;
    fs.writeSync(out, JSON.stringify({ at: new Date().toISOString(), connections: result.result.value }) + '\n');
  } catch (error) { fs.writeSync(out, JSON.stringify({ at: new Date().toISOString(), error: error.message }) + '\n'); }
}
const timer = setInterval(sample, interval); sample();
const stop = async () => { stopping = true; clearInterval(timer); if (holder) await send('Runtime.releaseObject', { objectId: holder }).catch(() => {}); fs.closeSync(out); socket.close(); process.exit(0); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
