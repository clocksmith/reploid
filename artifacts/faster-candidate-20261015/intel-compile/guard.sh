#!/bin/sh
# i915 guard for the intel-host side measurement (run-7/tools/i915-guard.sh pattern): polls intel-host's
# kernel journal every 5 s; on any i915 "Fence expiration", "GPU HANG" or "Resetting" line beyond the
# baseline count, it creates the run's stop file and stops the owned fc-intel-* scopes. The SSH
# destination comes from the environment (FC_SSH_INTEL), never from this file.
# Usage: guard.sh <baseline count> <log>
set -u
baseline=$1; log=$2
while :; do
  out=$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$FC_SSH_INTEL" 'test -e /var/tmp/faster-candidate-20261015-intel/guard-release && echo released; journalctl -k --no-pager 2>/dev/null | grep -c -i -E "i915.*(fence expiration|gpu hang|resetting)"' 2>/dev/null)
  case "$out" in released*) echo "$(date -u +%FT%TZ) released" >> "$log"; exit 0 ;; esac
  count=${out:-error}
  echo "$(date -u +%FT%TZ) count=$count baseline=$baseline" >> "$log"
  if [ "$count" != error ] && [ "$count" -gt "$baseline" ]; then
    echo "$(date -u +%FT%TZ) STOP: new i915 event" >> "$log"
    ssh -o BatchMode=yes "$FC_SSH_INTEL" 'touch /var/tmp/faster-candidate-20261015-intel/stop; export XDG_RUNTIME_DIR=/run/user/$(id -u); for u in $(systemctl --user list-units "fc-intel-*" --state=active --no-legend | awk "{print \$1}"); do systemctl --user stop "$u"; done' >> "$log" 2>&1
    exit 3
  fi
  sleep 5
done
