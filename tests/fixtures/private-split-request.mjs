// Prepare an ordinary HTTP request from saved owner inputs. This program has no network
// port, does not load a runtime, and cannot change a provider or grant an approval.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import catalog from '../../shared/config/chat-models.json' with { type: 'json' };
import bootstrap from '../../shared/config/swarm-bootstrap.json' with { type: 'json' };
import { availablePartitionRoute } from '../../apps/poolday/host/partition-release.js';
import { canonicalPartitionRoute } from '../../packages/reploid/src/contracts/partition.js';

const [configPath, statePath, modelsPath, requestPath] = process.argv.slice(2);
assert(configPath && statePath && modelsPath && requestPath,
  'Usage: node tests/fixtures/private-split-request.mjs REQUESTER_CONFIG HOST_STATE HTTP_MODELS PROMPT_FIXTURE');
const [config, snapshot, listing, fixture] = await Promise.all(
  [configPath, statePath, modelsPath, requestPath].map(async file => JSON.parse(await readFile(file, 'utf8')))
);
const state = snapshot.result ?? snapshot;
const model = catalog.find(row => row.id === fixture.modelId);
const stageCount = model?.partitionRequest ? model.partitionRequest.splitLayers.length + 1 : model?.partitionPlan?.stageCount;
assert(stageCount === 2 && state.selected?.mode === 'partition'
  && state.selected.modelId === model.id && state.selected.modelIdentity === model.identity,
  'Select the same catalogued two-stage model on the requester');
assert(config.schema === 'reploid.fleet-native/v1' && config.computerId === state.computerId
  && config.roomId && config.roomId !== bootstrap.publicRoomId && config.roomTokenFile
  && config.models.some(entry => entry.mode === 'partition' && entry.model.id === model.id
    && entry.model.identity === model.identity && entry.ordered?.stage === null),
  'Use a separate, enrolled, connect-only ordered requester in a private room');
assert(!state.preparing && !state.error && /^peer:[a-f0-9]{24,64}$/i.test(state.participantId),
  'Requester state is not ready');
const approvals = config.textApi.privatePartitionApprovals.filter(row => row.modelId === model.id
  && row.modelIdentity === model.identity && row.partition?.planId === model.partitionPlanId
  && Array.isArray(row.adapterIdentities) && !row.adapterIdentities.length);
// The list ID names the plan. Two approvals for different rosters on that plan
// would give the same list ID, so require a single reviewed descriptor here.
assert.equal(approvals.length, 1, 'Require exactly one reviewed roster for this model and plan');
if (fixture.modelIdentity !== undefined) assert.equal(fixture.modelIdentity, model.identity, 'Reference was captured for a different model');
if (fixture.planIdentity !== undefined) assert.equal(fixture.planIdentity, model.partitionPlanId, 'Reference targets a different plan');
const [approved] = approvals;
const route = canonicalPartitionRoute(approved.partition.route);
assert(route.modelId === model.id && route.modelIdentity === model.identity && route.planId === model.partitionPlanId
  && route.stages.length === 2 && approved.partition.coordinatorId === route.stages[0].participantId,
  'Approved route does not bind this catalog plan or its coordinator');
const providers = route.stages.map(stage => stage.participantId);
assert(!providers.includes(state.participantId), 'The separate requester cannot execute a stage');
assert.deepEqual([...config.textApi.allowedRecipients].sort(), [...providers].sort(), 'Pin both stage providers only');
const advertised = state.execution.models.filter(row => !row.canonical && availablePartitionRoute(row, approvals)
  && (row.networkAvailability ?? row.availability) === 'ready');
assert.equal(advertised.length, 1, 'Requester did not observe one ready instance of the approved split');
const selection = advertised[0].selectionId;
assert(selection && selection !== model.id, 'An exact split selection ID is required');
const listed = listing.data.filter(row => row.id === selection);
assert.equal(listed.length, 1, 'The split is missing or ambiguous in the authenticated model listing');
assert.equal(listed[0].model_identity, model.identity);
assert.deepEqual(listed[0].adapter_identities, []);
assert(Array.isArray(fixture.messages) && fixture.messages.length > 0
  && fixture.messages.every(message => typeof message.content === 'string' && ['system', 'user', 'assistant'].includes(message.role)),
  'Expected text messages from the frozen reference');
assert(Number.isSafeInteger(fixture.maxOutputTokens) && fixture.maxOutputTokens > 0
  && fixture.maxOutputTokens <= Math.min(config.maxOutputTokens, model.generation.maxTokens), 'Token limit exceeds the serving configuration');
console.log(JSON.stringify({ model: selection, input: fixture.messages, store: false, stream: true,
  max_output_tokens: fixture.maxOutputTokens, reploid: { pool_id: config.roomId, expected_model_identity: model.identity,
    expected_adapter_identities: [], expected_plan_identity: model.partitionPlanId,
    // Output is also disclosed back to this requester. The fleet server separately
    // constrains compute recipients to the two providers pinned above.
    allowed_recipients: [...providers, state.participantId], include_execution: true } }, null, 2));
