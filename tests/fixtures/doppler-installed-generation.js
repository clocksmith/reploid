// Installed public runtime + Reploid integration. Injected logits, not model qualification.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createReploidDopplerRuntimeService, DOPPLER_GENERATION_CONTRACT } from '../../self/infrastructure/doppler-runtime-service.js';
import { runPackOperation } from '../../self/pool/pack-operation.js';
import { hashDopplerEvidence } from '../../self/pool/executable-pack.js';

const consumer = process.env.DOPPLER_TEST_CONSUMER;
const checkout = process.env.DOPPLER_TEST_CHECKOUT;
assert(consumer && checkout, 'Explicit installed consumer and test-fixture checkout are required.');
// Resolve with ESM conditions from the consumer: the public root has no CommonJS export.
const entry = execFileSync(process.execPath,
  ['--input-type=module', '-e', "process.stdout.write(import.meta.resolve('doppler-gpu'))"],
  { cwd: consumer, encoding: 'utf8' }).trim();
assert(entry.includes('/node_modules/doppler-gpu/'), 'Inference must use installed package bytes.');
const api = await import(entry);
assert.deepEqual(api.GENERATION_CONTRACT, DOPPLER_GENERATION_CONTRACT);
// Only test artifact signing is imported from the checkout; no runtime source imports.
const { createSignedCapsuleFixture, TEST_CAPSULE_AUTHORITY, TEST_CAPSULE_PUBLIC_KEY } =
  await import(pathToFileURL(resolve(checkout, 'tests/helpers/capsule-v2-fixture.js')).href);
const fixture = await createSignedCapsuleFixture();
const phases = [];
let stop = {};
let released = 0;
let closed = 0;
const ports = {
  device: { getDevice: () => ({ limits: { maxBufferSize: 1024 }, createBuffer: () => ({ destroy() {} }),
    createCommandEncoder() {}, queue: { writeBuffer() {} } }),
  getProfile: () => ({ surface: 'test-webgpu', hasF16: false, hasSubgroups: false, maxBufferSize: 1024 }) },
  artifactStore: fixture.artifactStore,
  trustedSigners: { [TEST_CAPSULE_AUTHORITY]: TEST_CAPSULE_PUBLIC_KEY },
  programFactory: async () => ({
    executionGraphHash: fixture.capsule.program.executionGraphHash,
    tokenize: () => [0, 2], decodeTokens: ids => ids.join(','), getTokenContract: () => stop,
    reset() {}, getActiveAdapterIdentity: () => null,
    executePhase: async (phase, request) => {
      phases.push({ phase, sampling: request.context.generationOptions });
      return { logits: new Float32Array([3, 2, 1]) };
    },
    releaseStepResult(result) { if (result) released++; }, close() { closed++; }
  })
};
const service = createReploidDopplerRuntimeService({ loadModule: async () => api, expectedVersion: api.DOPPLER_VERSION });
const options = { maxTokens: 1, maxSeqLen: 16, temperature: 0, topP: 1, topK: 0,
  repetitionPenalty: 1, repetitionPenaltyWindow: 0, presencePenalty: 0, useChatTemplate: false, seed: 0 };
const makeRequest = overrides => ({ schema: 'doppler.capsule-operation-request/v1', operation: { name: 'generate', version: 1 },
  input: { promptTokens: [0, 2] }, options: { ...options, ...overrides }, assignment: { id: 'installed-contract', attempt: 1 },
  limits: { maxInputBytes: 10000, maxOutputBytes: 100000, deadlineAt: Date.now() + 60000 } });
