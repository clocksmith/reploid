// @vitest-environment node
import { test, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, mkdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { connectNativeInspector, connectNativePartitionEndpoint } from '../fixtures/native-partition-endpoint.js';
import { runConcurrentPartitionMemory } from '../fixtures/concurrent-partition-memory.js';
import { assertNativePartitionPhase } from '../fixtures/partition-diagnostic-selection.js';
import { observeResidentOpening } from '../fixtures/resident-opening-observer.js';

async function withInspector(script, run) {
  const child = spawn(process.execPath, ['--inspect=127.0.0.1:0', '--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit'); let stderr = '';
  const endpoint = new Promise((resolve, reject) => {
    child.stderr.on('data', chunk => { stderr += chunk; const found = stderr.match(/ws:\/\/127\.0\.0\.1:\d+\/[a-z0-9-]+/); if (found) resolve(found[0]); });
    child.once('error', reject); child.once('exit', code => reject(new Error(`Inspector exited ${code}: ${stderr}`)));
  });
  const ready = once(child.stdout, 'data');
  try { await ready; await run(await endpoint); }
  finally { child.kill('SIGTERM'); await exited; }
}
const fixtureScript = `const timer = setInterval(()=>{},1000);globalThis.__nativePartitionFixture={identity:{schema:'reploid.native-partition-fixture/v1'},importModule:url=>import(url),open:async()=>({synthetic:true}),close:async()=>{clearInterval(timer);return {closed:true}}};console.log('ready');`;
test('rejects a non-loopback inspector before connecting', async () => {
  await expect(connectNativeInspector('ws://example.com:9229/id')).rejects.toThrow('loopback');
});
test('real Node inspector evaluates fixture operations and preserves thrown errors without any GPU', async () => {
  await withInspector(fixtureScript, async url => {
    const endpoint = await connectNativePartitionEndpoint(url);
    expect(endpoint.identity.node).toBe(process.versions.node);
    expect(await endpoint.open()).toEqual({ synthetic: true });
    expect(await endpoint.page.evaluate(async value => value + 1, 41)).toBe(42);
    const pairedBytes = Buffer.from([0, 0, 128, 63, 0, 0, 0, 128, 1, 0, 0, 0, 255, 255, 127, 0]).toString('base64');
    expect(await endpoint.page.evaluate(encoded => btoa(atob(encoded)), pairedBytes)).toBe(pairedBytes);
    await expect(endpoint.page.evaluate(() => { throw new Error('owned fixture failure'); })).rejects.toThrow('owned fixture failure');
    expect(await endpoint.close()).toEqual({ closed: true });
  });
});
test('rejects an inspector lacking the owned fixture marker', async () => {
  await withInspector("setInterval(()=>{},1000);console.log('ready')", async url => {
    await expect(connectNativePartitionEndpoint(url)).rejects.toThrow('prepared native fixture');
  });
});
test('same resident observer captures actual Node lexical identity from exact module bytes', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'reploid-native-observer-')));
  const factorySource = `export async function open(){const allocation={index:1,planId:'synthetic',model:{identity:'synthetic'}};const opened={advanced:{getResolvedRuntimeSession:()=>({actual:42})}};let handle;\nhandle = opened;\nreturn handle;}`;
  const identitySource = 'export function observeInitialExecutionIdentity(resolved){return {actual:resolved.actual,synthetic:true}}';
  try {
    await mkdir(join(root, 'client')); await mkdir(join(root, 'config'));
    await writeFile(join(root, 'package.json'), '{"type":"module"}');
    await writeFile(join(root, 'client/resident-partitions.js'), factorySource);
    await writeFile(join(root, 'config/initial-execution-identity.js'), identitySource);
    await withInspector(fixtureScript, async url => {
      const endpoint = await connectNativePartitionEndpoint(url);
      const base = pathToFileURL(root + '/').href;
      const observer = await observeResidentOpening(endpoint.page, { runtimeBaseUrl: base, factorySource, identitySource });
      try {
        const session = await endpoint.page.context().newCDPSession();
        try {
          const result = await session.send('Runtime.evaluate', { expression: `__nativePartitionFixture.importModule(${JSON.stringify(base + 'client/resident-partitions.js')}).then(module => module.open())`, awaitPromise: true, returnByValue: true });
          expect(result.exceptionDetails).toBeUndefined();
        } finally { await session.detach(); }
        expect((await observer.finish()).initialExecutionIdentity).toEqual({ actual: 42, synthetic: true });
      } finally { await observer.close(); await endpoint.close(); }
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('failed owned cleanup is not reported as a released provider', async () => {
  await withInspector(fixtureScript.replace("clearInterval(timer);return {closed:true}", "throw Error('resident ownership unsettled')"), async url => {
    const endpoint = await connectNativePartitionEndpoint(url);
    expect(Number.isInteger(endpoint.identity.pid)).toBe(true);
    await expect(endpoint.close()).rejects.toThrow('resident ownership unsettled');
  });
});

function installSyntheticLongResident() {
  const live = new Set();
  globalThis.abortOnSubmit = null; globalThis.observePrefill = false;
  globalThis.encodeBytes = data => Buffer.from(data.buffer).toString('base64');
  globalThis.rejectOversizedAllocation = async () => ({ code: 'RESOURCE_EXHAUSTED', synthetic: true });
  globalThis.settleMemory = async () => ({ gpuValidationErrors: [], device: { liveBytes: 100 + live.size,
    peakBytes: 102, maxBytes: 1420000000, lost: false, categories: { weights: 100 } }, liveAttempts: [...live] });
  globalThis.resident = {
    tokenize: async () => ({ tokenIds: Array(1588).fill(7) }),
    executeGroup0: async ({ identity, step, signal }) => {
      live.add(identity.attemptId);
      if (globalThis.abortOnSubmit) {
        const controller = globalThis.abortOnSubmit; globalThis.abortOnSubmit = null;
        controller.abort(new DOMException('synthetic submitted cancellation', 'AbortError'));
      }
      signal.throwIfAborted();
      return { activationTensor: { data: new Float32Array([step]) }, continuation: { step } };
    },
    executeGroup1: async ({ identity, step, activation }) => {
      if (new Float32Array(activation.tensorData)[0] !== step) throw Error('Actual forwarded bytes differ');
      live.add(identity.attemptId);
      return { tokenId: step + 10, delta: String(step), done: step === 3,
        stopReason: step === 3 ? 'eos-token' : null, continuation: { step } };
    },
    closeAttempt: async ({ identity }) => { live.delete(identity.attemptId); }
  };
}
test('unchanged concurrent lifecycle runs through actual Node inspector calls in both roles (synthetic residents)', async () => {
  await withInspector(fixtureScript, async first => withInspector(fixtureScript, async second => {
    const endpoints = await Promise.all([first, second].map(connectNativePartitionEndpoint));
    try {
      assertNativePartitionPhase('concurrent', null);
      for (const reversed of [false, true]) {
        const pages = endpoints.map(endpoint => endpoint.page);
        for (const page of pages) await page.evaluate(installSyntheticLongResident);
        const runs = [], ordered = reversed ? [...pages].reverse() : pages;
        await runConcurrentPartitionMemory({ pages, pageA: ordered[0], pageB: ordered[1],
          request: { model: { id: 'synthetic', identity: 'synthetic' }, messages: [] },
          generation: { maxTokens: 8 }, planId: 'synthetic', runs, persist: async () => {} });
        expect(runs.map(row => row.inputTokens)).toEqual([1588, 1588, 1588, 1588]);
        expect(runs[1].cancelled).toBe(true);
        expect(runs[2].duringOverlap.every(row => row.liveAttempts.length === 2)).toBe(true);
        expect(runs[2].text).toBe(runs[0].text); expect(runs[3].tokenIds).toEqual(runs[0].tokenIds);
        expect(runs.every(row => row.closed)).toBe(true);
      }
    } finally { for (const endpoint of endpoints) await endpoint.close(); }
  }));
});
