#!/usr/bin/env node
/**
 * Two fresh browsers open a served Reploid page with relay-only ICE and must reach each other, or a
 * mesh peer, through Cloudflare TURN: a selected candidate pair whose local side is a relay candidate,
 * with bytes sent and received, and every credential response from the configured issuer a 200 with a
 * 600-second TTL and no-store. Nothing is downloaded or contributed; no prompt is sent.
 *
 *   node scripts/cloudflare/verify-turn-relay.js [--url https://replo.id] [--timeout-seconds 90]
 */
/* global window, localStorage */
import { chromium } from 'playwright';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { url: { type: 'string', default: 'https://replo.id' }, 'timeout-seconds': { type: 'string', default: '90' } } });
const deadlineMs = Number(values['timeout-seconds']) * 1000;
const browser = await chromium.launch({ headless: true });
const record = { url: values.url, startedAt: new Date().toISOString(), credentialResponses: [], pages: [] };
try {
  const pages = [];
  for (let index = 0; index < 2; index += 1) {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      window.REPLOID_POOL_FORCE_RELAY = true;
      localStorage.setItem('reploid.auto-download.v1', 'off');
      window.__relayConnections = [];
      const Peer = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends Peer {
        constructor(config, ...rest) { super({ ...(config || {}), iceTransportPolicy: 'relay' }, ...rest); window.__relayConnections.push(this); }
      };
    });
    const page = await context.newPage();
    page.on('response', async (response) => {
      if (!/\/rtc-config$/.test(new URL(response.url()).pathname) || response.request().method() !== 'GET') return;
      const payload = await response.json().catch(() => ({}));
      record.credentialResponses.push({ url: new URL(response.url()).origin, status: response.status(), ttlSeconds: payload.ttlSeconds,
        noStore: response.headers()['cache-control'] === 'no-store', urls: payload.rtcConfig?.iceServers?.flatMap((server) => server.urls) });
    });
    pages.push(page);
  }
  await Promise.all(pages.map((page) => page.goto(values.url, { waitUntil: 'domcontentloaded' })));
  const relayPairs = (page) => page.evaluate(async () => {
    const pairs = [];
    for (const pc of window.__relayConnections) {
      const stats = await pc.getStats();
      const selected = new Set([...stats.values()].filter((stat) => stat.type === 'transport').map((stat) => stat.selectedCandidatePairId));
      for (const stat of stats.values()) {
        if (stat.type !== 'candidate-pair' || stat.state !== 'succeeded' || !(stat.nominated || selected.has(stat.id))) continue;
        const local = stats.get(stat.localCandidateId), remote = stats.get(stat.remoteCandidateId);
        pairs.push({ local: local?.candidateType, remote: remote?.candidateType, relayProtocol: local?.relayProtocol || null,
          relayUrl: local?.url || null, bytesSent: stat.bytesSent, bytesReceived: stat.bytesReceived });
      }
    }
    return { connections: window.__relayConnections.length, pairs };
  });
  const until = Date.now() + deadlineMs;
  let results = [];
  do {
    await pages[0].waitForTimeout(2000);
    results = await Promise.all(pages.map(relayPairs));
  } while (Date.now() < until && !results.every((result) => result.pairs.some((pair) => pair.local === 'relay' && pair.bytesSent > 0 && pair.bytesReceived > 0)));
  record.pages = results;
  const relayed = results.every((result) => result.pairs.some((pair) => pair.local === 'relay' && pair.bytesSent > 0 && pair.bytesReceived > 0));
  const credentials = record.credentialResponses.length >= 2 && record.credentialResponses.every((response) => response.status === 200 && response.ttlSeconds === 600 && response.noStore
    && response.urls?.every((url) => /\.cloudflare\.com:/.test(url)));
  record.passed = relayed && credentials;
  record.failed = [...(relayed ? [] : ['no relayed candidate pair with bytes in both browsers']), ...(credentials ? [] : ['credential responses'])];
} catch (error) {
  record.passed = false;
  record.failed = [error.message];
} finally {
  await browser.close();
}
console.log(JSON.stringify(record));
process.exitCode = record.passed ? 0 : 1;
