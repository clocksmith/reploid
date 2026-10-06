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

/** File-backed staging avoids retaining large deleted IndexedDB values in its
 * journal while OPFS is simultaneously acquiring the completed model files. */
export async function openPeerPackFileCheckpoints({ name = 'reploid-chat-checkpoints-v1', maxBytes,
  storage = globalThis.navigator.storage, locks = globalThis.navigator.locks } = {}) {
  assert(Number.isSafeInteger(maxBytes) && maxBytes > 0, 'explicit disk byte limit required');
  let directory;
  let closed = false;
  const key = chunk => { validChunk(chunk); return chunk.hash.slice(7); };
  const run = (signal, action) => locks.request(name, { ...(signal ? { signal } : {}) }, async () => {
    assert(!closed, 'store closed'); signal?.throwIfAborted();
    // Browser-managed storage may disappear while a contribution is idle.
    // Resolve its namespace under the shared lock instead of retaining a
    // handle to a removed directory across requests.
    directory = await (await storage.getDirectory()).getDirectoryHandle(name, { create: true });
    return action();
  });
  const entries = async () => {
    const result = [];
    for await (const [name, handle] of directory.entries()) if (handle.kind === 'file' && /^[a-f0-9]{64}$/.test(name)) {
      const file = await handle.getFile(); result.push({ name, size: file.size, lastUsed: file.lastModified });
    }
    return result;
  };
  const writeIndex = async files => {
    const writer = await (await directory.getFileHandle('index.json', { create: true })).createWritable();
    try { await writer.write(JSON.stringify(files)); await writer.close(); }
    catch (error) { await writer.abort().catch(() => {}); throw error; }
  };
  // Reconcile an interrupted previous writer once. All later operations read
  // the shared index under the same lock, including operations from other tabs.
  await run(null, async () => writeIndex(await entries()));
  const readIndex = async () => {
    try { return JSON.parse(await (await (await directory.getFileHandle('index.json')).getFile()).text()); }
    catch (error) {
      if (error.name !== 'NotFoundError') throw error;
      // Missing metadata is a cache miss, not a failed peer acquisition.
      // Rebuild from actual files; the custody runtime still verifies bytes.
      const files = await entries(); await writeIndex(files); return files;
    }
  };
  const remove = async name => {
    try { await directory.removeEntry(name); } catch (error) { if (error.name !== 'NotFoundError') throw error; }
  };
  const forget = async name => {
    await remove(name);
    await writeIndex((await readIndex()).filter(file => file.name !== name));
  };
  return {
    getChunk(chunk, { signal } = {}) {
      const name = key(chunk);
      return run(signal, async () => {
        try {
          const file = await (await directory.getFileHandle(name)).getFile();
          if (file.size !== chunk.sizeBytes) { await forget(name); return null; }
          const bytes = new Uint8Array(await file.arrayBuffer()); signal?.throwIfAborted(); return bytes;
        } catch (error) {
          if (error.name !== 'NotFoundError') throw error;
          await forget(name); return null;
        }
      });
    },
    async putChunk(chunk, input, { signal } = {}) {
      const name = key(chunk);
      assert(input instanceof Uint8Array && input.byteLength === chunk.sizeBytes && chunk.sizeBytes <= maxBytes, 'chunk size exceeds staging allowance');
      const bytes = input.slice();
      assert(await sha256Hex(bytes) === chunk.hash, 'chunk integrity mismatch');
      return run(signal, async () => {
        const index = await readIndex();
        // Always replace verified bytes: metadata can outlive an interrupted
        // write or browser eviction and cannot establish that content exists.
        const files = index.filter(file => file.name !== name).sort((a, b) => a.lastUsed - b.lastUsed || a.name.localeCompare(b.name));
        let used = files.reduce((sum, file) => sum + file.size, 0), evictedBytes = 0;
        let writer;
        try {
          while (used + bytes.length > maxBytes) {
            const old = files.shift(); signal?.throwIfAborted();
            await remove(old.name); used -= old.size; evictedBytes += old.size;
          }
          writer = await (await directory.getFileHandle(name, { create: true })).createWritable();
          await writer.write(bytes); signal?.throwIfAborted(); assert(!closed, 'store closed'); await writer.close();
          await writeIndex([...files, { name, size: bytes.length, lastUsed: Date.now() }]);
        } catch (error) {
          await writer?.abort().catch(() => {});
          await directory.removeEntry(name).catch(() => {});
          await writeIndex(await entries()).catch(() => {});
          throw error;
        }
        return { storedBytes: used + bytes.length, evictedBytes };
      });
    },
    deleteChunk(chunk, { signal } = {}) {
      const name = key(chunk);
      return run(signal, () => forget(name));
    },
    getStats() { return run(null, async () => {
      const files = await entries();
      return { storedBytes: files.reduce((sum, file) => sum + file.size, 0), chunks: files.length,
        maxBytes, storage: 'opfs', persistence: 'browser-managed' };
    }); },
    close() { closed = true; }
  };
}

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
