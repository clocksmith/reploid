#!/usr/bin/env python3
"""Apply the scoped Reploid 1b6e50e runtime/discovery repair.

Python 3.9+ and Node 22+ are required. No pip dependencies.
Default: validate and show the proposed changes, without writing repository files.
--apply: back up files, apply guarded edits, run local checks and rebuild manifests.
--restore BACKUP: restore only if no repaired file has subsequently changed.

This script never commits, pushes, publishes, deploys, installs dependencies,
clears browser data, enables remote compute, or bypasses model verification.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
import hmac
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from urllib.parse import urlparse, urlunparse

PATCH_ID = 'reploid-public-swarm-local-doppler-20260922-v1'
REVIEWED_COMMIT = '1b6e50ebdf2fae358b5645b02515f8b6baae7acf'
VERSION = '0.6.2'
EXPECTED = {
    'self/config/doppler-local-models.js': 'd7583eacce55b1cb90ae8de760e69a9f2e50d065',
    'self/infrastructure/doppler-runtime-service.js': 'cf705484000a734f2e9029aa477ea82f7454500b',
    'self/kernel/boot.js': 'c02c099f99fc5a25fd7a1ef86f0b66a695bb85c1',
    'self/capabilities/communication/library-adapter.js': '2bdc7d40b78d22893e5d8063455c5821acbf2113',
    'self/host/work-swarm.js': 'c6eea126905296fba22b6db6ebd454d422424db0',
    'self/host/chat-session.js': '0a36964701f81a0e7fe34736a0e4a76db88f9205',
    'self/ui/pool-home/index.js': '5aad57cf0090c36591ec16469da370dfa0ca4803',
    'self/ui/pool-home/conversation-workspace.js': '3bf33f1c6856854cf0135148f45566d75580b431',
    'packages/reploid/src/transport/room.js': '736b32b3e8d342c3e3b1a88c6b7c1b90358f65cd',
    'server/proxy.js': 'd77a150db919846e38b73f9b710debdb57ef2638',
    'package.json': '822da9d131d9bba545c1cf826851b527caf23ade',
}
# The accompanying payload is embedded below; there are no remote patch downloads.
PAYLOAD = json.loads('{"self/capabilities/communication/swarm-join-policy.js": "/** Host-side public discovery and explicit private invitation selection. No network I/O. */\\nconst assert = (ok, message) => { if (!ok) throw new Error(message); };\\nconst suffixPattern = /^[a-z0-9][a-z0-9_-]{0,127}$/i;\\nconst read = (storage, key) => {\\n  try { return storage?.getItem?.(key) ?? null; } catch { return null; }\\n};\\n\\nexport function resolveSwarmJoin({ location, storage, policy, randomId }) {\\n  const url = new URL(location.href);\\n  const params = url.searchParams;\\n  const swarm = params.get(\'swarm\');\\n  const explicitRoom = swarm === \'public\' ? null\\n    : swarm && ![\'true\', \'false\', \'off\'].includes(swarm) ? swarm : params.get(\'room\');\\n  const suffix = explicitRoom?.replace(/^reploid-swarm-/, \'\');\\n  const privateRoom = !!suffix && suffix !== \'public\';\\n  const roomId = privateRoom ? `reploid-swarm-${suffix}` : policy.publicRoomId;\\n  if (privateRoom) assert(suffixPattern.test(suffix), \'Invalid private swarm identifier\');\\n  const paused = swarm === \'off\' || swarm === \'false\'\\n    || read(storage, \'REPLOID_SWARM_ENABLED\') === \'false\';\\n  let token = policy.publicJoinMarker;\\n  if (privateRoom) {\\n    const savedRoom = read(storage, \'REPLOID_SWARM_ROOM_ID\');\\n    token = params.get(\'swarmToken\') || read(storage, `REPLOID_PRIVATE_SWARM_TOKEN:${suffix}`)\\n      || (savedRoom === suffix ? read(storage, \'REPLOID_SWARM_ROOM_TOKEN\') : null);\\n    if (!token) {\\n      token = randomId() + randomId();\\n      // Do not silently create a room whose invitation cannot be retained.\\n      assert(typeof storage?.setItem === \'function\', \'Private invitations require writable storage\');\\n    }\\n    assert(typeof token === \'string\' && token.length >= 32 && token.length <= 512,\\n      \'Private swarm requires its invitation capability\');\\n    storage?.setItem?.(`REPLOID_PRIVATE_SWARM_TOKEN:${suffix}`, token);\\n    storage?.setItem?.(\'REPLOID_SWARM_ROOM_ID\', suffix);\\n    storage?.setItem?.(\'REPLOID_SWARM_ROOM_TOKEN\', token);\\n  }\\n  return Object.freeze({ scope: privateRoom ? \'private\' : \'public\', roomId, token,\\n    autoConnect: policy.autoConnect && !paused });\\n}\\n\\nexport function resolveSwarmSignalingUrl({ location, policy, join, privateOverride = null }) {\\n  const local = [\'localhost\', \'127.0.0.1\', \'[::1]\'].includes(location.hostname);\\n  // A signaling override alone must not create a random private room.\\n  const raw = privateOverride || (local ? new URL(policy.path, location.href).href : policy.signalingUrl);\\n  assert(typeof raw === \'string\' && raw.length > 0, \'Public swarm signaling URL is not configured\');\\n  const url = new URL(raw, location.href);\\n  if (url.protocol === \'https:\') url.protocol = \'wss:\';\\n  if (url.protocol === \'http:\') url.protocol = \'ws:\';\\n  assert([\'ws:\', \'wss:\'].includes(url.protocol), \'Swarm signaling requires WS or WSS\');\\n  assert(location.protocol !== \'https:\' || url.protocol === \'wss:\', \'HTTPS requires secure swarm signaling\');\\n  assert(!url.username && !url.password, \'Do not put credentials in the signaling URL authority\');\\n  if (!privateOverride) url.pathname = policy.path;\\n  // The new endpoint confines this connection to public or private namespaces.\\n  if (url.pathname === policy.path) url.searchParams.set(\'scope\', join.scope);\\n  url.hash = \'\';\\n  return url.href;\\n}\\n", "self/capabilities/communication/library-adapter.js": "import { resolveConfig } from \'../../vendor/reploid/config/index.js\';\\nimport profile from \'../../config/reploid-library.json\' with { type: \'json\' };\\nimport bootstrap from \'../../config/swarm-bootstrap.json\' with { type: \'json\' };\\nimport { getCurrentReploidStorage } from \'../../instance.js\';\\nimport { getResolvedSignalingConfig } from \'./signaling-config.js\';\\nimport { resolveSwarmJoin, resolveSwarmSignalingUrl } from \'./swarm-join-policy.js\';\\n\\n/** Public WebRTC discovery is the default; invitations choose isolated private namespaces. */\\nexport function createLegacyNetworkOptions(deps = {}, { enabled } = {}) {\\n  const win = globalThis.window;\\n  const location = win?.location || globalThis.location;\\n  if (!location?.href) throw new Error(\'Browser location is required by the network host\');\\n  const storage = getCurrentReploidStorage();\\n  const randomId = () => globalThis.crypto.randomUUID();\\n  const join = resolveSwarmJoin({ location, storage, policy: bootstrap, randomId });\\n  const signaling = getResolvedSignalingConfig();\\n  // Explicit legacy signaling overrides remain usable for private invitations.\\n  // Default public participants all use the configured common bootstrap.\\n  const signalingUrl = resolveSwarmSignalingUrl({ location, policy: bootstrap, join,\\n    privateOverride: join.scope === \'private\' && signaling.explicit ? signaling.url : null });\\n  const config = deps.config || resolveConfig({ profile: profile.profile, overrides: {\\n    mesh: { enabled: enabled === undefined ? true : enabled, roomId: join.roomId },\\n    webrtc: { signalingUrl, broadcastRoomId: join.roomId, transportOrder: [\'webrtc\'] }\\n  } });\\n  return {\\n    ...deps, config, autoConnect: join.autoConnect, discoveryScope: join.scope,\\n    // Keep live TURN configuration supplied by the existing authorized host.\\n    ...(globalThis.REPLOID_POOL_RTC_CONFIG ? { rtcConfig: globalThis.REPLOID_POOL_RTC_CONFIG } : {}),\\n    getInviteUrl() {\\n      const url = new URL(location.href);\\n      url.pathname = \'/\';\\n      for (const key of [\'room\', \'swarm\', \'swarmToken\', \'signaling\', \'instance\', \'relay\']) url.searchParams.delete(key);\\n      if (join.scope === \'private\') {\\n        url.searchParams.set(\'swarm\', join.roomId.replace(/^reploid-swarm-/, \'\'));\\n        url.searchParams.set(\'swarmToken\', join.token);\\n        if (signaling.explicit) url.searchParams.set(\'signaling\', signaling.url);\\n      } else url.searchParams.set(\'swarm\', \'public\');\\n      url.hash = \'\';\\n      return url.href;\\n    },\\n    getSessionId() {\\n      const target = win?.sessionStorage;\\n      let sessionId = null;\\n      try { sessionId = target?.getItem(\'REPLOID_SESSION_ID\'); } catch { /* Ephemeral session is sufficient. */ }\\n      sessionId ||= randomId();\\n      try { target?.setItem(\'REPLOID_SESSION_ID\', sessionId); } catch { /* No private data is stored here. */ }\\n      return sessionId;\\n    },\\n    getRoomCredentials() {\\n      if (config.value.mesh.roomId !== join.roomId) throw new Error(\'Network host and room identity disagree\');\\n      return { roomId: join.roomId, token: join.token };\\n    }\\n  };\\n}\\n", "self/host/swarm-autoconnect.js": "/** Application lifecycle only: joins discovery, never enables resource or data sharing. */\\nexport function startSwarmAutoconnect({ connect, isConnected, enabled, policy,\\n  eventTarget = globalThis.window, setTimer = setTimeout, clearTimer = clearTimeout,\\n  random = Math.random, onError = () => {} }) {\\n  for (const callback of [connect, isConnected, enabled, setTimer, clearTimer, random, onError]) {\\n    if (typeof callback !== \'function\') throw new TypeError(\'Invalid swarm lifecycle port\');\\n  }\\n  if (!Array.isArray(policy.retryMs) || !policy.retryMs.length\\n    || policy.retryMs.some(ms => !Number.isSafeInteger(ms) || ms < 1 || ms > 2147483647)\\n    || !Number.isSafeInteger(policy.healthCheckMs) || policy.healthCheckMs < 1\\n    || policy.healthCheckMs > 2147483647) throw new TypeError(\'Invalid automatic-connection policy\');\\n  let closed = false, suspended = false, inFlight = false, timer = null, failures = 0;\\n  const clear = () => { if (timer !== null) clearTimer(timer); timer = null; };\\n  const schedule = delay => {\\n    clear();\\n    if (!closed && !suspended) timer = setTimer(() => { timer = null; void tick(); }, delay);\\n  };\\n  async function tick() {\\n    if (closed || suspended || inFlight) return;\\n    if (!enabled()) { schedule(policy.healthCheckMs); return; }\\n    if (isConnected()) { failures = 0; schedule(policy.healthCheckMs); return; }\\n    inFlight = true;\\n    try {\\n      await connect();\\n      if (!isConnected()) throw new Error(\'Swarm discovery is not connected\');\\n      failures = 0;\\n    } catch (error) {\\n      failures++;\\n      if (!closed && !suspended) onError(error);\\n    } finally {\\n      inFlight = false;\\n      const base = failures ? policy.retryMs[Math.min(failures - 1, policy.retryMs.length - 1)] : policy.healthCheckMs;\\n      schedule(failures ? Math.min(2147483647, Math.floor(base * (0.75 + random() * 0.5))) : base);\\n    }\\n  }\\n  const online = () => { if (!closed && !suspended) schedule(0); };\\n  eventTarget?.addEventListener(\'online\', online);\\n  schedule(0);\\n  return Object.freeze({\\n    pause() { suspended = true; clear(); },\\n    resume() { if (!closed) { suspended = false; schedule(0); } },\\n    close() { closed = true; clear(); eventTarget?.removeEventListener(\'online\', online); }\\n  });\\n}\\n", "server/public-swarm-server.js": "/** Discovery-only endpoint. Reuses the established signaling protocol and private-room checks. */\\nimport SignalingServer from \'./signaling-server.js\';\\nimport policy from \'../self/config/swarm-bootstrap.json\' with { type: \'json\' };\\n\\nexport default class PublicSwarmServer extends SignalingServer {\\n  constructor({ allowedOrigins = [], logger = console } = {}) {\\n    const origins = [...new Set([...policy.allowedOrigins, ...allowedOrigins])];\\n    if (origins.some(value => typeof value !== \'string\' || value === \'*\')) {\\n      throw new Error(\'Swarm discovery requires explicit allowed origins\');\\n    }\\n    super({ ...policy.server, path: policy.path, localOnly: false, allowedOrigins: origins,\\n      virtualPeers: [], logger });\\n    this.admissionWindow = { since: 0, count: 0 };\\n    this.joinTimers = new Map();\\n  }\\n\\n  handleUpgrade(req, socket, head) {\\n    let scope;\\n    try { scope = new URL(req.url, \'http://swarm.invalid\').searchParams.get(\'scope\'); }\\n    catch { scope = null; }\\n    if (!this.shouldHandle(req) || ![\'public\', \'private\'].includes(scope)) {\\n      this.rejectUpgrade(socket, 400, \'Explicit discovery scope is required\'); return;\\n    }\\n    if (!this.isOriginAllowed(req.headers.origin)) {\\n      this.rejectUpgrade(socket, 403, \'Origin not allowed\'); return;\\n    }\\n    const now = Date.now();\\n    if (now - this.admissionWindow.since >= policy.server.connectionWindowMs) {\\n      this.admissionWindow = { since: now, count: 0 };\\n    }\\n    if (++this.admissionWindow.count > policy.server.maxConnectionsPerWindow\\n      || this.wss.clients.size >= policy.server.maxConnections) {\\n      this.rejectUpgrade(socket, 503, \'Discovery connection allowance reached\'); return;\\n    }\\n    socket.setNoDelay?.(true);\\n    // No shared secret is shipped to a public client. This is not compute authorization.\\n    this.wss.handleUpgrade(req, socket, head, ws => this.wss.emit(\'connection\', ws, req));\\n  }\\n\\n  handleConnection(ws, req) {\\n    super.handleConnection(ws, req);\\n    const meta = this.connectionMeta.get(ws);\\n    meta.discoveryScope = new URL(req.url, \'http://swarm.invalid\').searchParams.get(\'scope\');\\n    const timer = setTimeout(() => {\\n      this.joinTimers.delete(ws);\\n      if (!this.connectionMeta.get(ws)?.peerId) ws.close(1008, \'Join deadline expired\');\\n    }, policy.server.joinTimeoutMs);\\n    this.joinTimers.set(ws, timer);\\n    ws.once(\'close\', () => { clearTimeout(timer); this.joinTimers.delete(ws); });\\n  }\\n\\n  validateJoin(message, meta) {\\n    if (meta.discoveryScope === \'public\') {\\n      if (message.roomId !== policy.publicRoomId || message.token !== policy.publicJoinMarker) {\\n        return { valid: false, error: \'Public discovery cannot enter private rooms\' };\\n      }\\n    } else if (meta.discoveryScope === \'private\') {\\n      if (message.roomId === policy.publicRoomId || message.token === policy.publicJoinMarker) {\\n        return { valid: false, error: \'Private discovery requires a private invitation\' };\\n      }\\n    } else return { valid: false, error: \'Unknown discovery scope\' };\\n    return super.validateJoin(message, meta);\\n  }\\n\\n  validateMessage(message, meta) {\\n    // Never relay inference text or file contents through the bootstrap endpoint.\\n    if (message?.type === \'relay-message\') return { valid: false, error: \'Use the WebRTC data channel\' };\\n    return super.validateMessage(message, meta);\\n  }\\n\\n  handleJoin(ws, message, meta) {\\n    super.handleJoin(ws, message, meta);\\n    if (meta.peerId) { clearTimeout(this.joinTimers.get(ws)); this.joinTimers.delete(ws); }\\n  }\\n\\n  close() {\\n    for (const timer of this.joinTimers.values()) clearTimeout(timer);\\n    this.joinTimers.clear();\\n    super.close();\\n  }\\n}\\n", "scripts/verify-swarm-runtime.js": "#!/usr/bin/env node\\n/** Real browser imports plus two independent browser contexts. No model inference or GPU claims. */\\nimport { chromium } from \'@playwright/test\';\\nimport { readFile } from \'node:fs/promises\';\\nimport { fileURLToPath } from \'node:url\';\\nimport path from \'node:path\';\\nconst root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), \'..\');\\nconst baseUrl = process.argv[2];\\nif (!baseUrl || !/^https?:\\\\/\\\\//.test(baseUrl)) throw new Error(\'Usage: node scripts/verify-swarm-runtime.js https://your-app\');\\nconst manifest = JSON.parse(await readFile(path.join(root, \'self/config/swarm-bootstrap.json\'), \'utf8\'));\\nconst browser = await chromium.launch({ headless: true });\\nconst contexts = [];\\ntry {\\n  for (let index = 0; index < 2; index++) {\\n    const context = await browser.newContext(); contexts.push(context);\\n    const page = await context.newPage();\\n    // Same-origin blank resource: do not initialize the full application or another swarm.\\n    await page.goto(new URL(\'/repair-smoke.html\', baseUrl).href);\\n    await page.evaluate(async () => {\\n      const { DOPPLER_MODULE_URL } = await import(\'/config/doppler-local-models.js\');\\n      if (new URL(DOPPLER_MODULE_URL, location.href).origin !== location.origin) throw new Error(\'Doppler is not same-origin\');\\n      const response = await fetch(DOPPLER_MODULE_URL, { cache: \'no-store\' });\\n      if (!response.ok || !(response.headers.get(\'content-type\') || \'\').includes(\'javascript\')) throw new Error(\'Doppler URL is not JavaScript\');\\n      const runtime = await import(DOPPLER_MODULE_URL);\\n      if (runtime.DOPPLER_VERSION !== \'0.6.2\' || typeof (runtime.dr || runtime.doppler)?.open !== \'function\') {\\n        throw new Error(\'Wrong Doppler version or missing public interface\');\\n      }\\n      const { createWorkSwarm } = await import(\'/host/work-swarm.js\');\\n      window.__repairSwarm = createWorkSwarm({ storage: localStorage });\\n      await window.__repairSwarm.connect();\\n    });\\n  }\\n  for (const context of contexts) {\\n    await context.pages()[0].waitForFunction(() => {\\n      const state = window.__repairSwarm.getState();\\n      return state.consumer?.transport === \'webrtc\' && state.consumer?.peers?.length > 0;\\n    }, null, { timeout: 30000 });\\n    const result = await context.pages()[0].evaluate(() => {\\n      const state = window.__repairSwarm.getState();\\n      if (state.sharing) throw new Error(\'Discovery silently enabled compute sharing\');\\n      return { transport: state.consumer.transport, peers: state.consumer.peers.length, sharing: state.sharing };\\n    });\\n    console.log(JSON.stringify(result));\\n  }\\n  console.log(\'PASS: same-origin module graph; public WebRTC peer discovery; compute sharing stays disabled.\');\\n  console.log(`Configured endpoint: ${manifest.signalingUrl}. This does not qualify inference or physical multi-device NAT traversal.`);\\n} finally {\\n  for (const context of contexts) for (const page of context.pages()) {\\n    await page.evaluate(() => window.__repairSwarm?.close()).catch(() => {});\\n  }\\n  await browser.close();\\n}\\n", "self/repair-smoke.html": "<!doctype html><html lang=\\"en\\"><meta charset=\\"utf-8\\"><title>Reploid runtime check</title><body>Runtime check fixture. No model is loaded automatically.</body></html>\\n", "docs/public-swarm-repair.md": "# Public swarm and self-hosted Doppler\\n\\nThe application joins public WebRTC discovery automatically. An explicit `swarm`\\n(or `room`) invitation selects an isolated private namespace. Signaling settings\\nalone never create private rooms. The public namespace and join marker are public\\nprotocol identifiers, not authentication secrets.\\n\\n`self/config/swarm-bootstrap.json` owns bootstrap location, reconnect timing,\\norigin allowlists, and connection limits. `/swarm?scope=public` only joins the\\npublic namespace. `/swarm?scope=private` retains the existing high-entropy room\\ncapability checks. Neither endpoint forwards inference text or artifacts.\\nDefault operation does not fall back to BroadcastChannel and call that WebRTC.\\nThe Network control can disconnect; `?swarm=off` disables automatic joining.\\n\\nJoining announces network presence and may expose network addresses to peers.\\nIt does not grant compute, prompt/file disclosure, redistribution, candidate\\nreceipt, or candidate adoption. Existing application approval checks remain.\\n\\nThe bootstrap uses an in-memory peer directory. Run one signaling process with\\nno split traffic across revisions for this bounded release. Horizontal scaling\\nrequires shared rendezvous state or an explicitly designed discovery overlay.\\nThe configured room and connection limits remain enforced. This patch does not\\nimplement internet-scale all-to-all links, routing through arbitrary peers, or\\nmodel layer partition execution.\\n\\nCloud Run must expose the actual WSS endpoint directly. A Firebase static site\\nalone does not run the signaling process. Deploy both server and Hosting assets.\\nUse existing authorized RTC configuration for TURN. STUN alone cannot guarantee\\nconnections through all NAT/firewall combinations; this patch does not mint TURN\\ncredentials or remove authentication from the existing RTC configuration API.\\n\\nDoppler is served from `/vendor/doppler/0.6.2/`, copied from an archive whose\\nSHA-512 matches the repository lockfile. No runtime modules or kernels come from\\na moving CDN release. The archive and its internal relative asset layout are\\npreserved. Model weights are not bundled by this repair.\\n\\nAcceptance: `node scripts/verify-swarm-runtime.js https://your-app` checks the\\nreal browser module graph and real WebRTC discovery in separate browser contexts.\\nRun a second physical device on another network separately to qualify NAT traversal.\\nThis is not model, adapter, or partitioned-inference qualification.\\n", "scripts/repair-checks/swarm-join.test.js": "import test from \'node:test\';\\nimport assert from \'node:assert/strict\';\\nimport { resolveSwarmJoin, resolveSwarmSignalingUrl } from \'../../self/capabilities/communication/swarm-join-policy.js\';\\nimport { startSwarmAutoconnect } from \'../../self/host/swarm-autoconnect.js\';\\nconst policy = { publicRoomId: \'reploid-swarm-public\', publicJoinMarker: \'reploid-public-namespace-not-a-secret-v1\',\\n  autoConnect: true, path: \'/swarm\', signalingUrl: \'wss://bootstrap.example/swarm\' };\\nconst store = () => { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k,v) }; };\\nconst resolve = (href, storage = store()) => resolveSwarmJoin({ location: new URL(href), storage, policy, randomId: () => \'a\'.repeat(36) });\\n\\ntest(\'default public join is identical across isolated participants\', () => {\\n  const a = resolve(\'https://app.example/\'), b = resolve(\'https://app.example/?instance=other\');\\n  assert.equal(a.roomId, b.roomId); assert.equal(a.token, b.token); assert.equal(a.scope, \'public\');\\n  assert.equal(a.autoConnect, true);\\n});\\ntest(\'explicit public joining overrides a leftover room query\', () => {\\n  assert.equal(resolve(\'https://app.example/?swarm=public&room=old-private\').scope, \'public\');\\n});\\ntest(\'signaling customization alone does not create a private room\', () => {\\n  assert.equal(resolve(\'https://app.example/?signaling=wss://other.example/signaling\').scope, \'public\');\\n});\\ntest(\'stale private storage cannot silently divert default public joining\', () => {\\n  const storage = store(); storage.setItem(\'REPLOID_SWARM_ROOM_ID\',\'old\'); storage.setItem(\'REPLOID_SWARM_ROOM_TOKEN\',\'s\'.repeat(64));\\n  assert.equal(resolve(\'https://app.example/\', storage).scope, \'public\');\\n});\\ntest(\'private invitation retains its capability and namespace\', () => {\\n  const token = \'private-secret-\'.repeat(4);\\n  const a = resolve(\'https://app.example/?swarm=group-a&swarmToken=\'+token);\\n  const b = resolve(\'https://app.example/?room=group-a&swarmToken=\'+token);\\n  assert.equal(a.scope, \'private\'); assert.equal(a.roomId, b.roomId); assert.equal(a.token, b.token);\\n  assert.notEqual(a.token, policy.publicJoinMarker);\\n});\\ntest(\'invalid private room and undersized capability fail\', () => {\\n  assert.throws(() => resolve(\'https://app.example/?swarm=../escape\'));\\n  assert.throws(() => resolve(\'https://app.example/?swarm=private&swarmToken=short\'));\\n});\\ntest(\'automatic joining can be paused without disabling model computation\', () => {\\n  const a = resolve(\'https://app.example/?swarm=off\');\\n  assert.equal(a.autoConnect, false); assert.equal(a.scope, \'public\');\\n});\\ntest(\'production uses one secure bootstrap; localhost uses its own backend\', () => {\\n  const join = resolve(\'https://app.example/\');\\n  const a = resolveSwarmSignalingUrl({ location: new URL(\'https://app.example/\'), policy, join });\\n  const b = resolveSwarmSignalingUrl({ location: new URL(\'http://localhost:8000/\'), policy, join });\\n  assert.equal(a, \'wss://bootstrap.example/swarm?scope=public\');\\n  assert.equal(b, \'ws://localhost:8000/swarm?scope=public\');\\n});\\ntest(\'HTTPS cannot silently downgrade signaling to plaintext\', () => {\\n  const join = resolve(\'https://app.example/\');\\n  assert.throws(() => resolveSwarmSignalingUrl({ location: new URL(\'https://app.example/\'), policy, join,\\n    privateOverride: \'ws://unsafe.example/signaling\' }));\\n});\\ntest(\'autoconnect retries and respects stop without enabling any work\', async () => {\\n  let calls = 0, connected = false, enabled = true;\\n  const tasks = new Map(); let next = 0;\\n  const auto = startSwarmAutoconnect({\\n    connect: async () => { calls++; if(calls === 1) throw new Error(\'offline\'); connected = true; },\\n    isConnected: () => connected, enabled: () => enabled,\\n    policy: { retryMs: [10,20], healthCheckMs: 100 }, eventTarget: new EventTarget(), random: () => .5,\\n    setTimer: (fn,delay) => { const id = ++next; tasks.set(id,{fn,delay}); return id; }, clearTimer: id => tasks.delete(id)\\n  });\\n  const tick = async () => { const [id,entry] = tasks.entries().next().value; tasks.delete(id); entry.fn(); await new Promise(resolve => setImmediate(resolve)); };\\n  await tick(); assert.equal(calls,1); assert.equal([...tasks.values()][0].delay,10);\\n  await tick(); assert.equal(calls,2); assert.equal(connected,true);\\n  await tick(); assert.equal(calls,2);\\n  enabled=false; connected=false; await tick(); assert.equal(calls,2);\\n  auto.pause(); assert.equal(tasks.size,0); auto.resume(); assert.equal(tasks.size,1);\\n  auto.close(); assert.equal(tasks.size,0);\\n});\\n"}')


def die(message: str) -> None:
    raise RuntimeError(message)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def git_blob(data: bytes) -> str:
    return hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()


def safe_path(root: Path, name: str) -> Path:
    p = PurePosixPath(name)
    if p.is_absolute() or not p.parts or '..' in p.parts or '\\' in name:
        die(f'Unsafe repository path: {name}')
    target = root.joinpath(*p.parts)
    # Do not follow symlinked output directories or files.
    current = root
    for part in p.parts:
        current = current / part
        if current.is_symlink():
            die(f'Refusing symlinked output: {current}')
    if not target.resolve().is_relative_to(root.resolve()):
        die(f'Path escapes repository: {name}')
    return target


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        die(f'{label}: expected one matching code block, found {count}. No guessed patch will be applied.')
    return source.replace(old, new, 1)


def run(root: Path, command: list[str], *, capture: bool = False, timeout: int = 180) -> str:
    result = subprocess.run(command, cwd=root, text=True, capture_output=capture, timeout=timeout)
    if result.returncode:
        detail = (result.stderr or result.stdout or '').strip() if capture else ''
        die(f'Command failed ({result.returncode}): {" ".join(command)}\n{detail}')
    return result.stdout.strip() if capture else ''


def resolve_endpoint(root: Path, provided: str | None, local: bool) -> str:
    if provided:
        value = provided
    elif local:
        value = 'ws://localhost:8000/swarm'
    else:
        gcloud = shutil.which('gcloud')
        if not gcloud:
            die('Pass --signaling-url https://YOUR-BACKEND-HOST/swarm, or use --local for localhost only.\n'
                'A deployed WebSocket endpoint is necessary; a Firebase static page alone is not a signaling server.')
        config = json.loads((root/'deploy/env.production.json').read_text())
        value = run(root, [gcloud, 'run', 'services', 'describe', config['serviceName'],
                          '--project', config['projectId'], '--region', config['region'],
                          '--format=value(status.url)'], capture=True, timeout=45)
        if not value:
            die('Cloud Run did not return its service URL. Supply --signaling-url explicitly.')
    parsed = urlparse(value)
    scheme = {'https': 'wss', 'http': 'ws'}.get(parsed.scheme, parsed.scheme)
    if scheme not in ('ws', 'wss') or not parsed.hostname or parsed.username or parsed.password:
        die('Signaling URL must be an HTTP(S)/WS(S) server URL without embedded credentials.')
    if parsed.query or parsed.fragment:
        die('Do not embed an access token or private room in the public bootstrap URL.')
    loopback = parsed.hostname in ('localhost', '127.0.0.1', '::1')
    if scheme != 'wss' and not loopback:
        die('Non-local public signaling requires WSS.')
    return urlunparse((scheme, parsed.netloc, '/swarm', '', '', ''))


def read_sources(root: Path) -> dict[str, str]:
    originals = {}
    mismatches = []
    for name, expected in EXPECTED.items():
        path = safe_path(root, name)
        if not path.is_file():
            mismatches.append(f'{name}: missing'); continue
        data = path.read_bytes()
        if git_blob(data) != expected:
            mismatches.append(f'{name}: differs from reviewed {REVIEWED_COMMIT[:8]}')
        else:
            originals[name] = data.decode('utf-8')
    if mismatches:
        die('Refusing to overwrite changed or unsupported files:\n  '+'\n  '.join(mismatches)+
            '\nKeep concurrent work. Rebase this patch against the current files rather than forcing it.')
    return originals


def patch_sources(originals: dict[str, str], endpoint: str, origins: list[str]) -> dict[str, bytes]:
    out = dict(originals)
    name = 'self/config/doppler-local-models.js'
    out[name] = replace_once(out[name],
        'const DOPPLER_BROWSER_RELEASE_BASE_URL =\n  `https://cdn.jsdelivr.net/npm/${DOPPLER_BROWSER_RELEASE_REF}`;',
        "const DOPPLER_BROWSER_RELEASE_BASE_URL = new URL(\n  `../vendor/doppler/${DOPPLER_BROWSER_RUNTIME_VERSION}/`, import.meta.url\n).href.replace(/\\/$/, '');", name)

    name = 'self/infrastructure/doppler-runtime-service.js'
    old = """const defaultLoadModule = async () => {
  const isLocal = typeof location !== 'undefined'
    && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  const kernelBase = globalThis.REPLOID_DOPPLER_KERNEL_BASE_URL
    || (isLocal ? '/doppler/src/gpu/kernels' : DOPPLER_KERNEL_BASE_URL);
  globalThis.__DOPPLER_KERNEL_BASE_PATH__ = String(kernelBase).replace(/\\/+$/, '');
  const moduleUrl = globalThis.REPLOID_DOPPLER_MODULE_URL
    || (isLocal ? '/doppler/src/index.js' : DOPPLER_MODULE_URL);
  return import(moduleUrl);
};"""
    new = """const defaultLoadModule = async () => {
  const kernelBase = globalThis.REPLOID_DOPPLER_KERNEL_BASE_URL || DOPPLER_KERNEL_BASE_URL;
  globalThis.__DOPPLER_KERNEL_BASE_PATH__ = String(kernelBase).replace(/\\/+$/, '');
  const moduleUrl = globalThis.REPLOID_DOPPLER_MODULE_URL || DOPPLER_MODULE_URL;
  try { return await import(moduleUrl); }
  catch (cause) {
    throw new Error(`Doppler module import failed at ${moduleUrl}. Deploy the complete pinned runtime and inspect its first failed module request.`, { cause });
  }
};"""
    out[name] = replace_once(out[name], old, new, name)

    name = 'self/kernel/boot.js'
    out[name] = replace_once(out[name], "const BUILD_VERSION = '2026091901';", "const BUILD_VERSION = '20260922-public-swarm-v1';", name)
    out[name] = replace_once(out[name], "  const base = (fromQuery || stored || '').replace(/\\/$/, '');", """  // Discard only the old shipped CDN/dev defaults, not an explicit query override.
  const obsoleteDefault = /^https:\\/\\/cdn\\.jsdelivr\\.net\\/npm\\/doppler-gpu@0\\.6\\.2(?:\\/|$)/.test(stored || '')
    || stored === '/doppler';
  const base = (fromQuery || (!obsoleteDefault && stored) || new URL('../', DOPPLER_MODULE_URL).href).replace(/\\/$/, '');""", name)

    name = 'self/host/work-swarm.js'
    out[name] = replace_once(out[name], '  let connection = null;', '  let connection = null;\n  let automaticPaused = false;', name)
    out[name] = replace_once(out[name], '  const connect = () => {\n    if (!connection)',
        "  const connect = ({ automatic = false } = {}) => {\n    if (automatic && automaticPaused) return Promise.resolve(getState());\n    if (!automatic) automaticPaused = false;\n    if (!connection)", name)
    out[name] = replace_once(out[name], '  return Object.freeze({ getState, connect,',
        "  return Object.freeze({ getState, connect,\n    autoConnectEnabled: () => options.autoConnect !== false && options.config.value.mesh.enabled && !automaticPaused,\n    getInviteUrl: () => options.getInviteUrl(),", name)
    out[name] = replace_once(out[name],
        '    async disconnect() { const previous = consumer; consumer = null; peerOffers?.close(); consumerTransport = null; await previous?.close(); notify(); },',
        """    async disconnect() {
      automaticPaused = true;
      const pendingConnect = connection;
      if (pendingConnect) await pendingConnect.catch(() => null);
      const previousConsumer = consumer, previousSupplier = supplier;
      consumer = null; supplier = null; sharing = false; stopping = true;
      peerOffers?.close(); consumerTransport = null; notify();
      const results = await Promise.allSettled([
        previousConsumer?.close(), previousSupplier?.close(), ...owned
      ]);
      stopping = false; notify();
      const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (failures.length) throw new AggregateError(failures, 'Swarm disconnection failed');
    },""", name)

    name = 'self/host/chat-session.js'
    out[name] = replace_once(out[name], '    async connect() {\n      assert(swarm?.connect,',
        "    async disconnect() {\n      assert(swarm?.disconnect, 'Peer disconnection is unavailable');\n      try { await swarm.disconnect(); } finally { notifyAll(); }\n    },\n    async connect() {\n      assert(swarm?.connect,", name)

    name = 'packages/reploid/src/transport/room.js'
    out[name] = replace_once(out[name], '    const getConnectionState = () => _connectionState;',
        "    const getConnectionState = () => _transport === 'webrtc' && _webrtcSwarm\n      ? _webrtcSwarm.getConnectionState() : _connectionState;", name)

    name = 'self/ui/pool-home/conversation-workspace.js'
    out[name] = replace_once(out[name], "    find('[data-mesh-connect]').disabled = !!network.connecting;",
        "    const connected = network.consumer?.connectionState === 'connected';\n    find('[data-mesh-connect]').textContent = connected ? 'Disconnect' : 'Connect peers';\n    find('[data-mesh-connect]').disabled = !!network.connecting;", name)
    out[name] = replace_once(out[name], "  on('[data-mesh-connect]', 'click', () => act(() => session.connect()));",
        "  on('[data-mesh-connect]', 'click', () => act(() =>\n    session.getState().network?.consumer?.connectionState === 'connected'\n      ? session.disconnect() : session.connect()));", name)

    name = 'self/ui/pool-home/index.js'
    out[name] = "import { startSwarmAutoconnect } from '../../host/swarm-autoconnect.js';\nimport swarmBootstrap from '../../config/swarm-bootstrap.json' with { type: 'json' };\n" + out[name]
    out[name] = replace_once(out[name], "      if (!destination.searchParams.has('room')) destination.searchParams.set('room', getPeerRoomId());", "      // Preserve an explicit room; do not manufacture private rooms during navigation.", name)
    out[name] = replace_once(out[name], 'export function initPoolHome(mount, { operationNetwork = null } = {}) {\n  if (!mount) return;',
        "export function initPoolHome(mount, { operationNetwork = null } = {}) {\n  if (!mount) return;\n  window.REPLOID_SWARM_AUTOCONNECT_DISPOSE?.();", name)
    anchor = """  chatSession = createChatSession({ service, storage: workStorage, swarm,
    peers: createWorkPeerJobs({ getNetwork: () => operationNetwork }) });
  const onPageHide = event => {"""
    replacement = """  chatSession = createChatSession({ service, storage: workStorage, swarm,
    peers: createWorkPeerJobs({ getNetwork: () => operationNetwork }) });
  const autoSwarm = startSwarmAutoconnect({
    connect: () => swarm.connect({ automatic: true }),
    isConnected: () => swarm.getState().consumer?.connectionState === 'connected',
    enabled: () => swarm.autoConnectEnabled(),
    policy: swarmBootstrap,
    onError: error => console.warn('[Reploid Swarm] Discovery retry:', error.message)
  });
  const onPageShow = event => { if (event.persisted) autoSwarm.resume(); };
  window.addEventListener('pageshow', onPageShow);
  const disposeAutoSwarm = () => {
    autoSwarm.close(); window.removeEventListener('pageshow', onPageShow);
    void swarm.disconnect().catch(error => console.error('[Reploid Swarm] Disconnect failed', error));
  };
  window.REPLOID_SWARM_AUTOCONNECT_DISPOSE = disposeAutoSwarm;
  const onPageHide = event => {
    autoSwarm.pause();"""
    out[name] = replace_once(out[name], anchor, replacement, name)
    out[name] = replace_once(out[name], '    if (!event.persisted) {\n      disposeWorkView();',
        "    if (!event.persisted) {\n      autoSwarm.close(); window.removeEventListener('pageshow', onPageShow);\n      if (window.REPLOID_SWARM_AUTOCONNECT_DISPOSE === disposeAutoSwarm) window.REPLOID_SWARM_AUTOCONNECT_DISPOSE = null;\n      disposeWorkView();", name)
    out[name] = replace_once(out[name], 'bindConversationWorkspace(mount, chatSession, { getInviteUrl: getPeerInviteUrl })',
        'bindConversationWorkspace(mount, chatSession, { getInviteUrl: () => swarm.getInviteUrl() })', name)

    name = 'server/proxy.js'
    out[name] = replace_once(out[name], "import SignalingServer, { isLoopbackAddress } from './signaling-server.js';",
        "import SignalingServer, { isLoopbackAddress } from './signaling-server.js';\nimport PublicSwarmServer from './public-swarm-server.js';", name)
    out[name] = replace_once(out[name], 'const server = http.createServer(app);',
        "const server = http.createServer(app);\n// Public discovery remains available in the production backend-only deployment.\nconst publicSwarmServer = process.env.REPLOID_PUBLIC_SWARM === 'false'\n  ? null : new PublicSwarmServer({ allowedOrigins: CORS_ORIGINS });", name)
    out[name] = replace_once(out[name], "server.on('upgrade', (req, socket, head) => {\n  if (signalingServer?.shouldHandle(req))",
        "server.on('upgrade', (req, socket, head) => {\n  if (publicSwarmServer?.shouldHandle(req)) {\n    publicSwarmServer.handleUpgrade(req, socket, head); return;\n  }\n  if (signalingServer?.shouldHandle(req))", name)
    out[name] = replace_once(out[name], 'const gracefulShutdown = (signal) => {',
        'const gracefulShutdown = (signal) => {\n  publicSwarmServer?.close();', name)

    package = json.loads(out['package.json'])
    package['scripts']['verify:swarm-bootstrap'] = 'node --test scripts/repair-checks/swarm-join.test.js'
    package['scripts']['smoke:swarm-bootstrap'] = 'node scripts/verify-swarm-runtime.js'
    out['package.json'] = json.dumps(package, indent=2, ensure_ascii=False)+'\n'
    out.update(PAYLOAD)
    builtin_origins = ['https://replo.id', 'https://reploid.web.app', 'https://reploid.firebaseapp.com',
                       'http://localhost:8000', 'http://127.0.0.1:8000']
    for origin in origins:
        parsed = urlparse(origin)
        if parsed.scheme not in ('http','https') or not parsed.netloc or parsed.username or parsed.password or parsed.path not in ('','/') or parsed.query or parsed.fragment:
            die(f'--origin must be an exact HTTP(S) origin: {origin}')
    policy = {
        'schema': 'reploid.swarm-bootstrap/v1', 'repairId': PATCH_ID,
        'publicRoomId': 'reploid-swarm-public',
        'publicJoinMarker': 'reploid-public-namespace-not-a-secret-v1',
        'path': '/swarm', 'signalingUrl': endpoint, 'autoConnect': True,
        'retryMs': [1000, 2000, 4000, 8000, 16000, 30000], 'healthCheckMs': 10000,
        'allowedOrigins': list(dict.fromkeys(builtin_origins+[x.rstrip('/') for x in origins])),
        'server': {'heartbeatInterval': 30000, 'peerTimeout': 60000, 'maxMessageBytes': 65536,
                   'maxPeersPerRoom': 64, 'maxPeersTotal': 256, 'maxRooms': 128,
                   'maxMessagesPerWindow': 512, 'rateLimitWindowMs': 1000,
                   'maxConnections': 320, 'maxConnectionsPerWindow': 128,
                   'connectionWindowMs': 1000, 'joinTimeoutMs': 10000}
    }
    out['self/config/swarm-bootstrap.json'] = json.dumps(policy,indent=2)+'\n'
    return {name:text.encode('utf-8') for name,text in out.items()}


def package_files(root: Path, archive_arg: str | None) -> dict[str, bytes]:
    lock = json.loads((root/'package-lock.json').read_text())
    record = lock.get('packages',{}).get('node_modules/doppler-gpu')
    if not record or record.get('version') != VERSION:
        die('The lockfile must pin doppler-gpu 0.6.2. No dependency upgrade is performed.')
    integrity = record.get('integrity','')
    expected = [x.removeprefix('sha512-') for x in integrity.split() if x.startswith('sha512-')]
    if not expected:
        die('The Doppler lockfile entry has no SHA-512 integrity.')
    candidates = [Path(archive_arg).expanduser()] if archive_arg else [
        root.parent/'doppler'/f'doppler-gpu-{VERSION}.tgz', root/f'doppler-gpu-{VERSION}.tgz']
    archive = next((p.resolve() for p in candidates if p.is_file()), None)
    if archive:
        if archive.stat().st_size > 128*1024*1024: die('Runtime archive exceeds the repair size limit.')
        blob = archive.read_bytes()
        print(f'Runtime archive: {archive}')
    elif archive_arg:
        die(f'Runtime archive not found: {archive_arg}')
    else:
        url = record.get('resolved','')
        if url != f'https://registry.npmjs.org/doppler-gpu/-/doppler-gpu-{VERSION}.tgz':
            die('Supply --doppler-tarball: the lockfile does not use the expected public registry URL.')
        print('Reading the exact locked Doppler archive from npm (no install scripts).')
        try:
            with urlopen(Request(url,headers={'User-Agent':PATCH_ID}),timeout=45) as response:
                blob = response.read(128*1024*1024+1)
        except Exception as error:
            die(f'Could not obtain the pinned archive: {error}\n'
                'Use --doppler-tarball ../doppler/doppler-gpu-0.6.2.tgz. Do not substitute an unpinned version.')
        if len(blob)>128*1024*1024: die('Runtime archive exceeds the repair size limit.')
    actual = base64.b64encode(hashlib.sha512(blob).digest()).decode()
    if not any(hmac.compare_digest(actual,item) for item in expected):
        die('Doppler archive SHA-512 does not match package-lock.json. Nothing has been replaced.')
    out, total, count = {},0,0
    with tarfile.open(fileobj=io.BytesIO(blob), mode='r:gz') as archive_file:
        for member in archive_file:
            count+=1
            if count>30000: die('Too many archive entries.')
            name=PurePosixPath(member.name)
            if name.is_absolute() or '..' in name.parts or '\\' in member.name or not name.parts or name.parts[0]!='package':
                die(f'Unsafe archive entry: {member.name}')
            if member.isdir(): continue
            if not member.isfile(): die(f'Unsupported link/special file in archive: {member.name}')
            total+=member.size
            if total>512*1024*1024 or member.size>128*1024*1024: die('Expanded runtime exceeds the repair size limit.')
            relative=str(PurePosixPath(*name.parts[1:]))
            if relative in ('','.'): die('Invalid package entry')
            destination=f'self/vendor/doppler/{VERSION}/{relative}'
            if destination in out: die(f'Duplicate archive entry: {member.name}')
            extracted=archive_file.extractfile(member)
            if extracted is None: die(f'Unreadable archive entry: {member.name}')
            out[destination]=extracted.read()
    prefix=f'self/vendor/doppler/{VERSION}/'
    pkg=json.loads(out.get(prefix+'package.json',b'{}'))
    if pkg.get('name')!='doppler-gpu' or pkg.get('version')!=VERSION: die('Archive package identity mismatch.')
    for name in ['src/index.js','src/version.js','src/tooling-exports/storage.js']:
        if prefix+name not in out: die(f'The locked runtime is missing {name}. Fix the package, not its version string.')
    if not any(name.startswith(prefix+'src/gpu/kernels/') and name.endswith('.wgsl') for name in out):
        die('The locked package contains no WGSL kernels.')
    files=[{'path':n.removeprefix(prefix),'sha256':sha(data),'bytes':len(data)} for n,data in sorted(out.items())]
    out[prefix+'repair-runtime-manifest.json']= (json.dumps({'schema':'reploid.vendored-doppler/v1','version':VERSION,
        'archiveIntegrity':'sha512-'+actual,'files':files},indent=2)+'\n').encode()
    print(f'Verified locked archive: {len(files)} files, {total:,} expanded bytes.')
    return out


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd,name = tempfile.mkstemp(prefix='.'+path.name+'.repair-',dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as stream:
            stream.write(data);stream.flush();os.fsync(stream.fileno())
        os.chmod(name, path.stat().st_mode & 0o777 if path.exists() else 0o644)
        os.replace(name,path)
    finally:
        if os.path.exists(name):os.unlink(name)


def generated_paths(root: Path) -> set[str]:
    names={'self/vendor/reploid/package-assets.json','self/config/browser-bundle-manifest.json'}
    for path in (root/'packages/reploid/src').rglob('*'):
        if path.is_file() and path.suffix in ('.js','.json','.ts'):
            names.add('self/vendor/reploid/'+path.relative_to(root/'packages/reploid/src').as_posix())
    return names


def backup_files(root: Path,names: set[str], endpoint: str) -> tuple[Path,dict]:
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    backup=root/'.reploid-repair-backups'/stamp
    backup.mkdir(parents=True, mode=0o700)
    record={'repairId':PATCH_ID,'repo':str(root),'reviewedCommit':REVIEWED_COMMIT,'signalingUrl':endpoint,'files':{}}
    for name in sorted(names):
        target=safe_path(root,name)
        before=target.read_bytes() if target.exists() else None
        if before is not None:
            old=safe_path(backup/'original',name);old.parent.mkdir(parents=True,exist_ok=True);old.write_bytes(before)
        record['files'][name]={'before':None if before is None else sha(before),'after':None}
    (backup/'manifest.json').write_text(json.dumps(record,indent=2)+'\n')
    return backup,record


def restore_backup(root: Path, backup: Path, *, force_internal: bool=False) -> None:
    manifest=json.loads((backup/'manifest.json').read_text())
    if manifest.get('repairId')!=PATCH_ID or Path(manifest.get('repo','')).resolve()!=root:
        die('Backup belongs to another repair or repository.')
    if not force_internal:
        for name,entry in manifest['files'].items():
            target=safe_path(root,name)
            current=sha(target.read_bytes()) if target.exists() else None
            if current!=entry['after']:
                die(f'{name} changed after the repair. Refusing to overwrite it during restoration.')
    for name,entry in manifest['files'].items():
        target=safe_path(root,name)
        if entry['before'] is None:
            if target.is_file():target.unlink()
        else:
            before=safe_path(backup/'original',name).read_bytes()
            if sha(before)!=entry['before']:die(f'Backup integrity failed: {name}')
            atomic_write(target,before)
    print(f'Restored files from {backup}; browser conversations and model stores were not touched.')


def main() -> None:
    parser=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--repo',default='.',help='Reploid working tree (default current directory)')
    parser.add_argument('--apply',action='store_true',help='Write the guarded repair after backing up files')
    parser.add_argument('--signaling-url',help='Direct backend URL, e.g. https://SERVICE.run.app/swarm; otherwise read Cloud Run metadata using gcloud')
    parser.add_argument('--local',action='store_true',help='Prepare localhost-only defaults; do not deploy this config for remote users')
    parser.add_argument('--doppler-tarball',help='Exact local 0.6.2 .tgz matching package-lock.json')
    parser.add_argument('--origin',action='append',default=[],help='Additional exact allowed browser origin; repeat as needed')
    parser.add_argument('--restore',help='Backup directory from a previous application of this script')
    args=parser.parse_args()
    root=Path(args.repo).expanduser().resolve()
    if not (root/'package.json').is_file() or not (root/'self').is_dir():die('Use --repo /path/to/reploid.')
    if args.restore:
        if args.apply:die('--restore and --apply are separate operations.')
        restore_backup(root,Path(args.restore).expanduser().resolve());return
    lock_path=root/'.reploid-repair.lock'
    try:lockfd=os.open(lock_path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    except FileExistsError:die(f'{lock_path} already exists. Verify that another repair is not running.')
    try:
        os.write(lockfd,str(os.getpid()).encode());os.close(lockfd)
        originals=read_sources(root)
        node=shutil.which('node')
        if not node:die('Node 22+ is required for syntax checks and manifest regeneration.')
        node_version=run(root,[node,'--version'],capture=True)
        if int(node_version.lstrip('v').split('.')[0])<22:die('Node 22+ is required.')
        endpoint=resolve_endpoint(root,args.signaling_url,args.local)
        changes=patch_sources(originals,endpoint,args.origin)
        runtime=package_files(root,args.doppler_tarball)
        for name in set(changes)-set(originals):
            if safe_path(root,name).exists():die(f'New repair path already exists: {name}. Refusing to overwrite it.')
        vendor_dir=root/'self/vendor/doppler'/VERSION
        if vendor_dir.exists():die(f'{vendor_dir} already exists. Refusing to replace an unreviewed vendored runtime.')
        print(f'\nReviewed source: {REVIEWED_COMMIT}\nBootstrap: {endpoint}')
        for name in sorted(changes):print(('MODIFY ' if name in originals else 'ADD    ')+name)
        print(f'ADD    self/vendor/doppler/{VERSION}/ ({len(runtime)} files)')
        print('REBUILD self/vendor/reploid and self/config/browser-bundle-manifest.json')
        print('\nPrivate invitation scopes and execution permissions are preserved. Public presence is automatic.')
        if not args.apply:
            print('DRY RUN: no repository files replaced. Add --apply after reviewing the list.');return
        changes.update(runtime)
        names=set(changes)|generated_paths(root)
        backup,record=backup_files(root,names,endpoint)
        print(f'Backup: {backup}')
        try:
            # Catch last-moment edits to reviewed inputs before replacing any source.
            for name,original in originals.items():
                if safe_path(root,name).read_text()!=original:die(f'Concurrent edit detected: {name}')
            for name,data in changes.items():atomic_write(safe_path(root,name),data)
            for name in sorted(changes):
                if name.endswith('.js') and not name.startswith(f'self/vendor/doppler/{VERSION}/'):
                    run(root,[node,'--check',str(safe_path(root,name))],timeout=30)
            run(root,[node,'scripts/sync-reploid-library.js'])
            run(root,[node,'--test','scripts/repair-checks/swarm-join.test.js'])
            run(root,[node,'scripts/build-browser-bundle-manifest.js'])
            run(root,[node,'scripts/build-browser-bundle-manifest.js','--check'])
        except BaseException:
            print('Repair failed; restoring the recorded source/generated files.',file=sys.stderr)
            restore_backup(root,backup,force_internal=True)
            raise
        for name,entry in record['files'].items():
            target=safe_path(root,name);entry['after']=sha(target.read_bytes()) if target.exists() else None
        (backup/'manifest.json').write_text(json.dumps(record,indent=2)+'\n')
        print('\nAPPLIED. No commit, publication or deployment was performed.')
        print('Next: deploy the changed backend and complete self/ Hosting tree, then reload the page.')
        print('The in-memory bootstrap requires one signaling process / one active revision for this bounded release.')
        print('Default public capacity: 64 peer connections, including separate consumer/provider identities.')
        print('Use your existing authorized TURN configuration for difficult NAT/firewall paths.')
        print('Post-deploy browser check: node scripts/verify-swarm-runtime.js https://replo.id')
        print(f'Restore: python3 {Path(__file__).resolve()} --repo {root} --restore {backup}')
    finally:
        lock_path.unlink(missing_ok=True)


if __name__=='__main__':
    try:main()
    except KeyboardInterrupt:
        print('Stopped.',file=sys.stderr);sys.exit(130)
    except Exception as error:
        print(f'ERROR: {error}',file=sys.stderr);sys.exit(1)
