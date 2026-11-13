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
