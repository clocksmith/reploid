#!/bin/sh
# Copy of ../final-6/prepare-catalog.sh for final-8 (same Capsule, reports and minimum sequence; eighth export). Differences:
#  1. Capsule: the 16-token prefill-chunk Capsule built by Doppler a40f02a1
#     (artifacts/chunked-prefill-capsule-20261014, output /var/tmp/qwen35-capsule-chunk16-20261014-b),
#     bound to campaign 3 placement B (mac-host browser, intel-host stage 1, amd-host stage 2).
#  2. Reports: completion-qualification-3-20261014/b/reports (placement B).
#  3. Runtime directory and output belong to the eighth export (Reploid 76296a53).
#  4. Minimum release sequence 4 (this Capsule's event, chained to the sequence-3 renewal).
# Unchanged: script, reference, closure URL and split layers.
set -eu
cd /Users/xyz/deco/reploid-wt-final6
REPORTS=/Users/xyz/deco/reploid-wt-final6/artifacts/completion-qualification-3-20261014/b/reports
node artifacts/signed-completion-candidate-20261013/final/prepare-catalog.js \
  /var/tmp/qwen35-capsule-chunk16-20261014-b \
  /var/tmp/reploid-signed-completion-app-8-20261014/app/node_modules/doppler-gpu \
  "$REPORTS/partition-0.json,$REPORTS/partition-1.json,$REPORTS/partition-2.json" \
  /var/tmp/reploid-completion-candidate-20261013/approved-reference.json \
  http://127.0.0.1:29670/qualification/capsule/ \
  /var/tmp/reploid-signed-completion-app-8-20261014/signed-catalog/chat-models.json \
  8,16 \
  4
