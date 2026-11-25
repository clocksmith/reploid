// @vitest-environment node
/**
 * The attested GPU executor process surface on loopback: HTTP offer and readiness, a WebSocket session driven by
 * the pilot harness's requester flow (the same code the browser page runs), the loopback OpenAI-compatible runtime
 * adapter, and launch measurement. Evidence is SYNTHETIC; configfs-tsm and NVML are exercised only on real hardware.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startAttestedExecutor } from '../../server/attested-gpu/executor.js';
import { createOpenAiRuntime } from '../../server/attested-gpu/openai-runtime.js';
import { measureLaunch, parseSnpCertTable, ocspRequest } from '../../server/attested-gpu/cvm-evidence.js';
import { createSyntheticWorld, syntheticHost } from '../helpers/attested-gpu-fixtures.js';
import { runAttestedRequest, pilotLedger, taskMessages } from '../../scripts/attested-gpu-pilot.js';
import * as inferenceModule from '../../packages/reploid/src/inference/index.js';
import * as attestedModule from '../../packages/reploid/src/inference/attested/execution.js';
import * as wsModule from '../../packages/reploid/src/inference/attested/websocket-channel.js';
import { parseCertificate } from '../../packages/reploid/src/inference/attested/x509.js';
import task from '../fixtures/attested-gpu/build-diagnosis-task.json' with { type: 'json' };

let world, runtime, executor, logs;
beforeAll(async () => {
  world = await createSyntheticWorld({ now: Date.now() });
  // A fake loopback runtime speaking streamed chat completions with usage, as llama.cpp server and vLLM do.
  runtime = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const request = JSON.parse(body);
      res.setHeader('content-type', 'text/event-stream');
      for (const piece of ['readSettings ', 'replaces ', 'loadSettings.']) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: request.messages[0].content.length >> 2, completion_tokens: 3 } })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise(resolve => runtime.listen(0, '127.0.0.1', resolve));
  const generate = createOpenAiRuntime({ baseUrl: `http://127.0.0.1:${runtime.address().port}`, model: 'qwen' });
  const host = { ...syntheticHost(world, { platform: 'amd-sev-snp' }), generate };
  logs = [];
  executor = await startAttestedExecutor({ host, log: record => logs.push(record), offer: { schema: 'reploid.attested-gpu-offer/v1', participantId: host.participantId,
    platform: 'amd-sev-snp', launchId: 'synthetic-snp-27b', model: host.launch.model, operator: 'loopback (synthetic)', price: { unit: 'noncash-service-credit', creditsPerOutputToken: 1 } } });
}, 60000);
afterAll(async () => { await executor?.close(); runtime?.close(); });

describe('attested GPU executor on loopback', () => {
  it('serves an open offer and readiness', async () => {
    const response = await fetch(`${executor.url}/offer`);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect((await response.json()).launchId).toBe('synthetic-snp-27b');
    expect((await fetch(`${executor.url}/ready`)).status).toBe(200);
  });

  it('runs the pilot requester flow over WebSocket and logs no content', async () => {
    const ledger = pilotLedger(1000);
    const out = await runAttestedRequest({ inferenceModule, attestedModule, wsModule, executorUrl: executor.url, policy: world.policy, credits: ledger.ports,
      messages: taskMessages(task) });
    expect(out.result).toMatchObject({ status: 'completed', output: { text: 'readSettings replaces loadSettings.', finishReason: 'stop' },
      usage: { outputTokens: 3 }, settlement: { charge: 3, unit: 'noncash-service-credit' } });
    expect(out.timing.firstUsefulOutputMs).toBeGreaterThanOrEqual(0);
    // The executor logs the outcome after the requester has its answer: wait for the record, not for a fixed delay.
    await vi.waitFor(() => expect(JSON.stringify(logs)).toContain('completed'), { timeout: 15000, interval: 20 });
    expect(JSON.stringify(logs)).not.toMatch(/readSettings|Build log|invoice/);
  }, 20000);
});

describe('attested GPU executor: a requester that leaves', () => {
  it('keeps serving after a client disconnects while evidence is being collected', async () => {
    let entered, release;
    const collecting = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
    const base = syntheticHost(world, { platform: 'amd-sev-snp' });
    const host = { ...base, collectGpuEvidence: async nonce => { entered(); await gate; return base.collectGpuEvidence(nonce); } };
    const seen = [];
    const slow = await startAttestedExecutor({ host, log: record => seen.push(record), offer: {} });
    try {
      const channel = await wsModule.connectWebSocketFrames(`${slow.url.replace(/^http/, 'ws')}/attested`);
      await channel.send({ header: { schema: 'reploid.attested-gpu/v1', kind: 'challenge', nonce: Buffer.alloc(32, 1).toString('base64url'),
        model: base.launch.model, launchId: null, blobs: [] }, blobs: [] });
      await collecting;
      channel.close();
      await new Promise(resolve => setTimeout(resolve, 150));   // the executor sees the close before it has evidence to send
      release();
      await vi.waitFor(() => expect(seen.filter(record => record.session)).toEqual([{ session: 'closed', code: null }]), { timeout: 15000, interval: 20 });
      expect((await fetch(`${slow.url}/ready`)).status).toBe(200);
    } finally { release(); await slow.close(); }
  }, 20000);
});

describe('executor host pieces', () => {
  it('refuses a runtime that is not on loopback', () => {
    expect(() => createOpenAiRuntime({ baseUrl: 'http://203.0.113.5:8080', model: 'm' })).toThrow(/loopback/);
  });

  it('measures the launch and refuses a changed file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'attested-launch-'));
    try {
      const runtimeFile = path.join(dir, 'runtime.js'), weights = path.join(dir, 'weights.bin');
      await writeFile(runtimeFile, 'runtime'); await writeFile(weights, 'weights');
      const sha = text => 'sha256:' + createHash('sha256').update(text).digest('hex');
      const manifest = { schema: 'reploid.attested-gpu-launch/v1', image: 'sha256:' + '5'.repeat(64),
        runtime: { name: 'llama-server', version: 'b1', files: [{ path: runtimeFile, sha256: sha('runtime') }] },
        model: { id: 'm', identity: 'sha256:' + '7'.repeat(64), files: [{ path: weights, sha256: sha('weights') }] } };
      const launch = await measureLaunch(manifest);
      expect(launch.runtime.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(launch.model).toEqual({ id: 'm', identity: manifest.model.identity });
      await writeFile(weights, 'swapped');
      await expect(measureLaunch(manifest)).rejects.toThrow(/does not match/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('reads the SEV-SNP extended report certificate table', () => {
    const guid = text => { const h = text.replace(/-/g, ''); const le = s => s.match(/../g).reverse().join(''); return Buffer.from(le(h.slice(0, 8)) + le(h.slice(8, 12)) + le(h.slice(12, 16)) + h.slice(16), 'hex'); };
    const entry = (g, offset, length) => { const b = Buffer.alloc(24); guid(g).copy(b); b.writeUInt32LE(offset, 16); b.writeUInt32LE(length, 20); return b; };
    const table = Buffer.concat([entry('63da758d-e664-4564-adc5-f4b93be8accd', 72, 2), entry('4ab7b379-bbac-4fe4-a02f-05aef327c782', 74, 1), Buffer.alloc(24), Buffer.from([1, 2, 3])]);
    expect(parseSnpCertTable(new Uint8Array(table))).toEqual({ vcek: Uint8Array.of(1, 2), ask: Uint8Array.of(3) });
  });

  it('builds an RFC 6960 OCSP request for a chain link', () => {
    const [leaf, issuer] = world.chains.gpu.map(parseCertificate);
    const der = ocspRequest(leaf, issuer);
    expect(der[0]).toBe(0x30);
    expect(der.includes(Buffer.from(leaf.serial))).toBe(true);
  });
});
