#!/bin/sh
# Run-7 preflight byte verification (read-only). Compares the export's hosting payload descriptor, and the
# served copies (over a running loopback server, if given) and the export copies of the three partition
# files, with the blobs at Reploid commit 95641fe7.
# Usage: verify-bytes.sh <reploid checkout> <export app dir> [served origin]
set -eu
repo=$1; app=$2; origin=${3:-}
commit=95641fe7
echo "payloadBundleHash $(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["bundleHash"])' "$app/.firebase-hosting/reploid/config/browser-bundle-manifest.json")"
for f in partition-route-execution.js partition-ordered-peer.js automatic-ordered-partitions.js; do
  want=$(git -C "$repo" show "$commit:packages/reploid/src/mesh/partitions/$f" | shasum -a 256 | cut -c1-64)
  payload=$(shasum -a 256 "$app/.firebase-hosting/reploid/vendor/reploid/mesh/partitions/$f" | cut -c1-64)
  served=none
  if [ -n "$origin" ]; then served=$(curl -sf "$origin/vendor/reploid/mesh/partitions/$f" | shasum -a 256 | cut -c1-64); fi
  echo "$f commit=$want payload=$payload served=$served match=$([ "$want" = "$payload" ] && { [ "$served" = none ] || [ "$served" = "$want" ]; } && echo yes || echo NO)"
done
