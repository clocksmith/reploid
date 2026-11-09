/** Focused physical probe. No models, accounts, discovery or production services. */
import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(root, process.argv[2] || '.cache/computer-identity');
const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Computer identity probe</title>'); return; }
  if (!pathname.startsWith('/packages/reploid/src/') || !/\.(js|json)$/.test(pathname)) {
    response.writeHead(404).end(); return;
  }
  const file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(path.join(root, 'packages/reploid/src/'))) { response.writeHead(404).end(); return; }
  try {
    const bytes = await readFile(file);
    response.setHeader('Content-Type', pathname.endsWith('.json') ? 'application/json' : 'text/javascript');
    response.end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(async () => {
    const { captureGpuSignature, compareGpuSignatures } = await import('/packages/reploid/src/mesh/gpu-signature.js');
    const policy = (await import('/packages/reploid/src/mesh/gpu-signature.policy.json', { with: { type: 'json' } })).default;
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter || adapter.info.isFallbackAdapter !== false) throw Error('Physical GPU required');
    const hardware = Object.fromEntries(['vendor', 'architecture', 'device', 'description', 'isFallbackAdapter'].map(key => [key, adapter.info[key]]));
    const device = await adapter.requestDevice(), gpuErrors = [];
    device.addEventListener('uncapturederror', event => gpuErrors.push(event.error.message));
    const check = (condition, message) => { if (!condition) throw Error(message); };
    try {
      const first = await captureGpuSignature(device, { consent: true });
      const second = await captureGpuSignature(device, { consent: true });
      const owned = await captureGpuSignature(null, { consent: true });
      check(first.status === 'measured' && second.status === 'measured' && owned.status === 'measured', 'Probe missing');
      // Independent CPU execution checks that tickets accompany actual work.
      const expected = (seed, workload, group) => {
        let checksum = 0;
        for (let lane = 0; lane < policy.lanes; lane++) {
          let value = (seed ^ Math.imul(group, 747796405) ^ lane) >>> 0;
          for (let i = 0; i < policy.iterations; i++) {
            value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
            if (workload === 1) value = (value ^ Math.imul((value & (policy.dataWords - 1)) + 1, 2654435761)) >>> 0;
            value = (value ^ (value >>> 16)) >>> 0;
          }
          checksum = (checksum ^ value) >>> 0;
        }
        return checksum;
      };
      let checked = 0;
      for (const recording of [first, second, owned]) for (const sample of recording.samples) {
        const checksums = Array.from({ length: policy.workgroups }, (_, group) => expected(sample.seed, sample.workload, group));
        for (const row of sample.checksums) for (let group = 0; group < row.length; group++) {
          check(row[group] === checksums[group], 'GPU checksum differs from CPU'); checked++;
        }
      }
      const controller = new AbortController();
      const queue = new Proxy(device.queue, { get(target, key) {
        if (key === 'submit') return (...args) => { target.submit(...args); controller.abort(new Error('probe-stop')); };
        const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
      } });
      const borrowed = new Proxy(device, { get(target, key) {
        if (key === 'queue') return queue;
        const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
      } });
      let cancelled = false;
      try { await captureGpuSignature(borrowed, { consent: true, signal: controller.signal }); }
      catch (error) { cancelled = error.message === 'probe-stop'; }
      check(cancelled, 'Mid-dispatch cancellation missing');
      const buffer = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      device.queue.writeBuffer(buffer, 0, new Uint32Array([42]));
      await buffer.mapAsync(GPUMapMode.READ);
      check(new Uint32Array(buffer.getMappedRange())[0] === 42, 'Borrowed device did not survive');
      buffer.unmap(); buffer.destroy();
      check(gpuErrors.length === 0, gpuErrors.join('; '));
      return { hardware, first, second, owned, checked, cancelled,
        comparison: compareGpuSignatures(first, second), ownedComparison: compareGpuSignatures(first, owned),
        borrowedDeviceSurvived: true, gpuErrors, userAgent: navigator.userAgent };
    } finally { device.destroy(); }
  });
  assert.deepEqual(errors, []);
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'recordings.json'), JSON.stringify(result, null, 2) + '\n');
  const { first, second, owned, ...receipt } = result;
  const summary = { ...receipt, browser: browser.version(), launchArgs: [],
    elapsedMs: [first, second, owned].map(record => record.elapsedMs), allocationBytes: first.allocationBytes,
    scope: 'Single physical GPU functional check. No cross-device recognition or spoof-resistance qualification.' };
  await writeFile(path.join(output, 'receipt.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
