#!/usr/bin/env node
/** One adapter request per fresh browser. Failures remain in the denominator. */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { platform, release, arch } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const digest = value => createHash('sha256').update(value).digest('hex');

export function summarizeStartup(samples, attempts) {
  assert(Number.isSafeInteger(attempts) && attempts > 0 && samples.length === attempts, 'Every planned startup must be recorded');
  const failures = {};
  for (const sample of samples) if (!sample.passed) failures[sample.stage] = (failures[sample.stage] || 0) + 1;
  const successful = samples.filter(sample => sample.passed);
  const times = successful.map(sample => sample.elapsedMs).sort((a, b) => a - b);
  return { attempts, successes: successful.length, failures: attempts - successful.length,
    successFraction: successful.length / attempts, failureBoundaries: failures,
    successfulStartupMs: times.length ? { min: times[0], median: times[Math.floor(times.length / 2)],
      p95: times[Math.ceil(times.length * 0.95) - 1], max: times.at(-1) } : null };
}

export async function verifyGpuStartup(config) {
  assert(Number.isSafeInteger(config.attempts) && config.attempts > 0 && config.attempts <= 1000, 'Explicit bounded attempts required');
  assert(Number.isSafeInteger(config.timeoutMs) && config.timeoutMs > 0 && config.timeoutMs <= 60000, 'Explicit startup timeout required');
  assert(typeof config.browserExecutablePath === 'string' && Array.isArray(config.browserArgs)
    && config.browserArgs.every(arg => typeof arg === 'string'), 'Explicit browser executable and arguments required');
  assert(typeof config.requiredVendor === 'string' && config.requiredVendor, 'Physical vendor required');
  assert(config.adapterOptions && typeof config.adapterOptions === 'object' && !Array.isArray(config.adapterOptions), 'Explicit adapter options required');
  assert(typeof config.outputDir === 'string' && config.outputDir, 'Output directory required');
  await mkdir(config.outputDir); // Never overwrite an earlier experiment.
  const report = { schema: 'reploid.gpu-startup-observation/v1', config,
    sourceSha256: digest(await readFile(fileURLToPath(import.meta.url))),
    browserSha256: digest(await readFile(config.browserExecutablePath)),
    host: { platform: platform(), release: release(), arch: arch() }, samples: [],
    boundary: { browserProcesses: 'fresh-per-attempt', adapterRequestsPerAttempt: 1,
      retries: 0, operatingSystemCold: false, isolatedHost: false, modelExecution: false,
      independentOperators: false } };
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    response.end('<!doctype html><title>GPU startup observation</title>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    for (let index = 0; index < config.attempts; index++) {
      const sample = { index, startedAt: new Date().toISOString(), stage: 'launch', passed: false, events: [], logs: [] };
      const started = performance.now();
      let browser, timer;
      try {
        const observation = (async () => {
          browser = await chromium.launch({ executablePath: config.browserExecutablePath, headless: true,
            args: config.browserArgs, timeout: config.timeoutMs });
          sample.browserVersion = browser.version();
          const cdp = await browser.newBrowserCDPSession();
          sample.stage = 'navigation';
          const page = await browser.newPage();
          page.on('console', message => sample.logs.push({ type: message.type(), text: message.text() }));
          page.on('pageerror', error => sample.logs.push({ type: 'pageerror', text: error.message }));
          await page.exposeFunction('startupStage', event => { sample.stage = event.stage; sample.events.push(event); });
          await page.goto(url, { timeout: config.timeoutMs });
          sample.result = await page.evaluate(async ({ adapterOptions, requiredVendor }) => {
            const stage = name => window.startupStage({ stage: name, atMs: performance.now(),
              readyState: document.readyState, visibility: document.visibilityState });
            await stage('adapter-request');
            if (!navigator.gpu) throw new Error('WebGPU is unavailable');
            const adapter = await navigator.gpu.requestAdapter(adapterOptions);
            if (!adapter) throw new Error('WebGPU returned no adapter');
            const info = { vendor: adapter.info.vendor, architecture: adapter.info.architecture,
              device: adapter.info.device, description: adapter.info.description,
              isFallbackAdapter: adapter.isFallbackAdapter ?? adapter.info.isFallbackAdapter };
            await window.startupStage({ stage: 'adapter-selected', atMs: performance.now(), info });
            if (info.vendor !== requiredVendor || info.isFallbackAdapter !== false
              || /swiftshader|llvmpipe/i.test(JSON.stringify(info))) throw new Error('Required physical adapter unavailable');
            await stage('device-request');
            const device = await adapter.requestDevice();
            const faults = [];
            device.addEventListener('uncapturederror', event => faults.push(event.error.message));
            try {
              await stage('first-dispatch');
              const result = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
              const readback = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
              try {
                const module = device.createShaderModule({ code: '@group(0) @binding(0) var<storage, read_write> out: array<u32>; @compute @workgroup_size(1) fn main() { out[0] = 7u; }' });
                const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
                const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: result } }] });
                const encoder = device.createCommandEncoder(); const pass = encoder.beginComputePass();
                pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.dispatchWorkgroups(1); pass.end();
                encoder.copyBufferToBuffer(result, 0, readback, 0, 4); device.queue.submit([encoder.finish()]);
                await readback.mapAsync(GPUMapMode.READ); const value = new Uint32Array(readback.getMappedRange())[0];
                readback.unmap(); if (value !== 7 || faults.length) throw new Error('First dispatch failed: ' + faults.join('; '));
                await stage('ready'); return { info, firstDispatch: value };
              } finally { result.destroy(); readback.destroy(); }
            } finally { device.destroy(); }
          }, { adapterOptions: config.adapterOptions, requiredVendor: config.requiredVendor });
          sample.processes = (await cdp.send('SystemInfo.getProcessInfo')).processInfo;
        })();
        await Promise.race([observation, new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`Startup deadline at ${sample.stage}`)), config.timeoutMs);
        })]);
        sample.passed = true;
      } catch (error) { sample.error = { name: error.name, message: error.message }; }
      finally {
        clearTimeout(timer); sample.elapsedMs = performance.now() - started;
        report.samples.push(sample);
        await writeFile(resolve(config.outputDir, `attempt-${index + 1}.json`), JSON.stringify(sample, null, 2));
        if (browser) await browser.close();
      }
      console.log(`[gpu-startup] ${index + 1}/${config.attempts}: ${sample.passed ? 'passed' : sample.stage + ': ' + sample.error.message}`);
    }
    report.summary = summarizeStartup(report.samples, config.attempts);
    report.passed = report.summary.failures === 0;
  } finally {
    await writeFile(resolve(config.outputDir, 'report.json'), JSON.stringify(report, null, 2));
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
    const report = await verifyGpuStartup(config);
    console.log(JSON.stringify(report.summary)); process.exitCode = report.passed ? 0 : 1;
  } catch (error) { console.error(error); process.exitCode = 1; }
}
