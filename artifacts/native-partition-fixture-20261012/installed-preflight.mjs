import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { connectNativePartitionEndpoint } from './tests/fixtures/native-partition-endpoint.js';
const config = JSON.parse(await readFile('config.json'));
const child = spawn(process.execPath, ['--inspect=127.0.0.1:0', 'tests/fixtures/native-partition-process.js', 'config.json'], { stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '', stderr = '', endpoint;
child.stdout.on('data', data => { stdout += data; });
child.stderr.on('data', data => { stderr += data; });
const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
const result = { scope: 'Installed native artifact CPU-only fixture verification and natural shutdown; no provider open or model execution', pid: child.pid, node: process.version, gpuOpenRequested: false, config };
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
  assert.equal(endpoint.identity.fixture.testDelivery.installedFiles, 1974);
  assert.equal(endpoint.identity.fixture.testDelivery.archiveSha256, '8cae56b0748a5c66add985122d8bbf72b7492e2e0828f713f1b0d7425a59a4e5');
  result.beforeClose = await endpoint.page.evaluate(() => ({ residentPresent: Boolean(globalThis.resident), gpuPresent: Boolean(globalThis.navigator?.gpu) }));
  assert.equal(result.beforeClose.residentPresent, false);
  assert.equal(result.beforeClose.gpuPresent, false);
  result.close = await endpoint.close(); endpoint = null;
  assert.equal(result.close.providerOpened, false);
  assert.equal(result.close.ownedProviderReleased, false);
  result.exit = await Promise.race([exit, new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('Owned process did not exit naturally')), 10000); timer.unref(); })]);
  assert.deepEqual(result.exit, { code: 0, signal: null });
  result.passed = true;
} catch (error) {
  result.failure = { message: error.message, stack: error.stack };
  if (endpoint) await endpoint.close().catch(close => { result.closeFailure = close.message; });
  if (child.exitCode === null) { result.forcedOwnedProcessTermination = true; child.kill('SIGTERM'); await exit; }
} finally {
  result.stdoutSha256 = createHash('sha256').update(stdout).digest('hex');
  await writeFile('preflight.stdout.log', stdout); await writeFile('preflight.stderr.log', stderr);
  await writeFile('preflight.json', JSON.stringify(result, null, 2) + '\n');
}
console.log(JSON.stringify({ passed: result.passed, failure: result.failure, pid: child.pid, close: result.close, exit: result.exit }));
if (!result.passed) throw Error('Installed native fixture preflight failed');
