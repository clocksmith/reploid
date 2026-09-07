import { sha256Hex } from '../pool/inference-receipt.js';

/** Bounded OPFS acquisition bytes; the Capsule runtime owns final verification. */
export async function openCapsuleOpfsCheckpoints({ name, maxBytes }) {
  if (!name || !Number.isSafeInteger(maxBytes) || maxBytes <= 0 || !navigator.locks) {
    throw new Error('Capsule storage requires a namespace, disk limit, and browser locks');
  }
  const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
  let closed = false;
  const current = () => { if (closed) throw new Error('Capsule storage is closed'); };
  const filename = chunk => {
    if (!/^sha256:[a-f0-9]{64}$/.test(chunk.hash) || !Number.isSafeInteger(chunk.sizeBytes) || chunk.sizeBytes <= 0) {
      throw new Error('Capsule storage requires exact byte commitments');
    }
    return chunk.hash.slice(7);
  };
  const locked = action => navigator.locks.request(`reploid:opfs:${name}`, async () => {
    current(); const value = await action(); current(); return value;
  });
  return {
    getChunk: chunk => locked(async () => {
      try { return new Uint8Array(await (await (await directory.getFileHandle(filename(chunk))).getFile()).arrayBuffer()); }
      catch (error) { if (error.name === 'NotFoundError') return null; throw error; }
    }),
    deleteChunk: chunk => locked(async () => {
      try { await directory.removeEntry(filename(chunk)); }
      catch (error) { if (error.name !== 'NotFoundError') throw error; }
    }),
    putChunk: (chunk, input) => locked(async () => {
      const key = filename(chunk);
      if (!(input instanceof Uint8Array) || input.length !== chunk.sizeBytes || input.length > maxBytes
        || await sha256Hex(input) !== chunk.hash) throw new Error('Capsule storage byte commitment or disk limit mismatch');
      const files = [];
      for await (const [key, handle] of directory.entries()) {
        if (handle.kind !== 'file') throw new Error('Unexpected directory in Capsule byte cache');
        const file = await handle.getFile();
        files.push({ key, size: file.size, modified: file.lastModified });
      }
      let storedBytes = files.filter(file => file.key !== key).reduce((sum, file) => sum + file.size, 0);
      let evictedBytes = 0;
      for (const file of files.sort((a, b) => a.modified - b.modified || a.key.localeCompare(b.key))) {
        if (storedBytes + input.length <= maxBytes) break;
        if (file.key === key) continue;
        await directory.removeEntry(file.key); storedBytes -= file.size; evictedBytes += file.size;
      }
      const writable = await (await directory.getFileHandle(key, { create: true })).createWritable();
      try { await writable.write(input); await writable.close(); }
      catch (error) { await writable.abort().catch(() => {}); throw error; }
      return { storedBytes: storedBytes + input.length, evictedBytes };
    }),
    close() { closed = true; }
  };
}
