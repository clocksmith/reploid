// Only an explicitly enrolled private operator can arm this observer for a single reference request.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import bootstrap from '../../shared/config/swarm-bootstrap.json' with { type: 'json' };
import { canonicalPartitionJson, canonicalRouteAttemptBinding } from '../../shared/vendor/reploid/contracts/partition.js';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const digest = value => sha256(canonicalPartitionJson(value));
const validIds = (ids, limit) => Array.isArray(ids) && ids.length > 0 && ids.length <= limit
  && ids.every(id => Number.isSafeInteger(id) && id >= 0 && id <= 0xffffffff);
const peerId = id => typeof id === 'string' && /^peer:[0-9a-f]{24}$/.test(id);

function referenceTokens(fixture) {
  const reference = fixture.reference;
  assert(validIds(reference?.inputIds, 4096)
    && Number.isSafeInteger(fixture.maxOutputTokens) && fixture.maxOutputTokens > 0 && fixture.maxOutputTokens <= 256);
  let selected;
  if (reference.stopReason === 'max-tokens') {
    assert(validIds(reference.outputIds, fixture.maxOutputTokens) && reference.outputIds.length === fixture.maxOutputTokens
      && reference.stopId === undefined && reference.visibleOutputIds === undefined, 'A capped reference must contain exactly the requested sample count');
    selected = reference.outputIds;
  } else {
    assert(reference.stopReason === undefined && Array.isArray(reference.visibleOutputIds)
      && reference.outputIds === undefined, 'Expected a frozen stop-token reference');
    selected = [...reference.visibleOutputIds, reference.stopId];
  }
  assert(validIds(selected, fixture.maxOutputTokens) && fixture.messages?.length > 0);
  return { promptCount: reference.inputIds.length, promptDigest: digest(reference.inputIds),
    sampleCount: selected.length, sampleDigest: digest(selected) };
}

// Atomic no-clobber publication. Simultaneous runs cannot replace an existing receipt.
async function writeOnce(file, row) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(JSON.stringify(row) + '\n');
      await handle.sync();
    } finally { await handle.close(); }
    await fs.link(temporary, file);
  } finally { await fs.unlink(temporary); }
}

export async function openStageTokenWitness(options, { roomId, participantId }) {
  const { fixtureFile, fixtureSha256, receiptFile, threadId, requesterId, stageParticipants } = options;
  assert(typeof roomId === 'string' && roomId.length > 0 && roomId !== bootstrap.publicRoomId, 'Private pool required');
  assert(path.isAbsolute(fixtureFile) && path.isAbsolute(receiptFile)
    && typeof threadId === 'string' && /^[a-zA-Z0-9_-]{16,128}$/.test(threadId), 'Explicit paths and a unique thread ID required');
  assert(peerId(requesterId) && Array.isArray(stageParticipants) && stageParticipants.length >= 2
    && stageParticipants.every(peerId) && new Set([...stageParticipants, requesterId]).size === stageParticipants.length + 1,
  'Pin a distinct requester and ordered stage roster');
  const first = participantId === stageParticipants[0];
  assert(first || participantId === stageParticipants.at(-1), 'Install the witness on the input or final stage');
  const bytes = await fs.readFile(fixtureFile);
  assert.equal(sha256(bytes), fixtureSha256, 'Reference fixture hash mismatch');
  const fixture = JSON.parse(bytes);
  referenceTokens(fixture);
  await fs.mkdir(path.dirname(receiptFile), { recursive: true, mode: 0o700 });
  try {
    await fs.lstat(receiptFile);
    throw Error('Receipt already exists; choose a new qualification file');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }

  let attempt = null, tokenizerDigest = null, prefill = null, written = false;
  const samples = [];
  function matches(input) {
    if (input.identity?.threadId !== threadId || input.identity.requesterId !== requesterId) return false;
    const { route, attemptId } = canonicalRouteAttemptBinding(input.identity);
    return route.modelId === fixture.modelId && route.modelIdentity === fixture.modelIdentity
      && route.planId === fixture.planIdentity && (attempt === null || attempt === attemptId)
      && canonicalPartitionJson(route.stages.map(stage => stage.participantId)) === canonicalPartitionJson(stageParticipants);
  }
  async function save(binding, result) {
    written = true;
    await writeOnce(receiptFile, { schema: 'reploid.local-token-parity/v1', fixtureSha256, roomId, threadId,
      bindingDigest: digest(binding), attemptId: binding.attemptId, participantId, ...prefill, ...result });
  }
  return { wrap(resident) {
    return { ...resident,
      ...(first ? { async tokenize(input) {
        const result = await resident.tokenize(input);
        if (!written && matches(input) && canonicalPartitionJson(input.messages) === canonicalPartitionJson(fixture.messages)) {
          assert(validIds(result.tokenIds, 4096), 'Input token window is invalid');
          attempt = input.identity.attemptId;
          tokenizerDigest = digest(result.tokenIds);
        }
        return result;
      } } : {}),
      async executeStage(input) {
        const result = await resident.executeStage(input);
        if (written || !matches(input)) return result;
        if (input.step === 0) {
          if (first && !tokenizerDigest) return result;
          assert(validIds(input.inputTokenIds, 4096), 'Observed prefill window is invalid');
          attempt = input.identity.attemptId;
          assert.equal(input.generation?.maxTokens, fixture.maxOutputTokens, 'Generation cap differs from the reference request');
          prefill = { promptCount: input.inputTokenIds.length, promptDigest: digest(input.inputTokenIds),
            generationDigest: digest(input.generation), generation: Object.fromEntries(
              ['maxTokens', 'temperature', 'topK', 'topP', 'repetitionPenalty', 'repetitionPenaltyWindow']
                .filter(key => input.generation[key] !== undefined).map(key => [key, input.generation[key]])) };
          if (first) { await save(input.identity, { role: 'input', tokenizerDigest }); return result; }
        }
        if (attempt === null) return result;
        assert(input.step === samples.length && samples.length < fixture.maxOutputTokens && validIds([result.tokenId], 1),
          'Noncontiguous or oversized final-stage sample');
        if (input.step > 0) {
          assert(input.inputTokenIds?.length === 1 && input.inputTokenIds[0] === samples.at(-1),
            'Continuation differs from the previously sampled token');
        }
        samples.push(result.tokenId);
        if (result.done) await save(input.identity, { role: 'output', sampleCount: samples.length,
          sampleDigest: digest(samples), stopReason: result.stopReason });
        return result;
      }
    };
  } };
}

