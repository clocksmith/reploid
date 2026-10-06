#!/usr/bin/env node
// Run the existing conversation acceptance on two physical hosts. Own only
// these child processes; an existing development server/tunnel is never reused.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { physicalWebGpuBrowserOptions } from '../tests/fixtures/physical-webgpu-browser.js';

const root = resolve(import.meta.dirname, '..');
const modelArgument = process.argv.indexOf('--model');
const modelId = modelArgument < 0 ? 'qwen-3-5-0-8b-q4k-ehaf16' : process.argv[modelArgument + 1];
if (!modelId || modelId.startsWith('--')) throw new Error('--model requires a catalog model ID');
const capacityDiagnostic = process.argv.includes('--capacity');
const recoveryDiagnostic = process.argv.includes('--recovery');
const reverseHosts = process.argv.includes('--reverse');
const documentWorkload = recoveryDiagnostic ? process.env.REPLOID_E2E_DOCUMENTS === '1'
  : process.env.REPLOID_E2E_DOCUMENTS !== '0';
const frozenWorkloads = modelId === 'qwen-3-5-0-8b-q4k-ehaf16' && !capacityDiagnostic && !recoveryDiagnostic;
const peer = process.env.REPLOID_TEST_PEER || 'x@128.tail995236.ts.net';
const peerRoot = process.env.REPLOID_TEST_PEER_ROOT || '/home/x/deco/reploid';
const modelDirectory = process.env.DOPPLER_CHAT_MODEL_DIR
  || resolve(root, `../doppler/models/local/${modelId}`);
const referenceSource = process.env.DOPPLER_PARTITION_REFERENCE_OUT
  || resolve(root, 'tests/fixtures/distributed-reference.json.gz');
const output = resolve(process.env.REPLOID_DISTRIBUTED_OUTPUT_ROOT || resolve(root, 'artifacts/distributed'),
  new Date().toISOString().replace(/[:.]/g, '-'));
const reference = resolve(output, 'reference.json');
const children = [];
const logs = [];
const numericalPolicy = process.env.REPLOID_REQUIRE_NUMERICAL_TOLERANCE === '1' ? 'required' : 'tracked';
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
let phase = 'inputs';

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise(done => server.close(done));
  return port;
}
function start(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], ...options });
  children.push(child);
  const log = createWriteStream(resolve(output, `${children.length}-${command === 'ssh' ? 'ssh' : 'node'}.log`));
  logs.push(log);
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  child.stderr.on('data', bytes => process.stderr.write(bytes));
  return child;
}
function waitForLine(child, predicate, timeout = 30000) {
  return new Promise((done, reject) => {
    let pending = '';
    const timer = setTimeout(() => finish(new Error(`Timed out during ${phase}`)), timeout);
    const onExit = code => finish(new Error(`Process exited during ${phase} (${code})`));
    const onData = bytes => {
      pending += bytes;
      const lines = pending.split('\n'); pending = lines.pop();
      for (const line of lines) { const value = predicate(line); if (value) finish(null, value); }
    };
    function finish(error, value) {
      clearTimeout(timer);
      child.off('exit', onExit); child.off('error', finish); child.stdout.off('data', onData);
      error ? reject(error) : done(value);
    }
    child.on('error', finish); child.on('exit', onExit); child.stdout.on('data', onData);
  });
}
async function stopChildren() {
  for (const child of children.reverse()) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const exited = once(child, 'exit');
    child.stdin.end();
    const timer = setTimeout(() => child.kill('SIGTERM'), 1000);
    const force = setTimeout(() => child.kill('SIGKILL'), 5000);
    await exited;
    clearTimeout(timer); clearTimeout(force);
  }
}
let interruptedBy = null;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  interruptedBy = signal;
  for (const child of children) child.kill('SIGTERM');
});

