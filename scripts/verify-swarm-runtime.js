#!/usr/bin/env node
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import pin from '../shared/config/doppler-package.json' with { type: 'json' };

const index = process.argv.indexOf('--url');
const base = index >= 0 ? process.argv[index + 1] : 'http://localhost:8000';
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu'] });
const contexts = [];
const pages = [];
const joins = [];
try {
  for (let i = 0; i < 3; i++) {
    const context = await browser.newContext(); contexts.push(context);
    await context.addInitScript(() => {
      window.__swarmConnections = []; window.__swarmChannels = [];
      const Peer = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends Peer {
        constructor(...args) {
          super(...args); window.__swarmConnections.push(this);
          this.addEventListener('datachannel', event => window.__swarmChannels.push(event.channel));
        }
        createDataChannel(...args) {
          const channel = super.createDataChannel(...args); window.__swarmChannels.push(channel); return channel;
        }
      };
    });
    const page = await context.newPage(); pages.push(page); joins.push([]);
    page.on('websocket', socket => socket.on('framereceived', frame => {
      try { const message = JSON.parse(String(frame.payload)); if (message.type === 'joined') joins[i].push(message); } catch {}
    }));
  }
  await pages[0].goto(new URL('/repair-smoke.html', base).href);
  const assets = await pages[0].evaluate(() => window.repairReady);
  assert.equal(assets.version, pin.version);
  console.log('Pinned module graph and shaders:', assets);
  const missing = await pages[0].request.get(new URL(`/vendor/doppler/${pin.version}/src/missing-runtime-module.js`, base).href);
  assert.equal(missing.status(), 404);
  await Promise.all(pages.slice(0, 2).map((page, i) => page.goto(new URL(i === 0
    ? '/?room=reploid-default&reploidBootRetry=2026091901' : '/?room=another-application-room', base).href)));
  // Protocol first: a signaling `joined` frame and an open RTCPeerConnection with an
  // open data channel; then the rail summary must read "<n> connected" with n >= 1.
  for (const [i, page] of pages.slice(0, 2).entries()) {
    const deadline = Date.now() + 60000;
    while (!joins[i].length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 250));
    await page.waitForFunction(() => window.__swarmConnections.some(pc => pc.connectionState === 'connected')
      && window.__swarmChannels.some(channel => channel.readyState === 'open'), null, { timeout: 60000 });
    await page.waitForFunction(() => Number(/^(\d+) connected/.exec(document.querySelector('[data-rail-digest="participants"]')?.textContent || '')?.[1]) >= 1,
      null, { timeout: 30000 });
    // Cached sharing is the default (dda9e4692): the toggle is on, and with no
    // downloaded model in a fresh profile the label waits for one.
    await page.waitForFunction(() => document.querySelector('[data-contrib-label]')?.textContent === 'On · waiting for a downloaded model',
      null, { timeout: 30000 });
    assert.equal(await page.locator('[data-toggle-contribution]').getAttribute('aria-checked'), 'true');
  }
  assert.equal(joins[0].at(-1).roomId, 'reploid-swarm-public');
  assert.equal(joins[1].at(-1).roomId, 'reploid-swarm-public');
  console.log('Normal application startup: public WebRTC peers discovered automatically, cached sharing on by default.');
  await pages[2].goto(new URL('/?swarm=repair-private&swarmToken=repair-private-capability-0123456789abcdef', base).href);
  await pages[2].waitForFunction(() => document.querySelector('[data-mesh-connect]')?.dataset.disconnect === 'true');
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert.equal(joins[2].at(-1)?.roomId, 'reploid-swarm-repair-private');
  await pages[2].waitForFunction(() => /^0 connected/.test(document.querySelector('[data-rail-digest="participants"]')?.textContent || ''),
    null, { timeout: 30000 });
  assert.equal(await pages[2].evaluate(() => window.__swarmChannels.filter(channel => channel.readyState === 'open').length), 0);
  await pages[0].locator('[data-toggle-inspector]').click();
  await pages[0].locator('[data-mesh-connect]').click();
  const count = joins[0].length;
  await new Promise(resolve => setTimeout(resolve, 12000));
  assert.equal(joins[0].length, count);
  assert.equal(await pages[0].locator('[data-mesh-connect]').getAttribute('aria-checked'), 'false');
  await pages[0].reload();
  await pages[0].locator('[data-chat-workspace]').waitFor();
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert.equal(joins[0].length, count);
  console.log('Private namespace isolation and manual disconnect/reload opt-out passed.');
  console.log('Evidence: three isolated browser contexts on one machine, not two physical devices; no inference exercised.');
} finally {
  await Promise.all(contexts.map(context => context.close()));
  await browser.close();
}
