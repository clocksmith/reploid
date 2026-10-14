#!/bin/bash
# Run-7 shared-machine guard. Polls intel-host's kernel journal every 20 s; on any new i915
# "Fence expiration", "GPU HANG" or "Resetting" line beyond the baseline count, it stops the owned
# native scopes on both hosts (native-stop.sh, SIGTERM) and the harness process named in the pid
# file, then exits. SSH destinations come from the environment, never from files.
# Usage: i915-guard.sh <baseline count> <harness pid file> <log>
set -u
baseline=$1; pidfile=$2; log=$3; here=$(cd "$(dirname "$0")" && pwd)
RUN=/var/tmp/reploid-signed-completion-journey-run7-20261014
while [ ! -e "$RUN/guard-stop" ]; do
  count=$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$SCJ_RUN7_SSH_INTEL" 'journalctl -k --no-pager 2>/dev/null | grep -c -i -E "i915.*(fence expiration|gpu hang|resetting)"' || echo error)
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) count=$count baseline=$baseline" >> "$log"
  if [ "$count" != error ] && [ "$count" -gt "$baseline" ]; then
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) STOP: new i915 event" >> "$log"
    kill "$(cat "$pidfile" 2>/dev/null)" 2>/dev/null
    for pair in "$SCJ_RUN7_SSH_AMD:amd" "$SCJ_RUN7_SSH_INTEL:intel"; do
      dest=${pair%:*}; host=${pair##*:}
      for unit in $(ssh -o BatchMode=yes "$dest" 'XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user list-units "scj-run7-*" --state=active --no-legend | awk "{print \$1}" | sed "s/\.scope$//"'); do
        ssh -o BatchMode=yes "$dest" sh -s -- "$unit" < "$here/native-stop.sh" >> "$log" 2>&1
      done
    done
    exit 3
  fi
  sleep 20
done
