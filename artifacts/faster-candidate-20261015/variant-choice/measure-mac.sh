#!/bin/sh
# Variant choice: cold and warm pipeline preparation of the mac-host stage 0 (Chrome, Metal) through the real
# resident opening path (placement-c/prepare-measure.mjs, load-only, no token). Serves the variant's fixture
# root and model directory on loopback 29850/29851, then opens stage 0 twice in one new persistent Chrome
# profile: the first opening has no Chrome/Dawn shader cache (cold), the second reuses it (warm). macOS has no
# systemd scopes; each browser is closed by the tool.
# Usage: measure-mac.sh <u|r>
set -eu
v=$1
E=/Users/xyz/deco/reploid/artifacts/faster-candidate-20261015
case "$v" in
  u) root=/var/tmp/reploid-faster-candidate-20261015-2; model=/var/tmp/doppler-faster-model-20261015-2 ;;
  r) root=/var/tmp/reploid-faster-candidate-20261015-3; model=/var/tmp/doppler-faster-model-20261015-3 ;;
  *) exit 2 ;;
esac
out=$E/variant-choice/mac-$v; mkdir "$out"
profile=/var/tmp/faster-candidate-20261015-mac/prep-profile-$v; test ! -e "$profile"
cd "$root"; DOPPLER_CHAT_MODEL_DIR=$model node delivery-server.js > "$out/server.log" 2>&1 & server=$!
trap 'kill $server 2>/dev/null' EXIT
for i in $(seq 1 30); do curl -s -m 2 -o /dev/null http://127.0.0.1:29851/manifest.json && break; sleep 1; done
POL=/var/tmp/faster-candidate-20261015-mac/placement-c/partition-policy.json; H=sha256:fd0e3e512c86c66b9303662b61a7eb4b8321b84c967250781a512df9c3853f53
cd $E/placement-c
node prepare-measure.mjs $root "$out/mac-stage-0-cold.json" 0 - $POL $H "$profile" > "$out/cold.log" 2>&1
node prepare-measure.mjs $root "$out/mac-stage-0-warm.json" 0 - $POL $H "$profile" > "$out/warm.log" 2>&1
echo "mac $v done"
