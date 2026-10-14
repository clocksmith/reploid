#!/bin/sh
# Run-6 owned native contributor launch, modeled on
# artifacts/completion-qualification-2-20261013/native-launch.sh: a memory-bounded systemd user
# scope (10 GiB high, 12 GiB max, zero swap, 45-minute runtime cap (run-5 coordinator decision, kept for run 6)) so it cannot outlive the run.
# The room capability reaches the contributor only through --room-token-file (mode 0600 file in the
# run directory); --room-token is never passed. Public contributors are never addressed. Piped over ssh:
#   ssh <dest> sh -s -- <amd-host|intel-host> <unit name> <share|noshare> < native-launch.sh
set -eu
alias=$1; unit=$2; share=$3
run=/var/tmp/reploid-signed-completion-journey-run6-20261013
app=/var/tmp/reploid-signed-completion-5-20261013/reploid
model=/var/tmp/doppler-cold-compile-model-20261013
case "$alias" in
  amd-host) state=/var/tmp/reploid-signed-native-metadata-20261012; config=$run/amd-host-stage-1.json ;;
  intel-host) state=/var/tmp/reploid-signed-completion-journey-run1-20261013/intel-state; config=$run/intel-host-stage-2.json ;;
  *) exit 2 ;;
esac
case "$share" in share) files=--share-files ;; noshare) files= ;; *) exit 2 ;; esac
case "$unit" in scj-run6-*) ;; *) exit 2 ;; esac
test -f "$state/identity.json"
test "$(stat -c %a "$run/room-token")" = 600
room=$(cat "$run/room-id")
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
log=$run/$unit.log
test ! -e "$log"
cd "$app"
nohup systemd-run --user --scope --unit="$unit" \
  -p MemoryHigh=10737418240 -p MemoryMax=12884901888 -p MemorySwapMax=0 -p RuntimeMaxSec=2700 \
  /usr/bin/node server/native-participant.js --contribute $files \
  --model qwen-3-5-0-8b-q4k-ehaf16 --model-directory "$model" \
  --cache-directory "$state/cache" --identity-file "$state/identity.json" \
  --rtc-module @roamhq/wrtc --ws-module ws --gpu-module webgpu \
  --origin http://127.0.0.1:29670 --signaling-url ws://127.0.0.1:29670/swarm \
  --room "$room" --room-token-file "$run/room-token" --ordered-config "$config" \
  > "$log" 2>&1 < /dev/null &
sleep 4
echo "active=$(systemctl --user is-active "$unit.scope" || true)"
systemctl --user show "$unit.scope" -p MemoryHigh -p MemoryMax -p MemorySwapMax -p RuntimeMaxUSec -p ActiveEnterTimestamp
echo "pids=$(cat "/sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/app.slice/$unit.scope/cgroup.procs" 2>/dev/null | tr '\n' ' ')"
grep -m1 native-initialized "$log" || head -c 400 "$log"
