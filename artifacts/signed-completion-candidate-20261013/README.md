# Signed completion candidate: staged and packaged

Component: browser/native application delivery (preparation). Intent preserved.
Acceptance evidence: `final-2/preflight.json`, `final-2/metadata-staging.json`,
`final-2/delivery-verification.json`, `final-2/swarm-label.json`,
`final-2/worker.json`, `final-2/binding.json`.
Boundary effects: new isolated exports, catalogs and packages under `/var/tmp/`
only. Both checkouts, the public Doppler 0.6.27 pin, public catalogs, deployment
files, identities, release checkpoints and contribution ledgers are unchanged.
Nothing was started, opened on a GPU, installed on another machine, committed or pushed.

## Current: `final-2/` (Reploid `d7931c57`) supersedes `final/`

`final/` was built from Reploid `f1b2fd77`. In signed run 1, that build's swarm
transport refused the ordered-route channel `reploid-partitions-ordered`, so
contributors failed before ready. Reploid `d7931c57` adds the label to the
transport's auxiliary channel list in `packages/reploid/src/transport/swarm.js`
and in the vendored copy. Because the application bytes changed, the whole
`final/` pipeline was repeated into fresh directories with the same scripts,
Capsule `-c` and minimum sequence 2. `final/` and its export
(`/var/tmp/reploid-signed-completion-app-20261013`, marked `SUPERSEDED.json`)
are kept unchanged.

| Item | `final-2/` value |
| --- | --- |
| Export | `/var/tmp/reploid-signed-completion-app-2-20261013/app`, source `d7931c571cdccef5acbdd803501e2226f40bf6e9`, tar `7b32760e4fa22eb59047a766ebc3c80eb2c5db27604ef57f13124bb8654a0cfc` |
| Prepared catalog | `/var/tmp/reploid-signed-completion-app-2-20261013/signed-catalog/chat-models.json`, `b0277a5f75e8780c6e233ab618a09bbfc4c572ae098f1ce0ceda178719820bbd` (byte-identical to `final/`) |
| Staged catalog | `59811b4af5f7b44387344fe38fdea155de4f27a487332a846c27fee9257481d5`, 42 metadata files (staging receipt identical to `final/`) |
| Browser payload | 2,045 files, bundle `sha256:9f380ebf3daaad82f7476f2cd8c6ee30cacd3e0f055e28896211a14fd8bb0f1d` |
| Native tarball | `/var/tmp/reploid-signed-completion-app-2-20261013/app/output/reploid-native-OVBheJ/reploid-native-0.1.0.tgz`, `845b84bbce4e7cb1beddd0b246329c89d662057f45895b47b4b1dd6452ee9314` |
| Native descriptor | `90bc851af635d831059673c5c851484a593c6e8e8962c6ee17cebcb7824342a3`, 151 files |
| Swarm transport | served and packaged `transport/swarm.js` both `ae1d9239…`, equal to the commit blobs; both list and the packaged module's exported `SWARM_AUXILIARY_CHANNELS` include `reploid-partitions-ordered`, which the `final/` served copy lacked |

All steps passed as in `final/` (receipts in `final-2/`):

- The export changed the same 16 files and added the same 1,985 as before. 15
  of the changed files and the vendored runtime are byte-identical to `final/`;
  `self/vendor/reploid/package-assets.json` differs because vendored library
  files changed.
- The preflight passed: runtime 1,984/1,984, plan admission for stages 0-2,
  zero address matches, and every release-history case as expected.
- `verify-delivery.js` passed:
  - all 151 native members match;
  - all 1,984 installed runtime files equal the archive;
  - the payload's 2,045 files and 1,206 served runtime files match;
  - the staged catalog differs from the prepared one only in metadata URLs;
  - all 64 artifact mappings resolve, and plan admission passes for stages 0-2;
  - zero address matches.
- `check-swarm-label.js` is the only new script; it passed the Verification Worker.

Signed run 1 reportedly advanced both native contributors' checkpoints to
sequence 2; the preflight confirms a holder of sequence 2 accepts this history.
The reviewer checks below still apply.

## `final/` (superseded by `final-2/`)

The signed three-stage catalog for Capsule `-c` was prepared, staged into a new
export of Reploid `f1b2fd77`, and packaged for browser hosting and native
delivery. The produced bytes were verified locally. This is a delivery and
install proof, not an application run.

