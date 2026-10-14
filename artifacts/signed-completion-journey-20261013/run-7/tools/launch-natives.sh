#!/bin/sh
# Run-7: launch fresh owned native scopes on both hosts, then check (from the 0600 token file, never argv)
# that the token is absent from every owned native's argv and from the user journal, and wait for ready.
# SSH destinations come from the environment (SCJ_RUN7_SSH_AMD, SCJ_RUN7_SSH_INTEL), never from files.
# Usage: launch-natives.sh <amd unit> <intel unit> [cap seconds]
set -eu
here=$(cd "$(dirname "$0")" && pwd)
cap=${3:-2700}
for pair in "amd-host $SCJ_RUN7_SSH_AMD $1" "intel-host $SCJ_RUN7_SSH_INTEL $2"; do
  set -- $pair
  echo "== $1 $3"
  ssh -o BatchMode=yes "$2" sh -s -- "$1" "$3" noshare "$cap" < "$here/native-launch.sh" | grep -E "active=|pids=|ActiveEnter|RuntimeMax"
  ssh -o BatchMode=yes "$2" sh -s -- "$3" <<'EOF'
R=/var/tmp/reploid-signed-completion-journey-run7-20261014; unit=$1
export XDG_RUNTIME_DIR=/run/user/$(id -u)
for i in $(seq 1 45); do grep -q '"phase":"ready"\|"phase":"failed"' "$R/$unit.log" && break; sleep 2; done
grep partition-state "$R/$unit.log" | tail -1 | cut -c1-90
echo "journal-token-hits $(journalctl --user --since '-10min' --no-pager 2>/dev/null | grep -c -F -f $R/room-token)"
for p in $(cat /sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/app.slice/$unit.scope/cgroup.procs); do
  echo "pid $p argv-token-hits $(tr '\0' '\n' < /proc/$p/cmdline | grep -c -F -f $R/room-token)"
done
EOF
done
