#!/usr/bin/env node
/**
 * Attested GPU pilot harness: one private build-diagnosis job through `reploid/inference` with
 * `confidentiality: "attested-execution"`, and the same job on an ordinary (non-confidential) rental for comparison.
 *
 *   node scripts/attested-gpu-pilot.js dry-run [--browser]
 *       Local rehearsal: a synthetic executor (test-only evidence, fake runtime) on loopback. Spends nothing.
 *   node scripts/attested-gpu-pilot.js inspect --executor http://<vm>:8443
 *       Fetch one evidence bundle and print its measurements. Sends a nonce and nothing else. Use it once on the
 *       first boot to record the image's measurements into the policy (recorded, not independently reproduced).
 *   node scripts/attested-gpu-pilot.js attested --executor http://<vm>:8443 --policy policy.json
 *       [--browser] [--launched-at <ISO>] [--hourly-usd 7.03] [--credits 1000] [--out report.json]
 *   node scripts/attested-gpu-pilot.js plain --runtime-url http://<vm>:8080 --runtime-model <name>
 *       [--launched-at <ISO>] [--hourly-usd 11.06] [--out report.json]
 *   node scripts/attested-gpu-pilot.js spki <root-certificate.pem>
 *       The sha256 SubjectPublicKeyInfo digest a policy pins for a root.
 *
 * Measured: cold start (launched-at to executor ready), time to the first useful output (first non-blank text
 * after the request starts), total time, output tokens, and cost (hourly price times the instance's billed time so
 * far). The answer is checked for the fixture's expected findings by keyword; a person still reads the answer.
 */
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lib = rel => import(path.join(root, 'packages/reploid/src', rel));
const TASK = path.join(root, 'tests/fixtures/attested-gpu/build-diagnosis-task.json');
const MAX_OUTPUT_TOKENS = 512;

export function taskMessages(task) {
  const files = task.files.map(file => `--- ${file.path} ---\n${file.content}`).join('\n');
  return [{ role: 'user', content: `${task.instruction}\n\n=== Build log ===\n${task.log}\n=== Source files ===\n${files}` }];
}
export function scoreAnswer(task, text) {
  const checks = [['readSettings', /readSettings/], ['EXPORT_DIR', /EXPORT_DIR/], ['currency', /usd|upper-?case|currency code/i]];
  const matched = checks.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
  return { method: 'keyword presence for each expected finding; not a quality grade, a person reads the answer', expected: task.expected.findings, matched,
    passedKeywords: matched.includes('readSettings') && matched.includes('EXPORT_DIR') };
}

async function waitReady(url, { launchedAt, timeoutMs = 30 * 60 * 1000 }) {
  const start = Date.now();
  for (;;) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(5000) })).ok) break; } catch { /* not up yet */ }
    if (Date.now() - start > timeoutMs) throw new Error(`${url} was not ready within ${timeoutMs} ms`);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  const readyAt = Date.now();
  return { readyAt, coldStartMs: launchedAt ? readyAt - launchedAt : null };
}
const costOf = (hourlyUsd, launchedAt, finishedAt) => hourlyUsd && launchedAt
  ? { hourlyUsd, billedMs: finishedAt - launchedAt, usd: Math.round(hourlyUsd * (finishedAt - launchedAt) / 36e5 * 100) / 100,
    note: 'instance time from launch to the end of this job, at the on-demand or spot hourly price given; disk and egress are separate' } : null;

/** A local pilot ledger: credits held before the prompt is sealed, settled on a complete answer. */
export function pilotLedger(balance) {
  const state = { balance, holds: new Map(), log: [] };
  return { state, ports: {
    async reserve({ maximum, unit, requestId }) {
      if (maximum > state.balance) throw Object.assign(new Error(`The answer could cost ${maximum} credits; ${state.balance} are available. Nothing was sent.`), { code: 'CREDIT_INSUFFICIENT' });
      state.balance -= maximum; const id = `hold:${requestId}`; state.holds.set(id, maximum); state.log.push({ hold: id, maximum, unit });
      return { id, maximum };
    },
    async settle({ reservation, charge, outputTokens }) {
      const held = state.holds.get(reservation.id); state.holds.delete(reservation.id); state.balance += held - charge;
      state.log.push({ settled: reservation.id, charge });
      return { unit: 'noncash-service-credit', charge, outputTokens, status: 'settled-in-pilot-ledger', balanceAfter: state.balance };
    },
    async release({ reservation }) { const held = state.holds.get(reservation.id) ?? 0; state.holds.delete(reservation.id); state.balance += held; state.log.push({ released: reservation.id }); }
  } };
}

