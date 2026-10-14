#!/bin/sh
# Runs the named configurations sequentially, one bounded systemd scope per process.
# Usage: run-batch.sh <batch label> <run name>...
set -u
D=/var/tmp/plain-divergence-20261014
P=/var/tmp/reploid-signed-completion-9-20261014/reploid/node_modules/doppler-gpu
R=/var/tmp/plain-profile-reference-20261014
export XDG_RUNTIME_DIR=/run/user/$(id -u)
gpuerr(){ journalctl -k --no-pager 2>/dev/null | grep -c -i -E "amdgpu.*(timeout|reset|fault)"; }
batch=$1; shift
log=$D/batch-$batch.log
echo "batch $batch start $(date -u +%FT%TZ) amdgpu-errors $(gpuerr)" >> $log
for name in "$@"; do
  model=$(grep "^$name " $D/configs/runs.txt | cut -d' ' -f2)
  top -b -n1 -p 4103868 | tail -1 | awk '{print "public-native cpu " $9}' >> $log
  start=$(date +%s)
  timeout 2100 systemd-run --user --scope --quiet --unit=plain-substitution-$name -p MemoryHigh=10737418240 -p MemoryMax=12884901888 -p MemorySwapMax=0 -p RuntimeMaxSec=2000 \
    /usr/bin/node $D/substitution-check.mjs $P $model $R/inputs/approved-reference.json $R/inputs /var/tmp/speed-isolation-20261014/distributed-observed.json $D/configs/$name.json $D/runs/$name > $D/runs/$name.log 2>&1
  echo "$name exit=$? seconds=$(( $(date +%s) - start )) at $(date -u +%T) amdgpu-errors $(gpuerr)" >> $log
done
echo "batch $batch done $(date -u +%FT%TZ)" >> $log
