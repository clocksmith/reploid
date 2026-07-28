# Reploid pool deployment config

This directory keeps production deployment settings in source control.

## File roles

| File | Format | Reason |
|------|--------|--------|
| `env.production.json` | JSON | JavaScript-friendly source of deployment constants and required env values. |
| `cloud-run-service.yaml` | YAML | Native Cloud Run service import/export format. |
| `cloudbuild.yaml` | YAML | Native Cloud Build pipeline format. |
| `turn/provision.sh` | Shell | Idempotent TURN relay, secret, address, firewall, and service-account provisioning. |

The project uses JSON where Firebase/GCP accepts JSON directly. YAML is used only where Google Cloud tools expect it as the normal config surface.

## Required manual one-time setup

```bash
gcloud config set project reploid
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com firebase.googleapis.com

gcloud artifacts repositories create reploid \
  --repository-format=docker \
  --location=us-central1
```

Provision the credentialed WebRTC relay once, or rerun the same command to
repair its declarative resources:

```bash
TURN_HOST="$(./deploy/turn/provision.sh)"
```

Write the returned public IP to `REPLOID_TURN_HOST` in
`deploy/env.production.json` and `deploy/cloud-run-service.yaml`. Cloud Build
binds `REPLOID_TURN_SHARED_SECRET` from Secret Manager. Browsers receive only
short-lived TURN REST credentials from the authenticated `/pool/rtc-config`
endpoint. The shared secret never enters source control or Firebase Hosting.

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
gcloud builds submit --config deploy/cloudbuild.yaml
firebase deploy --only functions,firestore:indexes,firestore:rules,hosting:reploid
```

Replace required placeholder values in `deploy/env.production.json` before Cloud Build. `scripts/print-pool-env.js` fails when a runtime env value still starts with `<required-`, so placeholder model artifact, Doppler module, or Doppler kernel base URLs cannot deploy silently.

Then check:

```bash
npm run verify:pool:release -- --url https://<hosting-domain> --channel=chrome
```

`/pool/deployment/check` must return `ok: true` before public traffic. The release verifier checks local config validity, Firebase rewrites, Firestore indexes, Cloud Run env, required deployment values, config hash agreement, commit-reveal store support, Firebase auth readiness, the pinned launch manifests and Doppler execution fields, synthetic browser peer wiring, actual text and protein inference, and a two-provider ring quorum through signed requester acceptance.

## Runtime authority

Cloud Run remains authoritative for:

- Firebase Auth identity.
- Provider registry and admission lane.
- Model capability claims.
- Policy assignment.
- Signaling rendezvous metadata.
- Commit-reveal evidence.
- Receipt anchoring.
- Requester acceptance.
- Points and reputation ledger.
- Abuse controls.

Prompt, output, token, and full receipt payload envelopes can move over P2P DataChannel after the configured reveal gates. Cloud signaling must stay metadata-only.
