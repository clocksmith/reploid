# Reploid pool deployment config

This directory keeps production deployment settings in source control.

## File roles

| File | Format | Reason |
|------|--------|--------|
| `env.production.json` | JSON | JavaScript-friendly source of deployment constants and required env values. |
| `cloud-run-service.yaml` | YAML | Native Cloud Run service import/export format. |
| `cloudbuild.yaml` | YAML | Native Cloud Build pipeline format. |

The project uses JSON where Firebase/GCP accepts JSON directly. YAML is used only where Google Cloud tools expect it as the normal config surface.

## Required manual one-time setup

```bash
gcloud config set project reploid
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com firebase.googleapis.com

gcloud artifacts repositories create reploid \
  --repository-format=docker \
  --location=us-central1
```

## Deploy sequence

```bash
npm run verify:pool -- --allow-placeholders
gcloud builds submit --config deploy/cloudbuild.yaml
firebase deploy --only firestore:indexes,firestore:rules,hosting:reploid
```

Replace required placeholder values in `deploy/env.production.json` before Cloud Build. `scripts/print-pool-env.js` fails when a runtime env value still starts with `<required-`, so placeholder model artifact, Doppler module, or Doppler kernel base URLs cannot deploy silently.

Then check:

```bash
npm run verify:pool -- --url https://<hosting-domain>
REPLOID_POOL_SMOKE_URL=https://<hosting-domain> npm run smoke:pool
```

`/pool/deployment/check` must return `ok: true` before public traffic. The production verifier also checks local config validity, Firebase rewrites, Firestore indexes, Cloud Run env, required deployment values, config hash agreement, commit-reveal store support, and Firebase auth readiness.

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
