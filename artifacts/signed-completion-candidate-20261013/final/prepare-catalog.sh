#!/bin/sh
# Adapted copy of doppler/artifacts/qwen35-08b-capsule-intake-20261012/signed-closure-candidate/prepare-catalog.sh.
# Differences from the original are those of ../prepare-catalog.sh (this folder's script,
# three reports, the export's runtime install, the campaign's reference copy, a separate
# output that is never overwritten, split layers as argument 7), and from that first pass:
#  1. Capsule `-c` (Doppler e403ff3b), whose history is the earlier 0fad event at
#     sequence 1 followed by this Capsule's event at sequence 2.
#  2. Runtime directory and output belong to the new export of Reploid f1b2fd77.
#  3. Argument 8 sets the minimum release sequence to 2.
# Unchanged: the inherited loopback closure URL.
set -eu
cd /Users/xyz/deco/reploid
REPORTS=/Users/xyz/deco/reploid/artifacts/completion-qualification-2-20261013/reports
node artifacts/signed-completion-candidate-20261013/final/prepare-catalog.js \
  /var/tmp/qwen35-capsule-completion-20261013-c \
  /var/tmp/reploid-signed-completion-app-20261013/app/node_modules/doppler-gpu \
  "$REPORTS/partition-0.json,$REPORTS/partition-1.json,$REPORTS/partition-2.json" \
  /var/tmp/reploid-completion-candidate-20261013/approved-reference.json \
  http://127.0.0.1:29670/qualification/capsule/ \
  /var/tmp/reploid-signed-completion-app-20261013/signed-catalog/chat-models.json \
  8,16 \
  2
