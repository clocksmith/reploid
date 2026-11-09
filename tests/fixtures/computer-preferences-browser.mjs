/** Controlled peer-verifier fixture; actual local GPU and persisted browser controls. */
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const root = path.resolve('.firebase-hosting/reploid');
const output = path.resolve(process.env.REPLOID_COMPUTER_UI_OUTPUT || '.cache/computer-preferences-browser');
await mkdir(output, { recursive: true });
const layers = JSON.parse(await readFile('apps/poolday/styles/poolday/layers.json', 'utf8'));
const html = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
  + [layers.tokens, ...layers.primitives, ...layers.compositions]
  .map(file => `<link rel="stylesheet" href="/styles/poolday/${file}">`).join('')
  + '<main class="pool-home" data-pool-theme="dark" id="fixture"></main>';
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const file = path.resolve(root, '.' + url.pathname);
    assert(file.startsWith(root + '/'));
    const bytes = await readFile(file);
    response.writeHead(200, { 'Content-Type': file.endsWith('.css') ? 'text/css'
      : file.endsWith('.js') ? 'text/javascript' : 'application/json' }).end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = process.env.REPLOID_COMPUTER_UI_ORIGIN || `http://127.0.0.1:${server.address().port}`;
let context;
const errors = [], origins = new Set(), runs = [];
async function mount() {
  context = await chromium.launchPersistentContext(path.join(output, 'profile'), {
    channel: 'chrome', headless: true, viewport: { width: 1100, height: 1000 }
  });
  await context.route(origin + '/computer-ui-fixture', route => route.fulfill({ contentType: 'text/html', body: html }));
  const page = context.pages()[0];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) origins.add(new URL(request.url()).origin); });
  await page.goto(origin + '/computer-ui-fixture');
  await page.evaluate(async () => {
    const { createComputerPreferences } = await import('/host/computer-preferences.js');
    const { captureGpuSignature } = await import('/vendor/reploid/mesh/gpu-signature.js');
    const { renderConnectionControl, renderSharingControls, bindNetworkControls } = await import('/ui/pool-home/network-controls.js');
    const { renderComputerDiagnostic } = await import('/ui/pool-home/computer-preferences.js');
    const key = 'peer:' + 'a'.repeat(24);
    window.__captures = 0; window.__measurements = [];
    window.__preferences = createComputerPreferences({ storage: localStorage, verifyPeer: async () => key,
      capture: async (...args) => {
        window.__captures++;
        const measurement = await captureGpuSignature(...args);
        window.__measurements.push(measurement);
        return measurement;
      } });
    const state = { models: [], threads: [], network: { consumer: { peerId: 'self', connectionState: 'connected',
      peers: [{ peerId: 'wire', participantId: key, identityVerified: true, readiness: 'ready', model: 'fixture-model' }] } } };
    const session = { getState: () => state, subscribe: listener => { listener(state); return () => {}; } };
    const mount = document.getElementById('fixture');
    mount.innerHTML = renderConnectionControl() + renderSharingControls()
      + '<ul data-insp-device-list></ul><p data-network-message></p><button data-mesh-invite hidden></button>'
      + renderComputerDiagnostic();
    bindNetworkControls(mount, session, { computers: window.__preferences });
  });
  return page;
}
async function capture(page) {
  await page.locator('[data-computer-diagnostic] summary').click();
  await page.locator('[data-gpu-check]').click();
  await page.waitForFunction(() => window.__preferences.getState().canSave, null, { timeout: 15000 });
  const run = await page.evaluate(() => ({ state: window.__preferences.getState(), capture: window.__measurements[0] }));
  assert(run.capture.hardware?.vendor, 'GPU identity must be reported');
  assert(!/swiftshader|llvmpipe|software/i.test(JSON.stringify(run.capture.hardware)), 'Physical GPU required');
  runs.push(run);
}
try {
  let page = await mount();
  assert.equal(await page.evaluate(() => window.__captures), 0);
  assert.match(await page.locator('[data-computer-auth]').textContent(), /Authenticated identity observed/);
  await page.locator('[data-computer-id="wire"] details summary').click();
  await page.locator('[data-computer-name-input]').fill('Kitchen workstation');
  await page.locator('[data-computer-rename] button').click();
  await page.waitForFunction(() => document.querySelector('[data-computer-name]').textContent === 'Kitchen workstation');
  await capture(page);
  await page.locator('[data-gpu-save]').click();
  await page.waitForFunction(() => !!window.__preferences.getState().baselineAt);
  await page.screenshot({ path: path.join(output, 'baseline-desktop.png') });
  await page.locator('[data-computer-diagnostic]').screenshot({ path: path.join(output, 'diagnostic-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(output, 'baseline-390.png') });
  await page.locator('[data-computer-diagnostic]').screenshot({ path: path.join(output, 'diagnostic-390.png') });
  await page.locator('[data-computer-id="wire"]').screenshot({ path: path.join(output, 'nickname-390.png') });
  await context.close(); context = null;
  page = await mount();
  assert.equal(await page.evaluate(() => window.__captures), 0);
  assert.equal(await page.locator('[data-computer-name]').textContent(), 'Kitchen workstation');
  assert(await page.evaluate(() => !!window.__preferences.getState().baselineAt));
  await capture(page);
  const comparison = runs[1].state.comparison;
  assert.equal(comparison.status, 'uncertain'); assert.equal(comparison.reason, 'calibration-required');
  await page.locator('[data-gpu-clear]').click();
  assert.equal(await page.evaluate(() => window.__preferences.getState().baselineAt), null);
  assert.deepEqual(errors, []); assert.deepEqual([...origins], [origin]);
  await writeFile(path.join(output, 'recordings.json'), JSON.stringify(runs, null, 2));
  const hosted = !!process.env.REPLOID_COMPUTER_UI_ORIGIN;
  const artifact = async file => hosted ? new Uint8Array(await (await fetch(origin + '/' + file, { cache: 'no-store' })).arrayBuffer()) : readFile(path.join(root, file));
  const bundle = JSON.parse(new TextDecoder().decode(await artifact('config/browser-bundle-manifest.json')));
  const sources = {};
  for (const file of ['host/computer-preferences.js', 'ui/pool-home/computer-preferences.js',
    'ui/pool-home/network-controls.js', 'vendor/reploid/mesh/gpu-signature.js']) {
    sources[file] = createHash('sha256').update(await artifact(file)).digest('hex');
  }
  const receipt = { scope: 'Controlled identity-verifier fixture; physical GPU UI captures; browser restart, not OS reboot.',
    browser: context.browser().version(), origin, bundleHash: bundle.bundleHash, sources, noAutomaticCapture: true, renamePersisted: true,
    baselinePersistedAcrossBrowserRestart: true, baselineCleared: true, viewport390WithoutOverflow: true,
    measurements: runs.map(run => ({ status: run.capture.status, hardware: run.capture.hardware,
      elapsedMs: run.capture.elapsedMs, allocationBytes: run.capture.allocationBytes })), comparison, errors,
    unqualified: ['Driver changes', 'Different GPUs of the same model', 'OS reboot', 'Controlled load variation',
      'False-match and missed-match rates', 'Fabricated-response recognition resistance'] };
  await writeFile(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
} finally { await context?.close(); await new Promise(resolve => server.close(resolve)); }
