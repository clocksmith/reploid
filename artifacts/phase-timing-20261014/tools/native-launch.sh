#!/bin/sh
# Phase-timing measurement: launch one owned native contributor for a placement, modeled on
# signed-completion-journey-20261013/run-6/tools/native-launch.sh. Unchanged final-5 install and model;
# memory-bounded systemd user scope (10 GiB high, 12 GiB max, zero swap, 75-minute runtime cap, a
# measurement coordinator decision: a full prompt-length ladder outlasts run 6's 45 minutes).
# The room capability reaches the contributor only through --room-token-file (0600 file written over
# ssh stdin); --room-token is never passed. Public contributors are never addressed. Piped over ssh:
#   ssh <dest> sh -s -- <amd-host|intel-host> <unit name> <stage config file name> < native-launch.sh
set -eu
alias=$1; unit=$2; stagefile=$3
run=/var/tmp/reploid-phase-timing-run-20261014
app=/var/tmp/reploid-signed-completion-5-20261013/reploid
model=/var/tmp/doppler-cold-compile-model-20261013
case "$alias" in
  amd-host) state=/var/tmp/reploid-signed-native-metadata-20261012 ;;
  intel-host) state=/var/tmp/reploid-signed-completion-journey-run1-20261013/intel-state ;;
  *) exit 2 ;;
esac
case "$unit" in ptm-*) ;; *) exit 2 ;; esac
config=$run/$stagefile
test -f "$config"
test -f "$state/identity.json"
test "$(stat -c %a "$run/room-token")" = 600
room=$(cat "$run/room-id")
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
log=$run/$unit.log
test ! -e "$log"
cd "$app"
nohup systemd-run --user --scope --unit="$unit" \
  -p MemoryHigh=10737418240 -p MemoryMax=12884901888 -p MemorySwapMax=0 -p RuntimeMaxSec=4500 \
  /usr/bin/node server/native-participant.js --contribute \
  --model qwen-3-5-0-8b-q4k-ehaf16 --model-directory "$model" \
  --cache-directory "$state/cache" --identity-file "$state/identity.json" \
  --rtc-module @roamhq/wrtc --ws-module ws --gpu-module webgpu \
  --origin http://127.0.0.1:29670 --signaling-url ws://127.0.0.1:29670/swarm \
  --room "$room" --room-token-file "$run/room-token" --ordered-config "$config" \
  > "$log" 2>&1 < /dev/null &
sleep 4
echo "active=$(systemctl --user is-active "$unit.scope" || true)"
systemctl --user show "$unit.scope" -p MemoryHigh -p MemoryMax -p MemorySwapMax -p RuntimeMaxUSec -p ActiveEnterTimestamp
pids=$(cat "/sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/app.slice/$unit.scope/cgroup.procs" 2>/dev/null | tr '\n' ' ')
echo "pids=$pids"
for p in $pids; do echo "pid $p argv-token-hits $(tr '\0' '\n' < /proc/$p/cmdline | grep -c -F -f "$run/room-token")"; done
for i in $(seq 1 60); do grep -q '"phase":"ready"\|"phase":"failed"' "$log" && break; sleep 2; done
grep partition-state "$log" | tail -1 | cut -c1-90
echo "journal-token-hits $(journalctl --user --since '-10min' --no-pager 2>/dev/null | grep -c -F -f "$run/room-token")"
