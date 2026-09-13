import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { resolve } from 'node:path';
import { runPackOperation } from '../../self/pool/pack-operation.js';
import { hashDopplerEvidence } from '../../self/pool/executable-pack.js';

export async function checkInstalledAdapters({ consumer, service, api, makeRequest }) {
  const fixture = JSON.parse(await fs.readFile(resolve(consumer, 'adapter-fixture.json'), 'utf8'));
  const artifacts = new Map(fixture.artifacts.map(([id, bytes]) => [id, Uint8Array.from(bytes)]));
  let failLoad = false, failExecute = false, loads = 0, unloads = 0, closes = 0;
  const observations = [];
  const ports = {
    trustedSigners: fixture.trustedSigners,
    artifactStore: { readArtifact: async artifact => artifacts.get(artifact.artifactId) },
    device: { getDevice: () => ({ createBuffer: () => ({ destroy() {} }), createCommandEncoder() {}, queue: { writeBuffer() {} } }),
      getProfile: () => ({ surface: 'test-webgpu', hasF16: false, hasSubgroups: false, maxBufferSize: 1024 }) },
    programFactory: async ({ targetPlan }) => {
      let active = null;
      return { executionGraphHash: fixture.capsule.program.executionGraphHash,
        getInitialExecutionIdentity: () => targetPlan.initialExecutionIdentity,
        tokenize: () => [0, 2], decodeTokens: ids => ids.join(','), getTokenContract: () => ({}), reset() {},
        getActiveAdapterIdentity: () => active,
        async loadAdapter(manifest, control) {
          loads++;
          assert.equal(control.weightsLayout, 'peft');
          assert.deepEqual([...control.bytes], fixture.adapterBytes);
          active = { schema: 'doppler.lora-execution-identity/v1', id: manifest.id,
            digest: await hashDopplerEvidence({ tensors: fixture.adapterBytes, id: manifest.id }) };
          if (failLoad) throw new Error('injected adapter load failure');
        },
        unloadAdapter() { unloads++; active = null; },
        executePhase(_phase, request) {
          observations.push({ adapter: active?.id ?? null, temperature: request.context.generationOptions.temperature });
          if (failExecute) throw new Error('injected model failure');
          return { logits: new Float32Array(active ? [1, 3, 2] : [3, 2, 1]) };
        },
        releaseStepResult() {}, close() { assert.equal(active, null); closes++; },
      };
    },
  };
  const session = await service.openCapsule({ scope: 'adapter-a', source: fixture.capsule, options: ports });
  const second = await service.openCapsule({ scope: 'adapter-b', source: fixture.capsule, options: ports });
  const binding = { ...session.capsuleIdentity, artifacts: fixture.capsule.artifacts,
    requiredOperation: 'generate', acceptedTargetPlanDigests: [session.selectedTargetPlanDigest] };
  const request = { ...makeRequest({}), adapterSet: [fixture.adapter] };
  const adapterArtifactStore = { readArtifact: async () => Uint8Array.from(fixture.adapterBytes) };
  const run = (input = request, extra = {}) => runPackOperation({ binding, session, request: input,
    runtimeVersion: api.DOPPLER_VERSION, adapterArtifactStore, ...extra });
  try {
    const [adapted, base] = await Promise.all([run(), run({ ...request, adapterSet: [] }, { session: second })]);
    assert.deepEqual(adapted.output.tokenIds, [1]);
    assert.deepEqual(base.output.tokenIds, [0]);
    assert.equal(adapted.receipt.adapterReceipts[0].identity, fixture.adapter.identity);
    assert.equal(adapted.receipt.adapterReceipts[0].sourceDigest, fixture.adapter.artifact.hash);
    assert.deepEqual((await run({ ...request, adapterSet: [] })).output.tokenIds, [0]);
    failLoad = true;
    await assert.rejects(run(), /injected adapter load failure/);
    failLoad = false;
    failExecute = true;
    await assert.rejects(run(), /injected model failure/);
    failExecute = false;
    const replacement = structuredClone(fixture.adapter);
    replacement.identity = await hashDopplerEvidence({ replacement: 1 });
    replacement.manifest.id = replacement.artifact.artifactId = 'replacement-adapter';
    const replaced = await run({ ...request, adapterSet: [replacement] });
    assert.equal(replaced.receipt.adapterReceipts[0].identity, replacement.identity);
    assert.equal(observations.at(-1).adapter, 'replacement-adapter');
    const controller = new AbortController();
    await assert.rejects(run({ ...request, options: { ...request.options, maxTokens: 3 } }, {
      signal: controller.signal, onPartial: () => controller.abort(new Error('cancel adapted request')),
    }), /cancel adapted request/);
    await service.close('adapter-a');
    assert.deepEqual((await run({ ...request, adapterSet: [] }, { session: second })).output.tokenIds, [0]);
    assert.equal(loads, unloads, 'every loaded or partly loaded adapter is unloaded');
    return { passed: true, loads, unloads, observations };
  } finally {
    await service.close('adapter-a');
    await service.close('adapter-b');
    assert.equal(closes, 2);
  }
}
