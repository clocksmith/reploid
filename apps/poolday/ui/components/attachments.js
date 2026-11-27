

export async function readTextAttachments(chosen, existing, { maxFiles, maxFileBytes, maxTotalBytes, extensions }) {
  if (chosen.length + existing.length > maxFiles || chosen.some(file => file.size > maxFileBytes)
    || [...chosen, ...existing].reduce((sum, file) => sum + (file.size ?? file.bytes), 0) > maxTotalBytes) {
    throw new Error(`Attach up to ${maxFiles} text files, ${maxFileBytes / 1024} KB each and ${maxTotalBytes / 1024} KB total.`);
  }
  if (chosen.some(file => !extensions.includes(file.name.split('.').at(-1).toLowerCase()))) throw new Error('Choose a supported text file.');
  return Promise.all(chosen.map(async file => ({ name: file.name, bytes: file.size,
    text: new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()) })));
}

/** Serialize admission within one draft. Reset starts an independent draft;
 * borrowed File reads may finish later but cannot publish into its replacement. */
export function createTextAttachmentReader({ getFiles, onLoaded, onPending, limits }) {
  if (![getFiles, onLoaded, onPending].every(port => typeof port === 'function')) {
    throw new TypeError('Attachment reader requires file, publication and pending-state ports');
  }
  const policy = Object.freeze({ ...limits, extensions: Object.freeze([...limits.extensions]) });
  const createBatch = () => ({ pending: 0, tail: Promise.resolve() });
  let batch = createBatch(), closed = false;
  return Object.freeze({
    get pending() { return batch.pending > 0; },
    // The caller already renders a new draft when it resets this owner.
    reset() { batch = createBatch(); },
    close() { closed = true; batch = createBatch(); },
    enqueue(chosen) {
      if (closed) return Promise.reject(new Error('Attachment reader is closed'));
      const selected = [...chosen], current = batch;
      const active = () => !closed && current === batch;
      current.pending++;
      onPending();
      const reading = current.tail.then(async () => {
        if (!active()) return;
        const loaded = await readTextAttachments(selected, getFiles(), policy);
        if (active()) await onLoaded(loaded);
      }).catch(error => {
        // A stale draft's read failure must not replace the new draft's status.
        if (active()) throw error;
      });
      const settled = reading.finally(() => {
        current.pending--;
        if (active()) onPending();
      });
      current.tail = settled.catch(() => {});
      return settled;
    }
  });
}
