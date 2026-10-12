import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root = '/var/tmp/reploid-cleanup-failure-20261012/self';
const output = new URL('./result.json', import.meta.url);
const receipt = { startedAt: new Date().toISOString(), sourceCommit: 'f7757a81',
  scope: 'Physical browser resident cleanup rejection and explicit UI Retry stopping; pinned-manifest opening',
  fault: 'Reject the first armed resident close before releasing resources; retry calls the original close', resources: [] };
const context = await chromium.launchPersistentContext('/var/tmp/reploid-cleanup-failure-20261012/profile', {
  channel: 'chrome', headless: true, serviceWorkers: 'block', args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
const page = context.pages()[0] || await context.newPage();
let closeCalled = false;
try {
  const originalIndex = await readFile(path.join(root, 'pool-entry.html'));
  const servedIndex = Buffer.from(await (await fetch('http://localhost:8000/')).arrayBuffer());
  expect(servedIndex.equals(originalIndex)).toBe(true);
  receipt.documentSha256 = createHash('sha256').update(servedIndex).digest('hex');
  await context.route('http://localhost:8000/**', async route => {
    const u = new URL(route.request().url());
    // Preserve the real document response's local address-space classification.
    if (route.request().isNavigationRequest()) return route.continue();
    const rel = u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname).slice(1);
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + '/')) return route.abort();
    if (!(await stat(file).catch(() => null))?.isFile()) return route.continue();
    const body = await readFile(file);
    receipt.resources.push({ path: rel, sha256: createHash('sha256').update(body).digest('hex') });
    const ext = path.extname(file);
    const type = { '.js': 'text/javascript', '.json': 'application/json', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.wgsl': 'text/plain' }[ext] || 'application/octet-stream';
    await route.fulfill({ body, contentType: type });
  });
  const source = (await readFile(path.join(root, 'host/work-partitions.js'), 'utf8')).split('\n');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Debugger.enable');
  const breakpoint = await cdp.send('Debugger.setBreakpointByUrl', {
    urlRegex: '/host/work-partitions\\.js$', lineNumber: source.findIndex(line => line.includes('return { runtime, model, plan')) });
  const observationErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') (receipt.consoleErrors ||= []).push(msg.text()); });
  page.on('pageerror', error => (receipt.pageErrors ||= []).push(error.stack));
  cdp.on('Debugger.paused', async event => {
    if (!event.hitBreakpoints.includes(breakpoint.breakpointId)) return;
    try {
      const observed = await cdp.send('Debugger.evaluateOnCallFrame', {
        callFrameId: event.callFrames[0].callFrameId, returnByValue: true,
        expression: `(() => {
          const owned = resident;
          const fault = { owned, runtime, calls: 0, armed: false, rejected: 0, participantId, preparation };
          (globalThis.__cleanupFaults ||= []).push(fault);
          resident = Object.freeze({ ...owned, close() {
            fault.calls++;
            if (fault.armed) { fault.armed = false; fault.rejected++; return Promise.reject(new Error('Injected resident cleanup rejection before release')); }
            return owned.close();
          }});
          return { participantId, descriptor: owned.getState().descriptor, preparation };
        })()`
      });
      if (observed.exceptionDetails) throw Error(JSON.stringify(observed.exceptionDetails));
      (receipt.preparations ||= []).push(observed.result.value);
    } catch (e) { observationErrors.push(e.stack); }
    finally { await cdp.send('Debugger.resume').catch(() => {}); }
  });
  await page.goto('http://localhost:8000/');
  await page.locator('[data-chat-workspace]').waitFor();
  await page.locator('[data-toggle-inspector]').click();
  await page.locator('[data-inspector-section="device"]').click();
  await page.locator('[data-contribution-model]').selectOption('qwen-3-5-0-8b-q4k-ehaf16');
  await page.locator('[data-toggle-contribution]').click();
  await expect(page.locator('[data-contrib-label]')).toHaveText('Ready', { timeout: 180000 });
  expect(observationErrors).toEqual([]);
  const snapshot = () => page.evaluate(() => ({
    label: document.querySelector('[data-contrib-label]').textContent,
    toggleDisabled: document.querySelector('[data-toggle-contribution]').disabled,
    retryHidden: document.querySelector('[data-retry-contribution-stop]').hidden,
    error: document.querySelector('[data-network-message]').textContent,
    faults: (globalThis.__cleanupFaults || []).map(f => ({ calls: f.calls, rejected: f.rejected,
      state: f.owned.getState(), memory: f.runtime.inspectDeviceMemory() }))
  }));
  receipt.ready = await snapshot();
  expect(receipt.ready.faults).toHaveLength(1);
  expect(receipt.ready.faults[0].state.descriptor.index).toBe(1);
  await page.evaluate(() => { globalThis.__cleanupFaults[0].armed = true; });
  await page.locator('[data-toggle-contribution]').click();
  await expect(page.locator('[data-retry-contribution-stop]')).toBeVisible({ timeout: 30000 });
  receipt.failedStop = await snapshot();
  expect(receipt.failedStop.label).toBe('Cleanup not confirmed');
  expect(receipt.failedStop.toggleDisabled).toBe(true);
  expect(receipt.failedStop.faults[0].calls).toBe(1);
  expect(receipt.failedStop.faults[0].rejected).toBe(1);
  expect(receipt.failedStop.faults[0].state.descriptor.residentWeightBytes).toBeGreaterThan(0);
  await page.locator('[data-retry-contribution-stop]').click();
  await expect(page.locator('[data-contrib-label]')).toHaveText('Not sharing', { timeout: 30000 });
  receipt.retriedStop = await snapshot();
  expect(receipt.retriedStop.faults[0].calls).toBe(2);
  expect(receipt.retriedStop.faults[0].state.phase).toBe('closed');
  expect(receipt.retriedStop.toggleDisabled).toBe(false);
  expect(receipt.retriedStop.retryHidden).toBe(true);
  await page.locator('[data-toggle-contribution]').click();
  await expect(page.locator('[data-contrib-label]')).toHaveText('Ready', { timeout: 180000 });
  receipt.replacement = await snapshot();
  expect(receipt.replacement.faults).toHaveLength(2);
  expect(receipt.replacement.faults[1].calls).toBe(0);
  expect(receipt.replacement.faults[1].state.phase).toBe('ready');
  await page.locator('[data-toggle-contribution]').click();
  await expect(page.locator('[data-contrib-label]')).toHaveText('Not sharing', { timeout: 30000 });
  receipt.finalStop = await snapshot();
  expect(receipt.finalStop.faults[0].calls).toBe(2);
  expect(receipt.finalStop.faults[1].calls).toBe(1);
  expect(receipt.finalStop.faults[1].state.phase).toBe('closed');
  receipt.ok = true;
} catch (error) {
  receipt.ok = false; receipt.error = error.stack;
  receipt.screen = await page.locator('body').innerText().catch(() => null);
} finally {
  receipt.finishedAt = new Date().toISOString();
  await context.close(); closeCalled = true;
  receipt.contextClosed = closeCalled;
  await writeFile(output, JSON.stringify(receipt, null, 2) + '\n');
}
console.log(JSON.stringify({ ok: receipt.ok, error: receipt.error, preparations: receipt.preparations?.length }));
process.exitCode = receipt.ok ? 0 : 1;
