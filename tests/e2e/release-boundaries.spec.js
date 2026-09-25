import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('generated mesh imports without an import map or loading Doppler', async ({ page }) => {
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  await page.route('**/release-import-probe', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Import boundary test</title>'
  }));
  await page.goto('/release-import-probe');
  const exports = await page.evaluate(async () => {
    const mesh = await import('/vendor/reploid/mesh/index.js');
    return [typeof mesh.createLayerPartitionRunner, typeof mesh.verifySplitParity];
  });
  expect(exports).toEqual(['function', 'function']);
  expect(requests.filter(url => /doppler|jsdelivr|huggingface/.test(url))).toEqual([]);
});

test('Verification Worker accepts mutable release boundary modules', async ({ page }) => {
  const paths = ['vendor/reploid/mesh/partitions/partition-runner.js',
    'infrastructure/doppler-runtime-service.js', 'providers/doppler-reploid.js',
    'host/work-swarm.js', 'host/swarm-autoconnect.js', 'host/chat-session.js',
    'providers/work-provider.js', 'providers/work-device.js', 'providers/work-resident-provider.js',
    'vendor/reploid/mesh/remote-generation-requests.js', 'vendor/reploid/mesh/legacy-generation.js',
    'vendor/reploid/mesh/peer-identity.js',
    'vendor/reploid/artifacts/custody/runtime.js', 'pool/adapter-registry.js', 'pool/peer-adapter-execution.js',
    'ui/pool-home/conversation-workspace.js',
    'capabilities/communication/swarm-join-policy.js', 'capabilities/communication/library-adapter.js',
    'vendor/reploid/transport/room.js', 'vendor/reploid/transport/swarm.js',
    'config/doppler-local-models.js', 'providers/work-network-provider.js'];
  const snapshot = Object.fromEntries(await Promise.all(paths.map(async path =>
    ['/' + path, await readFile('self/' + path, 'utf8')])));
  await page.goto('/');
  const result = await page.evaluate(snapshot => new Promise((resolve, reject) => {
    const worker = new Worker('/core/verification-worker.js');
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Verification timed out')); }, 10000);
    worker.onmessage = event => { clearTimeout(timer); worker.terminate(); resolve(event.data); };
    worker.onerror = event => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)); };
    worker.postMessage({ type: 'VERIFY', snapshot });
  }), snapshot);
  expect(result.errors).toEqual([]);
  expect(result.passed).toBe(true);
});

test('Verification Worker still rejects bootstrap storage authority as mutable candidates', async ({ page }) => {
  // Bootstrap storage is intentionally outside candidate authority. The repair
  // must not grant those privileges to self-modifying code to pass this gate.
  const snapshot = Object.fromEntries(await Promise.all(['host/vfs-bootstrap.js', 'kernel/boot.js'].map(async path =>
    ['/' + path, await readFile('self/' + path, 'utf8')])));
  await page.goto('/');
  const result = await page.evaluate(snapshot => new Promise((resolve, reject) => {
    const worker = new Worker('/core/verification-worker.js');
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Verification timed out')); }, 10000);
    worker.onmessage = event => { clearTimeout(timer); worker.terminate(); resolve(event.data); };
    worker.onerror = event => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)); };
    worker.postMessage({ type: 'VERIFY', snapshot });
  }), snapshot);
  expect(result.passed).toBe(false);
  expect(result.errors).toEqual([
    'Security Violation in /host/vfs-bootstrap.js: Direct IndexedDB access forbidden - use VFS',
    'Security Violation in /kernel/boot.js: Direct localStorage access forbidden - use StateManager'
  ]);
});