await mkdir(output, { recursive: true });
let failure = null;
let numerical = null;
let referenceGeneration = null;
const memory = [];
try {
  const stored = await readFile(referenceSource);
  const bytes = stored[0] === 0x1f && stored[1] === 0x8b ? gunzipSync(stored) : stored;
  if (createHash('sha256').update(bytes).digest('hex') !== '9444f0d632de4b51624752a8c3d05a1e7cd7aea4b4ebaef71d96663bb650b6bd') {
    throw new Error('The frozen numerical reference differs; refusing to replace or weaken it');
  }
  if (frozenWorkloads || capacityDiagnostic) await writeFile(reference, bytes);
  referenceGeneration = JSON.parse(bytes).generation;
  const model = JSON.parse(await readFile(resolve(modelDirectory, 'manifest.json')));
  const catalog = JSON.parse(await readFile(resolve(root, 'self/config/chat-models.json'))).find(model => model.id === modelId);
  if (!catalog) throw new Error('Selected model is not in the application catalog');
  if (numericalPolicy === 'required' && !frozenWorkloads) throw new Error('This workload has no applicable frozen numerical comparison');
  if (createHash('sha256').update(await readFile(resolve(modelDirectory, 'manifest.json'))).digest('hex') !== catalog.identity.slice(7)) {
    throw new Error('Local model differs from the selected catalog model');
  }
  for (const shard of model.shards) await access(resolve(modelDirectory, shard.filename || shard.file));
  const port = await freePort();
  const socketPort = await freePort();
  const modelPort = await freePort();
  phase = 'local application';
  const server = start(process.execPath, ['server/proxy.js'], { env: {
    ...process.env, PORT: String(port), POOL_ALLOW_UNAUTHENTICATED_LOCAL: 'true', REPLOID_SKIP_CLOUD_ACCESS_BUILD: 'true'
  } });
  await waitForLine(server, line => line.includes(`HTTP API: http://localhost:${port}`));
  const modelServer = start(process.execPath, ['tests/fixtures/numerical-model-server.js'], { env: {
    ...process.env, DOPPLER_CHAT_MODEL_DIR: modelDirectory, REPLOID_MODEL_PORT: String(modelPort),
    REPLOID_E2E_BASE_URL: `http://localhost:${port}`
  } });
  await waitForLine(modelServer, line => line.includes(`loopback port ${modelPort}`));
  phase = 'physical peer browser';
  const code = `import { chromium } from 'playwright';
    const browser = await chromium.launchServer(${JSON.stringify(physicalWebGpuBrowserOptions('linux'))});
    console.log(JSON.stringify({ ws: browser.wsEndpoint() }));
    process.stdin.resume(); process.stdin.on('end', async () => { await browser.close(); process.exit(); });`;
  const remote = start('ssh', ['-o', 'BatchMode=yes', peer,
    `cd ${quote(peerRoot)} && node --input-type=module -e ${quote(code)}`]);
  const ws = await waitForLine(remote, line => {
    try { return JSON.parse(line).ws; } catch { return null; }
  });
  const remoteUrl = new URL(ws);
  phase = 'loopback transport';
  const tunnel = start('ssh', ['-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes',
    '-L', `${socketPort}:127.0.0.1:${remoteUrl.port}`, '-R', `${port}:127.0.0.1:${port}`,
    '-R', `${modelPort}:127.0.0.1:${modelPort}`,
    peer, 'echo REPLoid_TRANSPORT_READY; cat >/dev/null']);
  await waitForLine(tunnel, line => line === 'REPLoid_TRANSPORT_READY');
  const workloads = capacityDiagnostic ? [{ mode: 'capacity' }] : frozenWorkloads
    ? [{ mode: 'reference', direction: 'mac-linux' }, { mode: 'reference', direction: 'linux-mac', reverse: true },
      { mode: 'repetition' }, { mode: 'cancellation' }] : [];
  for (const workload of workloads) {
    const { mode } = workload;
    phase = mode === 'reference' ? `frozen reference ${workload.direction}` : `long-prompt ${mode}`;
    console.log(`[distributed] ${phase}: 1,420,000,000-byte budget; ${mode === 'reference' ? 'unchanged reference generation options' : mode === 'capacity' ? `${modelId}, 494-token comparison` : 'unchanged 1,588-token input'}`);
    const capture = resolve(output, mode === 'reference' ? `reference-${workload.direction}.json` : `memory-${mode}.json`);
    const check = start(process.execPath, ['tests/fixtures/browser-partition-memory-completion.js'], { env: {
      ...process.env, REPLOID_DIAGNOSTIC_REQUESTS: resolve(root, 'tests/fixtures/distributed-memory-requests.json'),
      REPLOID_CAPTURE_OUT: capture, REPLOID_MEMORY_PHASE: mode,
      REPLOID_TEST_MODEL: modelId,
      REPLOID_REFERENCE_FILE: reference, REPLOID_REFERENCE_REVERSE: workload.reverse ? '1' : '0',
      REPLOID_EXECUTOR_WS: `ws://127.0.0.1:${socketPort}${remoteUrl.pathname}`,
      REPLOID_E2E_BASE_URL: `http://localhost:${port}`, REPLOID_MODEL_BASE_URL: `http://127.0.0.1:${modelPort}/`
    } });
    check.stdout.pipe(process.stdout);
    const [code] = await once(check, 'exit');
    const receipt = JSON.parse(await readFile(capture));
    const cases = receipt.runs.map(run => ({ inputTokens: run.inputTokens,
      completed: run.completed === true, cancelled: run.cancelled === true, stopReason: run.stopReason }));
    if (mode === 'reference') {
      const comparisons = receipt.runs.flatMap(run => run.numerical || []);
      numerical ||= { policy: numericalPolicy, steps: 0, failed: 0, maxDifference: 0, tolerance: 0.001, directions: [] };
      const direction = { direction: workload.direction, capture, partitionHosts: receipt.partitionHosts,
        steps: comparisons.length, failed: comparisons.filter(step => !step.matches).length,
        maxDifference: Math.max(...comparisons.map(step => step.maxDifference), 0), tolerance: 0.001 };
      numerical.directions.push(direction); numerical.steps += direction.steps; numerical.failed += direction.failed;
      numerical.maxDifference = Math.max(numerical.maxDifference, direction.maxDifference);
      console.log(`[distributed] numerical (${numericalPolicy}, ${workload.direction}): ${direction.failed}/${direction.steps} exceed 0.001; maximum ${direction.maxDifference}`);
    } else {
      memory.push({ phase: mode, ok: code === 0, capture, cases,
        answersComplete: cases.length > 0 && cases.filter(run => !run.cancelled)
          .every(run => run.completed && run.stopReason === 'eos-token') });
    }
    if (code !== 0) throw new Error(`${receipt.failure?.message || `Retained ${mode} workload failed (${code})`}; inspect ${capture}`);
  }
  if (numericalPolicy === 'required' && numerical?.failed) throw new Error('Frozen numerical tolerance exceeded');
  if (!capacityDiagnostic) {
    phase = recoveryDiagnostic ? 'contributor restart diagnostic' : 'conversation acceptance';
    console.log(`[distributed] ${phase}; evidence: ${output}`);
    const test = start(process.execPath, ['node_modules/@playwright/test/cli.js', 'test',
      'tests/e2e/chat-cooperative-real.spec.js', '--project=chromium', `--output=${resolve(output, 'conversation')}`], { env: {
        ...process.env, DOPPLER_CHAT_MODEL_DIR: modelDirectory, DOPPLER_PARTITION_REFERENCE_OUT: '',
        REPLOID_TEST_MODEL: modelId, REPLOID_E2E_CAPACITY: frozenWorkloads || recoveryDiagnostic ? '0' : '1',
        REPLOID_E2E_RECOVERY: recoveryDiagnostic ? '1' : '0',
        REPLOID_E2E_REVERSE_HOSTS: reverseHosts ? '1' : '0',
        PLAYWRIGHT_JSON_OUTPUT_FILE: resolve(output, 'playwright.json'),
        REPLOID_EXECUTOR_WS: `ws://127.0.0.1:${socketPort}${remoteUrl.pathname}`,
        REPLOID_E2E_BASE_URL: `http://localhost:${port}`, REPLOID_E2E_SKIP_LOCAL_SERVER: '1',
        REPLOID_E2E_CHROMIUM_CHANNEL: 'chrome', REPLOID_E2E_CUSTODY_TRACE: '1', REPLOID_E2E_REPLICA: '1',
        REPLOID_E2E_DOCUMENTS: documentWorkload ? '1' : '0',
        REPLOID_TRACK_NUMERICAL_DRIFT: numericalPolicy === 'tracked' ? '1' : '0'
      } });
    test.stdout.pipe(process.stdout);
    const [exitCode] = await once(test, 'exit');
    if (exitCode !== 0) {
      const report = JSON.parse(await readFile(resolve(output, 'playwright.json')));
      const specs = suite => [...(suite.specs || []), ...(suite.suites || []).flatMap(specs)];
      const errors = report.suites.flatMap(specs)
        .flatMap(spec => spec.tests).flatMap(test => test.results).flatMap(result => result.errors || []);
      const message = errors[0]?.message?.split('\n')[0] || `Conversation acceptance failed (${exitCode})`;
      throw new Error(`${message}; inspect ${output}`);
    }
    if (memory.some(check => !check.answersComplete)) {
      throw new Error('Long-prompt generation reached the token limit; complete answers are still required');
    }
  }
} catch (error) {
  failure = { phase, message: interruptedBy ? `Verification interrupted by ${interruptedBy}` : error.message };
  console.error(`[distributed] ${phase}: ${error.message}`);
  process.exitCode = 1;
} finally {
  await stopChildren();
  await Promise.all(logs.map(log => new Promise(done => log.end(done))));
  const packageIdentity = JSON.parse(await readFile(resolve(root, 'self/config/doppler-package.json')));
  const browserIdentity = JSON.parse(await readFile(resolve(root, 'self/config/browser-bundle-manifest.json'))).bundleHash;
  const profile = JSON.parse(await readFile(resolve(root, 'self/config/work-profile.json')));
  const policy = JSON.parse(await readFile(resolve(root, 'self/config/partition-policy.json')));
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ ok: !failure, failure, modelId,
    scope: recoveryDiagnostic ? 'Physical contributor restart diagnostic; other acceptance categories not exercised'
      : capacityDiagnostic ? 'Installed-package capacity diagnostic; no peer acquisition proof'
      : documentWorkload ? 'Physical cooperative conversation' : 'Physical cooperative recovery diagnostic; long document workload omitted',
    documentWorkload, reverseHosts,
    frozenReferenceApplicable: frozenWorkloads,
    numericalPolicy, numerical, memory, package: packageIdentity, browserIdentity, peer, modelDirectory, referenceSource,
    generation: { ...profile.generation, ...policy.generation, maxSeqLen: policy.maxSeqLen },
    maxGpuBufferBytes: policy.maxGpuBufferBytes, bufferPool: policy.bufferPool, referenceGeneration,
    referenceSha256: '9444f0d632de4b51624752a8c3d05a1e7cd7aea4b4ebaef71d96663bb650b6bd' }, null, 2));
}
