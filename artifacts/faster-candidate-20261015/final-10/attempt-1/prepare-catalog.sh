#!/bin/sh
# Copy of ../../signed-completion-candidate-20261013/final-9/prepare-catalog.sh for final-10 (the faster
# candidate, Reploid 5610260a). Differences:
#  1. Capsule: /var/tmp/qwen35-capsule-faster-20261015, built by Doppler
#     artifacts/faster-candidate-20261015/build.js from runtime archive 21d054ee... (Doppler 1c9ec3db) and
#     manifest 64d74719..., bound to placement C (mac-host browser stage 0, amd-host native stage 1, a
#     second amd-host native stage 2 with the output head). Its release history is sequences 1-6 of
#     renewal 6, byte-identical, then sequence 7 (2486b1e7...) for this Capsule.
#  2. Reports: faster-candidate-20261015/placement-c/c/reports.
#  3. Runtime directory and output belong to the tenth export; the reference is the fixture root's copy
#     (the same bytes, ad26dfbc...).
#  4. Minimum release sequence 7.
#  5. Runs from the main checkout (5610260a), not a worktree.
# Unchanged: script, closure URL and split layers.
set -eu
cd /Users/xyz/deco/reploid
REPORTS=/Users/xyz/deco/reploid/artifacts/faster-candidate-20261015/placement-c/c/reports
node artifacts/signed-completion-candidate-20261013/final/prepare-catalog.js \
  /var/tmp/qwen35-capsule-faster-20261015 \
  /var/tmp/reploid-signed-completion-app-10-20261015/app/node_modules/doppler-gpu \
  "$REPORTS/partition-0.json,$REPORTS/partition-1.json,$REPORTS/partition-2.json" \
  /var/tmp/reploid-faster-candidate-20261015/approved-reference.json \
  http://127.0.0.1:29670/qualification/capsule/ \
  /var/tmp/reploid-signed-completion-app-10-20261015/signed-catalog/chat-models.json \
  8,16 \
  7
