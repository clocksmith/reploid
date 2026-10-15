#!/bin/sh
# One bounded GPU step on intel-host: a systemd user scope (MemoryHigh 10 GiB, MemoryMax 12 GiB, no swap, a runtime
# cap of at most 3,600 s) with `ulimit -c unlimited`, and the kernel i915 hang/reset count read before and after.
# Optionally interrupts the step: once the log shows the named pipeline being prepared, it waits the given delay and
# sends the signal to this step's own scope (nothing else is addressed).
# Prints one JSON line. Piped over ssh:
#   ssh <intel-host> sh -s -- <unit ir-*> <cap seconds> <log> <none|SIGTERM|SIGKILL> <key pattern> <delay s> <command...> < run-scope.sh
set -u
unit=$1; cap=$2; log=$3; signal=$4; pattern=$5; delay=$6; shift 6
case "$unit" in ir-*) ;; *) echo "unit must start with ir-" >&2; exit 2 ;; esac
case "$cap" in ''|*[!0-9]*) exit 2 ;; esac
test "$cap" -le 3600 || exit 2
case "$signal" in none|SIGTERM|SIGKILL) ;; *) exit 2 ;; esac
test ! -e "$log" || { echo "log exists: $log" >&2; exit 2; }
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
count() { journalctl -k --no-pager 2>/dev/null | grep -c -i -E "i915.*(fence expiration|gpu hang|resetting)"; }
before=$(count); start=$(date +%s.%N); signalled=null
systemd-run --user --scope --quiet --unit="$unit" -p MemoryHigh=10737418240 -p MemoryMax=12884901888 \
  -p MemorySwapMax=0 -p RuntimeMaxSec="$cap" sh -c 'ulimit -c unlimited; exec "$@"' sh "$@" > "$log" 2>&1 < /dev/null &
runner=$!
if [ "$signal" != none ]; then
  while kill -0 "$runner" 2>/dev/null && ! grep -q "\"event\":\"pipeline\".*\"status\":\"preparing\".*$pattern" "$log"; do sleep 0.2; done
  if kill -0 "$runner" 2>/dev/null; then
    sleep "$delay"
    signalled="\"$(date -u +%FT%T.%3NZ)\""
    systemctl --user kill --signal="$signal" "$unit.scope"
  fi
fi
wait "$runner"; status=$?
end=$(date +%s.%N); after=$(count)
peak=$(journalctl --user -u "$unit.scope" --no-pager -o cat 2>/dev/null | grep -o "[0-9.]*[KMG] memory peak" | tail -1)
printf '{"unit":"%s","exit":%s,"seconds":%s,"signal":"%s","signalledAt":%s,"i915Before":%s,"i915After":%s,"memoryPeak":"%s"}\n' \
  "$unit" "$status" "$(awk "BEGIN{printf \"%.1f\", $end - $start}")" "$signal" "$signalled" "$before" "$after" "$peak"
