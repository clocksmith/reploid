# Signed resident source paths

Doppler Rig's actual producer emits `artifacts/model/manifest.json` and
`artifacts/model/shard_00000.bin` in its retained synthetic producer test;
the signed piece index retains `shard_00000.bin`. The host regressions reproduce
the same mismatch using `artifacts/model/weights.bin` versus `weights.bin`.
Both host adapters previously compared the full packaged artifact path directly
to the original catalog/piece path. Retained failing-before tests reject the
first manifest read; this prevented reaching verified piece acquisition.

The shared host mapper binds all artifact fields to the selected Capsule and
resolves model-local paths against its declared signed manifest directory.
It then matches the original catalog's exact hash, size and SHA-256 declaration.
It does not use basename fallback. Files outside that directory require an
exact explicitly pinned catalog path. Browser and Node range reads use the
admitted source path and still require a complete authenticated piece. Both
adapters reject whole-weight artifact reads; modified identity, traversal,
wrong directory, non-piece range, corruption and cancellation remain failures.

Validation: 25 focused tests across browser source, native custody, native
participant and standalone native delivery. The same native tests exercise
real signed custody between simulated channels; this is not physical signed
Capsule inference. Actual Verification Worker passed all three changed sources
with six warnings and zero errors (`worker.json`). Previous failure is retained.

Browser bundle includes committed UI revisions `6127b737` and `8df89576` plus
this host change: 1906 files, SHA-256
`a1a0ca6c52b4e9cce001c5931feb7524f776529060495aaa94e1995756e8d083`.
Local browser manifest verification passes. No live participant was restarted,
no runtime pin or model catalog changed, and nothing was deployed.
