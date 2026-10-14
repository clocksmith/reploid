#!/bin/sh
# Run-7 storage acquirer browser on intel-host, modeled on run 5's scj-run5-intel-acquirer:
# headless Chrome with GPU disabled (no load on the shared Intel GPU), CDP on loopback 29674 only,
# a new profile in the run directory, inside a bounded user scope (10 GiB high, 12 GiB max, zero swap,
# 75-minute cap, or the optional second argument in seconds, at most 2 hours).
# Piped over ssh: ssh <dest> sh -s -- <unit> [cap seconds] < acquirer-launch.sh
set -eu
unit=$1; cap=${2:-4500}
case "$cap" in ''|*[!0-9]*) exit 2 ;; esac
test "$cap" -le 7200
case "$unit" in scj-run7-intel-acquirer*) ;; *) exit 2 ;; esac
run=/var/tmp/reploid-signed-completion-journey-run7-20261014
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
log=$run/$unit.log
test ! -e "$log"
nohup systemd-run --user --scope --unit="$unit" \
  -p MemoryHigh=10737418240 -p MemoryMax=12884901888 -p MemorySwapMax=0 -p RuntimeMaxSec=$cap \
  /usr/bin/google-chrome --headless=new --remote-debugging-port=29674 --remote-debugging-address=127.0.0.1 \
  --user-data-dir=$run/intel-acquirer-profile-$unit --disable-gpu --no-first-run --no-default-browser-check about:blank \
  > "$log" 2>&1 < /dev/null &
sleep 4
echo "active=$(systemctl --user is-active "$unit.scope" || true)"
grep -m1 "DevTools listening" "$log" | sed 's#/devtools/browser/.*##'
