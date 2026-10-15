#!/bin/sh
# Replace both owned amd-host native stages before their scope runtime cap: graceful stop of the current
# units (native-stop.sh), launch of new units with the given suffix (native-launch.sh, warm preparation, 2-hour
# cap, inspector ports 29991/29992, optional shaper), wait for both natives to report ready, then wait for the
# stage 0 coordinator to offer the ready ordered route again. The SSH destination comes from the environment
# (FC_ENV_SSH_AMD), never from files.
# Usage: restart-natives.sh <old suffix|none> <new suffix> <none|shape> <log>
set -eu
here=$(cd "$(dirname "$0")" && pwd)
old=$1; new=$2; shape=$3; log=$4
R=/var/tmp/reploid-placement-c-envelope-20261015
{
  echo "== restart $(date -u +%Y-%m-%dT%H:%M:%SZ) old=$old new=$new shape=$shape"
  if [ "$old" != none ]; then
    for unit in fc-env-native-1-$old fc-env-native-2-$old; do
      ssh -o BatchMode=yes "$FC_ENV_SSH_AMD" sh -s -- "$unit" < "$here/native-stop.sh"; echo
    done
  fi
  ssh -o BatchMode=yes "$FC_ENV_SSH_AMD" sh -s -- amd-host-1 "fc-env-native-1-$new" 7200 29991 "$shape" < "$here/native-launch.sh" | grep -E "unit=|pids=|RuntimeMax"
  ssh -o BatchMode=yes "$FC_ENV_SSH_AMD" sh -s -- amd-host-2 "fc-env-native-2-$new" 7200 29992 "$shape" < "$here/native-launch.sh" | grep -E "unit=|pids=|RuntimeMax"
  for unit in fc-env-native-1-$new fc-env-native-2-$new; do
    ssh -o BatchMode=yes "$FC_ENV_SSH_AMD" sh -s -- "$unit" <<'REMOTE'
R=/var/tmp/reploid-placement-c-envelope-20261015; unit=$1
for i in $(seq 1 150); do grep -q '"phase":"ready"\|"phase":"failed"' "$R/$unit.log" && break; sleep 2; done
echo "$unit $(grep -o '"event":"partition-state","phase":"[a-z]*","error":[^,]*' "$R/$unit.log" | tail -1)"
echo "journal-token-hits $(journalctl --user --since '-10min' --no-pager 2>/dev/null | grep -c -F -f /var/tmp/reploid-faster-journey-20261015/room-token)"
for p in $(cat /sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/app.slice/$unit.scope/cgroup.procs); do
  echo "pid $p argv-token-hits $(tr '\0' '\n' < /proc/$p/cmdline | grep -c -F -f /var/tmp/reploid-faster-journey-20261015/room-token)"
done
REMOTE
  done
  sleep 10
  cd /Users/xyz/deco/reploid/artifacts/signed-completion-journey-20261013/run-7/tools
  node observe-coordinator.mjs http://127.0.0.1:29671 http://127.0.0.1:29670/ 300000 | cut -c1-600
  echo "$new" > "$R/natives-suffix"
  date -u +%s > "$R/natives-started"
} >> "$log" 2>&1
tail -12 "$log"
