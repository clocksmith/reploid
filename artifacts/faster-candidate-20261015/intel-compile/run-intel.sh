#!/bin/sh
# Bounded side measurement on intel-host (not a gate): cold and warm pipeline creation cost of the
# recurrent-state programs with compile-cost.mjs (unchanged from paired-kernel-optimization-20261014),
# each in its own bounded scope (10 GiB high, 12 GiB max, zero swap, 1,800 s cap) with core dumps on.
# Every job uses a private Mesa shader cache under this directory (MESA_SHADER_CACHE_DIR), never the shared
# one, so an interrupted compile cannot leave a NIR-without-binary entry in the shared cache
# (native-crash-20261014). Cold = a new empty private cache; warm = the same private cache again.
# The i915 guard runs separately from mac-host. Usage (piped): ssh <intel-host> sh -s < run-intel.sh
set -u
D=/var/tmp/faster-candidate-20261015-intel
export XDG_RUNTIME_DIR=/run/user/$(id -u)
W=/var/tmp/reploid-signed-completion-9-20261014/reploid/node_modules/webgpu
K=$D/pkg/src/gpu/kernels
count(){ journalctl -k --no-pager 2>/dev/null | grep -c -i -E "i915.*(fence expiration|gpu hang|resetting)"; }
log=$D/session.log
echo "start $(date -u +%FT%TZ) i915=$(count)" >> $log
run(){ name=$1; cache=$2; wgsl=$3; consts=$4
  mkdir -p "$D/cache-$cache"
  start=$(date +%s)
  timeout 1900 systemd-run --user --scope --quiet --unit=fc-intel-$name -p MemoryHigh=10737418240 -p MemoryMax=12884901888 \
    -p MemorySwapMax=0 -p RuntimeMaxSec=1800 sh -c "ulimit -c unlimited; cd $D && MESA_SHADER_CACHE_DIR=$D/cache-$cache exec /usr/bin/node compile-cost.mjs $W $wgsl '$consts' $name" \
    > $D/out-$name.log 2>&1 < /dev/null
  status=$?
  peak=$(journalctl --user -u fc-intel-$name.scope --no-pager -o cat 2>/dev/null | grep -o "[0-9.]*[MG] memory peak" | tail -1)
  echo "$name exit=$status seconds=$(( $(date +%s) - start )) peak=$peak at $(date -u +%T) i915=$(count)" >> $log
  [ -e $D/stop ] && exit 0
}
run state-shipped-cold shipped $K/gated_delta_state_paired.wgsl '{"WORKGROUP_SIZE":128}'
run state-shipped-warm shipped $K/gated_delta_state_paired.wgsl '{"WORKGROUP_SIZE":128}'
run state-sliced-cold sliced $K/gated_delta_state_paired_sliced.wgsl '{"WORKGROUP_SIZE":256,"K_SLICES":16}'
run state-sliced-warm sliced $K/gated_delta_state_paired_sliced.wgsl '{"WORKGROUP_SIZE":256,"K_SLICES":16}'
echo "done $(date -u +%FT%TZ) i915=$(count)" >> $log
