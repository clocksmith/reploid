#!/bin/sh
# Placement C envelope run: the mac-host stage 0 browser contributor. Copy of
# ../../faster-candidate-20261015/journeys/tools/stage0-chrome.sh; only the log and pid paths differ.
# Google Chrome, headless, WebGPU on Metal, CDP on loopback 29671 only, the run-2 stage 0 profile (stage 0
# peer identity; release checkpoint 9 after run 8). No room capability on argv; stage0-setup.mjs navigates it
# over CDP. macOS has no systemd scopes; the browser is closed through CDP at settlement.
# Usage: stage0-chrome.sh <log file> <pid file>
set -eu
log=$1; pidfile=$2
profile=/var/tmp/reploid-signed-completion-journey-run2-20261013/mac-stage0-profile
test -d "$profile"
test ! -e "$pidfile"
nohup "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=29671 \
  --remote-debugging-address=127.0.0.1 --user-data-dir="$profile" --enable-unsafe-webgpu --no-first-run \
  --no-default-browser-check about:blank > "$log" 2>&1 < /dev/null &
echo $! > "$pidfile"
for i in $(seq 1 30); do grep -q "DevTools listening" "$log" && break; sleep 1; done
grep -m1 "DevTools listening" "$log" | sed 's#/devtools/browser/.*##'
