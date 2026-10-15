#!/bin/sh
# Runs named jobs sequentially, one bounded systemd scope per GPU process, on amd-host.
# Usage: run-jobs.sh <session label> <jobs file>
# Jobs file: one job per line, "<name> <command...>"; blank lines and # comments are skipped.
# Each job's output goes to out/<name>.log; the session log records the amdgpu error count before
# and after every job, the public contributor's CPU load, exit status and duration.
set -u
D=/var/tmp/paired-kernel-opt-20261014
export XDG_RUNTIME_DIR=/run/user/$(id -u)
gpuerr(){ journalctl -k --no-pager 2>/dev/null | grep -c -i -E "amdgpu.*(timeout|reset|fault)"; }
session=$1; jobs=$2
log=$D/session-$session.log
echo "session $session start $(date -u +%FT%TZ) amdgpu-errors $(gpuerr)" >> $log
grep -v -e '^#' -e '^$' "$jobs" | while read -r name command; do
  top -b -n1 -p 4103868 | tail -1 | awk '{print "public-native cpu " $9}' >> $log
  start=$(date +%s)
  timeout 3700 systemd-run --user --scope --quiet --unit=pko-$session-$name -p MemoryHigh=10737418240 -p MemoryMax=12884901888 -p MemorySwapMax=0 -p RuntimeMaxSec=3600 \
    sh -c "cd $D && exec $command" > $D/out/$name.log 2>&1 < /dev/null
  status=$?
  echo "$name exit=$status seconds=$(( $(date +%s) - start )) at $(date -u +%T) amdgpu-errors $(gpuerr)" >> $log
done
echo "session $session done $(date -u +%FT%TZ) amdgpu-errors $(gpuerr)" >> $log
