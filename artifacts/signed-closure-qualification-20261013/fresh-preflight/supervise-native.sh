#!/bin/sh
set -eu
direction=${1:?direction0or1required}
mode=${2:-reference}
case "$direction" in 0|1) ;; *) exit 2 ;; esac
case "$mode" in reference|cold-readiness) ;; *) exit 2 ;; esac
cd /var/tmp/reploid-closure-qualification-v2-20261013
python3 verify-launch.py native "${1:?direction0or1required}"
output=/var/tmp/reploid-closure-qualification-v2-output-20261013
mkdir -p "$output"
if [ "$mode" = cold-readiness ]; then
  export MESA_SHADER_CACHE_DIR=/var/tmp/reploid-readiness-private-mesa-pflfOW
  stem=native-direction-$direction
else
  stem=native-direction-$direction
fi
node --inspect=127.0.0.1:29829 tests/fixtures/native-partition-process.js config.json > "$output/$stem.log" 2>&1 &
native_pid=$!
echo "$native_pid" > "$output/$stem.pid"
set +e
wait "$native_pid"
exit_code=$?
printf '{"pid":%s,"exitCode":%s}\n' "$native_pid" "$exit_code" > "$output/$stem.exit.json"
exit "$exit_code"
