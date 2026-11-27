/**
 * @fileoverview The subset of the Firestore Admin API that the Pool and Change Control stores use
 * (server/pool/firebase-store.js, server/change-control/firestore-store.js), kept in one SQLite table.
 *
 * It runs inside the single coordinator Durable Object, so those stores keep one implementation on
 * Cloud Run and on Cloudflare. Documents are JSON values addressed by slash paths, as in Firestore.
 * Every write and every transaction runs under one queue, and a transaction's writes are applied in
 * one SQLite transaction, so a transaction never observes a concurrent write between its reads and
 * its commit (Firestore detects that case and retries; here it cannot occur).
 *
 * `sql` is anything with exec(query, ...bindings) returning { toArray() }: Durable Object SqlStorage,
 * or the node:sqlite adapter in tests. `atomically(fn)` runs fn as one SQLite transaction.
 */

const SCHEMA = 'CREATE TABLE IF NOT EXISTS firestore_documents (path TEXT PRIMARY KEY, parent TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL)';
const PARENT_INDEX = 'CREATE INDEX IF NOT EXISTS firestore_documents_parent ON firestore_documents (parent, id)';

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function assertSegment(segment, label) {
  if (typeof segment !== 'string' || !segment || segment.includes('/') || segment === '.' || segment === '..') {
    throw new TypeError(`Invalid ${label}: ${segment}`);
  }
  return segment;
}

/** Firestore-compatible JSON value: rejects undefined members and non-plain objects. */
export function toStoredJson(value, at = 'document') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`Non-finite number at ${at}`);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => toStoredJson(entry, `${at}[${index}]`));
  if (value instanceof Date) return value.toISOString();
  if (isPlainObject(value)) {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) throw new TypeError(`Undefined value at ${at}.${key}`);
      out[key] = toStoredJson(entry, `${at}.${key}`);
    }
    return out;
  }
  throw new TypeError(`Unsupported value at ${at}: ${Object.prototype.toString.call(value)}`);
}

// set(..., { merge: true }) merges nested maps field by field; other values replace.
function mergeDeep(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) out[key] = isPlainObject(value) && isPlainObject(base[key]) ? mergeDeep(base[key], value) : value;
  return out;
}

// Firestore value order: null < booleans < numbers < strings < arrays < maps.
const TYPE_RANK = Object.freeze({ boolean: 1, number: 2, string: 3 });
function typeRank(value) {
  if (value === null) return 0;
  if (Array.isArray(value)) return 5;
  return TYPE_RANK[typeof value] ?? 6;
}
const order = (left, right) => {
  if (left === right) return 0;
  return left < right ? -1 : 1;
};
export function compareValues(left, right) {
  const rank = typeRank(left) - typeRank(right);
  if (rank) return Math.sign(rank);
  if (left === null) return 0;
  if (['boolean', 'number', 'string'].includes(typeof left)) return order(left, right);
  return order(JSON.stringify(left), JSON.stringify(right));
}

const readField = (data, field) => String(field).split('.').reduce((value, key) => (isPlainObject(value) && Object.hasOwn(value, key) ? value[key] : undefined), data);

const OPERATORS = {
  '==': (value, operand) => value !== undefined && compareValues(value, operand) === 0,
  '!=': (value, operand) => value !== undefined && value !== null && compareValues(value, operand) !== 0,
  '<': (value, operand) => value !== undefined && typeRank(value) === typeRank(operand) && compareValues(value, operand) < 0,
  '<=': (value, operand) => value !== undefined && typeRank(value) === typeRank(operand) && compareValues(value, operand) <= 0,
  '>': (value, operand) => value !== undefined && typeRank(value) === typeRank(operand) && compareValues(value, operand) > 0,
  '>=': (value, operand) => value !== undefined && typeRank(value) === typeRank(operand) && compareValues(value, operand) >= 0
};

function createQueue() {
  let tail = Promise.resolve();
  return (task) => {
    const run = tail.then(task, task);
    tail = run.then(() => undefined, () => undefined);
    return run;
  };
}

