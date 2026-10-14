#!/bin/sh
# Runs each mode twice (cold then warm), one process each, in bounded scopes.
set -u
D=/var/tmp/speed-isolation-20261014; A=/var/tmp/reploid-signed-completion-9-20261014/reploid
export XDG_RUNTIME_DIR=/run/user/$(id -u)
gpuerr(){ journalctl -k --no-pager 2>/dev/null | grep -c -i -E "amdgpu.*(timeout|reset|fault)"; }
echo "start $(date -u +%FT%TZ) amdgpu-errors $(gpuerr)" >> $D/run.log
for mode in ordinary-batched ordinary-per-token paired-unsplit paired-three-stage; do
  for rep in 1 2; do
    top -b -n1 -p 4103868 | tail -1 | awk "{print \"public-native cpu \" \$9}" >> $D/run.log
    timeout 1900 systemd-run --user --scope --quiet --unit=speed-ladder-$mode-$rep -p MemoryHigh=10737418240 -p MemoryMax=12884901888 -p MemorySwapMax=0 -p RuntimeMaxSec=1800 \
      /usr/bin/node $D/speed-ladder.mjs $A/node_modules/doppler-gpu /var/tmp/doppler-cold-compile-model-20261013 $A/self/config/chat-models.json $A/self/config/partition-policy.json $D/distributed-observed.json $mode 128 $D/out/$mode-$rep.json > $D/out/$mode-$rep.log 2>&1
    echo "$mode $rep exit=$? at $(date -u +%T) amdgpu-errors $(gpuerr)" >> $D/run.log
  done
done
echo DONE >> $D/run.log
