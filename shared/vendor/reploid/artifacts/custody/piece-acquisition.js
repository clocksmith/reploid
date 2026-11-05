/** Coordinates verified acquisition across eligible sources. Existing custody
 * exchanges can supply read(piece); storage and source credentials are host ports.
 */
export function createPieceAcquisition({ sources, cache, authorize, verify, limits, foregroundIdle }) {
  if (typeof sources !== 'function' || typeof authorize !== 'function' || typeof verify !== 'function'
    || typeof foregroundIdle !== 'function' || !cache?.get || !cache?.put
    || !['maxConcurrent', 'maxQueued', 'maxPieceBytes', 'timeoutMs'].every(k => Number.isSafeInteger(limits?.[k]) && limits[k] > 0)) {
    throw new Error('Explicit acquisition ports and limits required');
  }
  const policy = structuredClone(limits), tasks = new Map(), queue = [];
  const lifetime = new AbortController();
  const receipt = { transferredBytes: 0, reusedBytes: 0, completedPieces: 0, failedSources: [], active: 0 };
  const pump = () => {
    while (!lifetime.signal.aborted && queue.length && receipt.active < policy.maxConcurrent) {
      const task = queue.shift(); receipt.active++;
      run(task).then(task.resolve, task.reject).finally(() => {
        receipt.active--; tasks.delete(task.piece.identity); pump();
      });
    }
  };
  async function run({ piece }) {
    const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(policy.timeoutMs)]);
    const saved = await cache.get(piece.identity);
    if (saved && await verify(piece, saved)) { receipt.reusedBytes += saved.byteLength; return saved; }
    const failures = [];
    for (const source of sources(piece)) {
      signal.throwIfAborted();
      if (await authorize({ sourceId: source.id, piece }) !== true) continue;
      try {
        await foregroundIdle(signal); signal.throwIfAborted();
        const data = await source.read(piece, { signal });
        receipt.transferredBytes += data.byteLength;
        signal.throwIfAborted();
        if (data.byteLength !== piece.size || !await verify(piece, data)) throw new Error('Piece verification failed');
        await cache.put(piece.identity, data); receipt.completedPieces++;
        return data;
      } catch (error) {
        signal.throwIfAborted(); failures.push(error);
        receipt.failedSources.push({ sourceId: source.id, identity: piece.identity, error: String(error.message) });
      }
    }
    throw new AggregateError(failures, 'No eligible source supplied the verified piece');
  }
  return Object.freeze({
    acquire(piece, { signal } = {}) {
      signal?.throwIfAborted(); lifetime.signal.throwIfAborted();
      if (!/^sha256:[a-f0-9]{64}$/.test(piece?.identity) || !Number.isSafeInteger(piece.size)
        || piece.size < 1 || piece.size > policy.maxPieceBytes) throw new Error('Invalid piece allocation');
      let task = tasks.get(piece.identity);
      if (!task) {
        if (tasks.size >= policy.maxQueued) throw new Error('Acquisition queue is full');
        task = { piece: structuredClone(piece) };
        task.promise = new Promise((resolve, reject) => { task.resolve = resolve; task.reject = reject; });
        tasks.set(piece.identity, task); queue.push(task); pump();
      } else if (task.piece.size !== piece.size) throw new Error('Conflicting piece identity');
      // Cancelling one consumer does not discard a shared verified transfer.
      return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal?.addEventListener('abort', abort, { once: true });
        task.promise.then(bytes => { if (!signal?.aborted) resolve(bytes.slice()); }, reject)
          .finally(() => signal?.removeEventListener('abort', abort));
      });
    },
    getReceipt: () => structuredClone(receipt),
    async close() {
      lifetime.abort(new Error('Acquisition closed'));
      for (const task of queue.splice(0)) { task.reject(lifetime.signal.reason); tasks.delete(task.piece.identity); }
      await Promise.allSettled([...tasks.values()].map(task => task.promise));
    },
  });
}
