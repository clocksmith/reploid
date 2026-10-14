#!/bin/bash
# Run-7 Mac health sampler (read-only): every 10 s, swap use, free-memory percentage and one ICMP RTT
# to each native host. Destinations come from the environment; only aliases and numbers are logged.
# Usage: mac-health.sh <log>
log=$1; RUN=/var/tmp/reploid-signed-completion-journey-run7-20261014
while [ ! -e "$RUN/health-stop" ]; do
  swap=$(sysctl -n vm.swapusage | awk '{print $6}'); free=$(memory_pressure 2>/dev/null | awk -F: '/free percentage/{gsub(/ /,"",$2);print $2}')
  amd=$(ping -c1 -t3 "$SCJ_RUN7_PING_AMD" 2>/dev/null | awk -F'time=' '/time=/{print $2}' | cut -d' ' -f1)
  intel=$(ping -c1 -t3 "$SCJ_RUN7_PING_INTEL" 2>/dev/null | awk -F'time=' '/time=/{print $2}' | cut -d' ' -f1)
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) swapUsed=$swap freeMemory=$free amdRttMs=${amd:-timeout} intelRttMs=${intel:-timeout}" >> "$log"
  sleep 10
done