| Item | Value |
| --- | --- |
| Application export | `/var/tmp/reploid-signed-completion-app-20261013/app`, source `f1b2fd7704c70f83bdf389495d0be8b6716a336c`, source tar `24811707dc5162032d59a4516e0c7941b3dcc46f5b10de12def2fb16de505513` |
| Runtime archive | `2df37d88f592b523bb90c4c79840354fd301af9803a7d9009e1c8939561c71f8`, Doppler 0.6.28 |
| Capsule `-c` | `/var/tmp/qwen35-capsule-completion-20261013-c` (Doppler `e403ff3b`), root `sha256:67f240af03e77a892eb1cc724000dd11e580ad180405b426b0f62e5c309b3fe1` |
| Envelope / closure | `sha256:dc49c934…541b` / `sha256:444473f1ae4496340f5b6c3e831d1bad08ee9aa3e273cba6c509ea127af5e079` (64 artifacts) |
| Accepted TargetPlan | `sha256:767ab4683072a5a34d5eb3adcd545b9ac971fec54ee1e8a8fb6ba57ebca1d5f0` |
| Partition plan | v3, `splitLayers [8, 16]`, `sha256:7a4ce534baee0945e47adf13bb3bad017038eebb83b509e9d68b1fe01c76a1bf` |
| Release history | seq 1 `sha256:d47ddb8d6f45b23230fbf2cf1731122ccc6160c51a968e616ff6cf366bf8c9d2` (earlier `0fad` release), seq 2 `sha256:923ac7e602b3075a17f9e540eb0abfd436eaf1de41bebf8b6f15bdaee604b45f` (this Capsule), minimum sequence 2, expires `2026-10-15T02:14:39.006Z` |
| Prepared catalog | `/var/tmp/reploid-signed-completion-app-20261013/signed-catalog/chat-models.json`, `b0277a5f75e8780c6e233ab618a09bbfc4c572ae098f1ce0ceda178719820bbd` |
| Staged catalog | `app/self/config/chat-models.json`, `59811b4af5f7b44387344fe38fdea155de4f27a487332a846c27fee9257481d5` |
| Staged metadata | 42 files: 40 under `self/config/model-artifacts/`, 1 manifest, 1 piece index (list in `final/metadata-staging.json`) |
| Browser payload | `app/.firebase-hosting/reploid`, 2,045 files (2,044 served plus descriptor), bundle `sha256:c6de2012f2dcfb41b973246ed91a20c92a8596f54665d75088dd1039e31cd8df` |
| Native tarball | `app/output/reploid-native-qHrdIJ/reploid-native-0.1.0.tgz`, `a7462eb845f13c8ccd7ce227a0e584241a8a1ed6df2f6f4c9c7b69c2ccdf012a` |
| Native descriptor | `2dac55001ab23f21d2fcd297f907db1aeac5c71a1646039cbfd12c8f5da6ac82`, 151 files |
| `maxAcquisitionChunkBytes` | 16,777,216 |

The catalog lists 46 non-weight source files but stages 42 files. Staging names
files by content hash, and three groups of WGSL modules have identical bytes
(`add`/`paired_pointwise_add`, `head`/`projection_f16`/`projection_q4`,
`silu`/`paired_pointwise_silu`). All 46 entries resolve to a staged file.

## Steps

1. **Export.** `git archive --format=tar f1b2fd77 -- . ':(exclude)artifacts' ':(exclude)reports' ':(exclude)doppler'`,
   the earlier export's method. The same command on `5e0cb286` reproduces that
   export's recorded tar hash `1863dcde…`. The exact archive was copied in and
   installed with `npm install --save-exact --ignore-scripts --no-audit --no-fund file:deploy/artifacts/doppler-gpu-0.6.28.tgz`.
   Then `vendor-doppler.js`, both contract syncs and `sync-reploid-library.js`
   ran. `sync-runtime-config.js` again rejected the unrelated 0.6.27 Pool model.
   `final/scope-export.js` disabled that model, the same one-field scope step
   recorded in `completion-candidate-20261013/chat-scope.json`, and
   `sync-runtime-config.js --write` passed. Relative to its source tar, the
   export changed the same 16 files and added the same 1,985 files as the
   earlier export, and all 16 changed files and the vendored runtime are
   byte-identical to that export's. Receipts: `final/source-export.json`,
   `final/package-install.json`, `final/scope.json` and the command logs.
