# Reploid pool deployment config

This directory keeps production deployment settings in source control.

## File roles

[CATSCAN.md](CATSCAN.md) names the inputs and outputs this directory owns and the
boundaries they keep. The project uses JSON where Firebase/GCP accepts JSON directly.
YAML is used only where Google Cloud tools expect it as the normal config surface.

## Required manual one-time setup

```bash
gcloud config set project reploid
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com firebase.googleapis.com

gcloud artifacts repositories create reploid \
  --repository-format=docker \
  --location=us-central1
```

Browsers take discovery and temporary TURN credentials from the Cloudflare
Worker named in `shared/config/swarm-bootstrap.json` (`signalingUrl` and
`rtcConfigUrl`), configured by `cloudflare/wrangler.jsonc`; see
[the Cloudflare migration](../docs/cloudflare-migration.md) for its deployment
inputs and checks. The Google Cloud signaling route and TURN relay below remain
in place for operator rollback, not as a runtime fallback.

To keep the rollback relay available, provision it once, or rerun the same
command to repair its declarative resources:

```bash
TURN_HOST="$(./deploy/turn/provision.sh)"
```

Write the returned public IP to `REPLOID_TURN_HOST` in
`deploy/env.production.json`, then run `npm run sync:runtime-config` to regenerate
`deploy/cloud-run-service.yaml`. CI verifies this projection. Cloud Build
binds `REPLOID_TURN_SHARED_SECRET` from Secret Manager. Browsers receive only
short-lived TURN REST credentials from the authenticated `/pool/rtc-config`
endpoint, which they call only after a rollback removes `rtcConfigUrl`.
The shared secret never enters source control or Firebase Hosting.

Create a dedicated private adapter bucket with uniform bucket-level access,
public access prevention, versioning, retention, and browser CORS for the exact
Reploid origins. Grant the Cloud Run service account object-viewer access and
permission to sign blobs; keep object creation on a separate release identity.
Every release upload must use `ifGenerationMatch=0`, and the returned object
generation must be sealed into AdapterPack v2 before publication. Do not grant
the runtime service account object-create or object-delete permissions.

## Deploy sequence

```bash
npm run verify:pool -- --allow-placeholders
release_revision="$(git rev-parse HEAD)"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
gcloud builds submit --config deploy/cloudbuild.yaml \
  --substitutions=COMMIT_SHA="${release_revision}"
firebase deploy --only functions,firestore:indexes,firestore:rules,hosting:reploid
```

Replace required placeholder values in `deploy/env.production.json` before Cloud Build. `scripts/print-pool-env.js` fails when a runtime env value still starts with `<required-`, so placeholder model artifact, Doppler module, or Doppler kernel base URLs cannot deploy silently.

Cloud Build tags and deploys the coordinator image with the full commit SHA,
then exposes that SHA and image identity through `/pool/deployment/check`.
Triggered builds receive `COMMIT_SHA` from Cloud Build; manual submissions must
provide it as shown above. The backend computes a deterministic SHA-256 identity
over `server/`, `self/`, `deploy/Dockerfile`, `package.json`, and `package-lock.json`.
Firebase Hosting must be deployed from the same clean checkout. A mutable
`latest` image, missing commit, mismatched coordinator bytes, or mismatched
static browser bytes fails release verification.

Then check:

```bash
npm run verify:pool:release -- --url https://<hosting-domain> --channel=chrome
```

`/pool/deployment/check` must return `ok: true` before public traffic. The release verifier checks local config validity, Firebase rewrites, Firestore indexes, Cloud Run env, exact backend commit/image/runtime bytes, complete Firebase browser bytes, required deployment values, config hash agreement, commit-reveal store support, Firebase auth readiness, pinned launch manifests, deployed origin-specific CORS and byte-range responses, Doppler execution fields, synthetic browser peer wiring, strict-preflight actual protein inference, requester interruption recovery, after-start cancellation without receipt publication, instrumented stale-result rejection, manifest-corruption rejection, cached-shard detection and source-backed recovery, and a two-provider ring quorum through signed requester acceptance. These checks do not by themselves create a clean-release browser-qualification receipt.

## Runtime authority

Cloud Run remains authoritative for:

- Firebase Auth identity.
- Provider registry and admission lane.
- Model capability claims.
- Policy assignment.
- Commit-reveal evidence.
- Receipt anchoring.
- Requester acceptance.
- Points and reputation ledger.
- Abuse controls.

