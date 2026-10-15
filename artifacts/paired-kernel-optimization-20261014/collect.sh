#!/bin/sh
# Copies the small results of the amd-host sessions into amd-host/ beside this script: session
# logs, job lists, variant manifests' change records, every kernel-check, ladder, profile,
# compile-cost and memory JSON, each 55-step check's report and cache metadata (hashes), and the
# job logs' JSON lines. The F16 cache dumps (about 3.3 MB per check) stay on amd-host under
# /var/tmp/paired-kernel-opt-20261014/out/*/caches.
# Usage: collect.sh <ssh destination>
set -eu
here=$(cd "$(dirname "$0")" && pwd)
dest=$here/amd-host
mkdir -p "$dest/out" "$dest/variants" "$dest/failed-attempts"
ssh "$1" 'cd /var/tmp/paired-kernel-opt-20261014 && tar -czf - session-*.log jobs-*.txt configs/*-control.json model-*/variant.json failed-attempts \
  $(ls out/*.json) $(ls out/*-check/report.json out/*-check/caches/request-*.json 2>/dev/null)' | tar -xzf - -C "$dest"
ssh "$1" 'cd /var/tmp/paired-kernel-opt-20261014/out && for f in *.log; do printf "== %s\n" "$f"; grep -h -e "^{" -e "Error" -e "error" "$f" | cut -c1-2000; done' > "$dest/out/job-log-lines.txt"
for v in "$dest"/model-*; do if [ -d "$v" ]; then rm -rf "$dest/variants/$(basename "$v")"; mv "$v" "$dest/variants/"; fi; done
echo "collected into $dest"
