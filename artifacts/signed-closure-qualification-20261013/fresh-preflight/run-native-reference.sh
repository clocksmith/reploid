#!/bin/sh
set -eu
cd /var/tmp/reploid-closure-qualification-v2-20261013
python3 verify-launch.py mac "${1:?direction0or1required}"
export DOPPLER_CHAT_MODEL_DIR=/var/tmp/reploid-closure-model-20261013
export REPLOID_PAIRED_EXECUTION_BINDING=$PWD/binding.json
export REPLOID_PAIRED_EXECUTION_GRAPH=$PWD/execution.json
export REPLOID_DIAGNOSTIC_REQUESTS=$PWD/tests/fixtures/distributed-memory-requests.json
export REPLOID_REFERENCE_FILE=$PWD/approved-reference.json
export REPLOID_REFERENCE_SHA256=ad26dfbc38c5b890f48da2f1e4313dac9295e39e12f688411a10bf614d22fdd6
export REPLOID_MEMORY_PHASE=reference
unset REPLOID_DIAGNOSTIC_PROMPT REPLOID_DIAGNOSTIC_STEP
export REPLOID_TEST_DELIVERY_BINDING=$PWD/snapshot-binding.json
export REPLOID_TEST_DELIVERY_SHA256=e9f3b8f266382d0aa36980fea657004a286fb66ff58e7d8e56e14d6acb4a6a3a
REPLOID_NATIVE_EXECUTOR_WS=$(node -e 'fetch("http://127.0.0.1:29829/json/list").then(r=>r.json()).then(x=>console.log(x[0].webSocketDebuggerUrl))')
export REPLOID_NATIVE_EXECUTOR_WS
export REPLOID_TEST_PEER=amd-host:node-dawn
export REPLOID_E2E_BASE_URL=http://127.0.0.1:29850
export REPLOID_MODEL_BASE_URL=http://127.0.0.1:29851/
export REPLOID_PEER_MODEL_BASE_URL=http://127.0.0.1:29851/
export REPLOID_REQUIRE_NUMERICAL_TOLERANCE=1
export REPLOID_REFERENCE_REVERSE="${1:?direction0or1required}"
export REPLOID_CAPTURE_OUT=/var/tmp/reploid-closure-qualification-v2-output-20261013/native-direction-$REPLOID_REFERENCE_REVERSE.json
node tests/fixtures/browser-partition-memory-completion.js > /var/tmp/reploid-closure-qualification-v2-output-20261013/native-direction-$REPLOID_REFERENCE_REVERSE.controller.log 2>&1