2. **Catalog.** `final/prepare-catalog.sh` passed (`final/catalog-preparation.json`).
3. **Preflight** (`final/preflight.json`, exit 0, no stop):
   - All 1,984 runtime files equal the archive in both the npm copy and the browser vendor copy.
   - Ordered plan admission passes for stages 0, 1 and 2 through the export's `createWorkPartitionPlan` with the installed runtime. The fixed call is at `self/host/work-partition-plan.js:58`.
   - No tailnet domain, login-shaped string or local machine name in the 47 files staging copies.
   - Release history; results in the table below.
4. **Staging.** The unchanged `basic-signed-candidate-20261013/final/stage-catalog.js` passed (`final/metadata-staging.json`).
5. **Manifests and packages.** Runtime sync (already synchronized), module
   inventory (2,438 modules), VFS manifest and browser manifest (2,044 served files)
   were regenerated, then `npm run prepare:hosting` and `npm run package:native`
   passed (`final/final-*.txt`).
6. **Delivery verification** (`final/delivery-verification.json`, passed). The tarball was extracted and installed under
   `/var/tmp/reploid-signed-completion-app-20261013/native-verify-2/reploid`
   with `npm ci --ignore-scripts --no-audit --no-fund`. Checks:
   - every one of the 151 descriptor members matches, and the package has no extra members;
   - the runtime archive inside the package is `2df37d88…` and matches the pin;
   - all 1,984 installed runtime files equal the archive;
   - dependencies are `@roamhq/wrtc` 0.10.0, `ws` 8.21.0 and `webgpu` 0.4.0;
   - all 2,045 payload files equal the export's served files, and all 1,206 served runtime files equal the archive;
   - the staged catalog differs from the prepared one only in metadata URLs;
   - all 42 metadata files match their pinned hashes in the export, the payload and the package;
   - all 64 signed artifacts resolve through the installed application;
   - ordered plan admission passes for stages 0-2 using the installed package's own code and runtime;
   - zero address matches across 129 staged files.
7. The Verification Worker passed all four scripts (`final/worker.json`, nine warnings retained).

### Release history checks

`final/preflight.js` feeds the application's own `prepareLocalPackRelease`,
given an in-memory checkpoint store, into the installed runtime's
`verifyCapsuleMetadata`. No real store was opened.

| Holder or history | Result |
| --- | --- |
| No checkpoint | accepted, advances to seq 2 `923ac7e6…` |
| Holds the earlier release (seq 1 `d47ddb8d…`) | accepted |
| Holds this release (seq 2) | accepted |
| Holds forked seq 1 `236f11e6…` (Capsule `-b`) or `ffc0db2c…` (Capsule `7391e1f4`) | rejected, `Release history conflicts with the persisted checkpoint.` |
| Either forked seq-1 history offered to a holder of the earlier release | rejected, same message |
| The earlier release alone | rejected, `Release history rolled back below the required sequence.` |

The catalog's checkpoint namespace `ce08ba3f…` equals the one the earlier release's
own authority and application produce.

## Reviewer checks

- **Release history.** It is a claim, not verified here, that `amd-host` holds the
  earlier release at seq 1. Any host or browser profile that persisted
  `ffc0db2c…` will refuse this delivery. That is the history of Capsule `7391e1f4`
  from the basic signed delivery. The checkpoint state of `intel-host` and of the
  Mac browser profile is unknown.
- **Retained 0.6.27 vendor tree.** The export keeps the 0.6.27 vendor tree, as the
  earlier chat export did; the basic signed precedent retired it. The tree is not
  served and not in the native package, but `module-inventory.json` lists its 943 modules.
- **Inherited closure URL.** The catalog still points at `http://127.0.0.1:29670/qualification/capsule/`.
- **Local-only install.** The native install was verified on this Mac (darwin arm64,
  Node 22.20.0) without install scripts, not on the Linux hosts. `--help` was not
  run because no application start is allowed in this step.
- **Abandoned verification directory.** `/var/tmp/reploid-signed-completion-app-20261013/native-verify`
  is from a first verification run that stopped on a bug in `final/verify-delivery.js`:
  it compared the whole archive with the partial runtime the payload serves.
  It is marked `NOT-EVIDENCE.json`; the corrected run used `native-verify-2`.
- **Git status.** The first pass, `final/` and an `install/` folder were committed
  upstream in `1c4be0ca`, outside this step; `install/` records native installs of
  the superseded `final/` tarball `a7462eb8…`. `final-2/` and this README's later
  edits are uncommitted. The checkout's local `info/exclude` (line 22) still lists
  this folder, so `git status` hides the untracked `final-2/`.

## Not established

