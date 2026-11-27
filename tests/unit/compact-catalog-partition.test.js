// @vitest-environment node
import { it } from 'vitest';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as native from 'dopplerx/partitions';
import catalog from '../../shared/config/chat-models.json' with { type: 'json' };
import { createWorkPartitionPlan } from '../../apps/poolday/host/work-partition-plan.js';
import { readNativeModelConfiguration } from '../../server/native-model-config.js';
import { DOPPLER_PARTITIONS_MODULE_URL } from '../../shared/config/doppler-local-models.js';
import { resolveServedFile } from '../../server/browser-roots.js';

// The browser copy is the vendored tree the page serves for the pinned Doppler version.
const browser = await import(pathToFileURL(resolveServedFile(DOPPLER_PARTITIONS_MODULE_URL)).href);

const pinned = 'sha256:a000b91dd404ff328a0deaa2f5e3ff89b5c73c9a93001d1870c145df4fdd882c';
const digest = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');

it('reconstructs the pinned 27B ordered contract in browser and native and refuses incompatible inputs', async () => {
  const selected = catalog.find(model => model.partitionPlanId === pinned);
  assert.ok(selected);
  assert.equal(selected.partitionPlan, undefined);
  const descriptor = selected.source.files.find(file => file.role === 'model-manifest');
  const bytes = await readFile(new URL('../../shared' + descriptor.url, import.meta.url));
  assert.equal(digest(bytes), selected.identity);
  const manifest = JSON.parse(bytes);
  const browserPlan = createWorkPartitionPlan(browser, manifest, selected, 0);
  const nativePlan = createWorkPartitionPlan(native, manifest, selected, 1);
  assert.deepEqual(nativePlan, browserPlan);
  assert.deepEqual(nativePlan.splitLayers, [1]);
  assert.equal(nativePlan.activationPrecision, 'f32');
  assert.equal(native.hashLayerPartitionPlan(nativePlan), pinned);
  assert.throws(() => createWorkPartitionPlan(native, manifest, { ...selected, partitionPlanId: 'sha256:' + '0'.repeat(64) }), /pinned Doppler plan digest/);
  assert.throws(() => createWorkPartitionPlan({}, manifest, selected), /installed Doppler/);
  assert.throws(() => createWorkPartitionPlan(native, manifest, { ...selected, capsule: {} }), /unsigned model/);
  assert.throws(() => createWorkPartitionPlan(native, manifest, { ...selected, partitionRequest: {
    ...selected.partitionRequest, adapterIdentities: ['sha256:' + '1'.repeat(64)]
  } }), /pinned Doppler plan digest/);

  const directory = await mkdtemp(join(tmpdir(), 'compact-plan-'));
  try {
    const path = join(directory, 'model.json');
    const manifestPath = join(directory, 'manifest.json');
    const options = { modelId: selected.id, modelDirectory: directory, models: [selected] };
    await writeFile(path, JSON.stringify({ schema: 'reploid.native-model/v1', model: selected.id }));
    await writeFile(manifestPath, bytes);
    assert.equal((await readNativeModelConfiguration(path, options)).partitionPlanId, pinned);
    await writeFile(manifestPath, JSON.stringify({ ...manifest, tokenizer: { wrong: true } }));
    await assert.rejects(readNativeModelConfiguration(path, options), /actual manifest/);
    await writeFile(manifestPath, bytes);
    await writeFile(path, JSON.stringify({ schema: 'reploid.native-model/v1', model: selected.id, partition: selected.partitionRequest }));
    await assert.rejects(readNativeModelConfiguration(path, options), /override a pinned compact/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
