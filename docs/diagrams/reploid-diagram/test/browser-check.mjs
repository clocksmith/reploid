// Browser interaction checks for the offline diagram page (Playwright, Chromium).
//   node test/browser-check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shot = name => ({ path: path.join(root, 'test', name) });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  const tab = name => page.getByRole('tab', { name, exact: true });
  const button = name => page.getByRole('button', { name, exact: true });
  const edges = () => page.locator('[data-edge]').count();
  await page.setContent(readFileSync(path.join(root, 'index.html'), 'utf8'));
  await page.waitForSelector('[data-node="A"]');
  assert.equal(await page.locator('[data-node]').count(), 3);
  assert.equal(await page.getByRole('tab').count(), 9);
  assert.equal(await page.evaluate('window.diagramEditor.getRenderer()'), 'svg');
  await page.screenshot(shot('ecosystem-preview.png'));
  await tab('Interfaces').click(); await page.waitForTimeout(150);
  assert.equal(await edges(), 6);
  await page.screenshot(shot('interfaces-preview.png'));
  await tab('Stream').click(); await page.waitForTimeout(150);
  assert.equal(await edges(), 10);
  await page.screenshot(shot('sequence-preview.png'));
  for (const [name, count] of [['Evolve', 7], ['Improve', 8], ['Placement', 3], ['Cancel', 10], ['Recover', 7], ['Adopt', 3]]) {
    await tab(name).click(); await page.waitForTimeout(100);
    assert.equal(await edges(), count, name);
  }
  await tab('Evolve').click(); await page.waitForTimeout(100);
  await page.screenshot(shot('runtime-improvement-preview.png'));
  await page.locator('[data-edge="rp-evaluate"] text').click();
  assert.match(await page.locator('#details').innerText(), /cannot self-approve/);
  const references = page.locator('#details-content a');
  assert.equal(await references.count(), 4);
  for (const link of await references.all()) {
    assert.ok((await link.getAttribute('href')).startsWith('https://github.com/clocksmith/reploid/blob/49425e01/'));
    assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
  }
  assert.match(await page.locator('#details').innerText(), /Retained results and unproved milestones/);
  await page.locator('#details-close').click();
  await tab('Products').click(); await page.waitForTimeout(100);
  await page.locator('[data-edge="A-B"]').click();
  assert.ok(await page.locator('#details').isVisible());
  await button('Interface contract').click();
  assert.equal(await tab('Interfaces').getAttribute('aria-selected'), 'true');
  await button('Edit JSON').click();
  await page.locator('#json-editor').fill('{"format":"wrong"}');
  await button('Validate and render').click();
  assert.match(await page.locator('#editor-error').innerText(), /Expected format/);
  await page.locator('#editor-cancel').click();
  await tab('Products').click(); await page.waitForTimeout(100);
  const before = await page.evaluate('window.diagramEditor.getJSON().views[0].nodes[0].x');
  const box = await page.locator('[data-node="A"]').boundingBox();
  const [x, y] = [box.x + 40, box.y + 40];
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 50, y + 20, { steps: 5 }); await page.mouse.up();
  assert.ok(await page.evaluate('window.diagramEditor.getJSON().views[0].nodes[0].x') > before);
  for (const [label, filename] of [['Export JSON', 'diagram.json'], ['Export SVG', 'ecosystem.svg']]) {
    const [download] = await Promise.all([page.waitForEvent('download'), button(label).click()]);
    assert.equal(download.suggestedFilename(), filename);
  }
  await page.setViewportSize({ width: 430, height: 932 });
  await button('Fit').click(); await page.waitForTimeout(100);
  assert.ok(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'));
  await page.screenshot(shot('mobile-preview.png'));
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
console.log('PASS: offline SVG; all 9 views; authority and evidence links; JSON validation; dragging; JSON/SVG export; mobile width; no uncaught page errors.');
