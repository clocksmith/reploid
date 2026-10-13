# Installed ordered candidate preparation

Component: native installed delivery. Intent preserved. This uses the existing
`package-native.js` owner and committed Reploid `d29cdec8`, with the exact
Doppler `5e0d60bc` standard archive. No live pin, public contributor, consent,
model cache, or 4 GiB allowance was changed.

The native archive is `d73081423fb00bfc64ecc56e8faf502048d86279c526189cf88a8382a6039cb6`;
its descriptor is `1b04241f1ad12defebc2f4e038d7a47b5b07843b6076a38d64ee4ec7b4ab9cd4`.
The native sourceRoot and installed paths are recorded in binding.json.
The catalog is the committed unsigned base, not an N-stage signed authorization.
Canonical mode remains off. This package is not advertised publicly.

## Reproduction and retained evidence

Export `d29cdec8` into the recorded sourceRoot using `git archive`; copy the exact
runtime TGZ to `deploy/artifacts/doppler-gpu-0.6.28.tgz`. In that isolated export:

```sh
npm install --save-exact --ignore-scripts --no-audit --no-fund file:deploy/artifacts/doppler-gpu-0.6.28.tgz
node scripts/vendor-doppler.js deploy/artifacts/doppler-gpu-0.6.28.tgz
node scripts/sync-doppler-generation-contract.js
node scripts/sync-doppler-partition-contract.js
node scripts/sync-reploid-library.js
node scripts/sync-runtime-config.js --write
node scripts/package-native.js
```

Before runtime-config synchronization, the isolated pool config active Doppler
runtimeVersion was set to `0.6.28`, matching the existing sync-doppler workflow.
Packaging output and each command log are retained here. Extract the resulting
TGZ outside the checkout and run normal `npm ci --no-audit --no-fund`.
`verify-native.js <installed-dir> <native-tgz> <output-json>` compares all 108
native descriptor entries and all 1,976 installed runtime members with the exact
archive. The x128 result, installation log and CLI help are retained.

`check-installed.js <isolated-base> <output-json>` reuses the existing numerical
snapshot verifier: all 2,575 frozen fixture members and 1,976 installed runtime
members match. Public ordered-plan/factory imports pass, a synthetic three-stage
plan hashes successfully, and unopened host close never loads a provider. This
is a contract/closure check, not a numerical run.

The initial missing x128 snapshot failure and incorrect public export name in
the CPU probe are preserved separately. The snapshot was copied unchanged and
the probe corrected to the actual exported `createManifestResidentPartitionFactory`;
no package or runtime source was changed to make either check pass.

## Existing three-stage startup

`startup-binding.json` binds the existing three-file startup closure from
`d29cdec8`, copied outside the immutable numerical snapshot. `startup-config.json`
binds its installed native descriptor and unchanged numerical delivery
`9d7b6eeedd1cc8641a759212c653605344c436bdaead2a054f828b4372687bd2`.
It uses the actual installed `createNativeGpuHost` via the existing native
fixture; no alternate host lifecycle was implemented. No startup process was
launched in this preparation.

The final three-stage controller still requires frozen per-executor provider,
library and Node observations, native descriptor/test-delivery expectations,
owned inspector endpoints, and a separately authorized GPU reservation. Keep
`launchReady:false` until those inputs are independently checked. Existing
signed two-stage evidence cannot authorize the ordered candidate.

The numerical agent's later Suby actual-installed-host close control is retained
separately in Doppler commit `2cfc892c`. It proves four cast cases and native
provider teardown, not three-stage model execution or ordinary chat acceptance.

Actual Verification Worker passed for the two CPU tooling files using its
existing `/testing/` capability; warnings remain in worker.json. Boundary effects:
none in production source; isolated package/config and test preparation only.
