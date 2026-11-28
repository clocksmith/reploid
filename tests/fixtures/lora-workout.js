import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { encodeTrainingTickets, trainTicketReference } from './lora-workout-reference.js';
import { compareAdapterWeights, weightTolerance } from './lora-workout-weights.js';
import policy from '../../apps/poolday/config/lora-training.json' with { type: 'json' };

const dataset = new URL('../../examples/export-triage/train.jsonl', import.meta.url);
const adapter = { id: 'export-triage', name: 'export-triage', version: '1.0.0' };
const receiptName = 'workout.json';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const asBytes = weights => weights instanceof ArrayBuffer ? new Uint8Array(weights) : Uint8Array.from(weights);

async function storeCandidate(directory, name, value) {
  const bytes = asBytes(value.weights), hash = sha(bytes), manifest = JSON.parse(value.json);
  assert.equal(manifest.checksum, hash);
  assert.equal(value.weightsSha256, hash);
  assert.equal(manifest.weightsSize, bytes.length);
  assert.equal(manifest.weightsPath, 'adapter.safetensors');
  assert.equal(manifest.metadata.baseManifestHash, policy.baseManifestHash);
  assert.equal(value.activated, false);
  assert.equal(value.evaluated, false);
  const target = path.join(directory, name);
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, 'adapter.safetensors'), bytes, { flag: 'wx' });
  await writeFile(path.join(target, 'adapter.json'), value.json, { flag: 'wx' });
  return { directory: name, sha256: hash, manifestSha256: sha(value.json), bytes: bytes.length,
    checkpointHash: manifest.metadata.checkpointHash, step: manifest.metadata.checkpointStep };
}

function assertWireDelta(before, after) {
  for (const side of ['coordinator', 'contributor']) {
    assert(after[side].sentBytes > before[side].sentBytes, 'Missing sent training bytes on ' + side);
    assert(after[side].receivedBytes > before[side].receivedBytes, 'Missing received training bytes on ' + side);
  }
}

