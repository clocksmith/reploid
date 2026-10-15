#!/bin/bash
# Mac health sampler for the placement C envelope run (read-only), copy of
# ../../faster-candidate-20261015/journeys/tools/mac-health.sh with this run's stop file: every 10 s, swap use,
# free-memory percentage and one ICMP RTT to amd-host over the tailnet name (FC_ENV_PING_AMD, from the
# environment; only aliases and numbers are logged). The WebRTC path's own RTT is in webrtc-stats.mjs.
# Usage: mac-health.sh <log>
log=$1; RUN=/var/tmp/reploid-placement-c-envelope-20261015
while [ ! -e "$RUN/health-stop" ]; do
  swap=$(sysctl -n vm.swapusage | awk '{print $6}'); free=$(memory_pressure 2>/dev/null | awk -F: '/free percentage/{gsub(/ /,"",$2);print $2}')
  amd=$(ping -c1 -t3 "$FC_ENV_PING_AMD" 2>/dev/null | awk -F'time=' '/time=/{print $2}' | cut -d' ' -f1)
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) swapUsed=$swap freeMemory=$free amdRttMs=${amd:-timeout}" >> "$log"
  sleep 10
done
