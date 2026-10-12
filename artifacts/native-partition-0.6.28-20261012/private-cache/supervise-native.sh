#!/bin/sh
cd /var/tmp/reploid-native-private-cache-0.6.28-20261012
MESA_SHADER_CACHE_DIR=/var/tmp/reploid-native-private-mesa-0.6.28-8m5y91ze node --inspect=127.0.0.1:29329 tests/fixtures/native-partition-process.js config.json > /var/tmp/reploid-native-private-cache-0.6.28-output-20261012/native-direction-0.log 2>&1 &
native_pid=$!
echo "$native_pid" > /var/tmp/reploid-native-private-cache-0.6.28-output-20261012/native-direction-0.pid
wait "$native_pid"
exit_code=$?
printf '{"pid":%s,"exitCode":%s}\n' "$native_pid" "$exit_code" > /var/tmp/reploid-native-private-cache-0.6.28-output-20261012/native-direction-0.exit.json
exit "$exit_code"
