# Native Node participant

Component: native host composition. Intent: preserved. Reploid's existing WebRTC,
identity, automatic partition placement, admission and settlement contracts run
in Node. Doppler's installed public partition factory performs model execution.
No browser process or whole-request inference fallback is started.

Implemented entry point: `node server/native-participant.js`. Six focused tests
pass on Linux. The native WebRTC host observed actual browser participant signing
identities and capability descriptions over authenticated data channels. The
first connection attempt and the old provider shutdown failure are retained;
neither was reported as successful acceptance.

## Physical opening

On x@128 AMD/Vulkan, installed Doppler 0.6.27 opened assigned layers 12–23 of the
catalog's Qwen3.5 0.8B. It verified 75 requested pieces (307,887,776 bytes), retained
285,497,344 weight bytes and reached 497,336,720 accounted allocated bytes, below
the unchanged 1,420,000,000-byte limit. No generation occurred in this opening
check. This is pinned-manifest opening, not signed Capsule qualification.

`open-unsettled.json` retains the initial observation: resident closing returned
but the buffer pool retained allocations and the native process did not exit.
Final host shutdown now waits for the queue, destroys its pool and device, and
restores the globals it owns. `open-settled.json` records the resident closed and
the device released. The process subsequently exited normally with status zero.
Contribution stop remains distinct from terminating this host's provider.

`runtime-identity.json` compares every installed package file with the pinned
archive, and records the actual Dawn and native WebRTC binaries. The provider is
webgpu 0.4.0; WebRTC is @roamhq/wrtc 0.10.0. `browser-discovery.json` is a real
native-to-browser capability observation, not proof that a model answer completed.

## Physical browser plus native conversation

The ordinary Mac requester discovered Suby's existing browser partition A and
this native AMD/Vulkan partition B automatically. It approved the actual pair;
Node executed layers 12–23 through the unchanged installed Doppler archive.
The requester received the complete answer that three $12 tickets cost $36.
After a targeted requester RTC closure and automatic rediscovery, a follow-up
using the same history correctly returned $48 for four tickets. Requester UI and
network evidence live in [the application receipts](../live-conversation-20261012/).

Five native attempt records all reached confirmed settlement: four successful
requests and one isolated cancellation. Concurrent cancellation preserved the
other response. `compute-concurrency.json` and `compute-final-settlement.json`
record zero active reservations and retained resident weights; the peak stayed
497,336,720 accounted bytes. These short requests do not rerun the full frozen
1,588-token workload. No resident reload was needed during the five attempts.

`executing-provider.json` records this process's exact host source, original
shared-library revision, runtime-selected AMD adapter family and mapped native
provider binaries. It differs from the earlier standalone opening's source
identity; the archive and installed model runtime remained unchanged. Reploid's
Linux checkout was synchronized only after those modules had been loaded.

The owned native process received one SIGTERM after all attempts settled. Its
log records model unload and explicit device destruction, followed by natural
exit status zero. `compute-shutdown.json` retains that observation. The unrelated
public contributor was left running. Full native file supply, missing-file peer
acquisition, signed Capsule opening, both native partition placements and the
remaining numerical/model-quality release gates remain unqualified.

## Run

The provider and RTC modules are explicit operator-selected dependencies. For the
retained Linux run they were installed under an isolated temporary directory:

```sh
npm install --prefix /var/tmp/reploid-native-deps-20261012 --no-audit --no-fund @roamhq/wrtc@0.10.0 ws@8.18.3
node server/native-participant.js \
  --connect-only \
  --model qwen-3-5-0-8b-q4k-ehaf16 \
  --model-directory /home/x/deco/doppler/models/local/qwen-3-5-0-8b-q4k-ehaf16 \
  --identity-file /var/tmp/reploid-native-20261012/identity.json \
  --rtc-module /var/tmp/reploid-native-deps-20261012/node_modules/@roamhq/wrtc/lib/index.js \
  --ws-module /var/tmp/reploid-native-deps-20261012/node_modules/ws/wrapper.mjs \
  --gpu-module /home/x/deco/reploid/node_modules/webgpu/index.js \
  --signaling-url ws://127.0.0.1:18000/swarm
```

Port 18000 in this run is an explicitly owned SSH reverse tunnel to the ordinary
Mac application's localhost:8000 signaling service. No model data is relayed
through that signaling service. Replace `--connect-only` with `--contribute` to
approve assigned local model computation. Selection uses the same existing
automatic placement as the browser. SIGINT/SIGTERM settle the participant and
then release its owned native device.

The weight directory is read only; individual requested pieces are authenticated
by Doppler. This initial opening did not exercise peer acquisition or file supply.
The subsequent [native custody implementation and physical checks](../native-files-20261012/)
record those capabilities separately.

## Checks

```sh
npx vitest run --config tests/vitest.config.js tests/unit/native-participant.test.js
node --check server/native-participant.js
```

The RTC regression covers node-webrtc's UINT16_MAX unlimited values versus the
browser's null representation, without admitting explicitly unreliable channels.
File tests cover selective reads, corruption, metadata binding, directory escape,
and cancellation. Lifecycle tests cover provider initialization rejection/retry,
queue settlement and restoration of owned globals.

The observed browser/native pair now completes short answers, concurrent work,
isolated cancellation and a follow-up after requester channel recovery. These
receipts do not promote a runtime archive or qualify broader numerical accuracy,
document quality, signed opening or public deployment.