export function verifyStageTokenWitnesses({ fixtureBytes, httpAttemptId, response, input, output }) {
  const fixture = JSON.parse(fixtureBytes), capped = fixture.reference.stopReason === 'max-tokens';
  // The HTTP `reploid` record: the requester's execution receipt, the executor's own report, and the pool and conversation used.
  const evidence = response?.reploid, receipt = evidence?.executionReceipt;
  assert((capped ? response?.status === 'incomplete' && response.incomplete_details?.reason === 'max_output_tokens'
    : response?.status === 'completed') && receipt?.schema === 'reploid.execution-receipt/v2' && receipt.attemptId === httpAttemptId
    && typeof httpAttemptId === 'string' && httpAttemptId.length > 0, 'Require the matching terminal HTTP response and attempt header');
  const target = referenceTokens(fixture), execution = evidence.execution;
  const binding = canonicalRouteAttemptBinding(execution.identity), route = binding.route;
  assert(typeof evidence.poolId === 'string' && binding.attemptId === httpAttemptId && binding.threadId === evidence.conversationId
    && route.modelId === fixture.modelId && route.modelIdentity === fixture.modelIdentity && receipt.requested.model.identity === route.modelIdentity
    && route.planId === fixture.planIdentity && receipt.route?.planIdentity === route.planId && receipt.requested.model.adapterIdentities?.length === 0,
  'Unexpected requester route, base model, adapter set, or plan');
  const stageIds = route.stages.map(stage => stage.participantId);
  assert.deepEqual([...receipt.route.participants].sort(), [...new Set(stageIds)].sort(), 'HTTP disclosure differs from the recorded stages');
  for (const row of [input, output]) {
    assert(row?.schema === 'reploid.local-token-parity/v1' && row.attemptId === httpAttemptId && row.threadId === evidence.conversationId
      && row.roomId === evidence.poolId && row.bindingDigest === digest(binding) && row.fixtureSha256 === sha256(fixtureBytes),
    'Witness belongs to a different reference, route, or HTTP attempt');
    assert.equal(row.promptCount, target.promptCount);
    assert.equal(row.promptDigest, target.promptDigest, 'Prompt token mismatch');
  }
  assert(input.role === 'input' && output.role === 'output' && input.participantId === stageIds[0] && output.participantId === stageIds.at(-1));
  assert.equal(input.tokenizerDigest, target.promptDigest, 'Stage-zero tokenization differs from execution');
  assert.equal(input.generationDigest, output.generationDigest, 'Generation settings differ between stages');
  assert.deepEqual(input.generation, output.generation);
  assert.equal(input.generation.maxTokens, fixture.maxOutputTokens);
  assert.equal(output.sampleCount, target.sampleCount);
  assert.equal(output.sampleDigest, target.sampleDigest, 'Sampled token or stop token mismatch');
  assert((capped ? output.stopReason === 'max-tokens' : ['eos-token', 'stop-token'].includes(output.stopReason))
    && execution.stopReason === output.stopReason, 'Unexpected terminal reason');
  if (execution.schema === 'reploid.mesh.partition-summary/v2') {
    assert.equal(execution.stepSummary.count, target.sampleCount);
    assert.equal(execution.stepSummary.phases.prompt.inputTokens, target.promptCount);
  } else {
    assert.equal(execution.schema, 'reploid.mesh.partition-execution/v3');
    assert.equal(execution.steps[0].inputTokenCount, target.promptCount);
    assert.equal(digest(execution.steps.map(step => step.tokenId)), target.sampleDigest, 'HTTP execution token mismatch');
  }
  if (typeof fixture.reference.outputText === 'string') {
    assert.equal(response.output?.[0]?.content?.[0]?.text, fixture.reference.outputText, 'Completed HTTP text differs from reference');
  }
  return { exact: true, attemptId: httpAttemptId, modelIdentity: route.modelIdentity, planIdentity: route.planId,
    ...target, stopReason: output.stopReason, generation: input.generation, generationDigest: input.generationDigest };
}
