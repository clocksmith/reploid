#!/bin/sh
cd /var/tmp/reploid-native-preparation-0.6.28-20261012
node --inspect=127.0.0.1:29329 tests/fixtures/native-partition-process.js config.json > /var/tmp/reploid-native-preparation-0.6.28-output-20261012/native-direction-0.log 2>&1 &
native_pid=$!
echo "$native_pid" > /var/tmp/reploid-native-preparation-0.6.28-output-20261012/native-direction-0.pid
wait "$native_pid"
exit_code=$?
printf '{"pid":%s,"exitCode":%s}\n' "$native_pid" "$exit_code" > /var/tmp/reploid-native-preparation-0.6.28-output-20261012/native-direction-0.exit.json
exit "$exit_code"
