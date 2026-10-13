// No GPU: exercise the installed public factory with an explicitly injected
// Capsule opener/session. This is allocation forwarding/cleanup, not admission.
import assert from 'node:assert/strict';
import * as runtime from 'doppler-gpu/partitions';
const required = ['canonicalGenerationIdentity', 'metadataDigest', 'tokenDigest', 'validateResidentAttemptIdentity',
  'residentAttemptDigest', 'residentPublicationDecisionDigest', 'validateExecutionPublication', 'validateAdmissionPublication',
  'validateResidentCursor', 'validateOrdinaryActivation', 'serializeActivationFrame', 'validateActivationFrameForPlan',
  'admitResidentPrompt', 'bootstrapResidentCursor', 'decideResidentBlock', 'hashLayerPartitionPlan',
  'createResidentPartitionFactory', 'createManifestResidentPartitionFactory'];
for (const name of required) assert.equal(typeof runtime[name], 'function', name);
const controller = new AbortController();
const input = { model: { id: 'synthetic', identity: 'synthetic-identity', capsule: { id: 'synthetic-source' }, generation: { maxTokens: 2 } },
  plan: { synthetic: true }, planId: 'synthetic-plan', index: 0, participantId: 'synthetic-participant',
  limits: { synthetic: true }, signal: controller.signal, canonicalGeneration: { synthetic: 'explicit-generation' } };
let observed, closed = 0;
const resident = Object.freeze({ fixtureOnly: true });
const factory = runtime.createResidentPartitionFactory({ capsuleOptions: { syntheticTrust: true },
  openCapsule: async (source, options) => { observed = { source, options }; return { residentPartition: resident, close: async () => { closed++; } }; } });
assert.equal(await factory.openResidentPartition(input), resident);
assert.deepEqual(observed.options.residentPartition.canonicalGeneration, input.canonicalGeneration);
assert.notEqual(observed.options.residentPartition.canonicalGeneration, input.canonicalGeneration);
assert.equal(observed.options.signal, controller.signal);
assert.equal(closed, 0);
const aborted = new AbortController(); aborted.abort(Error('pre-aborted'));
await assert.rejects(factory.openResidentPartition({ ...input, signal: aborted.signal }), /pre-aborted/);
const late = new AbortController();
const lateFactory = runtime.createResidentPartitionFactory({ capsuleOptions: {}, openCapsule: async () => {
  late.abort(Error('late abort')); return { residentPartition: resident, close: async () => { closed++; } };
} });
await assert.rejects(lateFactory.openResidentPartition({ ...input, signal: late.signal }), /late abort/);
assert.equal(closed, 1);
const missing = runtime.createResidentPartitionFactory({ capsuleOptions: {}, openCapsule: async () => ({ close: async () => { closed++; } }) });
await assert.rejects(missing.openResidentPartition(input), /does not implement/); assert.equal(closed, 2);
const failed = runtime.createResidentPartitionFactory({ capsuleOptions: {}, openCapsule: async () => ({ close: async () => { throw Error('cleanup failed'); } }) });
await assert.rejects(failed.openResidentPartition(input), error => error instanceof AggregateError && error.errors.length === 2);
console.log(JSON.stringify({ publicEntry: import.meta.resolve('doppler-gpu/partitions'), required,
  publicFactoryForwarding: true, preparationAbortCleanup: true, missingResidentCleanup: true,
  cleanupAggregate: true, injectedCapsuleOpener: true, physicalResidentQualified: false }, null, 2));
