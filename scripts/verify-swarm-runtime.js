#!/usr/bin/env node
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const index = process.argv.indexOf('--url');
const base = index >= 0 ? process.argv[index + 1] : 'http://localhost:8000';
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu'] });
const contexts = [];
const pages = [];
const joins = [];
try {
  for (let i = 0; i < 3; i++) {
    const context = await browser.newContext(); contexts.push(context);
    const page = await context.newPage(); pages.push(page); joins.push([]);
    page.on('websocket', socket => socket.on('framereceived', frame => {
      try { const message = JSON.parse(String(frame.payload)); if (message.type === 'joined') joins[i].push(message); } catch {}
    }));
  }
  await pages[0].goto(new URL('/repair-smoke.html', base).href);
  const assets = await pages[0].evaluate(() => window.repairReady);
  assert.equal(assets.version, '0.6.2');
  console.log('Pinned module graph and shaders:', assets);
  const missing = await pages[0].request.get(new URL('/vendor/doppler/0.6.2/src/missing-runtime-module.js', base).href);
  assert.equal(missing.status(), 404);
  await Promise.all(pages.slice(0, 2).map(page => page.goto(new URL('/', base).href)));
  for (const page of pages.slice(0, 2)) {
    await page.waitForFunction(() => Number.parseInt(document.querySelector('[data-mesh-peers]')?.textContent) >= 1, null, { timeout: 60000 });
    assert.equal(await page.locator('[data-contrib-label]').textContent(), 'Not sharing');
  }
  assert.equal(joins[0].at(-1).roomId, 'reploid-swarm-public');
  assert.equal(joins[1].at(-1).roomId, 'reploid-swarm-public');
  console.log('Normal application startup: public WebRTC peers discovered automatically, contribution off.');
  await pages[2].goto(new URL('/?swarm=repair-private&swarmToken=repair-private-capability-0123456789abcdef', base).href);
  await pages[2].waitForFunction(() => document.querySelector('[data-mesh-connect]')?.dataset.disconnect === 'true');
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert.equal(joins[2].at(-1)?.roomId, 'reploid-swarm-repair-private');
  assert.equal(await pages[2].locator('[data-mesh-peers]').textContent(), '0 peers');
  await pages[0].locator('[data-toggle-inspector]').click();
  await pages[0].locator('[data-mesh-connect]').click();
  const count = joins[0].length;
  await new Promise(resolve => setTimeout(resolve, 12000));
  assert.equal(joins[0].length, count);
  assert.equal(await pages[0].locator('[data-mesh-connect]').textContent(), 'Connect');
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
