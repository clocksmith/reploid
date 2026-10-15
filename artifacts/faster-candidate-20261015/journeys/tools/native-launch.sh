#!/bin/sh
# Run-8 (placement C) owned native contributor launch on amd-host. Copy of
# signed-completion-journey-20261013/run-7/tools/native-launch.sh with these differences:
# - two native stages on amd-host: alias amd-host-1 (stage 1, layers 8-15, the existing amd-host native
#   state; it held release checkpoint 5 before run 8) and amd-host-2 (stage 2, layers 16-23 and the output head,
#   a new state directory whose identity the participant creates at first start);
# - the final-10 install (pass 3, the chosen rolled variant: /var/tmp/reploid-signed-completion-10-20261015-3/reploid;
#   pass 2 used -2 with model-final-2) and the combined kernel model directory
#   (/var/tmp/faster-candidate-20261015/model-final-3: manifest 548e6559..., weight
#   shards hard-linked to the unchanged Capsule model's files, because the native participant refuses model
#   files whose real path leaves the approved directory, as attempt 1's symlinked directory showed);
# - `ulimit -c unlimited`, so a crash leaves a core;
# - optional fifth argument `cold`: a new empty private Mesa shader cache (MESA_SHADER_CACHE_DIR) for this
#   unit only, to measure cold pipeline preparation without touching the shared cache.
# Bounds are unchanged: 10 GiB high, 12 GiB max, zero swap, 45-minute cap unless a cap of at most 2 hours
# is given. The room capability reaches the contributor only through --room-token-file. Public
# contributors are never addressed. Piped over ssh:
#   ssh <dest> sh -s -- <amd-host-1|amd-host-2> <unit name> <share|noshare> [cap seconds] [cold|warm] < native-launch.sh
set -eu
alias=$1; unit=$2; share=$3; cap=${4:-2700}; cache=${5:-warm}
case "$cap" in ''|*[!0-9]*) exit 2 ;; esac
test "$cap" -le 7200
run=/var/tmp/reploid-faster-journey-20261015
app=/var/tmp/reploid-signed-completion-10-20261015-3/reploid
model=/var/tmp/faster-candidate-20261015/model-final-3
case "$alias" in
  amd-host-1) state=/var/tmp/reploid-signed-native-metadata-20261012; config=$run/amd-host-stage-1.json ;;
  amd-host-2) state=$run/amd-stage-2-state; config=$run/amd-host-stage-2.json ;;
  *) exit 2 ;;
esac
test -f "$state/identity.json"
case "$share" in share) files=--share-files ;; noshare) files= ;; *) exit 2 ;; esac
case "$unit" in fc-run8-*) ;; *) exit 2 ;; esac
case "$cache" in
  warm) mesa= ;;
  cold) mesa="$run/mesa-cold-$unit"; mkdir "$mesa" ;;
  *) exit 2 ;;
esac
test "$(sha256sum "$model/manifest.json" | cut -d' ' -f1)" = 548e65597f85e190d6f0edf38c63569b872a61696c28ec95dce031f913e953db
test "$(sha256sum "$app/native-delivery.json" | cut -d' ' -f1)" = a2ee0c631d428b4218283c4f6e4d2b2ab69d17bd9fde326a59aaf94710de7577
test "$(stat -c %a "$run/room-token")" = 600
room=$(cat "$run/room-id")
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
log=$run/$unit.log
test ! -e "$log"
cd "$app"
nohup systemd-run --user --scope --unit="$unit" \
  -p MemoryHigh=10737418240 -p MemoryMax=12884901888 -p MemorySwapMax=0 -p RuntimeMaxSec=$cap \
  sh -c "ulimit -c unlimited; ${mesa:+MESA_SHADER_CACHE_DIR=$mesa }exec /usr/bin/node server/native-participant.js --contribute $files \
  --model qwen-3-5-0-8b-q4k-ehaf16 --model-directory $model \
  --cache-directory $state/cache --identity-file $state/identity.json \
  --rtc-module @roamhq/wrtc --ws-module ws --gpu-module webgpu \
  --origin http://127.0.0.1:29670 --signaling-url ws://127.0.0.1:29670/swarm \
  --room $room --room-token-file $run/room-token --ordered-config $config" \
  > "$log" 2>&1 < /dev/null &
sleep 4
echo "active=$(systemctl --user is-active "$unit.scope" || true) cache=$cache"
systemctl --user show "$unit.scope" -p MemoryHigh -p MemoryMax -p MemorySwapMax -p RuntimeMaxUSec -p ActiveEnterTimestamp
echo "pids=$(cat "/sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/app.slice/$unit.scope/cgroup.procs" 2>/dev/null | tr '\n' ' ')"
grep -m1 native-initialized "$log" || head -c 400 "$log"
