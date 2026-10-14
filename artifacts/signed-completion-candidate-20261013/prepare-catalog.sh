#!/bin/sh
# Adapted copy of doppler/artifacts/qwen35-08b-capsule-intake-20261012/signed-closure-candidate/prepare-catalog.sh.
# Every difference from the original:
#  1. Runs this folder's prepare-catalog.js (original: signed-blake3-source-20261012/prepare-catalog.js).
#  2. Capsule directory is the three-stage Capsule for runtime archive 2df37d88.
#  3. Runtime directory is the exact archive as npm installed it in the isolated
#     application export (original: an older consumer install of archive 0fadac51).
#  4. Three resident reports, one per stage (original: one report, direction-0/partition-1).
#  5. Reference is the copy the three-host campaign bound; same bytes, sha256 ad26dfbc.
#  6. Output goes to a new directory beside the application export (original: inside
#     the Capsule directory). The script refuses to overwrite it.
#  7. A seventh argument states the expected split layers.
# Unchanged: the loopback closure URL. It names where the release owner serves the
# prepared closure to the browser stage and is an inherited choice, not a measured one.
set -eu
cd /Users/xyz/deco/reploid
REPORTS=/Users/xyz/deco/reploid/artifacts/completion-qualification-2-20261013/reports
node artifacts/signed-completion-candidate-20261013/prepare-catalog.js \
  /var/tmp/qwen35-capsule-completion-20261013-b \
  /var/tmp/reploid-completion-chat-candidate-20261013/app/node_modules/doppler-gpu \
  "$REPORTS/partition-0.json,$REPORTS/partition-1.json,$REPORTS/partition-2.json" \
  /var/tmp/reploid-completion-candidate-20261013/approved-reference.json \
  http://127.0.0.1:29670/qualification/capsule/ \
  /var/tmp/reploid-completion-chat-candidate-20261013/signed-catalog/chat-models.json \
  8,16