/** The requester flow, identical in Node and in the browser page below. */
export async function runAttestedRequest({ inferenceModule, attestedModule, wsModule, executorUrl, policy, credits, messages, now = Date.now }) {
  const offerUrl = new URL('/offer', executorUrl).href;
  const wsUrl = new URL('/attested', executorUrl.replace(/^http/, 'ws')).href;
  const attestedExecution = attestedModule.createAttestedExecution({ policy, credits,
    discover: async ({ signal }) => [{ endpoint: wsUrl, offer: await (await fetch(offerUrl, { signal })).json() }],
    connect: endpoint => wsModule.connectWebSocketFrames(endpoint) });
  const refuse = () => { throw new Error('Only the attested route is enabled in this harness'); };
  const inference = inferenceModule.createInference({ resolveRoute: refuse, execute: refuse, attestedExecution, unreviewedAttestedExecution: true });
  const offer = await (await fetch(offerUrl)).json();
  const started = now();
  const plan = await inference.prepare({ model: { ...offer.model, adapterIdentities: [] }, generation: { maxOutputTokens: 512 },
    execution: { placement: 'network-allowed', participants: { kind: 'named', ids: [offer.participantId] }, confidentiality: 'attested-execution',
      allowMetadata: ['model-id', 'timing', 'length', 'access-patterns'] } });
  const run = await inference.run({ planId: plan.id, requestId: `pilot-${started}`, input: { messages } });
  let firstUsefulAt = null, admittedAt = null, text = '';
  for await (const event of run.events) {
    if (event.type === 'admitted') admittedAt = now();
    if (event.type === 'output.delta') { text += event.text; if (firstUsefulAt === null && text.trim()) firstUsefulAt = now(); }
  }
  const result = await run.result;
  const finished = now();
  return { plan, result, timing: { prepareToAttestedMs: admittedAt && admittedAt - started, firstUsefulOutputMs: firstUsefulAt && firstUsefulAt - started, totalMs: finished - started }, finishedAt: finished };
}

async function plainRequest({ runtimeUrl, model, messages }) {
  const started = Date.now();
  const response = await fetch(new URL('/v1/chat/completions', runtimeUrl), { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true, stream_options: { include_usage: true }, temperature: 0, max_tokens: MAX_OUTPUT_TOKENS }) });
  if (!response.ok) throw new Error(`Runtime answered ${response.status}`);
  let text = '', firstUsefulAt = null, usage = null, buffer = '', chunks = 0;
  const decoder = new TextDecoder();
  for await (const part of response.body) {
    buffer += decoder.decode(part, { stream: true });
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim(); buffer = buffer.slice(i + 1);
      if (!line.startsWith('data:') || line.endsWith('[DONE]')) continue;
      const event = JSON.parse(line.slice(5));
      const delta = event.choices?.[0]?.delta?.content;
      if (delta) { text += delta; chunks += 1; if (firstUsefulAt === null && text.trim()) firstUsefulAt = Date.now(); }
      if (event.usage) usage = { inputTokens: event.usage.prompt_tokens, outputTokens: event.usage.completion_tokens };
    }
  }
  const finished = Date.now();
  // doppler-serve streams one token per chunk and sends no usage chunk.
  usage ??= { inputTokens: null, outputTokens: chunks, usageSource: 'stream-chunks' };
  return { text, usage, timing: { firstUsefulOutputMs: firstUsefulAt && firstUsefulAt - started, totalMs: finished - started }, finishedAt: finished };
}

