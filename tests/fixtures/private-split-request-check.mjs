import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseTextResponse } from '../../server/responses.js';
import { parseExecutionExtension } from '../../server/text-request-options.js';
import { fileURLToPath } from 'node:url';
import catalog from '../../shared/config/chat-models.json' with { type: 'json' };

const model = catalog.find(row => row.id === 'qwen-3-8-27b-text-q4k-ef16-af32');
const manifestFile = model.source.files.find(file => file.role === 'model-manifest').url;
const { hiddenSize } = JSON.parse(await readFile(new URL('../../shared' + manifestFile, import.meta.url))).architecture;
const providers = ['a', 'b'].map(letter => 'peer:' + letter.repeat(24));
const requester = 'peer:' + 'c'.repeat(24);
const selectionId = model.id + '/partition/' + model.partitionPlanId;
const cli = fileURLToPath(new URL('./private-split-request.mjs', import.meta.url));

function snapshot() {
  const selected = { modelId: model.id, modelIdentity: model.identity, mode: 'partition' };
  const stages = providers.map((participantId, index) => ({
    index, participantId, transportId: 'rtc-' + index, residentId: 'resident-' + index, executionId: 'executor-' + index
  }));
  const route = { schema: 'reploid.partition-route/v1', modelId: model.id, modelIdentity: model.identity,
    planId: model.partitionPlanId, stages, activation: { schema: 'doppler.activation-tensor/v1', dtype: 'f32',
      hiddenSize, precision: 'f32', components: 1, elementStrideBytes: 4 } };
  const partition = { schema: 'reploid.partition-selection/v2', planId: model.partitionPlanId,
    coordinatorId: providers[0], route };
  const approval = { modelId: model.id, modelIdentity: model.identity, partition, adapterIdentities: [], evidence: 'fixture://review' };
  const advertised = { id: model.id, identity: model.identity, selectionId, adapters: [], availability: 'ready',
    partition: structuredClone(partition) };
  return {
    config: { schema: 'reploid.fleet-native/v1', computerId: 'requester', roomId: 'fixture-room', roomTokenFile: '/unused',
      models: [{ model, mode: 'partition', ordered: { stage: null } }], maxOutputTokens: 16,
      textApi: { allowedRecipients: providers, privatePartitionApprovals: [approval] } },
    state: { result: { computerId: 'requester', participantId: requester, selected, preparing: false,
      execution: { models: [advertised] } } },
    listing: { object: 'list', data: [{ id: selectionId, model_identity: model.identity, adapter_identities: [] }] },
    prompt: { modelId: model.id, messages: [{ role: 'user', content: 'Controlled fixture' }], maxOutputTokens: 4 }
  };
}

async function run(input) {
  const directory = await mkdtemp(path.join(tmpdir(), 'reploid-private-split-request-'));
  try {
    const files = [];
    for (const key of ['config', 'state', 'listing', 'prompt']) {
      const file = path.join(directory, key + '.json');
      await writeFile(file, JSON.stringify(input[key]));
      files.push(file);
    }
    return spawnSync(process.execPath, [cli, ...files], { encoding: 'utf8' });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('the approved split produces a streaming request pinned to both stages and its output requester', async () => {
  const input = snapshot(), result = await run(input);
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  const { reploid, ...protocol } = body;
  const parsed = parseTextResponse(protocol);
  assert.deepEqual(parsed.messages, input.prompt.messages);
  assert.equal(parsed.generationRequest.maxOutputTokens, 4);
  assert.deepEqual(parseExecutionExtension(reploid).execution.participants.ids, [...providers, requester]);
  assert.deepEqual(body, { model: selectionId, input: input.prompt.messages, stream: true,
    max_output_tokens: 4, reploid: { poolId: input.config.roomId,
      model: { identity: model.identity, adapterIdentities: [], planIdentity: model.partitionPlanId },
      execution: { placement: 'network-allowed', participants: { kind: 'named', ids: [...providers, requester] },
        confidentiality: 'executor-readable', allowMetadata: ['model-id', 'timing', 'length', 'access-patterns'] } } });
});

const refusals = [
  ['a reference for a superseded model', data => { data.prompt.modelIdentity = 'sha256:' + '0'.repeat(64); },
    /different model/],
  ['a reference bound to a different partition plan', data => { data.prompt.planIdentity = 'sha256:' + '0'.repeat(64); },
    /different plan/],
  ['a changed executor', data => { data.state.result.execution.models[0].partition.route.stages[1].executionId = 'restarted'; },
    /one ready instance/],
  ['a whole-model listing alone', data => { data.listing.data[0].id = model.id; }, /missing or ambiguous/],
  ['two approved rosters with the same plan selection ID', data => {
    const approvals = data.config.textApi.privatePartitionApprovals;
    const other = structuredClone(approvals[0]);
    other.partition.route.stages[1].transportId = 'other-transport';
    approvals.push(other);
  }, /exactly one reviewed roster/],
  ['a requester also executing a stage', data => { data.state.result.participantId = providers[1]; }, /requester cannot execute/]
];
for (const [label, change, reason] of refusals) {
  test('refuses ' + label + ' without emitting a request body', async () => {
    const input = snapshot();
    change(input);
    const result = await run(input);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, reason);
    assert.equal(result.stdout, '');
  });
}
