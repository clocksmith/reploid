#!/bin/bash
# Run-8 Mac health sampler (read-only), copy of run-7/tools/mac-health.sh with the intel ping removed
# (placement C uses amd-host only): every 10 s, swap use, free-memory percentage and one ICMP RTT to
# amd-host. The destination comes from the environment; only aliases and numbers are logged.
# Usage: mac-health.sh <log>
log=$1; RUN=/var/tmp/reploid-faster-journey-20261015
while [ ! -e "$RUN/health-stop" ]; do
  swap=$(sysctl -n vm.swapusage | awk '{print $6}'); free=$(memory_pressure 2>/dev/null | awk -F: '/free percentage/{gsub(/ /,"",$2);print $2}')
  amd=$(ping -c1 -t3 "$FC_RUN8_PING_AMD" 2>/dev/null | awk -F'time=' '/time=/{print $2}' | cut -d' ' -f1)
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) swapUsed=$swap freeMemory=$free amdRttMs=${amd:-timeout}" >> "$log"
  sleep 10
done
