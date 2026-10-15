// A partition route of real resident stages (createResidentPartition, with its own admission
// records) executed by the library's ordered route runner over Doppler's real activation frame
// codecs. The resident sessions stand in for Doppler stage arithmetic with deterministic values,
// and the requester-to-coordinator network hop is elided: the requester port keeps the ordered
// requester's contract (approval with the route's exact recipients, executing state with the
// route identity, activity, deltas, the summary on success and the route's error otherwise).
// Proves orchestration, admission and settlement records, not GPU execution or model quality.
import * as codecs from 'doppler-gpu/partitions';

import { canonicalPartitionRoute } from '../../packages/reploid/src/mesh/partitions/partition-contract.js';
import { orderedPartitionDisclosure } from '../../packages/reploid/src/mesh/partitions/partition-grants.js';
import { createLayerPartitionRunner } from '../../packages/reploid/src/mesh/partitions/partition-runner.js';
import { summarizePartitionExecution } from '../../packages/reploid/src/mesh/partitions/partition-summary.js';
import { createResidentPartition } from '../../packages/reploid/src/mesh/partitions/resident-partition.js';
import { MODEL } from './reward-fixture.js';

export const GENERATION = `sha256:${'c'.repeat(64)}`;
export const STEPS = 3;
export const PROMPT_TOKENS = 2;
const HIDDEN = 8;
const ACTIVATION = Object.freeze({ schema: codecs.ACTIVATION_TENSOR_SCHEMA, dtype: 'f32', hiddenSize: HIDDEN, precision: 'f32', components: 1, elementStrideBytes: 4 });

const lost = () => Object.assign(new Error('Partition stage channel closed'), { code: 'CONNECTION_LOST' });

/**
 * @param {string[]} participants stage participant ids, coordinator first
 * @param {string} requesterId the weightless requester's participant id
 * @param {object[]} [signers] each stage host's createAttemptEvidenceSigner, in stage order; stages sign receipts
 *   for attempts that carry the requester's charge binding
 * @param {number} [steps] tokens each answer runs to before the final stage stops (the runner allows at most 10)
 * @param {number} [acknowledgmentWaitMs] test-only bound on how long a charged attempt waits for acknowledgments
 */
