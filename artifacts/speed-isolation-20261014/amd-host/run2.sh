#!/bin/sh
# Second pass: waits for the running paired-unsplit-1, then runs the remaining modes.
set -u
D=/var/tmp/speed-isolation-20261014; A=/var/tmp/reploid-signed-completion-9-20261014/reploid
export XDG_RUNTIME_DIR=/run/user/$(id -u)
gpuerr(){ journalctl -k --no-pager 2>/dev/null | grep -c -i -E "amdgpu.*(timeout|reset|fault)"; }
while pgrep -f "[u]nit=speed-ladder-paired-unsplit-1" >/dev/null; do sleep 5; done
echo "paired-unsplit 1 finished before $(date -u +%T)" >> $D/run.log
echo "start $(date -u +%FT%TZ) amdgpu-errors $(gpuerr)" >> $D/run.log
for job in ordinary-batched:1 ordinary-batched:2 ordinary-per-token:1 ordinary-per-token:2 paired-unsplit:2 paired-three-stage:1 paired-three-stage:2; do
  mode=${job%:*}; rep=${job#*:}
  top -b -n1 -p 4103868 | tail -1 | awk "{print \"public-native cpu \" \$9}" >> $D/run.log
  timeout 1900 systemd-run --user --scope --quiet --unit=speed-ladder-$mode-$rep -p MemoryHigh=10737418240 -p MemoryMax=12884901888 -p MemorySwapMax=0 -p RuntimeMaxSec=1800 \
    /usr/bin/node $D/speed-ladder.mjs $A/node_modules/doppler-gpu /var/tmp/doppler-cold-compile-model-20261013 $A/self/config/chat-models.json $A/self/config/partition-policy.json $D/distributed-observed.json $mode 128 $D/out/$mode-$rep.json $D/ordinary-model > $D/out/$mode-$rep.log 2>&1
  echo "$mode $rep exit=$? at $(date -u +%T) amdgpu-errors $(gpuerr)" >> $D/run.log
done
echo DONE >> $D/run.log
