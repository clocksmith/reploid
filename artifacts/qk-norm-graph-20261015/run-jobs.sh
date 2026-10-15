#!/bin/sh
# Runs named jobs sequentially, one bounded systemd scope per GPU process, on amd-host.
# Copied from faster-candidate-20261015/numerical/run-jobs.sh. Differences: the session directory, the
# unit prefix (qk-), a 900 s scope bound (each job is one model check or one kernel check), and the
# session log also records the CPU load of the concurrent placement C natives (fc-env-*), read only.
# Usage: run-jobs.sh <session label> <jobs file>
# Jobs file: one job per line, "<name> <command...>"; blank lines and # comments are skipped.
# Each job's output goes to out/<name>.log; the session log records the amdgpu error count before
# and after every job, the public contributor's and the concurrent natives' CPU load, exit status
# and duration.
set -u
D=/var/tmp/qk-norm-graph-20261015
export XDG_RUNTIME_DIR=/run/user/$(id -u)
gpuerr(){ journalctl -k --no-pager 2>/dev/null | grep -c -i -E "amdgpu.*(timeout|reset|fault)"; }
load(){
  top -b -n1 -p 4103868 | tail -1 | awk '{print "public-native cpu " $9}'
  for pid in $(pgrep -f 'native-participant.js --contribute   --model' || true); do
    top -b -n1 -p "$pid" | tail -1 | awk -v p="$pid" '{print "concurrent placement-c native " p " cpu " $9}'
  done
}
session=$1; jobs=$2
log=$D/session-$session.log
echo "session $session start $(date -u +%FT%TZ) amdgpu-errors $(gpuerr)" >> $log
grep -v -e '^#' -e '^$' "$jobs" | while read -r name command; do
  load >> $log
  start=$(date +%s)
  timeout 1000 systemd-run --user --scope --quiet --unit=qk-$session-$name -p MemoryHigh=10737418240 -p MemoryMax=12884901888 -p MemorySwapMax=0 -p RuntimeMaxSec=900 \
    sh -c "ulimit -c unlimited; cd $D && exec $command" > $D/out/$name.log 2>&1 < /dev/null
  status=$?
  peak=$(journalctl --user -u qk-$session-$name.scope --no-pager -o cat 2>/dev/null | grep -o "[0-9.]*[KMG] memory peak" | tail -1)
  echo "$name exit=$status seconds=$(( $(date +%s) - start )) at $(date -u +%T) amdgpu-errors $(gpuerr) scope-peak=$peak" >> $log
done
echo "session $session done $(date -u +%FT%TZ) amdgpu-errors $(gpuerr)" >> $log