/** Serve shared/vendor/reploid and a page that runs the same requester flow in Chromium. */
async function inBrowser({ executorUrl, policy, credits, messages }) {
  const vendor = path.join(root, 'shared/vendor/reploid');
  const page = `<!doctype html><meta charset="utf-8"><title>Attested pilot requester</title><script type="module">
    import * as inferenceModule from '/vendor/reploid/inference/index.js';
    import * as attestedModule from '/vendor/reploid/inference/attested/execution.js';
    import * as wsModule from '/vendor/reploid/inference/attested/websocket-channel.js';
    import { runAttestedRequest, pilotLedger } from '/pilot.js';
    window.runPilot = async ({ executorUrl, policy, credits, messages }) => {
      const ledger = credits === null ? null : pilotLedger(credits);
      const out = await runAttestedRequest({ inferenceModule, attestedModule, wsModule, executorUrl, policy, credits: ledger?.ports ?? null, messages });
      return JSON.parse(JSON.stringify({ ...out, ledger: ledger?.state.log ?? null, userAgent: navigator.userAgent }));
    };
    window.ready = true;
  </script>`;
  const pilotSource = (await readFile(fileURLToPath(import.meta.url), 'utf8'));
  // Only the two pure functions run in the page; the Node-only imports at the top are not reached by them.
  const browserPilot = [pilotSource.match(/export function pilotLedger[\s\S]*?\n}\n/)[0], pilotSource.match(/export async function runAttestedRequest[\s\S]*?\n}\n/)[0]].join('\n');
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    if (url.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end(page); return; }
    if (url.pathname === '/pilot.js') { res.setHeader('content-type', 'text/javascript'); res.end(browserPilot); return; }
    if (url.pathname.startsWith('/vendor/reploid/')) {
      const file = path.join(vendor, path.normalize(url.pathname.slice('/vendor/reploid/'.length)));
      if (!file.startsWith(vendor)) { res.statusCode = 403; res.end(); return; }
      try { res.setHeader('content-type', 'text/javascript'); res.end(await readFile(file)); } catch { res.statusCode = 404; res.end(); }
      return;
    }
    res.statusCode = 404; res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  try {
    const tab = await browser.newPage();
    await tab.goto(`http://127.0.0.1:${server.address().port}/`);
    await tab.waitForFunction(() => globalThis.ready === true);
    return await tab.evaluate(input => globalThis.runPilot(input), { executorUrl, policy, credits, messages });
  } finally { await browser.close(); server.close(); }
}

async function dryRunExecutor() {
  const fixtures = await import(path.join(root, 'tests/helpers/attested-gpu-fixtures.js'));
  const { startAttestedExecutor } = await import(path.join(root, 'server/attested-gpu/executor.js'));
  const world = await fixtures.createSyntheticWorld({ now: Date.now() });
  // A canned answer (not model output) so the scoring path runs too.
  const answer = 'export.ts line 3 imports loadSettings, but commit 9c1e2f4 renamed it to readSettings: import readSettings instead. '
    + 'Line 18 passes process.env.EXPORT_DIR, which is string | undefined under strict mode: default it, for example ?? "exports". '
    + 'Next: invoice.config.json uses currency "usd"; readSettings requires an upper-case code, so the export will throw at run time.';
  const host = fixtures.syntheticHost(world, { platform: 'intel-tdx', faults: { answer } });
  const offer = { schema: 'reploid.attested-gpu-offer/v1', participantId: host.participantId, platform: 'intel-tdx', launchId: 'synthetic-tdx-27b',
    model: host.launch.model, operator: 'dry run on loopback (synthetic evidence)', price: { unit: 'noncash-service-credit', creditsPerOutputToken: 1 } };
  const executor = await startAttestedExecutor({ host, offer });
  return { executor, policy: world.policy };
}

