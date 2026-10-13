# Basic signed chat delivery base

Component: browser/native application delivery. Intent preserved. Boundary effects: isolated generated candidate only; no checkout pin/catalog, deployment, running contributor, cache or transfer ledger changed.

Source is clean committed Reploid `7a49a7eabf2415163d36c08c0dfc62859a098834`. The new export is `/var/tmp/reploid-basic-signed-candidate-20261013/app` on Mac. Runtime archive is immutable SHA256 `0fadac5113d2cc154f65d9d40de50722a16454995e927c7d22bedc5f1a4925cd`, copied byte-exactly from the prior isolated signed application. It was installed normally with `npm install --save-exact --ignore-scripts --no-audit --no-fund file:deploy/artifacts/doppler-gpu-0.6.28.tgz`; it was not repacked from current Doppler source.

Existing vendor/generation/partition/library/runtime/inventory/VFS/browser-manifest generators then ran, followed by `npm run prepare:hosting` and `npm run package:native`. The isolated pool catalog runtime version and retention/old generated vendor retirement follow existing `sync-doppler.js` behavior; only this new export was modified. Old archives are retained. Native drain, source metadata mapping/inventory, cleanup, reliable custody, compact model advertisement and bounded CLI logging are included from this exact application revision. Canonical mode remains opt-in/default off, and this runtime is not claimed to support it.

Base browser delivery: 1,985 files, bundle `sha256:167a3411bef5983ea5fcbc37fb6992c8b2f3c00ed33202264016bccfe1f02325`. Existing `verifyHostingSource` validates complete browser descriptor and served archive projection. Base native TGZ: `097ae4205d7a10cbe679354884338de26e0a0a1769419f6563f03c532bbdae27`; descriptor `006dabd00b830f6fc5289feeba222eff84dbba258a4aa162d3d8c40592f99a18`, 102 files. Local package path is `app/output/reploid-native-KtwKBX/reploid-native-0.1.0.tgz` under the export.

The native artifact is installed outside checkout on x128 at `/var/tmp/reploid-basic-signed-candidate-20261013/reploid`. `npm ci --no-audit --no-fund` installed ordinary declared `@roamhq/wrtc@0.10.0`, `ws@8.21.0`, `webgpu@0.4.0` and exact Doppler 0.6.28. CLI `--help` passed using Node22.22.1. CPU-only verification compared every descriptor member and all 1,976 installed runtime files to the unchanged archive. No device, model, participant, file supply, cache or ledger was opened. Verification Worker passes the test-only verifier using `/testing/`; warnings retained.

## Required final handoff

The current catalog is intentionally the committed unsigned base (`catalogSha256` in both receipts), not the obsolete prior signed catalog. Final signed delivery remains pending these genuine inputs from the release owner:

- Corrected `capsule-v3.json`, complete non-weight artifact closure and SHA256 piece index, with their exact signed logical paths/hashes/sizes.
- Trusted signing identities, verified release events and checkpoint/minimum-sequence policy for this new Capsule; no sequence reset or prior ledger replacement.
- Genuine passed resident qualification reports covering required provider surfaces and both partition placements, bound to runtime 0fad, corrected graph/manifest, exact approved reference and observed initial execution identities.
- The final catalog row(s), exact accepted target-plan digests, explicit v2 partition plan, unchanged generation policy and application/workload/reference identities. `maxAcquisitionChunkBytes` remains 16,777,216 for the signed index; no transfer allowance increase.

Existing `artifacts/signed-blake3-source-20261012/prepare-catalog.js` takes Capsule directory, exact runtime directory, genuine resident report, approved reference, closure base URL and output catalog. It validates the report against signed qualification and verifies metadata/release trust. The release owner must supply all needed targets rather than infer eligibility from this base delivery.

Before final packaging, bundle every non-weight signed source file into `self/config/model-artifacts/` (or the existing manifest/piece directories) with exact catalog-pinned SHA256/size and bounded `/config/model-{artifacts,manifests,pieces}/filename` URLs. Preserve nested *logical* Capsule artifact paths in source mappings; do not flatten those identities. Native package admission deliberately rejects signed metadata left at remote URLs. The previous `Plain model filename required`/inventory boundary repairs remain included. Weight shards remain selectively acquired from their declared verified piece source, not bundled full weights.

After this handoff, regenerate runtime/catalog-dependent manifests, package hosting and native delivery again, re-install native into a separate final directory, and reverify exact identities. All base hashes above will be historical preparation evidence once signed metadata changes. No signed opening, inference, release qualification or deployment is claimed by this base.
