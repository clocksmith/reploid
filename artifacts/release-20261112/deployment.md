# Reploid release gate, November 12, 2026

Owner of the gate: A2 (owner direction, November 12, 2026).

## Live identities before this gate (recorded 2026-11-12)

- Cloud Run service `reploid-pool` (project `reploid`, region `us-central1`):
  revision `reploid-pool-00147-52n`, image
  `us-central1-docker.pkg.dev/reploid/reploid/reploid-pool:e7ea7aa6c2efc85fbb5c1b23a65defef9a43054b`,
  `/pool/deployment/check` sourceRevision `e7ea7aa6c`, runtimeBundleHash
  `sha256:30d8a964655cf9f703aa03efcf6a978c958cd43b5d606f0f23d4cc39dfa3aca0`.
- Firebase Hosting site `reploid`, channel `live`: release
  `sites/reploid/channels/live/releases/1794447831870000` (2026-11-12T01:43:51Z),
  version `sites/reploid/versions/ca243ad75bfb1b66` (2,411 files).
- Cloudflare discovery worker: release marker from `04b3a5255`
  (`cloudflare-swarm-20261112-shared-signaling-core`).

## Rollback commands

Cloud Run, send all traffic back to the recorded revision:

```sh
gcloud run services update-traffic reploid-pool --project reploid --region us-central1 \
  --to-revisions reploid-pool-00147-52n=100
```

Hosting, re-release the recorded version on the live channel:

```sh
firebase hosting:clone reploid@ca243ad75bfb1b66 reploid:live --project reploid
```

Functions and Firestore rules have no version pin; restore them from a clean
checkout of `e7ea7aa6c`:

```sh
git clone --branch main https://github.com/clocksmith/reploid reploid-rollback && cd reploid-rollback
git checkout e7ea7aa6c2efc85fbb5c1b23a65defef9a43054b
npm ci --ignore-scripts && (cd packages/functions && npm ci --ignore-scripts)
npm run prepare:hosting
firebase deploy --project reploid --only functions,firestore:rules,hosting:reploid --non-interactive
```

`firebase deploy --only firestore:indexes` without `--force` keeps indexes that
are absent from `deploy/firestore.indexes.json` (the three `signaling_messages`
indexes removed in `04b3a5255`), so no index rollback is needed.

## Gate decision: not deployed

Journeys run locally on one Mac (Apple GPU, Chromium, local server, private
discovery room), exact catalog bytes served from a local copy:

| Spec | Result |
| --- | --- |
| `chat-real-adapter.spec.js` (`REPLOID_E2E_ACTUAL_INFERENCE=1`) | passed, 2.5 min |
| `chat-open-mesh-real.spec.js` (`DOPPLER_CHAT_MODEL_DIR`, Qwen 3.5 0.8B) | failed at the queued-before-capacity step |
| same spec with only that step removed (scratch copy, not committed) | passed, 1.7 min |
| `chat-cooperative-real.spec.js` (Qwen 3.5 2B, single device) | failed: no current control starts a partition contribution |

Release checks passed: `verify:browser-bundle:local`, `verify:ownership-inventory`,
`verify:layers`, `verify:module-system`, `verify:library`, `verify:swarm-cloudflare`,
`verify:swarm-bootstrap` (16/16 after the transport fix in this commit; 15/16 and a
hung process at `e7ea7aa6c`), `verify:pool`, `verify:boundaries`, `verify:registry`,
`verify:zero-source`.

Blocking findings (product behavior, not test drift):

1. A message sent before any computer is ready is kept only during the 8 s
   discovery window (`apps/poolday/ui/pool-home/conversation-workspace.js`,
   `peerDiscoveryTimedOut`); afterwards it is dropped from the queue (the text stays
   in the composer) and the Send button is disabled while no model is usable. A
   computer that joins later never receives it.
2. A contributor that leaves the network or reloads does not resume sharing its
   downloaded model, although the label reads "On · waiting for a downloaded model".
   `work-swarm.js` `shareCachedModels` returns early for every browser with
   requester-only ordered participation (all browsers while the catalog declares an
   ordered 27B plan). Lifting that gate exposes a second defect: the cache-only
   resume fails with "Verified cached model file unavailable" for a model stored by
   Download & share.
