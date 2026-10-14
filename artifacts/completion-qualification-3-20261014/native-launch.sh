#!/bin/sh
# Campaign 3: start the owned, bounded native provider, loopback delivery/model server and read-only
# host sampler for one placement. Same fixture root, tools and limits as campaign 2's
# native-launch.sh; new receipt directory and server unit name. The native unit keeps campaign 2's name
# reploid-cold-reference-20261013 because the hash-pinned observe-native.js refuses any other scope.
# Public contributors are not addressed.
# Piped over ssh:  ssh <dest> sh -s -- <amd|suby> <attempt dir a|a2|b|...> < native-launch.sh
set -eu
host=${1:?amd-or-suby}; placement=${2:?a-or-b}
case "$host" in amd|suby) ;; *) exit 2 ;; esac
case "$placement" in a|a[0-9]|b|b[0-9]) ;; *) exit 2 ;; esac
root=/var/tmp/reploid-completion-candidate-20261013
tools=/var/tmp/reploid-recurrent-memory-20261013/cold-reference
out=/var/tmp/reploid-completion-qualification-3-20261014/$placement
model=/var/tmp/doppler-cold-compile-model-20261013
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
mkdir -p "$out"
test ! -e "$out/$host-memory.jsonl"
test "$(sha256sum "$tools/observe-native.js" | cut -d' ' -f1)" = b46b38a53afb1e06de5e542e12b78044bff8e022307b06654ea959f88bf96add
test "$(sha256sum "$tools/native-partition-process.js" | cut -d' ' -f1)" = d59c3c2f841dc20f01dd3598357d8457d551e2ce2a22f7adbcae19a2cb4abd02
cd "$root"
nohup systemd-run --user --scope --unit="rq3$placement-server" \
  -p RuntimeMaxSec=1800 \
  env DOPPLER_CHAT_MODEL_DIR="$model" /usr/bin/node delivery-server.js \
  > "$out/$host-server.log" 2>&1 < /dev/null &
nohup systemd-run --user --scope --unit=reploid-cold-reference-20261013 \
  -p MemoryHigh=10737418240 -p MemoryMax=12884901888 -p MemorySwapMax=0 -p RuntimeMaxSec=1800 \
  /usr/bin/node "$tools/observe-native.js" "$tools/native-partition-process.js" \
  "$root/startup-config.json" "$out/$host-memory.jsonl" \
  > "$out/$host-native.log" 2>&1 < /dev/null &
nohup timeout 1800 python3 "$out/observe-host.py" > "$out/$host-host.jsonl" 2>&1 < /dev/null &
sleep 4
systemctl --user is-active reploid-cold-reference-20261013.scope "rq3$placement-server.scope"
echo "pids native=$(cat /sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/app.slice/reploid-cold-reference-20261013.scope/cgroup.procs 2>/dev/null | tr '\n' ' ') server=$(cat /sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/app.slice/rq3$placement-server.scope/cgroup.procs 2>/dev/null | tr '\n' ' ')"
head -c 300 "$out/$host-memory.jsonl"; echo
head -c 400 "$out/$host-native.log"; echo
head -c 200 "$out/$host-server.log"; echo
