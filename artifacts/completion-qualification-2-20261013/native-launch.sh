#!/bin/sh
# Start the owned, bounded native provider and loopback delivery/model server for
# one fresh campaign. Receipts go to a new directory; the frozen fixture root and
# every earlier receipt stay untouched. Public contributors are not addressed.
set -eu
host=${1:?amd-or-suby}
case "$host" in amd|suby) ;; *) exit 2 ;; esac
root=/var/tmp/reploid-completion-candidate-20261013
tools=/var/tmp/reploid-recurrent-memory-20261013/cold-reference
out=/var/tmp/reploid-completion-qualification-2-20261013
model=/var/tmp/doppler-cold-compile-model-20261013
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
mkdir -p "$out"
test ! -e "$out/$host-memory.jsonl"
test "$(sha256sum "$tools/observe-native.js" | cut -d' ' -f1)" = b46b38a53afb1e06de5e542e12b78044bff8e022307b06654ea959f88bf96add
test "$(sha256sum "$tools/native-partition-process.js" | cut -d' ' -f1)" = d59c3c2f841dc20f01dd3598357d8457d551e2ce2a22f7adbcae19a2cb4abd02
cd "$root"
nohup systemd-run --user --scope --unit=reploid-completion-qualification-server-20261013 \
  -p RuntimeMaxSec=1800 \
  env DOPPLER_CHAT_MODEL_DIR="$model" /usr/bin/node delivery-server.js \
  > "$out/$host-server.log" 2>&1 < /dev/null &
nohup systemd-run --user --scope --unit=reploid-cold-reference-20261013 \
  -p MemoryHigh=10737418240 -p MemoryMax=12884901888 -p MemorySwapMax=0 -p RuntimeMaxSec=1800 \
  /usr/bin/node "$tools/observe-native.js" "$tools/native-partition-process.js" \
  "$root/startup-config.json" "$out/$host-memory.jsonl" \
  > "$out/$host-native.log" 2>&1 < /dev/null &
sleep 4
systemctl --user is-active reploid-cold-reference-20261013.scope reploid-completion-qualification-server-20261013.scope
head -c 300 "$out/$host-memory.jsonl"; echo
head -c 400 "$out/$host-native.log"; echo
head -c 200 "$out/$host-server.log"; echo
