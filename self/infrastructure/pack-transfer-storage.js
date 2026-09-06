/** Durable transport staging only. Doppler still verifies the complete artifact and Pack. */
import { sha256Hex } from '../pool/inference-receipt.js';

const assert = (condition, message) => { if (!condition) throw new Error(`Pack checkpoints: ${message}`); };
const request = (operation) => new Promise((resolve, reject) => {
  operation.onsuccess = () => resolve(operation.result);
  operation.onerror = () => reject(operation.error);
});
const validChunk = (chunk) => {
  assert(/^sha256:[a-f0-9]{64}$/.test(chunk?.hash)
    && Number.isSafeInteger(chunk.sizeBytes) && chunk.sizeBytes > 0, 'chunk commitment required');
};

export async function openPeerPackCheckpoints({ name = 'reploid-pack-transfer-v1', maxBytes, indexedDB = globalThis.indexedDB } = {}) {
  assert(Number.isSafeInteger(maxBytes) && maxBytes > 0, 'explicit disk byte limit required');
  assert(indexedDB, 'IndexedDB unavailable');
  const opening = indexedDB.open(name, 1);
  opening.onupgradeneeded = () => {
    const db = opening.result;
    db.createObjectStore('chunks');
    const entries = db.createObjectStore('entries', { keyPath: 'hash' });
    entries.createIndex('lastUsed', 'lastUsed');
  };
  const db = await request(opening);
  let closed = false;
  db.onversionchange = () => { closed = true; db.close(); };
  const transact = async (mode, signal, action) => {
    assert(!closed, 'store closed');
    signal?.throwIfAborted();
    const transaction = db.transaction(['chunks', 'entries'], mode);
    const abort = () => { try { transaction.abort(); } catch { /* Already settled. */ } };
    signal?.addEventListener('abort', abort, { once: true });
    const completion = new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(signal?.reason || transaction.error || new Error('Pack checkpoint transaction aborted'));
      transaction.onerror = () => {};
    });
    // Attach a rejection handler before awaiting individual requests.
    completion.catch(() => {});
    try {
      const result = await action(transaction.objectStore('chunks'), transaction.objectStore('entries'));
      await completion;
      signal?.throwIfAborted();
      assert(!closed, 'store closed');
      return result;
    } catch (error) {
      abort();
      await completion.catch(() => {});
      throw error;
    } finally { signal?.removeEventListener('abort', abort); }
  };
  return {
    async getChunk(chunk, { signal } = {}) {
      validChunk(chunk);
      return transact('readwrite', signal, async (chunks, entries) => {
        const value = await request(chunks.get(chunk.hash));
        if (value === undefined) return null;
        const metadata = await request(entries.get(chunk.hash));
        if (!metadata || metadata.sizeBytes !== chunk.sizeBytes) {
          await request(chunks.delete(chunk.hash));
          await request(entries.delete(chunk.hash));
          return null;
        }
        await request(entries.put({ ...metadata, lastUsed: Date.now() }));
        // The transfer owner rehashes even valid-looking restored bytes.
        return value instanceof Uint8Array ? value.slice() : new Uint8Array(0);
      });
    },
    async putChunk(chunk, input, { signal } = {}) {
      validChunk(chunk);
      assert(input instanceof Uint8Array && input.byteLength === chunk.sizeBytes, 'chunk size mismatch');
      assert(chunk.sizeBytes <= maxBytes, 'chunk exceeds disk limit');
      const bytes = input.slice();
      assert(await sha256Hex(bytes) === chunk.hash, 'chunk integrity mismatch');
      signal?.throwIfAborted();
      return transact('readwrite', signal, async (chunks, entries) => {
        const existing = await request(entries.getAll());
        let used = existing.reduce((total, item) => total + item.sizeBytes, 0);
        const old = existing.find((item) => item.hash === chunk.hash);
        used -= old?.sizeBytes || 0;
        let evictedBytes = 0;
        for (const entry of existing.sort((a, b) => a.lastUsed - b.lastUsed || a.hash.localeCompare(b.hash))) {
          if (used + bytes.length <= maxBytes) break;
          if (entry.hash === chunk.hash) continue;
          await request(chunks.delete(entry.hash));
          await request(entries.delete(entry.hash));
          used -= entry.sizeBytes;
          evictedBytes += entry.sizeBytes;
        }
        await request(chunks.put(bytes, chunk.hash));
        await request(entries.put({ hash: chunk.hash, sizeBytes: bytes.length, lastUsed: Date.now() }));
        return { storedBytes: used + bytes.length, evictedBytes };
      });
    },
    async deleteChunk(chunk, { signal } = {}) {
      validChunk(chunk);
      return transact('readwrite', signal, async (chunks, entries) => {
        await request(chunks.delete(chunk.hash));
        await request(entries.delete(chunk.hash));
      });
    },
    async getStats() {
      return transact('readonly', null, async (_chunks, entries) => {
        const all = await request(entries.getAll());
        return { storedBytes: all.reduce((total, item) => total + item.sizeBytes, 0), chunks: all.length,
          maxBytes, storage: 'indexeddb', persistence: 'browser-managed' };
      });
    },
    close() { closed = true; db.close(); }
  };
}
