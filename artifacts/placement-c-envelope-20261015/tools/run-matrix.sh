#!/bin/sh
# Runs envelope-matrix cells in order, one at a time (run-cell.mjs). Before each cell it checks the owned
# natives' remaining scope time and replaces them (restart-natives.sh) when less than the cell's worst case
# (answer deadline + 60 s harness margin + 300 s for setup and settlement) remains. One line per cell is
# appended to the run log. Cells: lines "<label> <prompt file> <requesters>" in the cell list.
# Usage: run-matrix.sh <cell list> <out dir> <run log>
set -u
here=$(cd "$(dirname "$0")" && pwd)
list=$1; outdir=$2; runlog=$3
R=/var/tmp/reploid-placement-c-envelope-20261015
while read -r label prompt n; do
  case "$label" in ''|'#'*) continue ;; esac
  [ -e "$R/matrix-stop" ] && { echo "stop file present before $label" >> "$runlog"; break; }
  if [ -e "$outdir/$label.json" ]; then echo "skip $label (exists)" >> "$runlog"; continue; fi
  started=$(cat "$R/natives-started"); suffix=$(cat "$R/natives-suffix")
  remaining=$((7200 - ($(date -u +%s) - started)))
  if [ "$remaining" -lt 1300 ]; then
    next=$((suffix + 1))
    sh "$here/restart-natives.sh" "$suffix" "$next" none "$outdir/restarts.log" > /dev/null < /dev/null
  fi
  # Memory guard (parent session warning about systemd-oomd): stop rather than throttle.
  guard=$(ssh -n -o BatchMode=yes "$FC_ENV_SSH_AMD" 'p=$(awk "/^some/{split(\$2,a,\"=\"); print a[2]}" /sys/fs/cgroup/user.slice/memory.pressure); m=0; for f in /sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/app.slice/fc-env-native-*.scope/memory.current; do v=$(cat $f); [ $v -gt $m ] && m=$v; done; echo "$p $m"')
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) guard userSlicePressureAvg10=${guard% *} largestNativeScopeBytes=${guard#* }" >> "$runlog"
  if awk -v g="$guard" 'BEGIN{split(g,a," "); exit !(a[1] > 20 || a[2] > 9663676416)}'; then echo "memory guard stop before $label" >> "$runlog"; break; fi
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) start $label $prompt $n natives=$(cat "$R/natives-suffix")" >> "$runlog"
  node "$here/run-cell.mjs" "$here/journey-config.json" "$here/../prompts/$prompt" "$n" "$outdir/$label.json" "$label" >> "$runlog" 2>&1 < /dev/null
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) end $label" >> "$runlog"
done < "$list"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) matrix done" >> "$runlog"
