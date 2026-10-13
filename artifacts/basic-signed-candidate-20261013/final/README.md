# Final signed browser/native test delivery

Component: ordinary browser/native application delivery. Intent preserved. Source `7a49a7eabf2415163d36c08c0dfc62859a098834`, immutable runtime archive `0fadac5113d2cc154f65d9d40de50722a16454995e927c7d22bedc5f1a4925cd`. Canonical mode remains default off. This supersedes the unsigned *preparation* identities recorded in the parent directory; both artifacts/installations remain retained.

Genuine producer handoff `/var/tmp/qwen35-capsule-closure-20261013/handoff.json` has SHA256 `afeeca59a412c4ab0d9fb9963e9023a0047fccc55492e490edcdb18b6961e8b7`, independently provided before staging. Numerical evidence/metadata is retained in Doppler `35ef09e4` and `4a97069c`. Capsule semantic root `7391e1f4f7579af308808d371119c7e42b40acc1b00df5f42325d41d4febd083`; corrected manifest `709894a75b4200c111fb7dbb6c9435c8fd69710949ea8ba486cf93f38582fdd3`; TargetPlan `a10e2e6a3c614ddb42330ae22d0e9993015c503d44d53880359cab523ab87f27`. The existing producer verified exact runtime, artifact closure, signatures/release lifecycle, and accepted resident reports for both placements (browser-webgpu and node-webgpu). Metadata preparation does not recompute or replace those numerical qualifications. Release expires `2026-10-14T13:40:56.063Z`.

`stage-catalog.js` verifies the independent input catalog SHA256 `e82c4658aae35ce2bccf9d5f156c9ffa929d2e98108c1144ff990ddd7966e155`, each non-weight metadata hash/size and path confinement. It preserves all signed Capsule, trust, plan, generation and logical source fields; only metadata URLs change to content-addressed `/config/model-{artifacts,manifests,pieces}/` paths. Three synthetic controls verify preservation, tamper rejection and escape rejection; they do not manufacture qualification. Final independent comparison proves these URLs are the only catalog changes, validates all 39 metadata entries and all 57 signed source mappings. No full weights are bundled.

Final catalog SHA256: `c4a2d9db0d474e81711ed01af5f47341cbf73a1eff70c28767f3099e96465a96`.

- Mac source: `/var/tmp/reploid-basic-signed-candidate-20261013/app`.
- Mac browser payload: that root's `.firebase-hosting/reploid`, 2,020 files, bundle `sha256:6ab27132598fea70c62dcef71fe491ba0f7a70e46c73cd6caf2f74db5c3e19f2`.
- Mac native TGZ: `app/output/reploid-native-Kmu984/reploid-native-0.1.0.tgz`, SHA256 `4c35a263a1d1aa14a1d4feecaa754b86e9f36ce0f9285f33f27904d949b6e3dc`.
- Native descriptor: `8e9dc118a4397e012e1c595726c525355460ca90449aee24343af0a926694836`, 133 files.
- x128 ordinary installed native: `/var/tmp/reploid-basic-signed-candidate-20261013/final/reploid`.
- Corrected weight/model source on both hosts: `/var/tmp/reploid-closure-model-20261013` (producer-owned, existing bytes).

Existing runtime/inventory/VFS/browser generators and `npm run prepare:hosting`, `npm run package:native` produced these outputs. x128 `npm ci --no-audit --no-fund` and CLI `--help` passed. Every native descriptor member and all 1,976 installed Doppler members match exact bound source/archive bytes. Native dependencies: `@roamhq/wrtc@0.10.0`, `ws@8.21.0`, `webgpu@0.4.0`; Node22.22.1. Actual Verification Worker passes artifact tooling under documented `/testing/`, warnings retained.

No application/server/contributor was launched, no GPU requested, no consent/cache/transfer ledger opened or renewed, and no live pin/catalog or public deployment changed. The existing candidate signing identity, verified cache, persistent 4 GiB supply ledger and release checkpoint store must be reused by the release owner's eventual launch. A new package directory is not a new allowance. This is a matched delivery/install proof; basic signed application inference, user-visible answer, cancellation and settlement remain the next physical journey.

Reproduce metadata staging before ordinary generators:

```sh
node artifacts/basic-signed-candidate-20261013/final/stage-catalog.js \
  /var/tmp/reploid-basic-signed-candidate-20261013/app \
  /var/tmp/qwen35-capsule-closure-20261013 \
  /var/tmp/qwen35-capsule-closure-20261013/chat-models.json \
  e82c4658aae35ce2bccf9d5f156c9ffa929d2e98108c1144ff990ddd7966e155 \
  /var/tmp/reploid-basic-signed-candidate-20261013/metadata-staging.json
```
