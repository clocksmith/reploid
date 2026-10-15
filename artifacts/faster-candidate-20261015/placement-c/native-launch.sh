#!/bin/sh
# Placement C: start the owned, bounded loopback delivery/model server, two native providers (stage 1,
# layers 8-15, and stage 2, layers 16-23 with the output head) and a read-only host sampler on
# amd-host. Same fixture tools and limits as campaign 3's native-launch.sh. Differences:
# - fixture root /var/tmp/reploid-faster-candidate-20261015 and model directory
#   /var/tmp/faster-candidate-20261015/model-final (manifest 64d74719..., shards linked to the
#   unchanged Capsule model);
# - two natives, each in its own scope (fc-c<attempt>-native-1 / -2) with its own inspector port
#   (29992 / 29996), through observe-native-c.js (the campaign supervisor with the scope name and
#   port as arguments);
# - `ulimit -c unlimited` before each native, so a crash leaves a core;
# - the host sampler also records amdgpu VRAM/GTT use and MemAvailable.
# Public contributors are not addressed.
# Piped over ssh:  ssh <amd-host> sh -s -- <attempt dir: o|o2|... for load-only observation, c|c2|... for capture> < native-launch.sh
set -eu
attempt=${1:?attempt}
case "$attempt" in c|c[0-9]|o|o[0-9]|pu1|pu2|pr1|pr2) ;; *) exit 2 ;; esac
# Attempts o3 and c4 to c8 qualify generation 3, the chosen rolled state variant (root -3, model-final-3).
# Attempts o and c use generation 1 (manifest 64d74719...); o2, c2 and later use generation 2 (manifest
# c6220c6a..., the declared Q/K head-norm program; root -2 and model-final-2, whose shards are hard links).
case "$attempt" in
  o|c) root=/var/tmp/reploid-faster-candidate-20261015; model=/var/tmp/faster-candidate-20261015/model-final
       manifest=64d747193bd983feb3d25eea6227284c6e979ea35c7cb874a3b0a0a582c2acbd ;;
  pr1|pr2|o3|c4|c5|c6|c7|c8) root=/var/tmp/reploid-faster-candidate-20261015-3; model=/var/tmp/faster-candidate-20261015/model-final-3
     manifest=548e65597f85e190d6f0edf38c63569b872a61696c28ec95dce031f913e953db ;;
  *) root=/var/tmp/reploid-faster-candidate-20261015-2; model=/var/tmp/faster-candidate-20261015/model-final-2
     manifest=c6220c6aefef7006aa2b3bc3c89932d61788340597c9abf055d27e8cdd1767fd ;;
esac
# Variant-choice preparation measurements (pu1/pu2 unrolled, pr1/pr2 rolled): each native gets a private
# Mesa shader cache per variant and stage; attempt 1 requires it new and empty (cold), attempt 2 reuses it
# (warm). Other attempts use the shared cache.
mesa=
case "$attempt" in
  pu1|pr1) variant=${attempt%1}; test ! -e "/var/tmp/faster-candidate-20261015/placement-c/mesa-$variant-1"; mesa=1 ;;
  pu2|pr2) variant=${attempt%2}; test -d "/var/tmp/faster-candidate-20261015/placement-c/mesa-$variant-1"; mesa=1 ;;
esac
# Attempts o, c, o2 and c2 keep campaign 3's limits (1,800 s scope, 1,740,000 ms provider deadline); c2 ran
# past that deadline during mac-host network stalls, so c3 onward use a 3,600 s scope and 3,540,000 ms.
case "$attempt" in o|c|o2|c2) cap=1800; deadline=1740000 ;; *) cap=3600; deadline=3540000 ;; esac
tools=/var/tmp/reploid-recurrent-memory-20261013/cold-reference
own=/var/tmp/faster-candidate-20261015/placement-c
out=/var/tmp/faster-candidate-20261015/placement-c/$attempt
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
mkdir -p "$out"
test ! -e "$out/native-1-memory.jsonl"
test "$(sha256sum "$tools/native-partition-process.js" | cut -d' ' -f1)" = d59c3c2f841dc20f01dd3598357d8457d551e2ce2a22f7adbcae19a2cb4abd02
test "$(sha256sum "$model/manifest.json" | cut -d' ' -f1)" = "$manifest"
cd "$root"
nohup systemd-run --user --scope --unit="fc-$attempt-server" \
  -p RuntimeMaxSec=3600 \
  env DOPPLER_CHAT_MODEL_DIR="$model" /usr/bin/node delivery-server.js \
  > "$out/server.log" 2>&1 < /dev/null &
for n in 1 2; do
  port=$([ "$n" = 1 ] && echo 29992 || echo 29996)
  nohup systemd-run --user --scope --unit="fc-$attempt-native-$n" \
    -p MemoryHigh=10737418240 -p MemoryMax=12884901888 -p MemorySwapMax=0 -p RuntimeMaxSec=$cap \
    sh -c "ulimit -c unlimited; ${mesa:+mkdir -p $own/mesa-$variant-$n; MESA_SHADER_CACHE_DIR=$own/mesa-$variant-$n }exec /usr/bin/node $own/observe-native-c.js $tools/native-partition-process.js $root/startup-config.json $out/native-$n-memory.jsonl fc-$attempt-native-$n $port $deadline" \
    > "$out/native-$n.log" 2>&1 < /dev/null &
done
nohup timeout 3600 python3 "$own/observe-host-c.py" > "$out/host.jsonl" 2>&1 < /dev/null &
sleep 5
systemctl --user is-active "fc-$attempt-native-1.scope" "fc-$attempt-native-2.scope" "fc-$attempt-server.scope"
for unit in "fc-$attempt-native-1" "fc-$attempt-native-2" "fc-$attempt-server"; do
  echo "$unit pids=$(cat /sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/app.slice/$unit.scope/cgroup.procs 2>/dev/null | tr '\n' ' ')"
done
head -c 300 "$out/native-1-memory.jsonl"; echo
head -c 300 "$out/native-2-memory.jsonl"; echo
head -c 400 "$out/native-1.log"; echo
head -c 200 "$out/server.log"; echo
