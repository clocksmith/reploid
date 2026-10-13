// Source-only ordinary two-stage runner integration; numerical dispatch is
// injected, while cursor transitions, stage signatures and publications are real.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createLayerPartitionRunner } from '../packages/reploid/src/mesh/partitions/partition-runner.js';
import { createConversationPublication } from '../packages/reploid/src/chat/workspace-publication.js';
import { createPartitionGrantAuthority } from '../packages/reploid/src/mesh/partitions/partition-grants.js';
import { createSigningIdentity } from '../packages/reploid/src/artifacts/identity.js';
import { createPartitionStageCommitAuthority, verifyPartitionStageCommit } from '../packages/reploid/src/mesh/partitions/partition-stage-commit.js';
const root = process.env.DOPPLER_SOURCE_ROOT; assert(root, 'Explicit source root required');
const runtime = await import(pathToFileURL(root + '/src/partitions.js'));
const { createResidentTargetState, createResidentCursorMirror } = await import(pathToFileURL(root + '/src/inference/resident-target-state.js'));
const { createResidentOutputState } = await import(pathToFileURL(root + '/src/inference/resident-output-state.js'));
const { createBundledIncrementalDecoder } = await import(pathToFileURL(root + '/src/inference/tokenizers/bundled/incremental-decoder.js'));
const basePolicy = JSON.parse(await readFile(root + '/tests/fixtures/canonical-generation-policy.json', 'utf8'));
const hash = 'sha256:' + 'a'.repeat(64), epoch = '0'.repeat(32);
const keys = await Promise.all([0, 1].map(() => createSigningIdentity({ algorithm: 'ECDSA' })));
const stages = keys.map((key, i) => ({ stageId: 'sha256:' + String(i).repeat(64), participantId: key.peerId,
  participantEpoch: epoch, deviceEpoch: epoch, residentId: 'r' + i, partitionIndex: i, executionId: hash }));
const plan = runtime.createLayerPartitionPlan({ modelId: 'fixture', numLayers: 4, hiddenSize: 8, vocabSize: 100, splitLayer: 2 });
const planId = runtime.hashLayerPartitionPlan(plan);
const limits = { maxTokens: 16, maxPromptTokens: 64, maxActivationBytes: 4096, maxOutputCharacters: 4096,
  maxAttempts: 8, maxConcurrentAttempts: 2 };
