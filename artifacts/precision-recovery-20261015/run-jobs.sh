#!/bin/bash
# Runs named jobs sequentially on amd-host, one bounded systemd user scope per GPU process.
# Derived from qk-norm-graph-20261015/run-jobs.sh. Differences:
#   - each job names a private Mesa shader cache directory (mesa/<cache>): a new name is a cold
#     compile, a reused name is warm;
#   - before each job: stop the session if the amdgpu error count differs from the baseline (50),
#     MemAvailable is under 24 GiB, or user.slice memory pressure (some avg10) exceeds 5;
#   - during each job a watchdog samples the scope every 2 s and kills it (recorded) before it can sit
#     throttled: at 90% of MemoryHigh, on any memory.events "high" event, or scope pressure avg10 > 10;
#   - after each job: amdgpu count, systemd-oomd lines since the session start, scope peak.
# Scope: MemoryHigh 14 GiB, MemoryMax 16 GiB, no swap, at most 1,500 s (cold paired compiles keep
# Mesa's compiler heap, measured at 5.6-6.7 GB per stage process on this host).
# Usage: run-jobs.sh <session label> <jobs file>
# Jobs file: "<name> <mesa cache name> <command...>"; blank lines and # comments are skipped.
set -u
D=/var/tmp/precision-recovery-20261015
export XDG_RUNTIME_DIR=/run/user/$(id -u)
BASE_GPU_ERRORS=50
HIGH=$((14 * 1024 * 1024 * 1024)); MAX=$((16 * 1024 * 1024 * 1024)); KILL_AT=$((HIGH / 10 * 9))
gpuerr(){ journalctl -k --no-pager 2>/dev/null | grep -c -i -E "amdgpu.*(timeout|reset|fault)"; }
avail(){ awk '/MemAvailable/{print int($2 / 1024 / 1024)}' /proc/meminfo; }
pressure(){ awk '/^some/{split($2, a, "="); print a[2]}' "$1"; }
session=$1; jobs=$2; log=$D/session-$session.log; since=$(date '+%Y-%m-%d %H:%M:%S')
echo "session $session start $(date -u +%FT%TZ) amdgpu-errors $(gpuerr) oomd-lines-48h $(journalctl --no-pager --since -48h 2>/dev/null | grep -ic oomd) avail-GiB $(avail) user.slice-some-avg10 $(pressure /sys/fs/cgroup/user.slice/memory.pressure)" >> $log
while read -r name cache command; do
  case "$name" in ''|'#'*) continue ;; esac
  e=$(gpuerr); a=$(avail); p=$(pressure /sys/fs/cgroup/user.slice/memory.pressure)
  if [ "$e" != "$BASE_GPU_ERRORS" ]; then echo "STOP before $name: amdgpu errors $e != $BASE_GPU_ERRORS" >> $log; break; fi
  if [ "$a" -lt 24 ]; then echo "STOP before $name: MemAvailable $a GiB < 24" >> $log; break; fi
  if awk -v p="$p" 'BEGIN { exit !(p > 5) }'; then echo "STOP before $name: user.slice pressure some avg10 $p" >> $log; break; fi
  echo "$name pre avail-GiB $a user.slice-some-avg10 $p public-native-cpu $(top -b -n1 -p 4103868 | tail -1 | awk '{print $9}') mesa $cache" >> $log
  unit=pr-$session-$name
  mkdir -p $D/mesa/$cache
  start=$(date +%s)
  systemd-run --user --scope --quiet --unit=$unit -p MemoryHigh=$HIGH -p MemoryMax=$MAX -p MemorySwapMax=0 -p RuntimeMaxSec=1500 \
    env MESA_SHADER_CACHE_DIR=$D/mesa/$cache sh -c "cd $D && exec $command" > $D/out/$name.log 2>&1 < /dev/null &
  pid=$!
  cg=''; peak=0; stopped=''
  while kill -0 $pid 2>/dev/null; do
    sleep 2
    [ -z "$cg" ] && cg=$(systemctl --user show -p ControlGroup --value $unit.scope 2>/dev/null)
    [ -z "$cg" ] && continue
    f=/sys/fs/cgroup$cg
    [ -r $f/memory.current ] || continue
    cur=$(cat $f/memory.current 2>/dev/null || echo 0)
    if [ -r $f/memory.peak ]; then peak=$(cat $f/memory.peak 2>/dev/null || echo $peak)
    elif [ "${cur:-0}" -gt "$peak" ]; then peak=$cur; fi
    high=$(awk '/^high /{print $2}' $f/memory.events 2>/dev/null)
    sp=$(pressure $f/memory.pressure 2>/dev/null)
    if [ "${cur:-0}" -gt $KILL_AT ] || [ "${high:-0}" -gt 0 ] || awk -v p="${sp:-0}" 'BEGIN { exit !(p > 10) }'; then
      stopped="watchdog memory.current=$cur high-events=${high:-0} scope-some-avg10=${sp:-0}"
      systemctl --user kill --signal=SIGKILL $unit.scope
      break
    fi
  done
  wait $pid; status=$?
  echo "$name exit=$status seconds=$(( $(date +%s) - start )) at $(date -u +%T) amdgpu-errors $(gpuerr) oomd-lines-since-start $(journalctl --no-pager --since "$since" 2>/dev/null | grep -ic oomd) scope-peak-bytes=$peak ${stopped:+STOPPED $stopped}" >> $log
  if [ -n "$stopped" ]; then echo "STOP session after $name: $stopped" >> $log; break; fi
  if [ "$(gpuerr)" != "$BASE_GPU_ERRORS" ]; then echo "STOP session after $name: new amdgpu error" >> $log; break; fi
done < "$jobs"
echo "session $session done $(date -u +%FT%TZ) amdgpu-errors $(gpuerr) oomd-lines-since-start $(journalctl --no-pager --since "$since" 2>/dev/null | grep -ic oomd)" >> $log
