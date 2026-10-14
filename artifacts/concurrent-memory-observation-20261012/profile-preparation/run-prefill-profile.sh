#!/bin/sh
set -eu
cd /var/tmp/reploid-concurrent-profile-20261013
export DOPPLER_CHAT_MODEL_DIR=/Users/xyz/deco/doppler/reports/local/paired-intermediates-20261012/model-0.6.28/model
export REPLOID_PAIRED_EXECUTION_BINDING=$PWD/binding.json
export REPLOID_PAIRED_EXECUTION_GRAPH=$PWD/execution.json
export REPLOID_DIAGNOSTIC_REQUESTS=$PWD/tests/fixtures/distributed-memory-requests.json
export REPLOID_MEMORY_PHASE=concurrent
export REPLOID_PREFILL_OBSERVATION_ONLY=1
export REPLOID_PROFILE_IMMEDIATE=1
export REPLOID_TEST_DELIVERY_BINDING=$PWD/snapshot-binding.json
export REPLOID_TEST_DELIVERY_SHA256=afade931e89f785484817b7e5dcbe39fe7f7fac439da2a29d1fd7eb9a6702c12
export REPLOID_EXECUTOR_CDP=1
export REPLOID_EXECUTOR_WS=http://127.0.0.1:29562
export REPLOID_TEST_PEER=amd-host
export REPLOID_E2E_BASE_URL=http://127.0.0.1:29560
export REPLOID_MODEL_BASE_URL=http://127.0.0.1:29561/
export REPLOID_PEER_MODEL_BASE_URL=http://127.0.0.1:29561/
export REPLOID_REFERENCE_REVERSE=${1:-0}
export REPLOID_CAPTURE_OUT=$PWD/prefill-profile-direction-$REPLOID_REFERENCE_REVERSE.json
node tests/fixtures/browser-partition-memory-completion.js > prefill-profile-direction-$REPLOID_REFERENCE_REVERSE.log 2>&1
