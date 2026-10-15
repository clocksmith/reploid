#!/bin/sh
# Runs the deliberate degradation conditions in order (run-degradation.mjs), one at a time, after confirming
# that the natives run with the shaper preloaded and that no control file is present. After each condition it
# records both natives' last partition state and the user-slice memory pressure, and checks that the control
# file is gone. SSH destination from FC_ENV_SSH_AMD (environment only).
# Conditions (trimmed to the decisive two at the parent session's direction): label mode delay jitter sendLoss%
# recvLoss% outageMs stallTunnel. Prompt: the matrix's p56-n24 (63-token answer).
# Usage: run-degradation.sh <out dir> <run log>
set -u
here=$(cd "$(dirname "$0")" && pwd)
out=$1; runlog=$2
R=/var/tmp/reploid-placement-c-envelope-20261015
while read -r label mode delay jitter sl rl outage stall; do
  case "$label" in ''|'#'*) continue ;; esac
  [ -e "$R/degradation-stop" ] && { echo "stop file present before $label" >> "$runlog"; break; }
  [ -e "$out/$label.json" ] && { echo "skip $label (exists)" >> "$runlog"; continue; }
  guard=$(ssh -n -o BatchMode=yes "$FC_ENV_SSH_AMD" "awk '/^some/{print \$2}' /sys/fs/cgroup/user.slice/memory.pressure; test ! -e $R/netshape.conf && echo control-absent")
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) start $label $mode delay=$delay jitter=$jitter loss=$sl/$rl outage=$outage stall=$stall guard=$(echo $guard | tr '\n' ' ')" >> "$runlog"
  node "$here/run-degradation.mjs" "$here/journey-config.json" "$label" "$mode" "$delay" "$jitter" "$sl" "$rl" "$outage" "$stall" "$here/../prompts/p56-n24.txt" "$out/$label.json" >> "$runlog" 2>&1 < /dev/null
  after=$(ssh -n -o BatchMode=yes "$FC_ENV_SSH_AMD" "test ! -e $R/netshape.conf && echo control-absent; for u in fc-env-native-1 fc-env-native-2; do tail -1 \$(ls -t $R/\$u-*.netshape.log | head -1); done")
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) end $label $(echo $after | tr '\n' ' ')" >> "$runlog"
done <<'CONDITIONS'
d1-delay-150-jitter-50 whole 150 50 0 0 0 no
d2-outage-45s mid 0 0 0 0 45000 yes
CONDITIONS
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) degradation done" >> "$runlog"
