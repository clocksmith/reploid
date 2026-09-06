/** Adapter acquisition composes the existing publication registry and custody owner. */
import { openPeerPackCheckpoints } from '../infrastructure/pack-transfer-storage.js';
import { createPeerPackArtifactStore } from './peer-pack-custody.js';
import { executionAdapterArtifact, executionAdapterArtifactSet, normalizeExecutionAdapterSet,
  resolveAdapterExecutionPolicy } from './adapter-execution.js';
import { hashDopplerEvidence } from './executable-pack.js';

const assert = (ok, message) => { if (!ok) throw new Error(`Peer adapter: ${message}`); };

export function createPeerAdapterResolver({ registry, resolveCustody, policy: input,
  openCheckpoints = openPeerPackCheckpoints }) {
  const policy = resolveAdapterExecutionPolicy(input);
  assert(typeof registry?.getPublication === 'function' && typeof registry?.getArtifact === 'function', 'publication registry required');
  const assertPublicationsCurrent = async ({ adapterSet, model }) => {
    const entries = await normalizeExecutionAdapterSet(adapterSet, { model, policy });
    for (const entry of entries) {
      const current = registry.getPublication(entry.identity);
      assert(current && current.revoked !== true && current.publicationHash === entry.publication.publicationHash,
        'adapter publication missing, changed, or revoked');
    }
  };
  return Object.freeze({
    assertCurrent: assertPublicationsCurrent,
    async prepare({ adapterSet, model, signal }) {
      const entries = await normalizeExecutionAdapterSet(adapterSet, { model, policy });
      const bytesByArtifact = new Map();
      const receipts = [];
      const stores = [];
      let checkpoints;
      let closed = false;
      const assertCurrent = async () => {
        signal?.throwIfAborted();
        assert(!closed, 'acquisition closed');
        await assertPublicationsCurrent({ adapterSet: entries, model });
      };
      const close = () => {
        closed = true;
        for (const store of stores) store.close();
        checkpoints?.close();
        bytesByArtifact.clear();
      };
      try {
        await assertCurrent();
        for (const entry of entries) {
          const artifact = executionAdapterArtifact(entry);
          const cached = await registry.getArtifact(entry.identity);
          await assertCurrent();
          let bytes;
          if (cached) {
            bytes = Uint8Array.from(cached.bytes);
            receipts.push({ identity: entry.identity, source: 'registry-cache', receivedBytes: 0 });
          } else {
            assert(policy.fetchBeforeExecute && typeof resolveCustody === 'function', 'missing adapter cannot be fetched under this policy');
            const custody = await resolveCustody({ entry, artifactSet: executionAdapterArtifactSet(entry), signal });
            await assertCurrent();
            assert(custody?.authorization?.schema === 'reploid.pool.pack-custody-authorization/v2'
              && await hashDopplerEvidence(custody.authorization.artifactSet) === await hashDopplerEvidence(executionAdapterArtifactSet(entry)),
            'custody authorizes a different adapter artifact set');
            checkpoints ??= await openCheckpoints({ name: policy.storage.databaseName, maxBytes: policy.storage.maxCacheBytes });
            await assertCurrent();
            const store = await createPeerPackArtifactStore({ ...custody, checkpoints, signal,
              maxConcurrentChunks: policy.storage.maxConcurrentChunks });
            stores.push(store);
            bytes = await store.readArtifact(artifact);
            await assertCurrent();
            receipts.push(store.getReceipt());
            // Persisted chunks remain reusable without retaining a second base model.
          }
          bytesByArtifact.set(await hashDopplerEvidence(artifact), bytes);
        }
        await assertCurrent();
        return Object.freeze({ adapterSet: entries, receipts: Object.freeze(receipts), assertCurrent, close,
          artifactStore: Object.freeze({ async readArtifact(artifact) {
            await assertCurrent();
            const bytes = bytesByArtifact.get(await hashDopplerEvidence(artifact));
            assert(bytes, 'artifact outside resolved adapter set');
            return bytes.slice();
          } }) });
      } catch (error) { close(); throw error; }
    }
  });
}
