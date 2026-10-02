#!/usr/bin/env node
/** Operator-owned browser contribution. Requesters use the ordinary hosted UI. */
import { parseArgs } from 'node:util';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const { values } = parseArgs({ options: {
  url: { type: 'string' }, profile: { type: 'string' }, model: { type: 'string' },
  contribute: { type: 'string' }, 'model-directory': { type: 'string' }, help: { type: 'boolean' }
} });
if (values.help) {
  console.log('node scripts/run-mesh-contributor.js --url https://replo.id/ --profile PATH --model MODEL_ID --contribute compute|files [--model-directory PATH]');
  process.exit(0);
}
if (!values.url || !values.profile || !values.model || !['compute', 'files'].includes(values.contribute)) {
  throw Error('Explicit URL, persistent profile, model and compute/files contribution consent are required. See --help.');
}
const url = new URL(values.url);
if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw Error('Hosted contribution requires HTTPS');
if (values['model-directory'] && values.contribute !== 'files') throw Error('Local seed bytes require explicit file contribution');
const profile = path.resolve(values.profile);
await mkdir(profile, { recursive: true });
const context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true,
  args: process.platform === 'darwin' ? ['--enable-unsafe-webgpu', '--use-angle=metal']
    : ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan', '--disable-gpu-sandbox'] });
let stopping = false, timer;
const stop = async () => {
  if (stopping) return; stopping = true; clearInterval(timer); await context.close();
};
process.once('SIGTERM', () => { void stop(); });
process.once('SIGINT', () => { void stop(); });
try {
  const page = context.pages()[0] || await context.newPage();
  if (values.contribute === 'compute') {
    // Observe the completed host receipt after its timers stop. No exception or
    // token breakpoints: acquisition and generation timings remain unpaused.
    const source = (await readFile(new URL('../self/host/work-partitions.js', import.meta.url), 'utf8')).split('\n');
    const cdp = await context.newCDPSession(page);
    await cdp.send('Debugger.enable');
    const breakpoint = await cdp.send('Debugger.setBreakpointByUrl', {
      urlRegex: '/host/work-partitions\\.js$', lineNumber: source.findIndex(line => line.includes('return { runtime, model, plan'))
    });
    cdp.on('Debugger.paused', async event => {
      try {
        if (!event.hitBreakpoints.includes(breakpoint.breakpointId)) return;
        const observed = await cdp.send('Debugger.evaluateOnCallFrame', {
          callFrameId: event.callFrames[0].callFrameId, returnByValue: true,
          expression: '({participantId,descriptor:resident.getState().descriptor,acquisition:source.getReceipt(),preparation})'
        });
        if (observed.exceptionDetails) throw Error(observed.exceptionDetails.text);
        console.log(JSON.stringify({ event: 'resident-prepared', ...observed.result.value }));
      } catch (error) { console.error('Preparation observation failed: ' + error.message); }
      finally { await cdp.send('Debugger.resume').catch(() => {}); }
    });
  }
  const modelRequests = [];
  page.on('request', request => {
    if (/huggingface\.co|shard_\d+\.bin/.test(request.url())) modelRequests.push(request.url());
  });
  page.on('response', async response => {
    if (new URL(response.url()).pathname !== '/rtc-config') return;
    const receipt = await response.json().catch(() => null);
    console.log(JSON.stringify({ event: 'relay-credentials', status: response.status(),
      expiresAt: receipt?.expiresAt ?? null }));
  });
  const response = await context.request.get(new URL('/config/chat-models.json', url).href);
  if (!response.ok()) throw Error(`Hosted catalog HTTP ${response.status()}`);
  const selected = (await response.json()).find(model => model.id === values.model);
  if (!selected) throw Error('Requested contribution is absent from the hosted catalog');
  if (values['model-directory']) {
    const directory = path.resolve(values['model-directory']);
    await context.route(selected.source.baseUrl + '*', async route => {
      const filename = new URL(route.request().url()).pathname.split('/').at(-1);
      if (!/^[\w.-]+$/.test(filename)) throw Error('Invalid seed artifact path');
      await route.fulfill({ body: await readFile(path.join(directory, filename)),
        contentType: filename.endsWith('.json') ? 'application/json' : 'application/octet-stream' });
    });
  }
  await page.goto(url.href);
  await page.locator('[data-chat-workspace]').waitFor();
  await page.locator('[data-toggle-inspector]').click();
  await page.locator('[data-contribution-model]').selectOption(selected.id);
  const files = values.contribute === 'files';
  const toggle = files ? '[data-toggle-file-contribution]' : '[data-toggle-contribution]';
  const label = files ? '[data-file-contribution-label]' : '[data-contrib-label]';
  const consent = files ? '[data-file-contribution-consent]' : '[data-contribution-consent]';
  await page.locator('details').filter({ has: page.locator(toggle) }).locator('summary').click();
  await page.locator(consent).check(); await page.locator(toggle).click();
  console.log(JSON.stringify({ event: 'contribution-authorized', url: url.href, model: selected.id,
    modelIdentity: selected.identity, contribution: values.contribute, profile }));
  const identity = await page.evaluate(() => Object.keys(localStorage)
    .filter(key => key.includes('work-swarm:') && key.endsWith('REPLOID_SELF_IDENTITY_V1'))
    .map(key => JSON.parse(localStorage.getItem(key)))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map(({ peerId }) => ({ peerId })));
  console.log(JSON.stringify({ event: 'participant', identities: identity }));
  let prior = '', checking = false;
  timer = setInterval(async () => {
    if (checking || stopping) return; checking = true;
    try {
      const state = { phase: await page.locator(label).textContent(),
        progress: await page.locator(files ? '[data-file-progress]' : '[data-contribution-progress]').textContent().catch(() => ''),
        error: await page.locator('[data-network-message]').textContent() };
      const encoded = JSON.stringify(state);
      if (encoded !== prior) {
        console.log(encoded); prior = encoded;
        if (!files && state.phase === 'Ready') {
          const memory = await page.evaluate(async () => {
            const { DOPPLER_PARTITIONS_MODULE_URL } = await import('/config/doppler-local-models.js');
            return (await import(DOPPLER_PARTITIONS_MODULE_URL)).inspectDeviceMemory();
          });
          console.log(JSON.stringify({ event: 'resident-ready', memory, modelRequests }));
        }
      }
      if (state.phase === 'Failed' || files && !['Preparing', 'Sharing'].includes(state.phase)
        || state.phase === 'Not sharing' && state.error) throw Error(state.error || state.phase);
    } catch (error) {
      if (!stopping) { console.error(error.message); process.exitCode = 1; await stop(); }
    } finally { checking = false; }
  }, 10000);
  await new Promise(resolve => context.once('close', resolve));
} catch (error) {
  console.error(error.message); process.exitCode = 1; await stop();
}
