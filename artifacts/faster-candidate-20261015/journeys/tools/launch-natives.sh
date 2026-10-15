#!/bin/sh
# Run-8 (placement C): launch the two owned native stages on amd-host, then check (from the 0600 token file,
# never argv) that the token is absent from every owned native's argv and from the user journal, and wait
# for ready. Copy of run-7/tools/launch-natives.sh; differences: both natives are on amd-host (aliases
# amd-host-1 and amd-host-2), the run directory, and an optional cache mode (cold|warm) passed through.
# The SSH destination comes from the environment (FC_RUN8_SSH_AMD), never from files.
# Usage: launch-natives.sh <stage-1 unit> <stage-2 unit> [cap seconds] [cold|warm]
set -eu
here=$(cd "$(dirname "$0")" && pwd)
cap=${3:-2700}; cache=${4:-warm}
units="$1 $2"
for pair in "amd-host-1 $1" "amd-host-2 $2"; do
  set -- $pair
  echo "== $1 $2"
  ssh -o BatchMode=yes "$FC_RUN8_SSH_AMD" sh -s -- "$1" "$2" noshare "$cap" "$cache" < "$here/native-launch.sh" | grep -E "active=|pids=|ActiveEnter|RuntimeMax"
done
for unit in $units; do
  ssh -o BatchMode=yes "$FC_RUN8_SSH_AMD" sh -s -- "$unit" <<'REMOTE'
R=/var/tmp/reploid-faster-journey-20261015; unit=$1
export XDG_RUNTIME_DIR=/run/user/$(id -u)
for i in $(seq 1 150); do grep -q '"phase":"ready"\|"phase":"failed"' "$R/$unit.log" && break; sleep 2; done
grep partition-state "$R/$unit.log" | tail -1 | cut -c1-160
echo "journal-token-hits $(journalctl --user --since '-10min' --no-pager 2>/dev/null | grep -c -F -f $R/room-token)"
for p in $(cat /sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/app.slice/$unit.scope/cgroup.procs); do
  echo "pid $p argv-token-hits $(tr '\0' '\n' < /proc/$p/cmdline | grep -c -F -f $R/room-token)"
done
REMOTE
done
