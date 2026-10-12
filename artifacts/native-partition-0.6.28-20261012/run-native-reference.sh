#!/bin/sh
set -eu
cd /var/tmp/reploid-native-split-0.6.28-20261012
export DOPPLER_CHAT_MODEL_DIR=/Users/xyz/deco/doppler/reports/local/paired-intermediates-20261012/model-0.6.28/model
export REPLOID_PAIRED_EXECUTION_BINDING=$PWD/binding.json
export REPLOID_PAIRED_EXECUTION_GRAPH=$PWD/execution.json
export REPLOID_DIAGNOSTIC_REQUESTS=$PWD/tests/fixtures/distributed-memory-requests.json
export REPLOID_REFERENCE_FILE=$PWD/approved-reference.json
export REPLOID_REFERENCE_SHA256=ad26dfbc38c5b890f48da2f1e4313dac9295e39e12f688411a10bf614d22fdd6
export REPLOID_MEMORY_PHASE=reference
export REPLOID_DIAGNOSTIC_PROMPT=0
export REPLOID_TEST_DELIVERY_BINDING=$PWD/snapshot-binding.json
export REPLOID_TEST_DELIVERY_SHA256=92a2a7faa9de26b926e05870a82a25114b308127a375d741de5d8322a9b0ba2b
REPLOID_NATIVE_EXECUTOR_WS=$(node -e 'fetch("http://127.0.0.1:29329/json/list").then(r=>r.json()).then(x=>console.log(x[0].webSocketDebuggerUrl))')
export REPLOID_NATIVE_EXECUTOR_WS
export REPLOID_TEST_PEER=x@128.tail995236.ts.net:node-dawn
export REPLOID_E2E_BASE_URL=http://127.0.0.1:28950
export REPLOID_MODEL_BASE_URL=http://127.0.0.1:28951/
export REPLOID_PEER_MODEL_BASE_URL=http://127.0.0.1:28951/
export REPLOID_REQUIRE_NUMERICAL_TOLERANCE=1
export REPLOID_REFERENCE_REVERSE=${1:-0}
export REPLOID_CAPTURE_OUT=/var/tmp/reploid-native-split-0.6.28-output-20261012/native-direction-$REPLOID_REFERENCE_REVERSE.json
node tests/fixtures/browser-partition-memory-completion.js > /var/tmp/reploid-native-split-0.6.28-output-20261012/native-direction-$REPLOID_REFERENCE_REVERSE.controller.log 2>&1
