# Installed canonical contract composition

Component: native participant / partition publication. Intent preserved. Boundary effects: generated Doppler package exclusions only; no accepted pin/catalog/deployment change.

Exact clean Doppler source `c240d4a8` was packed with ordinary `npm pack` and installed outside either checkout with `npm install --ignore-scripts --omit=optional --no-audit --no-fund`. Frozen Reploid library source is `054ff99438e51de184e13dd3e69e4645c90895b5`. Archive SHA256: `e0cf7aaeab31fc9555bd43478e281a3ad3ff96dd316842ebc90630d24dee8ef7`. It retains package version 0.6.28 for this diagnostic only; this is not a promoted release or a replacement for any other 0.6.28 archive.

Artifact and installed consumer remain at `/var/tmp/reploid-canonical-installed-20261013.7IKAGb/final/`. `binding.json` checks all 1,972 installed package members against both npm's pack membership and exact exported source bytes, rejects extra files/symlinks, and records every member hash. `setup.json` binds source archives, fixture adaptation and evidence. No optional GPU provider was installed or initialized.

The public `doppler-gpu/partitions` import exposes all 18 required functions (`factory.json`). The existing publication fixture was adapted only at import and computation setup: explicit selected token 3/text "3" replace GPU/sampler/decoder execution. Public admission, bootstrap, subsequent block transition, cursor/history validation, actual WebCrypto stage signing/authentication and the application publication state machine execute unchanged. The complete original assertion suffix after authority creation remains byte-identical. It covers missing/forged evidence, restart authentication, retained corruption, asynchronous mutation, cancellation/takeover/revocation, duplicate commit and before/unknown-commit reconciliation. N=0 uses real admission-only publication with no fabricated GPU acknowledgment. Transactional storage is an injected in-memory fault port, not physical disk durability proof.

The public factory test separately exercises allocation forwarding, pre-abort, late-abort cleanup, missing-resident cleanup and aggregate failure with an explicitly injected Capsule opener/resident object. It does not validate a signed Capsule or instantiate a physical resident. Actual resident canonical method execution, signed native/browser inference, numerical correctness, cold deadlines, cancellation, memory and restart recovery still require a fresh exactly bound physical package qualification.

Reproduction after exporting the stated revisions and packing/installing as above:

```sh
node prepare-consumer.js FROZEN_REPLOID FROZEN_DOPPLER CONSUMER
cp factory-installed.js CONSUMER/tests/factory-installed.js
# Run these two commands from CONSUMER:
node tests/publication-installed.js
node tests/factory-installed.js
# Run from Reploid root:
node artifacts/native-canonical-installed-20261013/verify-installed.js FINAL_EXPORT binding.json
node artifacts/native-canonical-installed-20261013/verify-worker.js
```

Both installed controls pass. Actual Verification Worker passes with its documented `/testing/` capability for Node-only tooling; warnings are retained in `worker.json`. No stronger browser production capability was granted.

## Preserved setup failures

The first clean export lacked development dependency TypeScript; `closure-environment-before.txt` retains that environment error. Copying the existing exact dev dependency into the export exposed genuinely stale generated exclusions (`closure-stale-before.txt`). Existing generator `node tools/package-source-closure.js --write` added four unused private/declaration exclusions; scoped Doppler commit `c240d4a8` fixes freshness. `closure-final.txt` passes (981 runtime JS, 493 declarations, 493 resources). No inference or import implementation defect was found. The original standard package/public import already worked (`initial-public-import.txt`); its metadata and hash remain retained. `import-wrong-cwd.txt` is a separate controller mistake: the command ran from the export parent rather than installed consumer. Correct working-directory import passed without source changes.

## Read-only native logging observation

Stopped isolated log `/var/tmp/reploid-signed-compact-20261013/native.log` measured 340,444,956 bytes. Its 1,402 `partition-state` JSON events total 339,813,386 bytes, median 270,721 and maximum 271,273 bytes. 1,256 records each include a 244,872-byte `capsuleVerification` object. `measure-log.js` retains the read-only aggregate recipe; `log-measurement.json` binds the complete original log by SHA256 without reproducing artifact bodies.

Current `server/native-participant.js` CLI serializes `{event:'partition-state', ...state}` on every change. `automatic-partitions.js` includes the complete program receipt in each `getState()`. Existing scalar fields (`phase`, `offering`, `modelId`, reservation counts and `unsettledOwners`) support a bounded status projection; detailed error/progress must be bounded explicitly. File status already requests `includeReceipts:false`, but no equivalent partition log summary helper currently exists. This observation establishes repeated bulk serialization, not its contribution to any prior timeout. No logging code or public process was changed.
