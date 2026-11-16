# Retained qualification evidence

Historical run output and obsolete runtime archives leave the current source
tree. Their exact bytes remain in the immutable, already-published Git revisions
listed in [index.json](index.json). Published history is not rewritten. Local
copies are not deleted during this migration.

Every catalog entry binds its repository-relative path, source commit, Git blob,
SHA-256, byte count and executable mode. The index hashes each catalog part.
No qualification record, signed payload or failed observation is rewritten.
Restoring evidence grants no execution, disclosure, promotion or qualification.

Verify availability without restoring files or accessing the network:

```sh
node scripts/restore-evidence.js --check
```

Restore one file or run directory to its original path:

```sh
node scripts/restore-evidence.js artifacts/recovery-20261009
node scripts/restore-evidence.js deploy/artifacts/doppler-gpu-0.7.1.tgz
```

A second argument selects a different destination root. Existing bytes must
match; divergent files and symlink destinations are refused. Restored files
remain ignored. Source checkouts do not restore old runs automatically.

Shallow clones may lack the old objects. Explicit `--fetch` downloads the pinned
historical revisions from `origin`; it changes no branch or tracked source file:

```sh
node scripts/restore-evidence.js --fetch artifacts/recovery-20261009
```

Use a shallow clone or GitHub source archive to obtain the compact current tree.
A full clone still includes retained historical blobs. History compaction is a
separate repository migration, not part of this cleanup.

The current integrity-pinned runtime stays in `deploy/artifacts/` for offline
installation and Docker builds. Before retiring a previous current runtime,
publish the revision that contains it, append it to this catalog, then untrack
the old archive while preserving local bytes:

```sh
node scripts/build-evidence-catalog.js --source FULL_PUSHED_COMMIT --include-current-runtime
```

The generator refuses reused paths with changed bytes. Existing qualification
evidence has no expiry. New unqualified run output belongs in local storage or
CI artifacts with the workflow's retention period; it is not added to this
catalog or to ordinary source commits. The repository byte policy and CI prevent
new output and historical runtime archives from accumulating again.

Five existing small frozen test inputs remain tracked at their original paths;
the index lists them explicitly. The current `docs/status/` contracts and retained
offline qualification fixtures retain their own ownership and acceptance.
