#!/bin/sh
# Run-8 mac-host storage supplier browser: Google Chrome, headless, WebGPU on, CDP on loopback 29673 only, a
# new profile in the run directory (as run 7's mac-supplier-profile). No room capability on argv. Closed
# through CDP at settlement; its pid is recorded.
# Usage: supplier-chrome.sh <log file> <pid file>
set -eu
log=$1; pidfile=$2
profile=/var/tmp/reploid-faster-journey-20261015/mac-supplier-profile
test ! -e "$pidfile"
nohup "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=29673 \
  --remote-debugging-address=127.0.0.1 --user-data-dir="$profile" --enable-unsafe-webgpu --no-first-run \
  --no-default-browser-check about:blank > "$log" 2>&1 < /dev/null &
echo $! > "$pidfile"
for i in $(seq 1 30); do grep -q "DevTools listening" "$log" && break; sleep 1; done
grep -m1 "DevTools listening" "$log" | sed 's#/devtools/browser/.*##'
