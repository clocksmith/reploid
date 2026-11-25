#!/usr/bin/env node
/**
 * An attested GPU executor: runs inside a confidential VM (AMD SEV-SNP or Intel TDX) with an NVIDIA GPU in
 * confidential-computing mode, and serves `reploid.attested-gpu/v1` sessions over WebSocket.
 * UNREVIEWED: requesters refuse it unless their host enabled the attested route and pinned this image's measurement.
 *
 *   node server/attested-gpu/executor.js --launch-manifest <launch.json> --runtime-url http://127.0.0.1:8080
 *     --runtime-model <name> --participant-id <id> --operator "<cloud, region, instance type>"
 *     [--listen 0.0.0.0:8443] [--credits-per-output-token 1] [--snp-product Genoa] [--token-per-chunk]
 *
 *   GET  /offer      the unsigned offer (CORS-open; it carries no secret and decides nothing)
 *   GET  /ready      200 once the launch is measured and the runtime answers
 *   WS   /attested   one session per connection
 *
 * Logs carry sizes, timings and codes only. The executor never logs or stores a prompt or an answer.
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { serveAttestedSession } from '../../shared/vendor/reploid/inference/attested/session.js';
import { encodeAttestedFrame, decodeAttestedFrame } from '../../shared/vendor/reploid/inference/attested/websocket-channel.js';
import { createCpuCollector, createGpuCollector, measureLaunch } from './cvm-evidence.js';
import { createOpenAiRuntime } from './openai-runtime.js';

/** Wrap a `ws` socket as a frame channel. */
export function wsFrameChannel(socket) {
  const queue = [], waiters = [];
  let failure = null;
  const finish = error => { if (failure) return; failure = error; for (const w of waiters.splice(0)) w.reject(error); };
  const closed = message => Object.assign(new Error(message), { code: 'ATTESTED_SESSION_CLOSED' });
  socket.on('message', (data, binary) => {
    if (!binary) { finish(closed('Text frame')); socket.close(); return; }
    let value;
    try { value = decodeAttestedFrame(new Uint8Array(data)); } catch (error) { finish(closed(error.message)); socket.close(); return; }
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(value); else queue.push(value);
  });
  socket.on('close', () => finish(closed('The connection closed')));
  socket.on('error', error => finish(closed(error.message)));
  return {
    send: value => new Promise((resolve, reject) => failure ? reject(failure)
      : socket.send(encodeAttestedFrame(value), { binary: true }, error => error ? reject(closed(error.message)) : resolve())),
    receive({ timeoutMs = 60000 } = {}) {
      if (queue.length) return Promise.resolve(queue.shift());
      if (failure) return Promise.reject(failure);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { waiters.splice(waiters.indexOf(waiter), 1); reject(closed('No frame in time')); }, timeoutMs);
        const waiter = { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } };
        waiters.push(waiter);
      });
    },
    close() { finish(closed('Closed')); socket.close(); }
  };
}

export function detectPlatform() {
  if (existsSync('/dev/tdx_guest')) return 'intel-tdx';
  if (existsSync('/dev/sev-guest')) return 'amd-sev-snp';
  throw new Error('No TDX or SEV-SNP guest device: this is not a confidential VM');
}

/** Start the executor with explicit ports (tests pass synthetic collectors and a fake runtime). */
export async function startAttestedExecutor({ host, offer, listen = '127.0.0.1:0', ready = async () => true, log = () => {} }) {
  const [address, port] = [listen.replace(/:\d+$/, ''), Number(listen.match(/:(\d+)$/)?.[1] ?? 0)];
  const server = http.createServer(async (req, res) => {
    const path = new URL(req.url, 'http://executor').pathname;
    res.setHeader('access-control-allow-origin', '*');
    if (req.method === 'GET' && path === '/offer') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(offer)); return; }
    if (req.method === 'GET' && path === '/ready') { const ok = await ready().catch(() => false); res.statusCode = ok ? 200 : 503; res.end(ok ? 'ready' : 'not ready'); return; }
    res.statusCode = 404; res.end();
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 << 20 });
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://executor').pathname !== '/attested') { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => {
      serveAttestedSession({ channel: wsFrameChannel(ws), host, log }).then(outcome => log({ session: outcome.outcome, code: outcome.code ?? null }));
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, address, resolve); });
  const bound = server.address();
  return { port: bound.port, url: `http://${address === '0.0.0.0' ? '127.0.0.1' : address}:${bound.port}`,
    close: () => new Promise(done => { for (const client of wss.clients) client.terminate(); server.close(() => done()); }) };
}

async function main() {
  const { values } = parseArgs({ options: {
    'launch-manifest': { type: 'string' }, 'runtime-url': { type: 'string' }, 'runtime-model': { type: 'string' },
    'participant-id': { type: 'string' }, operator: { type: 'string' }, listen: { type: 'string', default: '0.0.0.0:8443' },
    'credits-per-output-token': { type: 'string', default: '1' }, 'snp-product': { type: 'string' }, 'launch-id': { type: 'string' },
    'token-per-chunk': { type: 'boolean', default: false }
  } });
  for (const name of ['launch-manifest', 'runtime-url', 'runtime-model', 'participant-id', 'operator', 'launch-id']) {
    if (!values[name]) throw new Error(`--${name} is required`);
  }
  const started = Date.now();
  const platform = detectPlatform();
  const launch = await measureLaunch(JSON.parse(await readFile(values['launch-manifest'], 'utf8')));
  const generate = createOpenAiRuntime({ baseUrl: values['runtime-url'], model: values['runtime-model'], tokenPerChunk: values['token-per-chunk'] });
  const host = { participantId: values['participant-id'], platform, launch,
    collectCpuEvidence: createCpuCollector({ snpProduct: values['snp-product'] ?? null }), collectGpuEvidence: createGpuCollector(), generate };
  const offer = { schema: 'reploid.attested-gpu-offer/v1', participantId: host.participantId, platform, launchId: values['launch-id'],
    model: launch.model, operator: values.operator, price: { unit: 'noncash-service-credit', creditsPerOutputToken: Number(values['credits-per-output-token']) } };
  const ready = async () => (await fetch(new URL('/v1/models', values['runtime-url']), { signal: AbortSignal.timeout(5000) })).ok;
  const log = record => process.stdout.write(JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n');
  const executor = await startAttestedExecutor({ host, offer, listen: values.listen, ready, log });
  log({ executor: 'listening', port: executor.port, platform, launch, measuredInMs: Date.now() - started });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exit(1); });
}
