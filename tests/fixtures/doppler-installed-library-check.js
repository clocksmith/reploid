// Explicit v1/v2 installed-library acceptance with a producer-signed fixture.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { checkInstalledLibraryProvider } from './doppler-installed-library.js';

const consumer = process.env.DOPPLER_TEST_CONSUMER;
const format = process.env.DOPPLER_TEST_STREAM_FORMAT;
assert(consumer, 'DOPPLER_TEST_CONSUMER must identify an installed archive consumer');
assert(['v1', 'v2'].includes(format), 'DOPPLER_TEST_STREAM_FORMAT must explicitly select v1 or v2');
const entry = execFileSync(process.execPath, ['--input-type=module', '-e',
  "process.stdout.write(import.meta.resolve('doppler-gpu'))"], { cwd: consumer, encoding: 'utf8' }).trim();
assert(entry.includes('/node_modules/doppler-gpu/'));
const api = await import(entry);
const fixture = JSON.parse(await readFile(resolve(consumer, 'generation-fixture.json'), 'utf8'));
const artifacts = new Map(fixture.artifacts.map(([id, bytes]) => [id, Uint8Array.from(bytes)]));
let calls = 0, released = 0, closed = 0;
const session = await api.openCapsule(fixture.capsule, {
  trustedSigners: fixture.trustedSigners,
  artifactStore: { readArtifact: async artifact => artifacts.get(artifact.artifactId) },
  device: { getDevice: () => ({ createBuffer: () => ({ destroy() {} }), createCommandEncoder() {}, queue: { writeBuffer() {} } }),
    getProfile: () => ({ surface: 'test-webgpu', hasF16: false, hasSubgroups: false, maxBufferSize: 1024 }) },
  programFactory: async () => ({ executionGraphHash: fixture.capsule.program.executionGraphHash,
    tokenize: () => [0, 2], decodeTokens: ids => ids.join(','), getTokenContract: () => ({}),
    createIncrementalDecoder() {
      let first = true;
      return { push(id) { const text = `${first ? '' : ','}${id}`; first = false; return text; }, pendingText: () => '', finish: () => '' };
    },
    reset() {}, getActiveAdapterIdentity: () => null,
    executePhase() { calls++; return { logits: new Float32Array([3, 2, 1]) }; },
    releaseStepResult(result) { if (result) released++; }, close() { closed++; }
  })
});
const makeRequest = options => ({ schema: `doppler.capsule-operation-request/${format}`, operation: { name: 'generate', version: 1 },
  input: { promptTokens: [0, 2] }, options: { maxTokens: 3, maxSeqLen: 16, temperature: 0, topP: 1, topK: 0,
    repetitionPenalty: 1, repetitionPenaltyWindow: 1, presencePenalty: 2, useChatTemplate: false, seed: 0, ...options },
  assignment: null, limits: { maxInputBytes: 10000, maxOutputBytes: 100000, deadlineAt: Date.now() + 60000 } });
let acceptance;
try { acceptance = await checkInstalledLibraryProvider({ consumer, api, session, makeRequest, formats: [format] }); }
finally { await session.close(); }
assert.equal(calls, released);
assert.equal(closed, 1);
console.log(JSON.stringify({ ...acceptance, runtimeEntry: entry, calls, released, closed,
  model: { modelId: session.modelId, capsuleIdentity: session.capsuleIdentity },
  evidence: 'Installed public contract with signed fixture and injected logits; no physical model qualification' }));
