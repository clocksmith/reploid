/** Application-owned, bounded retention of opaque runtime contexts. No tensor math. */
export function createGenerationContextCache({ policy, create, now = Date.now }) {
  const { maxEntries, maxBytes, maxEntryBytes, idleMs } = policy;
  if (![maxEntries, maxBytes, maxEntryBytes, idleMs].every(n => Number.isSafeInteger(n) && n > 0)
    || maxEntryBytes > maxBytes) throw new Error('Invalid generation context retention policy');
  const entries = new Map();
  let closed = false;
  let cleanupError = null;
  let hits = 0, misses = 0, evictions = 0;
  const remove = (key, { evicted = false } = {}) => {
    const entry = entries.get(key);
    if (!entry || entry.active) return false;
    entry.context.close();
    clearTimeout(entry.timer);
    entries.delete(key);
    if (evicted) evictions++;
    return true;
  };
  const sweep = () => {
    for (const [key, entry] of entries) if (!entry.active && now() - entry.used >= idleMs) remove(key, { evicted: true });
  };
  const chargedBytes = entry => {
    const bytes = entry.context.getStats?.().allocatedBytes;
    return entry.active || !Number.isSafeInteger(bytes) || bytes < 0 ? maxEntryBytes : bytes;
  };
  return Object.freeze({
    acquire(key) {
      if (closed) throw new Error('Generation context cache is closed');
      if (cleanupError) throw new Error('Generation context expiry failed; close and replace the provider', { cause: cleanupError });
      if (!key) return null;
      sweep();
      let entry = entries.get(key);
      if (entry?.active) throw new Error('Generation context already leased');
      const otherBytes = () => [...entries].reduce((sum, [id, item]) => sum + (id === key ? 0 : chargedBytes(item)), 0);
      while ((!entry && entries.size >= maxEntries) || otherBytes() + maxEntryBytes > maxBytes) {
        const victim = [...entries].find(([id, candidate]) => id !== key && !candidate.active);
        if (!victim) return null;
        remove(victim[0], { evicted: true });
      }
      if (entry) {
        hits++;
      } else {
        misses++;
        // Reserve the full per-entry allowance before the runtime allocates it.
        // Active requests cannot be evicted to make room for another request.
        entry = { context: create({ maxBytes: maxEntryBytes }), used: now(), active: false, timer: null };
        entries.set(key, entry);
      }
      clearTimeout(entry.timer);
      entry.active = true;
      let released = false;
      return Object.freeze({
        context: entry.context,
        release({ discard = false } = {}) {
          if (released) return;
          released = true;
          entry.active = false;
          entry.used = now();
          if (discard) { remove(key); return; }
          entries.delete(key);
          entries.set(key, entry);
          entry.timer = setTimeout(() => {
            try { remove(key, { evicted: true }); } catch (error) { cleanupError = error; }
          }, idleMs);
          entry.timer.unref?.();
        },
      });
    },
    getStats() {
      let activeEntries = 0, allocatedBytes = 0, cachedTokens = 0;
      for (const entry of entries.values()) {
        if (entry.active) activeEntries++;
        const stats = entry.context.getStats?.();
        if (Number.isSafeInteger(stats?.allocatedBytes) && stats.allocatedBytes > 0) allocatedBytes += stats.allocatedBytes;
        if (Number.isSafeInteger(stats?.cachedTokens) && stats.cachedTokens > 0) cachedTokens += stats.cachedTokens;
      }
      return Object.freeze({
        entries: entries.size,
        activeEntries,
        allocatedBytes,
        cachedTokens,
        maxEntries,
        maxBytes,
        maxEntryBytes,
        hits,
        misses,
        evictions,
      });
    },
    close() {
      if ([...entries.values()].some(entry => entry.active)) throw new Error('Context execution must settle before cache close');
      for (const key of entries.keys()) remove(key);
      cleanupError = null;
      closed = true;
    },
  });
}
