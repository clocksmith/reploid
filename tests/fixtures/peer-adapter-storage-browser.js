import config from '../../self/pool/pool-config.json' with { type: 'json' };
import { operationFixture } from './peer-pack-operation.js';
import { peerAdapterFixture } from './peer-adapter.js';
import { adapterCustodyFixture } from './peer-adapter-custody.js';
import { createPeerAdapterResolver } from '../../self/pool/peer-adapter-execution.js';
import { createAdapterRegistry } from '../../self/pool/adapter-registry.js';
import { executionAdapterArtifact } from '../../self/pool/adapter-execution.js';
import { packPeerModel } from '../../self/pool/peer-pack-job.js';

export async function transfer(saved = null) {
  const f = saved || await peerAdapterFixture((await operationFixture('generate')).model);
  f.bytes = new Uint8Array(f.bytes);
  const registry = createAdapterRegistry();
  await registry.publish(f.publication);
  const ports = await adapterCustodyFixture(f);
  let requests = 0;
  const resolver = createPeerAdapterResolver({ registry, policy: config.peerJobs.execution.adapters,
    resolveCustody: async () => ({ ...ports, requestChunk: async (...args) => {
      requests++;
      if (saved) throw new Error('Original supplier is unavailable');
      return ports.requestChunk(...args);
    } }) });
  const prepared = await resolver.prepare({ adapterSet: [f.entry], model: packPeerModel(f.model), signal: new AbortController().signal });
  try {
    const bytes = await prepared.artifactStore.readArtifact(executionAdapterArtifact(f.entry));
    return { requests, bytes: [...bytes], receipts: prepared.receipts,
      saved: { model: f.model, bytes: [...f.bytes], publication: f.publication, entry: f.entry } };
  } finally { prepared.close(); }
}