async function pooledRound(pair, samples, resume, spec) {
  const { coordinator, contributor, measure } = pair;
  const started = performance.now();
  const before = await measure();
  await contributor.contribute({ consent: true, sample: samples[1], coordinator: contributor.peer });
  try {
    const candidate = await coordinator.run({ samples: [samples[0]], peers: [coordinator.peer],
      consent: true, retainCheckpoint: true, resume, adapter: spec });
    const state = await contributor.getState();
    assert.equal(state.phase, 'contributed');
    assert.equal(candidate.metrics.length, 1);
    const metric = candidate.metrics[0];
    assert(Number.isFinite(metric.loss));
    assert.deepEqual(metric.contributors, [coordinator.participantId, contributor.participantId]);
    assert.equal(metric.supervisedTokenCount, samples[0].supervisedTokenCount + samples[1].supervisedTokenCount);
    const after = await measure();
    assertWireDelta(before, after);
    const { checkpointHash, parentCheckpointHash, checkpointStep } = candidate.manifest.metadata;
    assert.match(checkpointHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(parentCheckpointHash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(checkpointStep, metric.stepCount);
    return { candidate, observed: { metric, checkpointHash, parentCheckpointHash, checkpointStep,
      weightsSha256: candidate.weightsSha256, before, after, elapsedMs: performance.now() - started } };
  } finally { await contributor.stop(); }
}

// Keep all causal contexts identical. The direct baseline supervises all three
// positions in one trainStep, independently of the production aggregation path.
function numericalSamples() {
  const inputIds = [100, 200, 300];
  return [[200, 300, -100], [-100, -100, 400], [200, 300, 400]].map(targetIds => ({
    inputIds, targetIds, supervisedTokenCount: targetIds.filter(id => id >= 0).length
  }));
}

async function dropout(pair, samples, expectedHash) {
  const { coordinator, contributor } = pair;
  const parent = await coordinator.getCheckpoint();
  const previous = await coordinator.getCandidate();
  assert.equal(parent.hash, expectedHash);
  const before = await pair.measure();
  const started = performance.now();
  await contributor.contribute({ consent: true, sample: samples[1], coordinator: contributor.peer });
  try {
    await pair.interrupt();
    let reason;
    try {
      await coordinator.run({ consent: true, resume: true, samples: [samples[0]], peers: [coordinator.peer], adapter });
    } catch (error) { reason = error.message; }
    assert(reason, 'Interrupted training unexpectedly completed');
    const state = await coordinator.getState(), after = await pair.measure();
    assert.equal(after.contributor.interruptions - before.contributor.interruptions, 1, 'Missing physical channel interruption');
    assert.equal(state.phase, 'failed');
    assert.equal(state.completedSteps, 0);
    const retained = await coordinator.getCheckpoint(), candidate = await coordinator.getCandidate();
    assert.deepEqual(retained, parent, 'Committed adapter or optimizer checkpoint changed during interrupted transfer');
    assert.equal(candidate.weightsSha256, previous.weightsSha256);
    assert.deepEqual(asBytes(candidate.weights), asBytes(previous.weights), 'Committed candidate bytes changed');
    return { passed: true, before, after, reason, checkpointBefore: parent.hash, checkpointAfter: retained.hash,
      optimizerStep: retained.value.stepCount, weightsSha256: candidate.weightsSha256,
      coordinatorPhase: state.phase, completedSteps: state.completedSteps, elapsedMs: performance.now() - started };
  } finally { await contributor.stop(); }
}

export async function runTrainingWorkout(pair, { outputDirectory }) {
  assert(outputDirectory, 'Pass an empty trial output directory');
  await mkdir(outputDirectory, { recursive: true });
  const trainBytes = await readFile(dataset);
  const tickets = trainBytes.toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  assert.equal(tickets.length, 32);
  const schedule = Array.from({ length: 16 }, (_, i) => tickets.slice(2 * i, 2 * i + 2).map(t => t.id));
  const report = { schema: 'reploid.two-host-lora-workout/v1', started: new Date().toISOString(), status: 'running',
    discovery: pair.discovery, tolerance: weightTolerance, numericalSamples: numericalSamples(),
    model: { id: policy.modelId, baseManifestHash: policy.baseManifestHash, trainer: policy.trainer },
    trainingDataSha256: sha(trainBytes), schedule, selection: 'Use step 16, before holdout scoring', rounds: [] };
  const file = path.join(outputDirectory, receiptName);
  await writeFile(file, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  const save = async () => {
    await writeFile(file + '.tmp', JSON.stringify(report, null, 2) + '\n');
    await rename(file + '.tmp', file);
  };
  try {
    const [a, b, combined] = numericalSamples();
    const numericAdapter = { ...adapter, id: 'numerical-qualification', name: 'numerical-qualification' };
    const referenceStart = performance.now();
    const direct = await pair.coordinator.run({ consent: true, retainCheckpoint: true, samples: [combined], peers: [], adapter: numericAdapter });
    report.numerical = { referenceElapsedMs: performance.now() - referenceStart,
      reference: await storeCandidate(outputDirectory, 'numerical-reference', direct),
      referenceLoss: direct.metrics[0].loss };
    await save();
    const pooled = await pooledRound(pair, [a, b], false, numericAdapter);
    report.numerical.pooled = pooled.observed;
    report.numerical.candidate = await storeCandidate(outputDirectory, 'numerical', pooled.candidate);
    assert.equal(pooled.observed.parentCheckpointHash, direct.manifest.metadata.parentCheckpointHash);
    report.numerical.weights = compareAdapterWeights(asBytes(pooled.candidate.weights).buffer, asBytes(direct.weights).buffer);
    await save();
    assert(report.numerical.weights.passed, 'Combined-token numerical comparison failed');
    report.dropout = await dropout(pair, [a, b], report.numerical.candidate.checkpointHash);
    await save();
    // Resume on the surviving machine. A new worker must restore the exact optimizer
    // and tensor checkpoint from before the interrupted transfer.
    const recovered = await pair.coordinator.run({ consent: true, resume: true, peers: [], samples: [combined], adapter: numericAdapter });
    assert.equal(recovered.manifest.metadata.parentCheckpointHash, report.dropout.checkpointBefore);
    assert.equal(recovered.manifest.metadata.checkpointStep, report.dropout.optimizerStep + 1);
    assert.notEqual(recovered.weightsSha256, report.dropout.weightsSha256);
    report.recovery = await storeCandidate(outputDirectory, 'numerical-recovered', recovered);
    await save();
    report.reconnected = await pair.refreshPeers();
    await save();

    const encoded = await pair.coordinator.evaluate(encodeTrainingTickets, tickets);
    assert.deepEqual(encoded.map(row => row.id), tickets.map(row => row.id));
    assert(encoded.every(row => row.sample.inputIds.length <= policy.maxTokensPerSample));
    report.taskLabelTokens = encoded[0].tokens;
    assert(encoded.every(row => row.tokens.A === report.taskLabelTokens.A && row.tokens.B === report.taskLabelTokens.B));
    const rounds = schedule.map((_, i) => encoded.slice(2 * i, 2 * i + 2).map(row => row.sample));
    report.taskInputTokens = rounds.map(samples => samples.map(row => row.inputIds.length));
    let finalCandidate;
    for (const [index, samples] of rounds.entries()) {
      const { candidate, observed } = await pooledRound(pair, samples, index > 0, adapter);
      assert.equal(observed.checkpointStep, index + 1);
      if (index > 0) assert.equal(observed.parentCheckpointHash, report.rounds[index - 1].checkpointHash);
      report.rounds.push(observed);
      finalCandidate = candidate;
      await save();
    }
    report.task = await storeCandidate(outputDirectory, 'task', finalCandidate);
    await save();
    const localStart = performance.now();
    const local = await pair.coordinator.evaluate(trainTicketReference, { rounds, adapter });
    report.taskReference = { ...await storeCandidate(outputDirectory, 'task-reference', local),
      elapsedMs: performance.now() - localStart, metrics: local.metrics, parentHashes: local.parentHashes };
    assert.equal(local.parentHashes[0], report.rounds[0].parentCheckpointHash);
    assert.equal(report.taskReference.step, 16);
    report.taskWeights = compareAdapterWeights(asBytes(finalCandidate.weights).buffer, asBytes(local.weights).buffer);
    report.status = report.numerical.weights.passed && report.taskWeights.passed && report.dropout.passed ? 'passed' : 'failed';
    return report;
  } catch (error) {
    report.status = 'failed';
    report.error = error.message;
    throw error;
  } finally {
    report.finished = new Date().toISOString();
    await save();
  }
}
