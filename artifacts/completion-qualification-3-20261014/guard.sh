#!/bin/sh
# Campaign 3 stop condition: poll intel-host's kernel journal every 5 s from the campaign start.
# On any i915 "Fence expiration", "GPU HANG" or "Resetting" line, record it, stop the controller and
# the Mac browser owner, and stop the owned scopes on both hosts. Public contributors are never
# addressed. SSH destinations come from RQ3_SSH_AMD / RQ3_SSH_INTEL, never from this file.
# Usage: guard.sh <a|b> <since, e.g. "2026-10-14 08:45:00"> <log file>
set -u
placement=$1; since=$2; log=$3
camp=/var/tmp/reploid-completion-qualification-3-20261014/$placement
while :; do
  [ -e "$camp/guard.stop" ] && { echo "$(date -u +%FT%TZ) guard released" >> "$log"; exit 0; }
  hits=$(ssh -o BatchMode=yes -o ConnectTimeout=15 "$RQ3_SSH_INTEL" "journalctl -k --since '$since' --no-pager -o short-iso 2>/dev/null | grep -E 'i915.*(Fence expiration|GPU HANG|Resetting)|GPU HANG|Resetting rcs0' || true")
  if [ -n "$hits" ]; then
    echo "$(date -u +%FT%TZ) STOP: i915 event" >> "$log"; echo "$hits" >> "$log"
    touch "$camp/stop-condition"
    pkill -TERM -f 'tests/fixtures/browser-partition-memory-completion.js' || true
    touch "$camp/mac-preflight.json.stop"
    for dest in "$RQ3_SSH_AMD" "$RQ3_SSH_INTEL"; do
      ssh -o BatchMode=yes -o ConnectTimeout=15 "$dest" "XDG_RUNTIME_DIR=/run/user/\$(id -u) systemctl --user stop reploid-cold-reference-20261013.scope rq3$placement-server.scope 2>&1" >> "$log" 2>&1
    done
    echo "$(date -u +%FT%TZ) owned scopes stopped" >> "$log"; exit 1
  fi
  sleep 5
done
