#!/bin/sh
# Copy of ../final-2/prepare-catalog.sh. The only difference: the runtime directory and the
# output belong to the third export (Reploid 9b42f5ee). Same script, Capsule `-c`, reports,
# reference, closure URL, split layers and minimum release sequence 2.
set -eu
cd /Users/xyz/deco/reploid
REPORTS=/Users/xyz/deco/reploid/artifacts/completion-qualification-2-20261013/reports
node artifacts/signed-completion-candidate-20261013/final/prepare-catalog.js \
  /var/tmp/qwen35-capsule-completion-20261013-c \
  /var/tmp/reploid-signed-completion-app-3-20261013/app/node_modules/doppler-gpu \
  "$REPORTS/partition-0.json,$REPORTS/partition-1.json,$REPORTS/partition-2.json" \
  /var/tmp/reploid-completion-candidate-20261013/approved-reference.json \
  http://127.0.0.1:29670/qualification/capsule/ \
  /var/tmp/reploid-signed-completion-app-3-20261013/signed-catalog/chat-models.json \
  8,16 \
  2