3. Browsers can start only whole-model or adapter contributions
   (`contribution-models.js` `eligible`, `network-inspector.js` `openModelSetup`);
   no control starts the layer-partition contribution the cooperative journey needs.

## Hotfix deployed: browser-contributor answer limit (2026-11-13T01:11Z)

Owner-approved hotfix (November 12, 2026): only the answer-limit fix from
`314c209a1`, on top of the live `e7ea7aa6c`. The blocking findings above are
unchanged and the release gate still holds everything else on `main`.

- Fix: `apps/poolday/providers/work-provider.js` (lines 125-136). Without a
  request budget the configured default (4096, the whole context) is a ceiling
  that shrinks to the room left in the context; an explicit budget that does not
  fit, or a prompt that leaves no room, is still rejected. Before it, every
  request to a browser contributor failed with "52 + 4096 > 4096 tokens".
  The code runs only in the browser bundle, so only Hosting was deployed.
- Build: detached commit `083d8fb92bb8e053786a45db2064e3955ce17d91` (tree
  `ebbf1ff93d1bb597ade8d7557406202eab7e7931`, local tag
  `hotfix-20261112-answer-limit`, not pushed, not on `main`), parent `e7ea7aa6c`.
  Diff: the fix, its unit assertions, and the regenerated `app.bundle.js`,
  `browser-bundle-manifest.json` and `self/config/module-inventory.json`.
  Browser bundle `sha256:1443b45b53ebf6ed7e69d7967de43f0aa4936a5b3d4b2a8c20fa4b9ee83ae716`
  (was `sha256:5a85d29d1e709cf06dcf51f7d90ac1d5f6d40de3627a32546daeb8bb32b4457c`).
- Hosting: release `sites/reploid/channels/live/releases/1794532296404000`,
  version `sites/reploid/versions/2cf418d9bb157ed5` (2,411 files), deployed with
  `firebase deploy --project reploid --only hosting:reploid` from the clean
  hotfix tree.
- Unchanged: Cloud Run `reploid-pool-00147-52n` (100% traffic, image and
  `/pool/deployment/check` at `e7ea7aa6c`, `ok: true`), functions, Firestore
  rules and indexes, and the Cloudflare worker (`04b3a5255`). The coordinator
  runtime identity covers `self/`, so `verify:pool:release` from the hotfix tree
  would report that `self/config/module-inventory.json` differs from the
  backend image; that file only lists browser module hashes.

Checks:

| Check | Result |
| --- | --- |
| `tests/unit/work-resident-provider.test.js` | 18/18; the new assertions fail at `e7ea7aa6c` (1800 + 512 > 2048) |
| `verify:browser-bundle:local` | 2,408 served files match `sha256:1443b45b…` |
| Local smoke: private room, Chromium 145 with WebGPU (Apple metal-3), contributor serving Qwen 3.5 0.8B from exact catalog bytes | answered "Hello", 52 prompt tokens, `peer-whole-request`, 53 s run |
| `verify:browser-bundle -- --url https://replo.id` | 2,408 deployed files match `sha256:1443b45b…` |
| `scripts/verify-cloudflare-swarm.js --deployed`, `e7ea7aa6c` copy | fails waiting for `[data-mesh-peers]`, which the current UI no longer renders (same at the earlier live bundle) |
| same, `main` copy (protocol-based check from `9de19ac09`) | passed: relay/relay pair, private isolation, disconnect persists, network recovery |
| Live journey on https://replo.id, private room through the deployed worker; contributor's model bytes served from the same local catalog copy | answered "Hello", 52 prompt tokens, `peer-whole-request` by a browser contributor, bundle `sha256:1443b45b…` |

The live journey used a private room, so no public computer answered or saw
the prompt.

Rollback of this hotfix, re-release the previous Hosting version:

```sh
firebase hosting:clone reploid@ca243ad75bfb1b66 reploid:live --project reploid
```
