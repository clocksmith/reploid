#!/bin/sh
# Placement C envelope run: one owned native stage on amd-host. Copy of
# ../../faster-candidate-20261015/journeys/tools/native-launch.sh (run 8) with these differences:
# - unit prefix fc-env- and this run's directory for logs (/var/tmp/reploid-placement-c-envelope-20261015);
#   the room files, ordered stage configs and both native state directories are run 8's, read only, so the
#   stage peer identities and release checkpoints are the installed ones;
# - optional loopback inspector port (fifth argument, 29991-29999 or none) for harness-side logpoint timing;
#   the product bytes are unchanged and nothing is evaluated in the process unless a probe attaches;
# - optional sixth argument `shape`: preloads this run's userspace UDP shaper (netshape.so) for degradation
#   tests. Shaping is off unless its control file exists; see netshape.c.
# Only warm preparation (the shared Mesa cache) is used. Bounds are unchanged: 10 GiB high, 12 GiB max, zero
# swap, a runtime cap of at most 2 hours, `ulimit -c unlimited`. The room capability reaches the contributor
# only through --room-token-file. Public contributors are never addressed. Piped over ssh:
#   ssh <dest> sh -s -- <amd-host-1|amd-host-2> <unit> <cap seconds> <inspector port|none> [shape] < native-launch.sh
set -eu
alias=$1; unit=$2; cap=$3; inspect=$4; shape=${5:-none}
case "$cap" in ''|*[!0-9]*) exit 2 ;; esac
test "$cap" -le 7200
journey=/var/tmp/reploid-faster-journey-20261015
run=/var/tmp/reploid-placement-c-envelope-20261015
app=/var/tmp/reploid-signed-completion-10-20261015-3/reploid
model=/var/tmp/faster-candidate-20261015/model-final-3
case "$alias" in
  amd-host-1) state=/var/tmp/reploid-signed-native-metadata-20261012; config=$journey/amd-host-stage-1.json ;;
  amd-host-2) state=$journey/amd-stage-2-state; config=$journey/amd-host-stage-2.json ;;
  *) exit 2 ;;
esac
test -f "$state/identity.json"
case "$unit" in fc-env-*) ;; *) exit 2 ;; esac
case "$inspect" in none) flag= ;; 2999[1-9]) flag="--inspect=127.0.0.1:$inspect" ;; *) exit 2 ;; esac
case "$shape" in
  none) preload= ;;
  shape) test -f "$run/netshape.so"; preload="LD_PRELOAD=$run/netshape.so NETSHAPE_CONTROL=$run/netshape.conf NETSHAPE_LOG=$run/$unit.netshape.log " ;;
  *) exit 2 ;;
esac
test "$(sha256sum "$model/manifest.json" | cut -d' ' -f1)" = 548e65597f85e190d6f0edf38c63569b872a61696c28ec95dce031f913e953db
test "$(sha256sum "$app/native-delivery.json" | cut -d' ' -f1)" = a2ee0c631d428b4218283c4f6e4d2b2ab69d17bd9fde326a59aaf94710de7577
test "$(stat -c %a "$journey/room-token")" = 600
room=$(cat "$journey/room-id")
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
mkdir -p "$run"
log=$run/$unit.log
test ! -e "$log"
cd "$app"
nohup systemd-run --user --scope --unit="$unit" \
  -p MemoryHigh=10737418240 -p MemoryMax=12884901888 -p MemorySwapMax=0 -p RuntimeMaxSec=$cap \
  sh -c "ulimit -c unlimited; ${preload}exec /usr/bin/node $flag server/native-participant.js --contribute \
  --model qwen-3-5-0-8b-q4k-ehaf16 --model-directory $model \
  --cache-directory $state/cache --identity-file $state/identity.json \
  --rtc-module @roamhq/wrtc --ws-module ws --gpu-module webgpu \
  --origin http://127.0.0.1:29670 --signaling-url ws://127.0.0.1:29670/swarm \
  --room $room --room-token-file $journey/room-token --ordered-config $config" \
  > "$log" 2>&1 < /dev/null &
sleep 4
echo "unit=$unit active=$(systemctl --user is-active "$unit.scope" || true) inspect=$inspect shape=$shape"
systemctl --user show "$unit.scope" -p MemoryHigh -p MemoryMax -p MemorySwapMax -p RuntimeMaxUSec -p ActiveEnterTimestamp
echo "pids=$(cat "/sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/app.slice/$unit.scope/cgroup.procs" 2>/dev/null | tr '\n' ' ')"