Signed opening, GPU execution, peer acquisition, ordered route selection at run
time, conversations, cancellation, settlement, performance, installation on the
three hosts and any public eligibility.

## Superseded first pass (Capsule `-b`)

The files at this folder's top level are the first pass. That pass stopped before
staging for two reasons, both since resolved upstream:

- Capsule `-b` carried this Mac's machine name in two signed artifacts.
- The application at `5e0cb286` called `validateOrderedLayerPartitionPlan(plan)`
  without the manifest.

`preflight.json` there also recorded that `-b` began a forked seq-1 history. The
first-pass catalog `/var/tmp/reploid-completion-chat-candidate-20261013/signed-catalog/chat-models.json`
(`9cefc0cc…`) is kept and marked by `SUPERSEDED.json` beside it. It was never
staged, and the earlier export at `/var/tmp/reploid-completion-chat-candidate-20261013/app`
was not modified. Top-level `binding.json` binds the first pass, including the
README text of that time.

## What the precedent assumed about two stages

| Precedent | Two-stage assumption | Three-stage need | Handled by |
| --- | --- | --- | --- |
| `signed-blake3-source-20261012/prepare-catalog.js` | One report; one `(surface, index)` qualified | One report per stage on one plan and identity, indexes 0..2 | `prepare-catalog.js` |
| same | `partitionSplitLayer: plan.splitLayer` | Omitted; v3 has no scalar split and `work-partition-plan.js:8` rejects a mismatch | `prepare-catalog.js` |
| same | Implicit v2 plan | v3 plan with `splitLayers [8, 16]` | `prepare-catalog.js` |
| same | `minimumSequence: 1` | Full signed history and minimum 2 | `final/prepare-catalog.js` |
| `signed-closure-candidate/prepare-catalog.sh` | One report, older runtime, output in the Capsule directory | Three reports, the export's runtime, separate output | `prepare-catalog.sh`, `final/prepare-catalog.sh` |
| `final/stage-catalog.js` | None | Used unchanged | — |
| `final/verify-native.js` | None about stages; archive `0fadac51…`; remote install | Archive `2df37d88…`; local install | `final/verify-delivery.js` |
| Host launch | Two residents | Each host needs an explicit ordered stage with `maxStages >= 3` | Not prepared here |

## Differences from the originals

Each script lists every difference at its top. In short:

- `final/prepare-catalog.js` is the first-pass adaptation plus argument 8, the
  minimum release sequence, which must equal the last signed event's sequence.
  The receipt also lists the release history. The first-pass changes remain:
  - a list of reports;
  - exactly one signed row per report;
  - one shared plan and identity, with indexes 0..2;
  - a v3 plan with split layers given as argument;
  - no `partitionSplitLayer`;
  - the reference bound to the signed contract and oracle;
  - output that is never overwritten.
- `final/prepare-catalog.sh`: Capsule `-c`, the new export's runtime and output, and minimum sequence 2.
- `final/preflight.js`: release-history check replaced as above; otherwise as the first pass.
- `final/verify-delivery.js`: adapted `verify-native.js`, with:
  - archive `2df37d88…`;
  - a local extract and `--ignore-scripts` install;
  - added checks for the payload, staging, the catalog, plan admission and addresses.
- `final/scope-export.js`: new, reproduces the earlier export's recorded scope step.
- `final/verify-worker.js`: this folder's four scripts; exclusive receipt.

## Reproduce

All commands run from the Reploid checkout root and refuse to overwrite earlier output.

```sh
sh artifacts/signed-completion-candidate-20261013/final/prepare-catalog.sh
node artifacts/signed-completion-candidate-20261013/final/preflight.js <app> <capsule -c> <catalog> <catalog sha256> \
  sha256:d47ddb8d6f45b23230fbf2cf1731122ccc6160c51a968e616ff6cf366bf8c9d2 <capsule -b>,<capsule 7391e1f4> <new extraction dir> <new receipt>
node artifacts/basic-signed-candidate-20261013/final/stage-catalog.js <app> <capsule -c> <catalog> <catalog sha256> <new receipt>
# in <app>: sync-runtime-config --write, build-module-inventory, build-vfs-manifest,
# build-browser-bundle-manifest, npm run prepare:hosting, npm run package:native
node artifacts/signed-completion-candidate-20261013/final/verify-delivery.js <app> <catalog> <catalog sha256> <native tgz> <new install dir> <new receipt>
node artifacts/signed-completion-candidate-20261013/final/verify-worker.js
```
