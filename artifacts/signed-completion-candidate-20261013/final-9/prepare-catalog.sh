#!/bin/sh
# Copy of ../final-6/prepare-catalog.sh for final-9 (ninth export, Reploid 1473eda7). Differences:
#  1. Capsule: the 16-token prefill-chunk Capsule built by Doppler a40f02a1
#     (artifacts/chunked-prefill-capsule-20261014), bound to campaign 3 placement B (mac-host browser,
#     intel-host stage 1, amd-host stage 2). Its root is /var/tmp/qwen35-capsule-chunk16-20261014-r5, an
#     APFS clone of the -b output whose release-events.json is replaced by the renewed history,
#     sequences 1-5 (Doppler 71a3daf6, artifacts/chunked-prefill-capsule-20261014/release-renewal-5,
#     sha256 7be31ba9...; sequences 1-4 byte-identical to the -b history). Every other file is unchanged.
#  2. Reports: completion-qualification-3-20261014/b/reports (placement B).
#  3. Runtime directory and output belong to the ninth export.
#  4. Minimum release sequence 5 (the renewal, chained to sequence 4).
# Unchanged: script, reference, closure URL and split layers.
set -eu
cd /Users/xyz/deco/reploid-wt-final6
REPORTS=/Users/xyz/deco/reploid-wt-final6/artifacts/completion-qualification-3-20261014/b/reports
node artifacts/signed-completion-candidate-20261013/final/prepare-catalog.js \
  /var/tmp/qwen35-capsule-chunk16-20261014-r5 \
  /var/tmp/reploid-signed-completion-app-9-20261014/app/node_modules/doppler-gpu \
  "$REPORTS/partition-0.json,$REPORTS/partition-1.json,$REPORTS/partition-2.json" \
  /var/tmp/reploid-completion-candidate-20261013/approved-reference.json \
  http://127.0.0.1:29670/qualification/capsule/ \
  /var/tmp/reploid-signed-completion-app-9-20261014/signed-catalog/chat-models.json \
  8,16 \
  5
