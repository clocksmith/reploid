/** Isolated installed-native host used only by the physical numerical fixture. */
import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyNumericalTestDelivery } from './numerical-test-delivery.js';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const config = JSON.parse(await readFile(process.argv[2]));
const app = resolve(config.applicationDirectory), deliveryBytes = await readFile(resolve(app, 'native-delivery.json'));
assert.equal(hash(deliveryBytes), config.nativeDeliverySha256, 'Native application delivery changed');
const delivery = JSON.parse(deliveryBytes);
assert.equal(delivery.schema, 'reploid.native-delivery/v1');
for (const entry of delivery.entries) {
  assert(!entry.path.startsWith('/') && !entry.path.split('/').includes('..'));
  assert.equal(hash(await readFile(resolve(app, entry.path))), entry.sha256, `Native application file changed: ${entry.path}`);
}
const runtimeRoot = await realpath(resolve(app, 'node_modules/doppler-gpu'));
const verified = await verifyNumericalTestDelivery({ ...config.testDelivery, runtimeDirectory: runtimeRoot });
const requireInstalled = createRequire(resolve(app, 'package.json'));
assert.equal(config.providerModule, 'webgpu', 'This fixture qualifies the explicitly selected Dawn provider only');
const providerPath = requireInstalled.resolve(config.providerModule);
const providerPackagePath = resolve(app, 'node_modules', config.providerModule, 'package.json');
const providerPackage = JSON.parse(await readFile(providerPackagePath));
const { createNativeGpuHost } = await import(pathToFileURL(resolve(app, 'server/native-participant.js')));
const gpu = createNativeGpuHost(() => import(pathToFileURL(providerPath)));
let open = false, closed = false;
let finish;
const lifetime = new Promise(resolve => { finish = resolve; });
const keepAlive = setInterval(() => {}, 1000);
globalThis.__nativePartitionFixture = Object.freeze({
  identity: { schema: 'reploid.native-partition-fixture/v1', nativeDeliverySha256: config.nativeDeliverySha256,
    testDelivery: verified, runtimeBaseUrl: pathToFileURL(runtimeRoot + '/src/').href,
    config: { DOPPLER_PARTITIONS_MODULE_URL: pathToFileURL(runtimeRoot + '/src/partitions.js').href,
      DOPPLER_KERNEL_BASE_URL: pathToFileURL(runtimeRoot + '/src/gpu/kernels/').href,
      DOPPLER_PACKAGE_VERSION: delivery.runtime.version },
    provider: { module: config.providerModule, version: providerPackage.version,
      entrySha256: hash(await readFile(providerPath)), packageSha256: hash(await readFile(providerPackagePath)) } },
  async importModule(url) {
    const target = new URL(url);
    assert(target.href.startsWith(pathToFileURL(runtimeRoot + '/src/').href) && !target.search && !target.hash,
      'Native fixture imports must stay inside the verified installed runtime');
    return import(target.href);
  },
  async open() {
    assert(!open && !closed, 'Native fixture provider may open once');
    await gpu.open(); open = true;
    return this.identity;
  },
  async observeProvider() {
    const libraries = [];
    for (const path of process.report.getReport().sharedObjects) {
      const bytes = await readFile(path); libraries.push({ path, bytes: bytes.length, sha256: hash(bytes) });
    }
    assert(libraries.some(row => row.path.endsWith('.node') && row.path.includes('webgpu')),
      'The selected native WebGPU library was not observed in this process');
    return { ...this.identity.provider, observation: 'Actual process.report sharedObjects after resident preparation', libraries };
  },
  async close() {
    if (closed) return { closed: true };
    // The controller must close residents and capture settlement first.
    await globalThis.resident?.close();
    await gpu.close(); closed = true; clearInterval(keepAlive); finish();
    return { closed: true, providerOpened: open, ownedProviderReleased: open };
  },
});
console.log(JSON.stringify({ nativeFixtureReady: __nativePartitionFixture.identity }));
try { await lifetime; } finally { clearInterval(keepAlive); }