async function inspect(executorUrl) {
  const { connectWebSocketFrames } = await lib('inference/attested/websocket-channel.js');
  const { parseSnpReport, parseTdxQuote, parseGpuReport } = await lib('inference/attested/reports.js');
  const { decodeBase64Url, toBase64Url, randomBytes, decodeUtf8 } = await lib('inference/attested/bytes.js');
  const offer = await (await fetch(new URL('/offer', executorUrl))).json();
  const channel = await connectWebSocketFrames(new URL('/attested', executorUrl.replace(/^http/, 'ws')).href);
  await channel.send({ header: { schema: 'reploid.attested-gpu/v1', kind: 'challenge', nonce: toBase64Url(randomBytes(32)), model: offer.model, launchId: offer.launchId, blobs: [] }, blobs: [] });
  const frame = await channel.receive({ timeoutMs: 120000 });
  await channel.send({ header: { schema: 'reploid.attested-gpu/v1', kind: 'abort', blobs: [] }, blobs: [] }).catch(() => {});
  channel.close();
  const evidence = JSON.parse(decodeUtf8(frame.blobs[0]));
  const raw = decodeBase64Url(evidence.cpu.report);
  const cpu = evidence.cpu.platform === 'intel-tdx' ? parseTdxQuote(raw) : parseSnpReport(raw);
  return { offer, platform: evidence.cpu.platform, launch: evidence.session.launch, debug: cpu.debug,
    migrationAllowed: evidence.cpu.platform === 'intel-tdx' ? cpu.migratable : cpu.migrationAgent,
    measurement: evidence.cpu.platform === 'intel-tdx' ? { mrTd: cpu.mrTd, rtmr: cpu.rtmr, mrSeam: cpu.mrSeam, tdAttributes: cpu.tdAttributes.toString(16) } : { measurement: cpu.measurement, policy: cpu.policy.toString(16), reportedTcb: cpu.reportedTcb },
    // Shown for comparison only. `inspect` verifies nothing, so this is whatever enclave the executor presented.
    ...(evidence.cpu.platform === 'intel-tdx' ? { quotingEnclavePresented: cpu.qe } : {}),
    gpus: evidence.gpus.map(gpu => ({ index: gpu.index, architecture: gpu.architecture, ccMode: gpu.ccMode, devToolsMode: gpu.devToolsMode,
      measurements: parseGpuReport(decodeBase64Url(gpu.report)).measurements, certificates: gpu.certificates.length, ocsp: gpu.ocsp.length })),
    note: 'Recorded from one boot of this image. Pin these values only after comparing GPU measurements with NVIDIA\'s RIMs for the installed driver and VBIOS. '
      + 'Take tdxQe from Intel\'s published TD quoting enclave identity, never from this output.' };
}

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: {
    executor: { type: 'string' }, policy: { type: 'string' }, browser: { type: 'boolean', default: false }, 'launched-at': { type: 'string' },
    'hourly-usd': { type: 'string' }, credits: { type: 'string', default: '1000' }, out: { type: 'string' },
    'runtime-url': { type: 'string' }, 'runtime-model': { type: 'string' } } });
  const task = JSON.parse(await readFile(TASK, 'utf8'));
  const messages = taskMessages(task);
  const launchedAt = values['launched-at'] ? Date.parse(values['launched-at']) : null;
  const hourlyUsd = values['hourly-usd'] ? Number(values['hourly-usd']) : null;
  const emit = async report => {
    const text = JSON.stringify(report, null, 2) + '\n';
    if (values.out) await writeFile(values.out, text); else process.stdout.write(text);
  };
  if (mode === 'spki') {
    const { parseCertificate, spkiDigest } = await lib('inference/attested/x509.js');
    const pem = await readFile(positionals[0], 'utf8');
    const der = new Uint8Array(Buffer.from(pem.replace(/-----[^-]+-----|\s+/g, ''), 'base64'));
    process.stdout.write(`${await spkiDigest(parseCertificate(der))}\n`);
    return;
  }
  if (mode === 'inspect') { await emit(await inspect(values.executor)); return; }
  if (mode === 'plain') {
    const ready = await waitReady(new URL('/v1/models', values['runtime-url']).href, { launchedAt });
    const out = await plainRequest({ runtimeUrl: values['runtime-url'], model: values['runtime-model'], messages });
    await emit({ schema: 'reploid.attested-gpu-pilot-report/v1', mode: 'plain', confidentiality: 'executor-readable', task: task.id, ...ready,
      timing: out.timing, usage: out.usage, answer: out.text, score: scoreAnswer(task, out.text), cost: costOf(hourlyUsd, launchedAt, out.finishedAt) });
    return;
  }
  if (mode !== 'attested' && mode !== 'dry-run') throw new Error('Mode is dry-run, inspect, attested, plain or spki');
  let executorUrl = values.executor, policy = values.policy ? JSON.parse(await readFile(values.policy, 'utf8')) : null, local = null;
  if (mode === 'dry-run') { local = await dryRunExecutor(); executorUrl = local.executor.url; policy = local.policy; }
  try {
    const ready = await waitReady(new URL('/ready', executorUrl).href, { launchedAt });
    const credits = Number(values.credits);
    let out;
    if (values.browser) out = await inBrowser({ executorUrl, policy, credits, messages });
    else {
      const ledger = pilotLedger(credits);
      out = { ...await runAttestedRequest({ inferenceModule: await lib('inference/index.js'), attestedModule: await lib('inference/attested/execution.js'),
        wsModule: await lib('inference/attested/websocket-channel.js'), executorUrl, policy, credits: ledger.ports, messages }), ledger: ledger.state.log };
    }
    const { result } = out;
    await emit({ schema: 'reploid.attested-gpu-pilot-report/v1', mode, requester: values.browser ? 'browser' : 'node', confidentiality: 'attested-execution',
      synthetic: mode === 'dry-run', task: task.id, ...ready, timing: out.timing, status: result.status, error: result.error ?? null,
      model: result.executionReceipt.requested.model, settlement: result.settlement, usage: result.usage,
      answer: result.output?.text ?? null, score: result.output ? scoreAnswer(task, result.output.text) : null,
      cost: costOf(hourlyUsd, launchedAt, out.finishedAt), ledger: out.ledger, receipt: result.executionReceipt });
    if (result.status !== 'completed') process.exitCode = 1;
  } finally { await local?.executor.close(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exit(1); });
}