Signaling rendezvous and temporary TURN credentials come from the Cloudflare
Worker (`server/cloudflare/`); the Cloud Run `/swarm` route remains for
rollback. Prompt, output, token, and full receipt payload envelopes can move over P2P DataChannel after the configured reveal gates. Signaling must stay metadata-only.

## Historical Doppler packages

The current browser pin remains in `package-lock.json` and
`shared/config/doppler-package.json`; its integrity-pinned archive
(`artifacts/dopplerx-0.2.0.tgz`, the registry package bytes) is in the current tree,
as is the previous pin `artifacts/dopplerx-0.1.7.tgz`, which `retention.json` lists
among the archived versions. `dopplerx-0.1.5.tgz`, which the
[0.1.5 qualification receipts](../reports/release-015-qualification/README.md) name,
and other historical packages and run output are indexed in the
[evidence catalog](../docs/evidence-catalog/README.md), backed by immutable
published Git revisions. Local bytes are preserved when they are untracked.

[retention.json](artifacts/retention.json) preserves each historical package's
SHA-512 integrity and qualification identity. Restore on demand without changing
the active pin:

```sh
node scripts/restore-evidence.js deploy/artifacts/doppler-gpu-0.6.3-dev.split.10.tgz
node scripts/restore-doppler-evidence.js --restore 0.6.3-dev.split.10 /tmp/reploid-split-10
npm run verify:retained-artifacts
```

A shallow clone needs the catalog's explicit `--fetch` option before recovering
old objects. Historical evidence always uses its recorded runtime. New package
upgrades retire the previous archive through the catalog instead of accumulating
binary files in the current tree. CI enforces the current archive's integrity and
the deployment archive byte budget.

## Firebase configuration ownership

Edit shared cache headers and common route destinations in
`firebase-common.json`. Target-specific configuration and route order belong to
`firebase-reploid.template.json` and `firebase-simulatte.template.json`. Run
`npm run build:hosting-config` to regenerate the two root Firebase files;
`npm run verify:hosting-config` checks them in CI. Template references preserve
each target's existing route order and its distinct functions, Firestore and
hosting configuration.

## Process logs

Hosted and native processes write operational events to stdout and errors to stderr.
Cloud Run captures these streams in Cloud Logging; local operators can redirect them
to a chosen file outside the source tree. Log files are ignored and are not durable
execution or accounting receipts. Do not put credentials or private request payloads
in operational events.

### Optional landing-link counts

Codes have four base64url characters (`A-Z a-z 0-9 - _`, in that order);
the last is the sum of the first three character indices modulo 64. Generate
the first three randomly, ensure the code is unused in the operator's private
list, and reserve a leading `z` for tests. For example, `https://replo.id/?v=K7pu`.
Do not encode names, addresses, or sequence numbers. The checksum detects some
typos, not unissued codes, scanners, or forged hits. Treat only operator-issued
codes as meaningful. Only the homepage sends the optional event. Deploy the
existing `reploid-pool` backend route before publishing its Hosting rewrite and
entry page. Confirm one fresh test token produces one count, that an ordinary
or malformed URL produces none, and no inference/provider settings changed.

The route logs only `event=reploid_landing_attribution_v1` and a SHA-256 hex
digest of the tag. Leading-`z` codes use the separate event type
`reploid_landing_attribution_test_v1`. The digest does not protect the short
code against enumeration; the private operator mapping must stay private.
There is no public read endpoint or new analytics store.
Use existing project IAM. Query only the short observation window needed for
the link (seven days or less), and discard copied results after use. Actual
retention follows the existing Cloud Logging bucket policy; this feature
does not set a bucket TTL or change logging, IAM, quota, or billing settings.

With `TOKEN` set locally and your usual project selected:

```sh
DIGEST=$(printf '%s' "$TOKEN" | sha256sum | cut -d' ' -f1)
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=reploid-pool AND jsonPayload.event=reploid_landing_attribution_v1 AND jsonPayload.ref=\"$DIGEST\"" \
  --freshness=7d --format='value(timestamp)' | wc -l
```

The 30 accepted events per process per minute cap guards application log
volume; it is not a global edge throttle or a guarantee that hosting metering
does not apply. Treat counts as approximate, including repeats, scanners and
forwards; never treat a count as individual identification.
