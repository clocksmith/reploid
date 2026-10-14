#!/bin/sh
# Run-2 graceful stop of one owned native scope (SIGTERM; the application's createNativeShutdown path).
# Piped over ssh: ssh <dest> sh -s -- <unit name> < native-stop.sh
set -eu
unit=$1
case "$unit" in scj-run2-*) ;; *) exit 2 ;; esac
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
if ! systemctl --user is-active --quiet "$unit.scope"; then echo "{\"unit\":\"$unit\",\"alreadyInactive\":true}"; exit 0; fi
procs=$(cat "/sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/app.slice/$unit.scope/cgroup.procs" | tr '\n' ' ')
peak=$(systemctl --user show "$unit.scope" -p MemoryPeak --value)
at=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
systemctl --user kill --signal=SIGTERM "$unit.scope"
i=0; while [ $i -lt 90 ] && systemctl --user is-active --quiet "$unit.scope"; do sleep 1; i=$((i+1)); done
echo "{\"unit\":\"$unit\",\"pids\":\"$procs\",\"memoryPeakBytes\":\"$peak\",\"sigtermAt\":\"$at\",\"waitedSeconds\":$i,\"activeAfter\":\"$(systemctl --user is-active "$unit.scope" 2>&1 || true)\",\"journal\":\"$(journalctl --user -u "$unit.scope" --no-pager -o cat 2>/dev/null | tail -1 | tr -d '"')\"}"
