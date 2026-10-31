/** Transactional test double: atomic commits and optimistic retries, not live Firestore evidence. */
export function createSettlementFirestore() {
  const records = new Map();
  const versions = new Map();
  let beforeCommit = null;
  let retries = 0;
  let transactionQueries = 0;
  const copy = value => value === undefined ? undefined : structuredClone(value);
  const version = key => versions.get(key) || 0;
  const snapshot = value => ({ exists: value !== undefined, data: () => copy(value) });
  const write = (key, value, options = {}) => {
    const next = options.merge ? { ...(records.get(key) || {}), ...value } : value;
    records.set(key, copy(next));
    versions.set(key, version(key) + 1);
    const collectionKey = key.slice(0, key.indexOf('/'));
    versions.set(collectionKey, version(collectionKey) + 1);
  };
  const query = (name, filters = [], limit = Infinity) => ({
    key: name,
    where(field, operator, value) {
      if (operator !== '==') throw Error('Test query only supports equality');
      return query(name, [...filters, [field, value]], limit);
    },
    limit(value) { return query(name, filters, value); },
    async get() {
      const values = [...records.entries()]
        .filter(([key, value]) => key.startsWith(`${name}/`) && filters.every(([field, expected]) => value[field] === expected))
        .slice(0, limit);
      return { empty: values.length === 0, docs: values.map(([key, value]) => ({ ...snapshot(value), id: key.slice(name.length + 1) })) };
    }
  });
  const firestore = {
    collection(name) {
      return {
        ...query(name),
        doc(id) {
          const key = `${name}/${id}`;
          return {
            key,
            async get() { return snapshot(records.get(key)); },
            async set(value, options) { write(key, value, options); }
          };
        }
      };
    },
    async runTransaction(callback) {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const reads = new Map();
        const writes = [];
        const result = await callback({
          async get(reference) {
            if (writes.length) throw Error('Transaction read after write');
            if (!reference.key.includes('/')) transactionQueries += 1;
            reads.set(reference.key, version(reference.key));
            return reference.get();
          },
          set(reference, value, options) { writes.push({ key: reference.key, value: copy(value), options }); }
        });
        const hook = beforeCommit;
        beforeCommit = null;
        if (hook) await hook();
        if ([...reads].some(([key, observed]) => version(key) !== observed)) {
          retries += 1;
          continue;
        }
        for (const entry of writes) write(entry.key, entry.value, entry.options);
        return result;
      }
      throw Error('Test transaction exhausted conflict retries');
    }
  };
  return {
    firestore,
    beforeNextCommit(callback) { beforeCommit = callback; },
    dump: () => copy([...records.entries()]),
    retries: () => retries,
    transactionQueries: () => transactionQueries,
    seed: (collection, id, value) => write(`${collection}/${id}`, value)
  };
}
