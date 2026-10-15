// Firestore double with optimistic concurrency: a transaction whose read
// versions changed before commit, or that failed after reading documents that
// have since changed, is retried. This models the serializable reads the
// server SDK gives each transaction under contention. `faults.beforeCommit`
// and `faults.afterCommit` fire once on the next commit.
export const createFakeFirestore = () => {
  const docs = new Map();
  const faults = { beforeCommit: null, afterCommit: null };
  const stats = { commits: 0, retries: 0 };
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const snapshot = (path) => {
    const doc = docs.get(path);
    return { exists: Boolean(doc), data: () => structuredClone(doc?.data) };
  };
  const children = (name) => [...docs.entries()]
    .filter(([path]) => path.startsWith(`${name}/`) && !path.slice(name.length + 1).includes('/'))
    .map(([, doc]) => ({ data: () => structuredClone(doc.data) }));
  const fire = (point) => {
    const fault = faults[point];
    faults[point] = null;
    if (fault) fault();
  };
  return {
    faults,
    stats,
    collection: (name) => ({
      doc: (id) => ({
        path: `${name}/${id}`,
        async get() { await tick(); return snapshot(`${name}/${id}`); }
      }),
      where: (field, op, value) => ({
        async get() { await tick(); return { docs: children(name).filter((doc) => doc.data()[field] === value) }; }
      }),
      async get() { await tick(); return { docs: children(name) }; }
    }),
    async runTransaction(operation) {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const reads = new Map();
        const writes = [];
        const stale = () => [...reads].some(([path, version]) => (docs.get(path)?.version ?? 0) !== version);
        let result;
        try {
          result = await operation({
            async get(ref) {
              if (writes.length) throw new Error('Firestore transactions require all reads to be executed before all writes.');
              await tick();
              reads.set(ref.path, docs.get(ref.path)?.version ?? 0);
              return snapshot(ref.path);
            },
            set(ref, data) { writes.push({ create: false, path: ref.path, data: structuredClone(data) }); },
            create(ref, data) { writes.push({ create: true, path: ref.path, data: structuredClone(data) }); }
          });
        } catch (error) {
          if (!stale()) throw error;
          stats.retries += 1;
          continue;
        }
        // Commit is synchronous: validate read versions, then apply every write.
        if (stale()) {
          stats.retries += 1;
          continue;
        }
        if (writes.some((write) => write.create && docs.has(write.path))) throw new Error('ALREADY_EXISTS');
        fire('beforeCommit');
        for (const write of writes) docs.set(write.path, { version: (docs.get(write.path)?.version ?? 0) + 1, data: write.data });
        stats.commits += 1;
        fire('afterCommit');
        return result;
      }
      throw new Error('ABORTED: transaction contention');
    }
  };
};

export default createFakeFirestore;
