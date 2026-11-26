# Blueprint 0x000011: Advanced Storage Backend (IndexedDB)

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/core/vfs.js`, `/packages/reploid/src/artifacts/store.js`, `/packages/reploid/src/adapters/browser.js`, `/tests/integration/vfs.test.js`, `/tests/e2e/vfs-storage-contract.spec.js`

**Planned Artifacts:** None

**Owned Source Files:** `core/vfs.js`

**Former Blueprint Paths:** `self/blueprints/0x000011-advanced-storage-backend-indexeddb.md`
**Objective:** Persist the agent's virtual file system (its source, configuration, state and artifacts) as text files in one IndexedDB object store per instance and surface, behind an asynchronous path-based API.

**Prerequisites:** [0x000003](0x000003-core-utilities-and-error-handling.md) (Utils), [0x00004F](0x00004F-event-bus-infrastructure.md) (EventBus, optional)

**Affected Artifacts:** `self/core/vfs.js`, `packages/reploid/src/artifacts/store.js`, `packages/reploid/src/adapters/browser.js`, `shared/config/reploid-library.json`, `shared/instance.js`

---

### 1. Layers

There is no `storage-indexeddb.js` and no localStorage backend. The `VFS` DI module (`self/core/vfs.js`, `genesis: { introduced: 'tabula' }`, dependencies `Utils`, optional `EventBus`) composes two library functions, imported from the vendored copy `shared/vendor/reploid/adapters/browser.js`:

- `createIndexedDbStore({ databaseName, storeName, version, keyPath, openTimeoutMs })` (`packages/reploid/src/adapters/browser.js`): a key-value store port (`init`, `get`, `set`, `delete`, `keys`, `close`) over one object store. All four options are required; open fails after `openTimeoutMs`, and a `versionchange` closes the connection.
- `createVfs({ store, ownsStore, now, emit })` (`packages/reploid/src/artifacts/store.js`): the file API over any store port. `createMemoryStore()` provides the same port in memory for tests.

The persistence options come from `shared/config/reploid-library.json`: store `files`, version 1, key path `path`, open timeout 10 000 ms. The database name is `getScopedReploidVfsDbName()` from `shared/instance.js`: `reploid-vfs-v0--<surface>` or `reploid-vfs-v0--<surface>--<instance>`, so each surface and instance has its own database.

### 2. Interface

The module returns the frozen VFS operations plus wrappers for `init` (logs once on connect), `mkdir` and `close`:

| Operation | Behavior |
| --- | --- |
| `read(path)` | Returns the text content; throws `File not found` |
| `write(path, content)` | Text only (binary belongs in an artifact store); records `{ path, content, size, updated, type: 'file' }` |
| `list(path = '/')` | Sorted keys under the prefix |
| `stat(path)` | `{ path, size, updated, type }` or `null` |
| `exists(path)` | `!!stat(path)` |
| `delete(path)` | Removes the entry |
| `isEmpty()`, `clear()` | Whole-store helpers |
| `mkdir(path)` | Validates the path only; directories are virtual |
| `exportAll()` | `{ files: { path: { content, size, updated } }, meta: { exportedAt, version: '2.0', fileCount } }` |
| `importAll(data, clearFirst = false)` | Writes each file and returns the count |
| `close()` | Closes the VFS and, because `ownsStore` is true, the IndexedDB connection |

Paths are normalized to one leading `/` with `/` separators. Empty paths and any `.` or `..` segment are rejected. Every operation fails after `close()`.

### 3. Change events

`write` and `delete` emit `vfs:file_changed` and `vfs:file-changed` with `{ path, operation: 'write' | 'update' | 'delete', size, beforeSize, afterSize, timestamp }` through the EventBus. The host launchers use these to invalidate modules and reload the UI ([0x000002](0x000002-application-orchestration.md)).

### 4. Writable roots

The VFS itself does not restrict paths. Tool-level write policy lives in `self/config/vfs-policy.js`: `WriteFile` and similar tools may write only under `/shadow`, `/artifacts` and `/cycles`, and the OPFS backend only under `/artifacts`. Changes to `/self` source go through promotion ([0x000080](0x000080-core-promotion-policy.md)).

### 5. Verification

`tests/integration/vfs.test.js` exercises the module against an IndexedDB implementation; `tests/e2e/vfs-storage-contract.spec.js` and `tests/e2e/vfs-roundtrip.spec.js` check persistence in a real browser.
