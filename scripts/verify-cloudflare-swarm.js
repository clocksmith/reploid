#!/usr/bin/env node
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

// Exercise the existing application, never a replacement inference/demo page.
// Before cutover, override only the migration modules and policy in isolated contexts.
const args = new Set(process.argv.slice(2));
const staged = !args.has('--deployed');
const discoveryOnly = args.has('--discovery-only');
const endpoint = 'https://reploid-swarm.reploid.workers.dev';
const policy = JSON.parse(await readFile('self/config/swarm-bootstrap.json', 'utf8'));
const browser = await chromium.launch({ headless: true });
const contexts = [], pages = [], joins = [], unexpected = [], credentialChecks = [];
const record = { staged, discoveryOnly, physicalDevices: 1, browserContexts: 3,
  discoveryEndpoint: endpoint, credentialIssuer: discoveryOnly ? 'existing Poolday endpoint' : endpoint,
  credentialResponses: [], startedAt: new Date().toISOString() };
const output = `artifacts/cloudflare-2026-09-26/${staged ? 'staged' : 'deployed'}-${discoveryOnly ? 'discovery' : 'turn'}.json`;
try {
  const health = await fetch(endpoint + '/health');
  assert.equal(health.status, 200);
  record.worker = await health.json();
  for (let i = 0; i < 3; i++) {
    const context = await browser.newContext(); contexts.push(context);
    await context.addInitScript(({ forceRelay }) => {
      window.REPLOID_POOL_FORCE_RELAY = forceRelay;
      window.__migrationConnections = []; window.__migrationSockets = []; window.__migrationIceErrors = [];
      const Peer = window.RTCPeerConnection, Socket = window.WebSocket;
      window.RTCPeerConnection = class extends Peer {
        constructor(...args) {
          super(...args); window.__migrationConnections.push(this);
          this.addEventListener('icecandidateerror', event => window.__migrationIceErrors.push({ code: event.errorCode, url: event.url }));
        }
      };
      window.WebSocket = class extends Socket {
        constructor(...args) { super(...args); window.__migrationSockets.push(this); }
      };
    }, { forceRelay: !discoveryOnly });
    if (staged) {
      await context.route('**/config/swarm-bootstrap.json*', route => route.fulfill({
        contentType: 'application/json', body: JSON.stringify({ ...policy,
          signalingUrl: endpoint.replace('https:', 'wss:') + '/swarm',
          rtcConfigUrl: discoveryOnly ? null : endpoint + '/rtc-config' })
      }));
      for (const path of ['pool/sdk.js', 'capabilities/communication/swarm-join-policy.js', 'vendor/reploid/transport/swarm.js']) {
        const body = await readFile('self/' + path, 'utf8');
        await context.route(`**/${path}*`, route => route.fulfill({ contentType: 'text/javascript', body }));
      }
    } else {
      assert.equal(policy.signalingUrl, endpoint.replace('https:', 'wss:') + '/swarm');
      if (!discoveryOnly) assert.equal(policy.rtcConfigUrl, endpoint + '/rtc-config');
    }
    const page = await context.newPage(); pages.push(page); joins.push([]);
    page.on('response', response => {
      if (response.url() !== endpoint + '/rtc-config' || response.request().method() !== 'GET') return;
      credentialChecks.push((async () => {
        const payload = await response.json().catch(() => ({}));
        record.credentialResponses.push({ status: response.status(), code: payload.code, ttlSeconds: payload.ttlSeconds,
          noStore: response.headers()['cache-control'] === 'no-store',
          urls: payload.rtcConfig?.iceServers?.flatMap(server => server.urls) });
      })());
    });
    page.on('request', request => {
      const url = new URL(request.url());
      if (/shard_.*\.bin|\.safetensors|\.gguf/.test(url.pathname)) unexpected.push(url.pathname);
    });
    page.on('websocket', socket => {
      if (!socket.url().startsWith(endpoint.replace('https:', 'wss:') + '/swarm')) return;
      socket.on('framereceived', frame => {
        try { const msg = JSON.parse(String(frame.payload)); if (msg.type === 'joined') joins[i].push(msg); } catch {}
      });
    });
  }
  const waitPeer = page => page.waitForFunction(() => Number.parseInt(document.querySelector('[data-mesh-peers]')?.textContent) >= 1, null, { timeout: 60000 });
  await Promise.all(pages.slice(0, 2).map(page => page.goto('https://replo.id/', { waitUntil: 'domcontentloaded' })));
  for (const page of pages.slice(0, 2)) {
    await waitPeer(page);
    assert.equal(await page.locator('[data-contrib-label]').textContent(), 'Not sharing');
  }
  for (const joined of joins.slice(0, 2)) assert.equal(joined.at(-1).roomId, policy.publicRoomId);
  record.automaticDiscovery = true;
  record.candidatePairs = await pages[0].evaluate(async () => {
    const deadline = Date.now() + 10000;
    // ICE statistics can lag the data-channel-open event. Require an actual
    // selected/nominated successful pair with bytes, not merely a UI peer count.
    do {
      const pairs = [];
      for (const pc of window.__migrationConnections) {
        const stats = await pc.getStats();
        const selected = new Set([...stats.values()].filter(stat => stat.type === 'transport').map(stat => stat.selectedCandidatePairId));
        for (const stat of stats.values()) if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && (stat.nominated || selected.has(stat.id))) {
          const local = stats.get(stat.localCandidateId), remote = stats.get(stat.remoteCandidateId);
          pairs.push({ local: local?.candidateType, remote: remote?.candidateType, relayProtocol: local?.relayProtocol || null,
            bytesSent: stat.bytesSent, bytesReceived: stat.bytesReceived });
        }
      }
      if (pairs.some(pair => pair.bytesSent > 0 && pair.bytesReceived > 0)) return pairs;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    return [];
  });
  assert.ok(record.candidatePairs.some(pair => pair.bytesReceived > 0 && pair.bytesSent > 0));
  if (!discoveryOnly) assert.ok(record.candidatePairs.some(pair => pair.local === 'relay' && pair.remote === 'relay'));
  const room = 'migration-' + randomUUID();
  await pages[2].goto(`https://replo.id/?swarm=${room}&swarmToken=${randomUUID()}${randomUUID()}`, { waitUntil: 'domcontentloaded' });
  const privateDeadline = Date.now() + 30000;
  while (!joins[2].length && Date.now() < privateDeadline) await pages[2].waitForTimeout(250);
  assert.equal(joins[2].at(-1)?.roomId, 'reploid-swarm-' + room);
  assert.equal(joins[2].at(-1)?.peers.length, 0);
  assert.equal(await pages[2].locator('[data-mesh-peers]').textContent(), '0 peers');
  record.privateIsolation = true;
  await pages[0].locator('[data-toggle-inspector]').click();
  await pages[0].locator('[data-mesh-connect]').click();
  const before = joins[0].length;
  await pages[0].waitForTimeout(12000);
  assert.equal(joins[0].length, before);
  await pages[0].reload({ waitUntil: 'domcontentloaded' }); await pages[0].locator('[data-chat-workspace]').waitFor();
  await pages[0].waitForTimeout(1500); assert.equal(joins[0].length, before);
  record.disconnectPersists = true;
  if (!await pages[0].locator('[data-mesh-connect]').isVisible()) await pages[0].locator('[data-toggle-inspector]').click();
  await pages[0].locator('[data-mesh-connect]').click(); await waitPeer(pages[0]);
  const beforeInterruption = joins[0].length;
  await contexts[0].setOffline(true);
  await pages[0].evaluate(() => { for (const ws of window.__migrationSockets) ws.close(); });
  await pages[0].waitForTimeout(2000); await contexts[0].setOffline(false);
  const deadline = Date.now() + 60000;
  while (joins[0].length === beforeInterruption && Date.now() < deadline) await pages[0].waitForTimeout(250);
  assert.ok(joins[0].length > beforeInterruption); await waitPeer(pages[0]);
  record.networkRecovery = true;
  assert.deepEqual(unexpected, []); record.implicitModelDownloads = 0;
  await Promise.all(credentialChecks);
  if (!discoveryOnly) {
    assert.ok(record.credentialResponses.length >= 2);
    assert.ok(record.credentialResponses.every(response => response.status === 200
      && response.ttlSeconds === 600 && response.noStore));
  }
  record.passed = true;
} catch (error) {
  record.passed = false;
  record.connections = await Promise.all(pages.map(page => page.evaluate(async () => ({
    iceErrors: window.__migrationIceErrors,
    peers: await Promise.all((window.__migrationConnections || []).map(async pc => {
      const stats = await pc.getStats();
      return { connection: pc.connectionState, ice: pc.iceConnectionState, gathering: pc.iceGatheringState,
        candidates: [...stats.values()].filter(stat => ['local-candidate', 'remote-candidate'].includes(stat.type))
          .map(stat => ({ type: stat.type, candidateType: stat.candidateType, protocol: stat.protocol, relayProtocol: stat.relayProtocol })),
        pairs: [...stats.values()].filter(stat => stat.type === 'candidate-pair').map(stat => ({ state: stat.state, nominated: stat.nominated,
          sent: stat.bytesSent, received: stat.bytesReceived })) };
    }))
  })).catch(() => ({ unavailable: true }))));
  // Do not retain console logs, credentials, capabilities, SDP or candidate IPs.
  record.error = error.message.replace(/https?:\/\/\S+/g, '[URL]');
  process.exitCode = 1;
} finally {
  await Promise.allSettled(credentialChecks);
  await Promise.all(contexts.map(context => context.close())); await browser.close();
  await mkdir('artifacts/cloudflare-2026-09-26', { recursive: true });
  await writeFile(output, JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify(record, null, 2));
  console.log('Evidence:', output);
}