export function createSqliteFirestore({ sql, atomically = (fn) => fn() } = {}) {
  if (typeof sql?.exec !== 'function') throw new TypeError('SQLite exec() is required');
  sql.exec(SCHEMA);
  sql.exec(PARENT_INDEX);
  const enqueue = createQueue();
  const documentRefs = new WeakSet();

  const readRow = (path) => {
    const row = sql.exec('SELECT data FROM firestore_documents WHERE path = ?', path).toArray()[0];
    return row ? JSON.parse(row.data) : undefined;
  };
  const writeRow = (ref, data) => sql.exec(
    'INSERT INTO firestore_documents (path, parent, id, data) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET data = excluded.data',
    ref.path, ref.parent.path, ref.id, JSON.stringify(data));
  const deleteRow = (path) => sql.exec('DELETE FROM firestore_documents WHERE path = ?', path);
  const listRows = (parent) => sql.exec('SELECT id, data FROM firestore_documents WHERE parent = ? ORDER BY id', parent).toArray();

  // Applies one write to the committed state. `current` is the stored value or undefined.
  const applyWrite = ({ kind, ref, data, options }) => {
    const current = readRow(ref.path);
    if (kind === 'delete') return deleteRow(ref.path);
    if (kind === 'create' && current !== undefined) throw Object.assign(new Error(`Document already exists: ${ref.path}`), { code: 6 });
    if (kind === 'update') {
      if (current === undefined) throw Object.assign(new Error(`No document to update: ${ref.path}`), { code: 5 });
      return writeRow(ref, mergeDeep(current, data));
    }
    return writeRow(ref, options?.merge && current !== undefined ? mergeDeep(current, data) : data);
  };
  const write = (kind, ref, data, options) => enqueue(() => {
    atomically(() => applyWrite({ kind, ref, data: kind === 'delete' ? null : toStoredJson(data), options }));
    return { writeTime: new Date().toISOString() };
  });

  const snapshot = (ref, data) => Object.freeze({
    id: ref.id, ref, exists: data !== undefined,
    data: () => (data === undefined ? undefined : structuredClone(data)),
    get: (field) => (data === undefined ? undefined : structuredClone(readField(data, field)))
  });

  function docRef(parent, id) {
    const ref = {
      id, parent, path: `${parent.path}/${id}`,
      collection: (name) => collectionRef(`${ref.path}/${assertSegment(name, 'collection id')}`),
      async get() { return snapshot(ref, readRow(ref.path)); },
      set: (data, options = {}) => write('set', ref, data, options),
      create: (data) => write('create', ref, data),
      update: (data) => write('update', ref, data),
      delete: () => write('delete', ref)
    };
    documentRefs.add(ref);
    return ref;
  }

  function query(collection, { filters = [], orders = [], cursor = null, max = null } = {}) {
    const next = (change) => query(collection, { filters, orders, cursor, max, ...change });
    const run = () => {
      let docs = listRows(collection.path).map((row) => ({ id: row.id, data: JSON.parse(row.data) }));
      for (const { field, operator, value } of filters) {
        const test = OPERATORS[operator];
        if (!test) throw new Error(`Unsupported query operator: ${operator}`);
        docs = docs.filter((entry) => test(readField(entry.data, field), value));
      }
      // Ordering by a field leaves out documents that do not have it, as Firestore does.
      for (const { field } of orders) docs = docs.filter((entry) => readField(entry.data, field) !== undefined);
      const ordering = [...orders, { field: '__name__', direction: 'asc' }];
      const keyOf = (entry, field) => (field === '__name__' ? entry.id : readField(entry.data, field));
      docs.sort((left, right) => {
        for (const { field, direction } of ordering) {
          const difference = compareValues(keyOf(left, field), keyOf(right, field));
          if (difference) return direction === 'desc' ? -difference : difference;
        }
        return 0;
      });
      if (cursor) {
        docs = docs.filter((entry) => {
          for (let index = 0; index < cursor.length && index < ordering.length; index += 1) {
            const { field, direction } = ordering[index];
            const difference = compareValues(keyOf(entry, field), cursor[index]);
            if (difference) return direction === 'desc' ? difference < 0 : difference > 0;
          }
          return false;
        });
      }
      if (max !== null) docs = docs.slice(0, max);
      const snapshots = docs.map((entry) => snapshot(docRef(collection, entry.id), entry.data));
      return Object.freeze({ docs: snapshots, size: snapshots.length, empty: snapshots.length === 0, forEach: (fn) => snapshots.forEach(fn) });
    };
    return {
      where: (field, operator, value) => next({ filters: [...filters, { field, operator, value }] }),
      orderBy: (field, direction = 'asc') => next({ orders: [...orders, { field, direction }] }),
      startAfter: (...values) => next({ cursor: values }),
      limit: (value) => next({ max: Math.max(0, Math.floor(Number(value))) }),
      count: () => ({ get: async () => { const size = run().size; return { data: () => ({ count: size }) }; } }),
      get: async () => run()
    };
  }

  function collectionRef(path) {
    const segments = path.split('/');
    const ref = {
      id: segments.at(-1), path,
      doc: (id = crypto.randomUUID().replaceAll('-', '')) => docRef(ref, assertSegment(String(id), 'document id'))
    };
    Object.assign(ref, query(ref));
    return ref;
  }

  return {
    kind: 'sqlite-firestore',
    collection: (name) => collectionRef(assertSegment(name, 'collection id')),
    doc: (path) => {
      const parts = String(path).split('/');
      if (parts.length % 2) throw new TypeError(`Document path needs an even number of segments: ${path}`);
      return docRef(collectionRef(parts.slice(0, -1).map((part) => assertSegment(part, 'path segment')).join('/')), assertSegment(parts.at(-1), 'document id'));
    },
    async listCollections() {
      return sql.exec("SELECT DISTINCT parent FROM firestore_documents WHERE instr(parent, '/') = 0 ORDER BY parent").toArray()
        .map((row) => collectionRef(row.parent));
    },
    runTransaction(fn) {
      return enqueue(async () => {
        const writes = [];
        let writing = false;
        const transaction = {
          async get(target) {
            if (writing) throw new Error('Firestore transactions require all reads before writes');
            // A document reference reads committed state; a query runs as usual.
            return documentRefs.has(target) ? snapshot(target, readRow(target.path)) : target.get();
          },
          set(ref, data, options = {}) { writing = true; writes.push({ kind: 'set', ref, data: toStoredJson(data), options }); return transaction; },
          create(ref, data) { writing = true; writes.push({ kind: 'create', ref, data: toStoredJson(data) }); return transaction; },
          update(ref, data) { writing = true; writes.push({ kind: 'update', ref, data: toStoredJson(data) }); return transaction; },
          delete(ref) { writing = true; writes.push({ kind: 'delete', ref }); return transaction; }
        };
        const result = await fn(transaction);
        atomically(() => { for (const entry of writes) applyWrite(entry); });
        return result;
      });
    },
    /** Deletes documents of one top-level collection whose time field (ISO text or epoch ms) is before `beforeIso`. */
    pruneBefore(collection, field, beforeIso) {
      return enqueue(() => {
        const name = assertSegment(collection, 'collection id');
        const stale = listRows(name).filter((row) => {
          const value = readField(JSON.parse(row.data), field);
          const at = typeof value === 'string' ? Date.parse(value) : Number(value ?? NaN);
          return Number.isFinite(at) && at < Date.parse(beforeIso);
        });
        atomically(() => { for (const row of stale) deleteRow(`${name}/${row.id}`); });
        return stale.length;
      });
    },
    /** Imports exported documents verbatim (migration only). */
    importDocuments(entries) {
      return enqueue(() => {
        atomically(() => {
          for (const { path, data } of entries) {
            const parts = String(path).split('/');
            if (parts.length < 2 || parts.length % 2) throw new TypeError(`Invalid document path: ${path}`);
            parts.forEach((part) => assertSegment(part, 'path segment'));
            sql.exec('INSERT INTO firestore_documents (path, parent, id, data) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET data = excluded.data',
              path, parts.slice(0, -1).join('/'), parts.at(-1), JSON.stringify(toStoredJson(data, path)));
          }
        });
        return entries.length;
      });
    },
    /** Counts and a content digest input per top-level collection path (parity checks). */
    inventory() {
      return sql.exec('SELECT parent, COUNT(*) AS count FROM firestore_documents GROUP BY parent ORDER BY parent').toArray()
        .map((row) => ({ parent: row.parent, count: Number(row.count) }));
    },
    exportDocuments({ parent = null, limit = 1000, after = '' } = {}) {
      const rows = parent
        ? sql.exec('SELECT path, data FROM firestore_documents WHERE parent = ? AND path > ? ORDER BY path LIMIT ?', parent, after, limit).toArray()
        : sql.exec('SELECT path, data FROM firestore_documents WHERE path > ? ORDER BY path LIMIT ?', after, limit).toArray();
      return rows.map((row) => ({ path: row.path, data: JSON.parse(row.data) }));
    }
  };
}
