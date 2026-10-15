#!/bin/sh
# Variant choice: cold or warm pipeline preparation of both amd-host stages together, through the real resident
# opening path (placement-c/prepare-measure.mjs, load-only, no token). Launches the two natives of one attempt
# (pu1/pr1 cold: new empty private Mesa caches; pu2/pr2 warm: the same caches), opens stages 1 and 2 at the
# same time from mac-host through loopback tunnels, then stops the attempt's server and sampler. The natives
# exit after their providers close. The SSH destination comes from FC_SSH_AMD.
# Usage: measure-amd.sh <pu1|pu2|pr1|pr2>
set -eu
attempt=$1
E=/Users/xyz/deco/reploid/artifacts/faster-candidate-20261015
case "$attempt" in pu*) root=/var/tmp/reploid-faster-candidate-20261015-2 ;; pr*) root=/var/tmp/reploid-faster-candidate-20261015-3 ;; *) exit 2 ;; esac
out=$E/variant-choice/$attempt; mkdir "$out"
ssh -o BatchMode=yes "$FC_SSH_AMD" sh -s -- "$attempt" < $E/placement-c/native-launch.sh > "$out/launch.txt" 2>&1
ssh -o BatchMode=yes -o ExitOnForwardFailure=yes -N -L 127.0.0.1:29994:127.0.0.1:29992 -L 127.0.0.1:29995:127.0.0.1:29996 "$FC_SSH_AMD" &
tunnel=$!
trap 'kill $tunnel 2>/dev/null' EXIT
for i in $(seq 1 60); do curl -s -m 2 http://127.0.0.1:29994/json/list | grep -q webSocket && curl -s -m 2 http://127.0.0.1:29995/json/list | grep -q webSocket && break; sleep 1; done
ws(){ curl -s "http://127.0.0.1:$1/json/list" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['webSocketDebuggerUrl'])"; }
W1=$(ws 29994); W2=$(ws 29995)
POL=/var/tmp/faster-candidate-20261015-mac/placement-c/partition-policy.json; H=sha256:fd0e3e512c86c66b9303662b61a7eb4b8321b84c967250781a512df9c3853f53
cd $E/placement-c
node prepare-measure.mjs $root "$out/amd-stage-1.json" 1 "$W1" $POL $H > "$out/amd-stage-1.log" 2>&1 & p1=$!
node prepare-measure.mjs $root "$out/amd-stage-2.json" 2 "$W2" $POL $H > "$out/amd-stage-2.log" 2>&1 & p2=$!
wait $p1; s1=$?; wait $p2; s2=$?
sleep 3
ssh -o BatchMode=yes "$FC_SSH_AMD" "export XDG_RUNTIME_DIR=/run/user/\$(id -u); systemctl --user stop fc-$attempt-server.scope; pkill -f '^(timeout 3600 )?python3 /var/tmp/faster-candidate-20261015/placement-c/observe-host-c.py'; sleep 1; systemctl --user list-units 'fc-$attempt-*' --no-pager --plain | grep scope || echo none; du -s /var/tmp/faster-candidate-20261015/placement-c/mesa-*" >> "$out/launch.txt" 2>&1 || true
scp -q -r "$FC_SSH_AMD:/var/tmp/faster-candidate-20261015/placement-c/$attempt" "$out/amd-host"
echo "$attempt stage1=$s1 stage2=$s2"
