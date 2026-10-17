/** One bounded browser worker step using provisioned bytes; no public peers or activation. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { physicalWebGpuBrowserOptions } from './physical-webgpu-browser.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const modelRoot = path.resolve(process.argv[2] || '');
assert(process.argv[2], 'Pass a provisioned model directory');
const pooled = process.argv[3] === 'pooled';
assert(!process.argv[3] || pooled, 'Only the declared pooled mode is supported');
const receiptName = pooled ? 'browser-gpu-pooled' : 'browser-gpu';
const directory = path.join(root, 'artifacts/community-lora-20261017');
const policy = JSON.parse(await fs.readFile(path.join(root, 'self/config/lora-training.json')));
const native = JSON.parse(await fs.readFile(path.join(directory, 'native.json')));
const pin = JSON.parse(await fs.readFile(path.join(root, 'self/config/doppler-package.json')));
const reference = pooled
  ? { kind: 'supervised-token-weighted contribution loss', absoluteTolerance: 0.000001 }
  : { kind: 'native M3 step', loss: native.metrics[0].loss, absoluteTolerance: 0.0001 };
const contract = { modelId: policy.modelId, baseManifestHash: policy.baseManifestHash,
  samples: [{ inputIds: [100, 200, 300], targetIds: [200, 300, 400], supervisedTokenCount: 3 }],
  contributorSample: pooled ? { inputIds: [100], targetIds: [200], supervisedTokenCount: 1 } : null,
  steps: 1, participants: pooled ? 2 : 1, pooled, timeoutMs: policy.timeoutMs, publicDisclosureBytes: 0, activated: false, reference, package: pin };
await fs.writeFile(path.join(directory, receiptName + '-contract.json'), JSON.stringify(contract, null, 2) + '\n');
let origin;
const server = http.createServer(async (request, response) => {
  try {
    const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (name === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Bounded training check</title>'); return; }
    if (name === '/config/chat-models.json') {
      const catalog = JSON.parse(await fs.readFile(path.join(root, 'self', name)));
      catalog.find(row => row.id === policy.modelId).source.baseUrl = origin + '/model/';
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(catalog)); return;
    }
    const base = name.startsWith('/model/') ? modelRoot : path.join(root, 'self');
    const file = path.resolve(base, '.' + (name.startsWith('/model/') ? name.slice(6) : name));
    if (!file.startsWith(base + '/')) throw Error('Invalid path');
    const stat = await fs.stat(file);
    response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.json') ? 'application/json' : 'application/octet-stream');
    const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0, end = range && range[2] ? Number(range[2]) : stat.size - 1;
    assert(start >= 0 && end >= start && end < stat.size, 'Invalid range');
    if (range) { response.statusCode = 206; response.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`); }
    response.setHeader('Content-Length', end - start + 1);
    createReadStream(file, { start, end }).pipe(response);
  } catch (error) { response.statusCode = 404; response.end(error.message); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
origin = 'http://127.0.0.1:' + server.address().port;
let browser, timeout, result;
const started = Date.now();
try {
  browser = await chromium.launch(physicalWebGpuBrowserOptions(process.platform));
  timeout = setTimeout(() => { void browser.close(); }, contract.timeoutMs + 10000);
  const context = await browser.newContext();
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  const page = await context.newPage();
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  await page.goto(origin);
  result = await page.evaluate(async contract => {
    const { createTrainingSession, createTrainingNetwork } = await import('/vendor/reploid/training/index.js');
    const { createTrainingWorker } = await import('/host/lora-training.js');
    const policy = await (await fetch('/config/lora-training.json')).json();
    const sessions = [], connections = [], networks = [], ports = [], applied = [];
    const ids = ['peer:' + 'a'.repeat(24), 'peer:' + 'b'.repeat(24)];
    try {
      if (contract.pooled) {
        // Real local WebRTC, with direct test-host signaling and trusted identity ports.
        // This is deliberately not public mesh discovery or signature qualification.
        const { createPartitionNetwork } = await import('/vendor/reploid/mesh/partitions/partition-network.js');
        const certificates = await Promise.all([0, 1].map(() => RTCPeerConnection.generateCertificate({ name: 'ECDSA', namedCurve: 'P-256' })));
        certificates.forEach(certificate => connections.push(new RTCPeerConnection({ certificates: [certificate], iceServers: [] })));
        const listeners = [new Map(), new Map()];
        connections.forEach((connection, side) => {
          connection.ondatachannel = ({ channel }) => {
            const listener = listeners[side].get(channel.label);
            if (listener) listener('remote', channel); else channel.close();
          };
        });
        const gathering = connection => new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(Error('ICE gathering deadline')), 10000);
          const check = () => { if (connection.iceGatheringState === 'complete') { clearTimeout(timer); connection.removeEventListener('icegatheringstatechange', check); resolve(); } };
          connection.addEventListener('icegatheringstatechange', check); check();
        });
        connections[0].createDataChannel('bootstrap');
        await connections[0].setLocalDescription(await connections[0].createOffer()); await gathering(connections[0]);
        await connections[1].setRemoteDescription(connections[0].localDescription);
        await connections[1].setLocalDescription(await connections[1].createAnswer()); await gathering(connections[1]);
        await connections[0].setRemoteDescription(connections[1].localDescription);
        const fingerprint = side => certificates[side].getFingerprints().find(item => item.algorithm === 'sha-256').value.toLowerCase();
        for (const side of [0, 1]) {
          const binding = () => ({ local: fingerprint(side), remote: connections[side].remoteDescription.sdp.match(/a=fingerprint:sha-256 ([^\r\n]+)/)[1].toLowerCase() });
          networks.push(createTrainingNetwork({ policy, localParticipantId: ids[side],
            allowed: peer => ports[side].allowed(peer), receive: request => ports[side].receive(request),
            openNetwork: options => createPartitionNetwork({ ...options,
              verifyPeer: async () => {
                if (binding().remote !== fingerprint(1 - side)) throw Error('Unexpected certificate');
                return ids[1 - side];
              },
              transport: { getPeerBinding: binding,
                onDataChannel(label, listener) { listeners[side].set(label, listener); return () => listeners[side].delete(label); },
                openDataChannel: (_peer, label) => connections[side].createDataChannel(label) }
            }) }));
        }
      }
      for (let side = 0; side < contract.participants; side++) {
        sessions.push(createTrainingSession({ policy, participantId: async () => ids[side],
          openExecutor: async ({ onProgress }) => {
            const executor = createTrainingWorker({ onProgress });
            return { close: () => executor.close(), async request(action, input, options) {
              const value = await executor.request(action, input, options);
              if (action === 'apply') applied.push({ contributions: input.contributions.map(row => ({
                participantId: row.participantId, loss: row.loss, tokens: row.supervisedTokenCount,
                roundHash: row.roundHash, checkpointHash: row.checkpointHash })), result: value });
              return value;
            } };
          },
          openNetwork: handlers => { if (!contract.pooled) throw Error('Peers excluded'); ports[side] = handlers; return networks[side]; },
          connectPeer: (network, peer, signal) => network.connect(peer, signal) }));
      }
      if (contract.pooled) {
        await Promise.all(sessions.map(session => session.connect()));
        await sessions[1].contribute({ consent: true, coordinator: 'remote',
          sample: contract.contributorSample });
      }
      const candidate = await sessions[0].run({ consent: true, samples: contract.samples,
        peers: contract.pooled ? ['remote'] : [],
        adapter: { id: 'reploid-browser-check', name: 'Reploid browser check', version: '0.0.1' } });
      return { loss: candidate.metrics[0].loss, bytes: candidate.weights.byteLength, weightsSha256: candidate.weightsSha256,
        baseManifestHash: candidate.manifest.metadata.baseManifestHash, activated: candidate.activated, evaluated: candidate.evaluated,
        applied, contributorPhase: sessions[1]?.getState().phase || null };
    } finally {
      await Promise.all(sessions.map(session => session.close()));
      await Promise.all(networks.map(network => network.close())); connections.forEach(connection => connection.close());
    }
  }, contract);
  assert.equal(result.baseManifestHash, policy.baseManifestHash);
  assert.equal(result.activated, false); assert.equal(result.evaluated, false);
  assert(Number.isFinite(result.loss));
  if (pooled) {
    assert.equal(result.applied.length, 1); assert.equal(result.contributorPhase, 'contributed');
    const contributions = result.applied[0].contributions; assert.equal(contributions.length, 2);
    const tokens = contributions.reduce((sum, row) => sum + row.tokens, 0);
    const expected = contributions.reduce((sum, row) => sum + row.loss * row.tokens, 0) / tokens;
    assert(Math.abs(result.loss - expected) <= reference.absoluteTolerance, 'Shared loss does not match token weighting');
  } else assert(Math.abs(result.loss - reference.loss) <= reference.absoluteTolerance, 'Native/browser loss differs beyond frozen tolerance');
  result = { passed: true, ...result };
} catch (error) { result = { passed: false, error: error.message, observation: result || null }; }
finally {
  clearTimeout(timeout); await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
const receipt = { schema: 'reploid.browser-training-check/v1', at: new Date().toISOString(), elapsedMs: Date.now() - started,
  scope: pooled ? 'Two Chrome workers on one M3, real local WebRTC with trusted test-host identity/signaling ports; no public discovery, cross-machine or quality qualification' : 'One physical Chrome worker step; local model-source override only; no pooled or quality qualification', contract, ...result };
await fs.writeFile(path.join(directory, receiptName + '.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
if (!result.passed) process.exitCode = 1;