const checks = [];
try {
  const session = await service.openCapsule({ scope: 'a', source: fixture.capsule, options: ports });
  const second = await service.openCapsule({ scope: 'b', source: fixture.capsule, options: ports });
  const binding = { ...session.capsuleIdentity, artifacts: fixture.capsule.artifacts, requiredOperation: 'generate',
    acceptedTargetPlanDigests: [session.selectedTargetPlanDigest] };
  const run = (request, extra = {}) => runPackOperation({ binding, session, request, runtimeVersion: api.DOPPLER_VERSION, ...extra });
  for (const [overrides, tokens] of [
    [{ presencePenalty: 2 }, [1]],
    [{ presencePenalty: 2, repetitionPenaltyWindow: 1 }, [0]],
    [{ repetitionPenalty: 2 }, [1]],
    [{ repetitionPenalty: 2, repetitionPenaltyWindow: 1 }, [0]],
    [{ presencePenalty: 2, repetitionPenaltyWindow: 1, maxTokens: 3 }, [0, 1, 0]],
  ]) {
    const request = makeRequest(overrides);
    const result = await run(request);
    assert.deepEqual(result.output.tokenIds, tokens);
    assert.equal(result.output.text, tokens.join(','));
    assert.deepEqual(result.output.sampling, api.resolveGenerationOptions(request.options));
    assert.equal(result.output.completion.stopReason, 'max-tokens');
    assert.equal(result.output.completion.generatedTokenCount, tokens.length);
    assert.equal(result.output.completion.promptTokenCount, 2);
    assert.equal(result.receipt.modelId, fixture.capsule.modelId);
    assert.equal(result.receipt.outputHash, await hashDopplerEvidence(result.output));
    for (const field of ['presencePenalty', 'repetitionPenaltyWindow', 'maxTokens', 'maxSeqLen']) {
      assert.equal(phases.at(-1).sampling[field], request.options[field]);
    }
  }
  checks.push('application-to-installed-inference sampling and budget propagation');
  for (const [tokenContract, overrides, reason] of [
    [{ eosTokenId: 0 }, {}, 'eos-token'], [{ stopTokenIds: [0] }, {}, 'stop-token'],
    [{}, { stopSequences: ['0'] }, 'stop-sequence']
  ]) {
    stop = tokenContract;
    assert.equal((await run(makeRequest({ maxTokens: 3, ...overrides }))).output.completion.stopReason, reason);
  }
  stop = {};
  checks.push('actual stopping reasons');
  const concurrent = await Promise.all([run(makeRequest({ presencePenalty: 2 })),
    run(makeRequest({ presencePenalty: 0 }), { session: second })]);
  assert.deepEqual(concurrent.map(value => value.output.tokenIds), [[1], [0]]);
  checks.push('independent concurrent session settings');
  const mutable = makeRequest({ presencePenalty: 2 });
  const pending = run(mutable);
  mutable.options.presencePenalty = 0;
  assert.deepEqual((await pending).output.tokenIds, [1]);
  checks.push('request snapshot resists caller mutation');
  const controller = new AbortController();
  const beforeCancel = phases.length;
  await assert.rejects(run(makeRequest({ maxTokens: 3 }), { signal: controller.signal,
    onPartial: () => controller.abort(new Error('application cancellation')) }), /application cancellation/);
  assert.equal(phases.length, beforeCancel + 1, 'cancelled request must not decode again');
  const preCancelled = new AbortController(); preCancelled.abort(new Error('before invocation'));
  await assert.rejects(session.generateText({ ...options, prompt: 'test', signal: preCancelled.signal }),
    { code: 'DOPPLER_GENERATION_ABORTED' });
  let current = true;
  await assert.rejects(run(makeRequest({ maxTokens: 3 }), { onPartial: () => { current = false; },
    assertCurrent: () => { if (!current) throw new Error('stale attempt'); } }), /stale attempt/);
  assert.equal((await run(makeRequest({}))).output.completion.stopReason, 'max-tokens');
  checks.push('cancellation and stale attempts cannot return completion; session remains usable');
  const phaseCount = phases.length;
  for (const invalid of [{ presencePenalty: -1 }, { repetitionPenaltyWindow: -1 }, { maxTokens: 0 }, { invented: 1 }]) {
    await assert.rejects(run(makeRequest(invalid)));
  }
  await assert.rejects(run(makeRequest({}), { session: { ...session, generationContract: null } }), /contract mismatch/);
  assert.equal(phases.length, phaseCount);
  checks.push('invalid options and incompatible runtime rejected before inference');
  assert.equal(released, phases.length, 'every emitted step result is released');
} finally { await service.closeAll(); }
assert.equal(closed, 2);
console.log(JSON.stringify({ schema: 'reploid.installed-generation-contract-test/v1', passed: true,
  runtimeEntry: entry, runtimeVersion: api.DOPPLER_VERSION, checks, phaseCalls: phases.length, released, closed,
  model: { kind: 'signed test fixture with injected logits', modelId: fixture.capsule.modelId,
    capsuleHash: await hashDopplerEvidence(fixture.capsule) },
  evidence: 'installed API contract with injected logits; not physical model or semantic qualification' }));