export async function residentRoute({ participants, requesterId, signers = [], steps = STEPS, acknowledgmentWaitMs = 60_000 }) {
  const count = participants.length;
  const plan = {
    schema: 'doppler.layer-partition-contract/v3', modelId: MODEL.modelId, totalLayers: count * 2, hiddenSize: HIDDEN, vocabSize: 128,
    stageCount: count, splitLayers: Array.from({ length: count - 1 }, (_, i) => (i + 1) * 2),
    activationDtype: 'f32', activationPrecision: 'f32', activationComponents: 1, activationElementStrideBytes: 4,
    partitions: participants.map((_, index) => ({ index, startLayer: index * 2, endLayer: index * 2 + 2, layerRange: [index * 2, index * 2 + 1] }))
  };
  const route = canonicalPartitionRoute({
    schema: 'reploid.partition-route/v1', modelId: MODEL.modelId, modelIdentity: MODEL.modelIdentity, planId: MODEL.planId, activation: ACTIVATION,
    stages: participants.map((participantId, index) => ({ index, participantId, transportId: `transport_${index}`, residentId: `resident_${index}`, executionId: `execution_${index}` }))
  });
  const runtime = {
    ...codecs, ORDERED_LAYER_PARTITION_SCHEMA: plan.schema, validateOrderedLayerPartitionPlan: () => plan,
    hashLayerPartitionPlan: () => MODEL.planId, hashPartitionGeneration: () => GENERATION,
    getPartitionActivationContract: () => ACTIVATION, validateActivationFrameForPlan: (frame) => codecs.deserializeActivationFrame(frame)
  };
  // Gates hold a stage at one step of one attempt; faults make a stage's channel close there.
  const gates = [];
  const faults = [];
  const residents = [];
  for (const [index, participantId] of participants.entries()) {
    const final = index === count - 1;
    const session = {
      getDescriptor: () => ({
        schema: 'doppler.resident-partition/v2', ready: true, modelId: MODEL.modelId, modelIdentity: MODEL.modelIdentity, planId: MODEL.planId,
        index, stageCount: count, layerRange: plan.partitions[index].layerRange, residentWeightBytes: 64, generationDigest: GENERATION
      }),
      getRecoveryCapabilities: () => ({ schema: 'doppler.resident-recovery/v1', inputReplay: false, checkpointExport: false, checkpointImport: false }),
      tokenize: async () => ({ tokenIds: [1, 2] }),
      async executeStage(request) {
        const result = { identity: request.identity, partitionIndex: index, step: request.step, tokenPosition: request.tokenPosition, continuation: { step: request.step } };
        if (final) return { ...result, tokenId: 10 + request.step, delta: String(request.step), done: request.step === steps - 1, stopReason: 'eos' };
        const tokens = request.inputTokenIds.length;
        return { ...result, activationTensor: { shape: [1, tokens, HIDDEN], dtype: 'f32', data: new Float32Array(tokens * HIDDEN).fill(index + request.step), seqOffset: request.tokenPosition, step: request.step } };
      },
      closeAttempt: async () => {},
      close: async () => {}
    };
    const resident = createResidentPartition({
      runtime: { openResidentPartition: async () => session },
      model: { id: MODEL.modelId, identity: MODEL.modelIdentity, generation: { maxTokens: steps } },
      plan, planId: MODEL.planId, index, participantId, limits: { maxAttempts: 100, maxConcurrentAttempts: 2 },
      ordered: { runtime, stage: route.stages[index] }, ...(signers[index] ? { evidence: signers[index] } : {})
    });
    await resident.prepare({ approved: true });
    residents.push(resident);
  }
  // The coordinator's stage ports; a stage whose channel closed answers CONNECTION_LOST, as the partition network does.
  const closedLinks = new Set();
  const stages = residents.map((resident, index) => ({
    id: resident.id, transportId: resident.transportId, residentId: resident.residentId, executionId: resident.executionId,
    async reserve(request) {
      if (closedLinks.has(`${index}:${request.identity.attemptId}`)) throw lost();
      return resident.reserve(request);
    },
    async executeStage(request) {
      const { attemptId } = request.identity;
      const gate = gates.find((row) => row.index === index && row.step === request.step && !row.used);
      if (gate) {
        gate.used = true;
        gate.entered.resolve();
        await Promise.race([gate.release.promise, new Promise((_, reject) => {
          if (request.signal?.aborted) reject(request.signal.reason);
          request.signal?.addEventListener('abort', () => reject(request.signal.reason), { once: true });
        })]);
      }
      const fault = faults.find((row) => row.index === index && row.step === request.step && !row.used);
      if (fault) {
        fault.used = true;
        closedLinks.add(`${index}:${attemptId}`);
        // The contributor settles its own resident when its channel closes; the coordinator cannot confirm it.
        await resident.closeAttempt({ identity: request.identity });
        throw lost();
      }
      if (closedLinks.has(`${index}:${attemptId}`)) throw lost();
      return resident.executeStage(request);
    },
    async closeAttempt(request) {
      if (closedLinks.has(`${index}:${request.identity.attemptId}`)) throw lost();
      return resident.closeAttempt(request);
    }
  }));
  const runner = createLayerPartitionRunner({
    runtime, plan, route, stages, authorize: async () => true,
    transport: { transferActivation: async (frame) => structuredClone(frame) },
    limits: { maxTokens: 10, maxPromptTokens: 32, maxActivationBytes: 4096, maxOutputCharacters: 100, maxAttempts: 100, maxConcurrentAttempts: 2, maxStages: 8 }
  });
  const grant = { id: 'grant' };
  const model = {
    id: MODEL.modelId, identity: MODEL.modelIdentity, name: 'Resident route fixture', provider: 'doppler',
    partition: { schema: 'reploid.partition-selection/v2', planId: MODEL.planId, coordinatorId: route.stages[0].participantId, route }
  };
  const requester = {
    /** The ordered requester's generate contract over the in-process route. */
    async generate(request, controls) {
      const identity = { schema: 'reploid.partition-attempt/v2', route, requesterId, threadId: request.threadId, attemptId: request.attemptId, placementGeneration: 0 };
      const disclosure = orderedPartitionDisclosure(identity);
      const coordinator = route.stages[0].participantId;
      const approved = await controls.requestApproval({
        id: crypto.randomUUID(), threadId: request.threadId, attemptId: request.attemptId, operation: 'generate-partition',
        peerId: coordinator, recipientIdentity: coordinator, ...structuredClone(model.partition), modelId: model.id, modelIdentity: model.identity,
        adapterIdentities: [], disclosure, expiresAt: Date.now() + 60_000, executionTimeoutMs: 60_000,
        input: { messages: structuredClone(request.messages), recipients: [...new Set([...disclosure.tokenRecipients, ...disclosure.outputRecipients])] }
      });
      controls.signal?.throwIfAborted();
      if (approved !== true) throw new Error('Ordered disclosure declined or expired');
      controls.onState?.({ threadId: request.threadId, attemptId: request.attemptId, status: 'executing', execution: { placement: 'ordered-layer-partition', identity } });
      let sequence = 0;
      const result = await runner.execute({
        identity, tokenIds: [1, 2], generation: { maxTokens: steps }, maxTokens: steps, signal: controls.signal,
        // The requester's charge binding and acknowledgment port, as the coordinator's ordered chat forwards them.
        ...(controls.charge ? { charge: controls.charge, acknowledgmentDeadlineAt: Date.now() + acknowledgmentWaitMs,
          ...(controls.onOutput ? { onOutput: controls.onOutput } : {}) } : {}),
        grants: { execution: stages.map(() => grant), tokenContext: stages.map(() => grant), activation: stages.slice(1).map(() => grant), output: grant },
        onActivity: (activity) => controls.onActivity?.({ threadId: request.threadId, attemptId: request.attemptId, ...activity }),
        onDelta: (text) => controls.onDelta?.({ threadId: request.threadId, attemptId: request.attemptId, sequence: sequence++, text })
      });
      return {
        threadId: request.threadId, attemptId: request.attemptId, modelId: model.id, modelIdentity: model.identity, adapterIdentities: [],
        content: result.content, execution: { ...summarizePartitionExecution(result.execution), provider: 'peer' }
      };
    }
  };
  return {
    plan, route, model, residents, stages, runner, requester, runtime,
    /** Hold stage `index` before `step` of the next attempt that reaches it, until released or aborted. */
    hold(index, step) {
      const gate = { index, step, used: false, entered: Promise.withResolvers(), release: Promise.withResolvers() };
      gates.push(gate);
      return { entered: gate.entered.promise, release: () => gate.release.resolve() };
    },
    /** Close stage `index`'s channel when the next attempt reaches `step`. */
    loseStage(index, step) { faults.push({ index, step, used: false }); },
    /** The stage's own admission records. */
    admissions: (index) => residents[index].getState().reservations.records,
    close: async () => { await runner.close().catch(() => {}); await Promise.allSettled(residents.map((resident) => resident.close())); }
  };
}