async function fixture({ zero = false, full = false, forged = false, unknown = false, decline = false, authenticationGate = null, attemptId = 'a', observedPublications = null } = {}) {
  const policy = { ...basePolicy, maxGeneratedTokens: zero ? 0 : 2, ...(full ? { totalAcceptedTokenLimit: 2 } : {}) };
  const generation = runtime.canonicalGenerationIdentity(policy, hash, 100);
  const identity = { modelId: plan.modelId, modelIdentity: hash, planId, threadId: 'thread-' + attemptId, attemptId,
    participantA: keys[0].peerId, participantB: keys[1].peerId, requesterId: 'requester', placementGeneration: 0 };
  const attempt = { schema: 'doppler.resident-attempt/v2', attemptId, requesterId: 'requester',
    inputDigest: runtime.tokenDigest([1, 2], 100, 64), authorizationScope: hash, routeId: hash,
    generationId: generation.generationId, coordinatorEpoch: epoch, publisherEpoch: epoch, routeKind: 'two-stage-layer', stages };
  const grantAuthority = createPartitionGrantAuthority({ identity: keys[0], meshId: 'mesh', maxGrants: 8, maxTtlMs: 60000, canonicalRuntime: runtime });
  const grantLimits = { maxTokens: limits.maxTokens, maxPromptTokens: limits.maxPromptTokens,
    maxActivationBytes: limits.maxActivationBytes, maxOutputCharacters: limits.maxOutputCharacters };
  attempt.authorizationScope = grantAuthority.canonicalScope({ identity, limits: grantLimits,
    disclosure: 'partition-activations-and-tokens', generationId: generation.generationId });
  const grant = await grantAuthority.issueCanonical(identity, grantLimits, { approved: true, ttlMs: 60000,
    disclosure: 'partition-activations-and-tokens', generation, canonicalAttempt: attempt, vocabSize: 100 });
  const grants = Object.fromEntries(['executionA', 'executionB', 'activation', 'tokenContext', 'output'].map(k => [k, grant]));
  const decoder = () => createBundledIncrementalDecoder({ tokenForId: id => String(id), byteLevel: false,
    byteDecoder: new Map(), wordPiece: false, splitEveryCharacter: false, wordPiecePrefix: '##' });
  let target, mirror, awaiting = null, state = null, queue = Promise.resolve();
  const events = [], counters = { a: 0, b: 0, commits: 0, closes: 0 };
  const authorities = keys.map((identity, i) => createPartitionStageCommitAuthority({ runtime, identity, stage: stages[i] }));
  const devices = keys.map((key, i) => ({ id: key.peerId, getCanonicalStage: () => stages[i], getCanonicalGeneration: () => generation,
    closeAttempt: async () => { counters.closes++; events.push('close' + i); },
    executeFrame: async () => { throw Error('Legacy execution forbidden'); },
    executeGroup0: async () => { throw Error('Legacy execution forbidden'); }, executeGroup1: async () => { throw Error('Legacy execution forbidden'); },
    async admitCanonicalPrompt() {
      const admitted = runtime.admitResidentPrompt([1, 2], policy, 100, generation.generationId);
      if (admitted.kind) {
        if (i) target = createResidentTargetState([1, 2], policy, 100, generation.generationId,
          createResidentOutputState(decoder(), decoder(), policy, 100));
        else mirror = createResidentCursorMirror([1, 2], policy, 100, generation.generationId);
      }
      events.push('admit' + i); return admitted;
    } }));
  devices[0].reserve = binding => ({ identity: binding, participantId: devices[0].id, index: 0, phase: 'reserved', resources: { attemptSlots: 1 } });
  devices[1].reserveCanonical = async request => ({ reservation: { identity: request.identity, participantId: devices[1].id,
    index: 1, phase: 'reserved', resources: { attemptSlots: 1 } } });
  devices[0].executeCanonicalGroup0 = async request => {
    counters.a++; events.push('a' + request.step);
    return { identity, continuation: null, activationTensor: { data: new Float32Array(request.tokenIds.length * 8), dtype: 'f32',
      shape: [1, request.tokenIds.length, 8], seqOffset: request.tokenPosition, step: request.step } };
  };
  devices[0].commitCanonicalTransition = async request => {
    counters.commits++; events.push('commit' + request.sequence);
    const transition = mirror.acceptTransition(request.baseCursorId, request.transition);
    return { transition, commit: await authorities[0].sign({ attempt, sequence: request.sequence, baseCursorId: request.baseCursorId, transition }) };
  };
  devices[1].executeCanonicalFrame = async request => {
    assert.equal(awaiting, null, 'next numerical step must wait for publication acknowledgment');
    counters.b++; events.push('b' + request.step);
    const logits = new Float32Array(100).fill(-Infinity); logits[3 + request.step] = 0;
    const transition = request.step === 0 ? target.bootstrap(logits) : target.advance(request.baseCursorId, logits);
    const commit = await authorities[1].sign({ attempt, sequence: request.sequence, baseCursorId: request.baseCursorId, transition });
    if (forged) commit.evidence.signature = 'bad';
    awaiting = transition;
    return { identity, step: request.step, tokenPosition: request.tokenPosition, transition, commit, continuation: null };
  };
  devices[1].acknowledgeCanonicalPublication = async request => {
    events.push('ack' + request.sequence);
    assert((observedPublications ? observedPublications() : state.records).some(r => r.receipt.receiptDigest === request.receipt.receiptDigest), 'ack requires actually stored receipt');
    awaiting = null; return request.receipt;
  };
  const store = { schema: 'reploid.transactional-chat-store/v1', async read() { await queue; return structuredClone(state); },
    transact(key, reduce) {
      const pending = queue.then(() => {
        const { state: next, result } = reduce(structuredClone(state)); state = structuredClone(next);
        if (state.records.length) { events.push('stored' + (state.records.length - 1)); if (unknown) throw Error('unknown commit completion'); }
        return structuredClone(result);
      }); queue = pending.catch(() => {}); return pending;
    } };
  const publication = createConversationPublication({ conversationId: identity.threadId, writerEpoch: epoch, store, doppler: runtime,
    requireCommitEvidence: true, authorize: () => true,
    authenticateCommit: async (acknowledgment, stage, attempt, evidence) => {
      if (authenticationGate) { authenticationGate.entered.resolve(); await authenticationGate.release.promise; }
      return verifyPartitionStageCommit({ runtime, acknowledgment, stage, attempt, evidence });
    } });
  await publication.claimWriter(null);
  const authorize = async request => !decline && grantAuthority.verify(request.grant, { identity, action: request.action,
    canonicalAttempt: request.canonicalAttempt, generationId: request.generationId, phase: request.phase,
    step: request.step, inputTokenCount: request.inputTokenCount });
  const runner = createLayerPartitionRunner({ runtime, plan, deviceA: devices[0], deviceB: devices[1], limits, canonical: true, authorize });
  const input = { tokenIds: [1, 2], identity, grants,
    canonical: { attempt, generation, publication, deadlineAt: Date.now() + 60000 },
    onDelta: text => { events.push('delta' + text); assert(state.records.length > 0, 'UI requires durable output'); } };
  return { runner, input, publication, events, counters, devices, authorize, grantAuthority, state: () => structuredClone(state) };
}
export { fixture, runtime, plan, planId, limits, hash, epoch };
