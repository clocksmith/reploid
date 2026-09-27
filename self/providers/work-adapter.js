/** Acquire catalog-pinned adapter bytes; Doppler owns compatibility and tensor identity. */
export function createWorkAdapterResolver({ models, acquire, fetchImpl = globalThis.fetch }) {
  const catalog = structuredClone(models).flatMap(model => model.availableAdapters || []);
  const cache = new Map();
  return async (selection, { signal }) => {
    signal.throwIfAborted();
    const entry = catalog.find(item => item.identity === selection.identity
      && item.baseModelIdentity === selection.baseModelIdentity);
    if (!entry) throw new Error('Selected adapter is not in the authorized catalog');
    let bytes = cache.get(entry.identity);
    if (!bytes) {
      if (acquire) bytes = new Uint8Array(await acquire(entry.artifact, { signal })).slice();
      else {
        const response = await fetchImpl(entry.artifact.url, { signal });
        if (!response.ok) throw new Error(`Adapter acquisition HTTP ${response.status}`);
        const chunks = []; let size = 0;
        const reader = response.body.getReader();
        try {
          while (size <= entry.artifact.sizeBytes) {
            const { value, done } = await reader.read();
            if (done) break;
            if (!value?.byteLength) throw new Error('Adapter stream made no progress');
            signal.throwIfAborted(); size += value.byteLength;
            if (size > entry.artifact.sizeBytes) throw new Error('Adapter exceeds its declared file size');
            chunks.push(value);
          }
        } finally { await reader.cancel(); reader.releaseLock(); }
        bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      }
      signal.throwIfAborted();
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
        .map(value => value.toString(16).padStart(2, '0')).join('');
      if (bytes.byteLength !== entry.artifact.sizeBytes || 'sha256:' + digest !== entry.artifact.hash) {
        throw new Error('Adapter file identity mismatch');
      }
      signal.throwIfAborted(); cache.set(entry.identity, bytes.slice());
    }
    return { manifest: structuredClone(entry.manifest), options: {
      weightsLayout: entry.weightsLayout, readOPFS: undefined, writeOPFS: undefined,
      fetchUrl: async url => {
        signal.throwIfAborted();
        if (url !== entry.manifest.weightsPath) throw new Error('Adapter requested an undeclared file');
        return bytes.slice().buffer;
      }
    } };
  };
}
