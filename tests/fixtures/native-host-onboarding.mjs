// Qualify an installed candidate on this machine with fresh host storage and a private loopback room.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { PublicSwarmServer } from '../../server/public-swarm-server.js';

assert.ok(process.argv[2], 'Usage: node tests/fixtures/native-host-onboarding.mjs /path/to/installed/reploid');
const installed = resolve(process.argv[2]);
const { version, dependencies } = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
const cli = join(installed, 'server/native-node.js');
const state = await mkdtemp(join(os.tmpdir(), 'reploid-onboarding-state-'));
const model = '0.8b';
const room = `reploid-swarm-onboarding-${randomUUID()}`;
const tokenFile = join(state, 'room-token');
await writeFile(tokenFile, randomUUID(), { mode: 0o600 });
const signaling = new PublicSwarmServer({ logger: { log() {} } });
const server = createServer();
server.on('upgrade', (request, socket, head) => signaling.handleUpgrade(request, socket, head));
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const roomArgs = ['--room', room, '--room-token-file', tokenFile, '--signaling-url',
  `ws://127.0.0.1:${server.address().port}${signaling.options.path}`];
const weights = join(state, 'host', 'weights');
const serve = [cli, 'serve', model, '--weights', weights, '--identity-file', join(state, 'host', 'identity.json'), ...roomArgs];
const children = [];

function launch(args, onEvent = () => {}, timeoutMs = 900_000) {
  const startedAt = performance.now();
  const child = spawn(process.execPath, args, { cwd: installed, stdio: ['ignore', 'pipe', 'pipe'] });
  const lastLines = [];
  const remember = line => { lastLines.push(line); if (lastLines.length > 12) lastLines.shift(); };
  createInterface({ input: child.stdout }).on('line', line => {
    remember(line);
    let event;
    try { event = JSON.parse(line); } catch { return; }
    onEvent(event, child);
  });
  createInterface({ input: child.stderr }).on('line', remember);
  const exited = once(child, 'close').then(([code, signal]) => ({ code, signal, elapsedMs: performance.now() - startedAt }));
  const timeout = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  void exited.finally(() => clearTimeout(timeout)).catch(() => {});
  const run = { child, exited, error: () => lastLines.join('\n') };
  children.push(run);
  return run;
}

try {
  let preflight = null;
  let interruptedAt = null;
  const first = launch(serve, (event, child) => {
    if (event.event === 'native-gpu-preflight') preflight = event;
    if (!interruptedAt && event.event === 'model-fill' && event.phase === 'piece' && event.fetchedBytes > 0) {
      interruptedAt = event;
      child.kill('SIGINT');
    }
  });
  const interrupted = await first.exited;
  assert.ok(interruptedAt, first.error());
  assert.ok(preflight && preflight.maxStorageBufferBindingSize > 0, 'A real GPU check must precede the first model bytes');
  assert.notEqual(interrupted.signal, 'SIGKILL', first.error());
  assert.ok((await readdir(weights)).some(name => name.endsWith('.partial')), 'The interruption must leave partial weights');
  assert.ok(!(await readdir(weights)).includes('manifest.json'), 'Do not mark an interrupted directory verified');

  const ready = Promise.withResolvers();
  let completion = null;
  let lastProgress = 0;
  const resumed = launch(serve, event => {
    if (event.event === 'model-fill' && event.percent >= lastProgress + 10) {
      lastProgress = event.percent;
      console.error(`Verified ${event.percent}% · ${event.fetchedBytes} bytes fetched · ${event.reusedBytes} bytes reused`);
    }
    if (event.event === 'model-fill' && event.phase === 'complete') completion = event;
    if (event.event === 'native-host-ready') ready.resolve(event);
  });
  const host = await Promise.race([ready.promise, resumed.exited.then(() => { throw Error(resumed.error()); })]);
  assert.ok(completion?.reusedBytes > 0, 'A restart must reuse verified partial bytes');
  assert.equal(completion.percent, 100);
  assert.equal(completion.verifiedBytes, completion.bytes);
  assert.equal(host.gpu.backend, process.platform === 'darwin' ? 'metal' : 'vulkan');
  const manifestHash = createHash('sha256').update(await readFile(join(weights, 'manifest.json'))).digest('hex');
  assert.equal(host.modelIdentity, `sha256:${manifestHash}`);

  // Use the installed participant and its normal ask request without touching the user's default state.
  const ask = `import { pathToFileURL } from 'node:url';
    const [native, requester, ...args] = process.argv.slice(1);
    process.argv = [process.execPath, 'onboarding-requester', ...args];
    const { main } = await import(pathToFileURL(native));
    const { askMesh } = await import(pathToFileURL(requester));
    await main({ runOnce: async (participant, model, signal) => {
      let receipt = null, provider = null, selected = null;
      const recording = { ...participant, async generate(request, controls) {
        const result = await participant.generate(request, controls);
        ({receipt, providerIdentity: provider} = result.execution);
        selected = result.modelIdentity;
        return result;
      }};
      const answer = await askMesh(recording, model, 'Reply with only the number 42.', { signal, report() {} });
      console.log(JSON.stringify({event:'onboarding-answer', answer, receipt, provider, selected}));
    }});`;
  let answer = null;
  const requester = launch(['--input-type=module', '--eval', ask, '--', join(installed, 'server/native-participant.js'),
    join(installed, 'server/native-node-ask.js'), '--model', host.modelId, '--connect-only', '--model-directory', state,
    '--identity-file', join(state, 'requester', 'identity.json'), '--rtc-module', '@roamhq/wrtc', '--ws-module', 'ws', ...roomArgs],
  event => { if (event.event === 'onboarding-answer') answer = event; }, 180_000);
  const result = await requester.exited;
  assert.equal(result.code, 0, requester.error());
  assert.match(answer?.answer || '', /\b42\b/);
  assert.equal(answer.selected, host.modelIdentity);
  assert.equal(answer.provider, host.participantId);
  assert.ok(answer.receipt, 'The real answer must carry a provider receipt');
  console.log(JSON.stringify({ platform: process.platform, packageVersion: version, dopplerDependency: dependencies.dopplerx,
    modelId: host.modelId, modelIdentity: host.modelIdentity, gpu: host.gpu,
    interruptedAfterFetchedBytes: interruptedAt.fetchedBytes, interruptedExitCode: interrupted.code,
    interruptedProcessMs: Math.round(interrupted.elapsedMs), resumedFetchedBytes: completion.fetchedBytes,
    resumedReusedBytes: completion.reusedBytes, resumedToReadyMs: host.elapsedMs, requestProcessMs: Math.round(result.elapsedMs),
    answer: answer.answer.trim(), receiptSha256: createHash('sha256').update(JSON.stringify(answer.receipt)).digest('hex') }, null, 2));
} finally {
  await Promise.allSettled(children.map(async ({ child, exited }) => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await exited;
  }));
  signaling.close();
  await new Promise(resolveClose => server.close(resolveClose));
  await rm(state, { force: true, recursive: true });
}
