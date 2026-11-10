/** Origin-wide cache use. A failed cleanup retains its lease until cleanup succeeds. */
export const MODEL_STORAGE_LOCK = 'reploid:model-storage-use';

export function retainModelStorage({ signal, locks = globalThis.navigator?.locks } = {}) {
  // Hosts without browser storage can still execute injected models. Removal requires locks.
  if (!locks?.request) return Promise.resolve(() => {});
  return new Promise((resolve, reject) => {
    const holding = locks.request(MODEL_STORAGE_LOCK, { mode: 'shared', ...(signal ? { signal } : {}) },
      () => new Promise(release => resolve(() => { release(); return holding; })));
    holding.catch(reject);
  });
}

export function withUnusedModelStorage(operation, locks = globalThis.navigator?.locks) {
  if (!locks?.request) throw new Error('Safe storage removal is unavailable in this browser.');
  const names = [MODEL_STORAGE_LOCK, 'reploid:model-acquisition', 'reploid-chat-artifacts-v1:write'];
  const enter = index => index === names.length ? operation() : locks.request(names[index], { ifAvailable: true }, lock => {
    if (!lock) throw new Error('Model files are in use. Stop local models, downloads and file sharing in all Reploid tabs first.');
    return enter(index + 1);
  });
  return enter(0);
}
