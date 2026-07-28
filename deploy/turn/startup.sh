#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="$(curl -fsS -H 'Metadata-Flavor: Google' \
  http://metadata.google.internal/computeMetadata/v1/project/project-id)"
EXTERNAL_IP="$(curl -fsS -H 'Metadata-Flavor: Google' \
  http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip)"
INTERNAL_IP="$(curl -fsS -H 'Metadata-Flavor: Google' \
  http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/ip)"
TURN_SECRET="$(gcloud secrets versions access latest \
  --project "${PROJECT_ID}" \
  --secret reploid-turn-shared-secret)"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y coturn libcap2-bin

install -o root -g turnserver -m 640 /dev/null /etc/turnserver.conf
{
  printf '%s\n' \
    'listening-port=3478' \
    "listening-ip=${INTERNAL_IP}" \
    "relay-ip=${INTERNAL_IP}" \
    'fingerprint' \
    'use-auth-secret' \
    "static-auth-secret=${TURN_SECRET}" \
    'realm=replo.id' \
    "external-ip=${EXTERNAL_IP}/${INTERNAL_IP}" \
    'min-port=49160' \
    'max-port=49200' \
    'user-quota=16' \
    'total-quota=256' \
    'stale-nonce=600' \
    'no-multicast-peers' \
    'no-loopback-peers' \
    'no-tls' \
    'no-dtls' \
    'no-cli'
} > /etc/turnserver.conf
unset TURN_SECRET
setcap cap_net_bind_service=+ep /usr/bin/turnserver
iptables -t nat -C PREROUTING -p tcp --dport 443 -j REDIRECT --to-ports 3478 2>/dev/null \
  || iptables -t nat -A PREROUTING -p tcp --dport 443 -j REDIRECT --to-ports 3478

if [[ -f /etc/default/coturn ]]; then
  sed -i 's/^#\\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
fi
systemctl enable coturn
systemctl restart coturn
