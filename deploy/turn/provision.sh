#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${REPLOID_GCP_PROJECT:-reploid}"
REGION="${REPLOID_TURN_REGION:-us-central1}"
ZONE="${REPLOID_TURN_ZONE:-us-central1-a}"
ADDRESS_NAME="reploid-turn-ip"
INSTANCE_NAME="reploid-turn"
SERVICE_ACCOUNT_NAME="reploid-turn"
SERVICE_ACCOUNT="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
SECRET_NAME="reploid-turn-shared-secret"
FIREWALL_NAME="reploid-turn-ingress"

gcloud services enable compute.googleapis.com secretmanager.googleapis.com \
  --project "${PROJECT_ID}"

if ! gcloud secrets describe "${SECRET_NAME}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud secrets create "${SECRET_NAME}" \
    --project "${PROJECT_ID}" \
    --replication-policy automatic
  openssl rand -hex 32 | gcloud secrets versions add "${SECRET_NAME}" \
    --project "${PROJECT_ID}" \
    --data-file=-
fi

if ! gcloud iam service-accounts describe "${SERVICE_ACCOUNT}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${SERVICE_ACCOUNT_NAME}" \
    --project "${PROJECT_ID}" \
    --display-name "Reploid TURN relay"
fi

gcloud secrets add-iam-policy-binding "${SECRET_NAME}" \
  --project "${PROJECT_ID}" \
  --member "serviceAccount:${SERVICE_ACCOUNT}" \
  --role roles/secretmanager.secretAccessor >/dev/null
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member "serviceAccount:${SERVICE_ACCOUNT}" \
  --role roles/logging.logWriter \
  --condition=None >/dev/null

PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
gcloud secrets add-iam-policy-binding "${SECRET_NAME}" \
  --project "${PROJECT_ID}" \
  --member "serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role roles/secretmanager.secretAccessor >/dev/null

if ! gcloud compute addresses describe "${ADDRESS_NAME}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" >/dev/null 2>&1; then
  gcloud compute addresses create "${ADDRESS_NAME}" \
    --project "${PROJECT_ID}" \
    --region "${REGION}" \
    --network-tier PREMIUM
fi
TURN_IP="$(gcloud compute addresses describe "${ADDRESS_NAME}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --format='value(address)')"

if ! gcloud compute firewall-rules describe "${FIREWALL_NAME}" \
  --project "${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute firewall-rules create "${FIREWALL_NAME}" \
    --project "${PROJECT_ID}" \
    --network default \
    --direction INGRESS \
    --action ALLOW \
    --rules tcp:3478,tcp:443,udp:3478,udp:49160-49200 \
    --source-ranges 0.0.0.0/0 \
    --target-tags reploid-turn
fi

if ! gcloud compute instances describe "${INSTANCE_NAME}" \
  --project "${PROJECT_ID}" \
  --zone "${ZONE}" >/dev/null 2>&1; then
  gcloud compute instances create "${INSTANCE_NAME}" \
    --project "${PROJECT_ID}" \
    --zone "${ZONE}" \
    --machine-type e2-micro \
    --network-interface "network=default,address=${TURN_IP},network-tier=PREMIUM" \
    --service-account "${SERVICE_ACCOUNT}" \
    --scopes cloud-platform \
    --tags reploid-turn \
    --image-family debian-12 \
    --image-project debian-cloud \
    --boot-disk-size 10GB \
    --metadata-from-file "startup-script=$(dirname "$0")/startup.sh"
else
  gcloud compute instances add-metadata "${INSTANCE_NAME}" \
    --project "${PROJECT_ID}" \
    --zone "${ZONE}" \
    --metadata-from-file "startup-script=$(dirname "$0")/startup.sh"
fi

printf '%s\n' "${TURN_IP}"
