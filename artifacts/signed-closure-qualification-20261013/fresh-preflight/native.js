import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { connectNativePartitionEndpoint } from '/var/tmp/reploid-closure-qualification-20261013/tests/fixtures/native-partition-endpoint.js';
const config = JSON.parse(await readFile('config.json'));
const child = spawn(process.execPath, ['--inspect=127.0.0.1:0', 'tests/fixtures/native-partition-process.js', 'config.json'], { stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '', stderr = '', endpoint;
child.stdout.on('data', data => { stdout += data; });
child.stderr.on('data', data => { stderr += data; });
const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
const result = { scope: 'Installed native artifact provider and adapter observation; no device, kernels or model execution', pid: child.pid, node: process.version, gpuOpenRequested: true, config };
try {
  const started = Date.now();
  while (!stdout.includes('nativeFixtureReady')) {
    if (child.exitCode !== null) throw Error(`Owned fixture exited early: ${stderr}`);
    assert(Date.now() - started < 120000, 'Owned fixture did not become ready');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const url = stderr.match(/ws:\/\/127\.0\.0\.1:\d+\/[^\s]+/)?.[0];
  assert(url, 'Owned inspector URL missing');
  endpoint = await connectNativePartitionEndpoint(url);
  result.observedIdentity = endpoint.identity;
  assert.equal(endpoint.identity.fixture.nativeDeliverySha256, config.nativeDeliverySha256);
  assert.equal(endpoint.identity.fixture.testDelivery.installedFiles, 1976);
  assert.equal(endpoint.identity.fixture.testDelivery.archiveSha256, '0fadac5113d2cc154f65d9d40de50722a16454995e927c7d22bedc5f1a4925cd');
  result.beforeClose = await endpoint.page.evaluate(() => ({ residentPresent: Boolean(globalThis.resident), gpuPresent: Boolean(globalThis.navigator?.gpu) }));
  assert.equal(result.beforeClose.residentPresent, false);
  assert.equal(result.beforeClose.gpuPresent, false);
  await endpoint.open();
  result.providerObservation = await endpoint.page.evaluate(async () => {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw Error('Native provider returned no adapter');
    const info = adapter.info;
    return { rawAdapter: { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description },
      features: [...adapter.features].sort(), nativeProvider: await __nativePartitionFixture.observeProvider(),
      modelLoaded: Boolean(globalThis.resident), deviceRequested: false };
  });
  assert.equal(result.providerObservation.modelLoaded, false);
  result.close = await endpoint.close(); endpoint = null;
  assert.equal(result.close.providerOpened, true);
  assert.equal(result.close.ownedProviderReleased, true);
  result.exit = await Promise.race([exit, new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('Owned process did not exit naturally')), 10000); timer.unref(); })]);
  assert.deepEqual(result.exit, { code: 0, signal: null });
  result.executable = { path: process.execPath, sha256: createHash('sha256').update(await readFile(process.execPath)).digest('hex') };
  result.passed = true;
} catch (error) {
  result.failure = { message: error.message, stack: error.stack };
  if (endpoint) {
    try {
      result.cleanupAfterFailure = await endpoint.close();
      result.exit = await Promise.race([exit, new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('Owned cleanup exit timed out')), 10000); timer.unref(); })]);
    } catch (close) { result.closeFailure = close.message; }
  }
  if (child.exitCode === null) { result.forcedOwnedProcessTermination = true; child.kill('SIGTERM'); result.exit = await exit; }
} finally {
  result.stdoutSha256 = createHash('sha256').update(stdout).digest('hex');
  await writeFile('/var/tmp/reploid-closure-qualification-output-20261013/fresh-native-preflight.stdout.log', stdout); await writeFile('/var/tmp/reploid-closure-qualification-output-20261013/fresh-native-preflight.stderr.log', stderr);
  await writeFile('/var/tmp/reploid-closure-qualification-output-20261013/fresh-native-preflight.json', JSON.stringify(result, null, 2) + '\n');
}
console.log(JSON.stringify({ passed: result.passed, failure: result.failure, pid: child.pid, close: result.close, exit: result.exit }));
if (!result.passed) throw Error('Installed native fixture preflight failed');
