# Blueprint 0x00003C: Genesis Snapshot System

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/infrastructure/genesis-snapshot.js`, `/tests/integration/genesis-snapshot.test.js`, `/tests/integration/genesis-publication-baseline.test.js`

**Planned Artifacts:** None

**Owned Source Files:** `infrastructure/genesis-snapshot.js`

**Former Blueprint Paths:** `self/blueprints/0x00003C-genesis-snapshot-system.md`

**Module ID:** `GenesisSnapshot` (version 1.0.0, genesis level `substrate`, type `infrastructure`, async; dependencies `Utils`, `VFS`, `EventBus`)

**Source:** `self/infrastructure/genesis-snapshot.js`

---

## Purpose

`GenesisSnapshot` gives the agent a way back after it changes its own files. It has three separate mechanisms with different strength:

1. **Ordinary snapshots**: full VFS checkpoints that can be listed, restored, deleted, exported and imported.
2. **Publication baseline**: one immutable, hash-identified copy of the declared self-source closure, pinned once and never overwritten through this service.
3. **Lifeboat**: a legacy `localStorage` copy of `/core/` and `/infrastructure/` JavaScript.

It does not compare the current state to a baseline or compute an "evolution delta"; earlier drafts that described `saveGenesisSnapshot` and `compareToGenesis` named functions that do not exist.

The boot sequence creates one ordinary snapshot named `genesis-<date>` when the genesis level registers this module (`self/boot-helpers/services.js:11-23`). The file is on the validator quarantine list in `self/core/promotion-policy.js:69`, so a candidate change cannot rewrite it.

## Ordinary snapshots

Stored under `/.genesis/snapshots/` as `<id>.json` with an index at `/.genesis/snapshots/index.json`, newest first. At most 10 (`MAX_SNAPSHOTS`) are kept; older ones are pruned after each create.

| Export | Behavior |
| --- | --- |
| `createSnapshot(name?, { includeApps = false, includeLogs = false })` | Walks the VFS from `/`, skipping `/.genesis/`, and `/.logs/` and `/apps/` unless included. Writes `{ id, name, timestamp, fileCount, isBootable: true, version: '2.0', files }`, refuses an existing ID, updates the index, prunes, emits `genesis:snapshot_created` and returns the metadata without `files`. |
| `restoreSnapshot(id, { deleteExtra = false })` | Validates every path first (absolute, no `.`/`..`/control characters, never `/.genesis`), writes each file and, with `deleteExtra`, deletes files not in the snapshot except under `/.genesis/` and `/.logs/`. Per-file write failures are logged and skipped. Emits `genesis:snapshot_restored` and returns `{ success, restored, deleted }`. |
| `listSnapshots()` | Returns the index (empty on error). |
| `deleteSnapshot(id)` | Removes the file and index entry; emits `genesis:snapshot_deleted`. |
| `exportSnapshot(id)` | Downloads the snapshot JSON through a browser link. |
| `importSnapshot(file)` | Reads a `File`, requires `id`, `files` and `timestamp`, validates the file paths, refuses an existing ID, stores it, updates the index and emits `genesis:snapshot_imported`. |

Snapshot IDs must match `[a-zA-Z0-9_-]+` and may not start with `genesis-sha256-`, which is reserved for publication baselines.

## Publication baseline

Stored under `/.genesis/publication/`: `<id>.json` holds the baseline and `pin.json` names the pinned ID. The schema is `reploid/genesis-publication-baseline/v1`; the ID is `genesis-sha256-<sha256 of the sorted file identity list>`.

| Export | Behavior |
| --- | --- |
| `createPublicationBaseline()` | Reads `/config/self-source-manifest.json`, copies the exact bytes of every declared file, builds a self-image manifest, validates it, rereads every file to detect concurrent change, and pins it. |
| `getPublicationBaseline()` | Returns `{ id, path, fileCount, bytes, pinned: true, scope: 'publication' }` for the pinned baseline. |
| `exportPublicationBaseline()` / `importPublicationBaseline(value)` | Carry the full payload to a descendant; import validates before pinning. |
| `restorePublicationBaseline()` | Writes every declared file back, reads each one back and fails on a mismatch. Files outside the closure are left alone. Emits `genesis:publication_restored`. |

The module also exports `validatePublicationBaseline(value, expectedId)` as a named export: it checks schema, version, ID format, the self-image manifest, that the files are exactly the declared closure, that the manifest descriptor restores to its canonical path, that no target lies under `.genesis`, and the hash.

Invariants:

- A pin is never repaired or replaced. If a pin exists for different bytes, pinning fails; if the pinned payload is corrupt, reading fails.
- The baseline is read back from storage and validated before the pin is written, and the pin is reread after.
- Writers are serialized in the page and, where `navigator.locks` exists, across tabs with the lock `reploid:genesis-publication`.
- Immutability holds only through this service. Code with direct storage access, or a hostile host, can still change the bytes.
- No runtime caller creates a publication baseline yet; it is exercised by `tests/integration/genesis-publication-baseline.test.js`. The source comment states it is for publication and never for `CreateTool` or a per-tool activation path.

## Lifeboat

`createLifeboat()` stores `.js` files from `/core/` and `/infrastructure/` in `localStorage` under `REPLOID_LIFEBOAT`; `restoreFromLifeboat()`, `hasLifeboat()` and `getLifeboatInfo()` read it back. It is limited by `localStorage` quota and is not the publication baseline.

## Events

`genesis:snapshot_created`, `genesis:snapshot_restored`, `genesis:snapshot_deleted`, `genesis:snapshot_imported`, `genesis:publication_pinned`, `genesis:publication_restored`, `genesis:lifeboat_created`, `genesis:lifeboat_restored`.

## Authority

Restoring is an operator recovery action. A snapshot or baseline is a recovery point, not evidence that a change improved anything, and creating one grants no permission to adopt a change.

## Related blueprints

- [0x000002 Application Orchestration](0x000002-application-orchestration.md): boot creates the first snapshot.
- [0x000011 Advanced Storage Backend (IndexedDB)](0x000011-advanced-storage-backend-indexeddb.md): the VFS this module reads and writes.
- [0x000040 Verification Manager](0x000040-verification-manager.md): checks a change before it is written; this module covers recovery after.
