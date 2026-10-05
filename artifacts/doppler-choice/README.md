# Real installed decision execution

[summary.json](summary.json) retains exact archive/Capsule identities, per-case
outputs, receipt digests, accounting and one complete verified execution.
[failed-observations.json](failed-observations.json) preserves missing-loading-
shader rejection and the initial fixture cleanup failure. Successful reruns use
new evidence files; failures were not replaced.

Twelve reviewed relevance decisions pass through installed public Doppler and
Reploid libraries in Node, ordinary browser WebGPU and the existing signed
complete-job protocol over actual WebRTC. The requester has no model session and
requests no model artifacts. Browser contexts are isolated on one physical AMD
machine. This does not establish cross-device model partitions or capacity pooling.

Raw reports remain local, hash-inventoried inputs. Compact evidence is tracked;
duplicate receipts, model weights, archives and private keys are not added to Git.
The [Doppler record](https://github.com/clocksmith/doppler/blob/main/reports/choice-scoring/README.md) owns the
independent CPU reference, frozen task, derived model dependencies and package.
The Capsule uses explicit local test release metadata, not a public model release.

## Verified peer storage into real decisions

[custody-summary.json](custody-summary.json) records two fresh physical-browser
runs through supplier storage, peer acquisition, signed Capsule opening and
weightless-requester decisions. Suppliers retain verified chunks in OPFS. The
executor's artifact origin is blocked; it rejects a corrupt contribution and
recovers from a departing supplier. Both suppliers close before the twelve real
decisions run. All answers pass the independent reference, and cleanup succeeds.

The final run acquires 945,323,341 payload bytes, including rejected corruption;
verification accounts for both chunks and reconstructed artifacts. The healthy
supplier retains 944,274,765 bytes in OPFS, including content deduplication.
Executor acquisition has a 67,108,864-byte maximum artifact buffer and a
4,194,304-byte maximum in-flight chunk allowance. These are distinct observed
counters, not physical GPU residency or total browser-memory measurements.
The executor has no persistent chunk checkpoint in this fixture. Four browser
contexts still share one physical machine. This whole-request model closure
does not prove selective partition acquisition or solve the earlier chat-model
missing-piece failure.

To exercise this path, prefix the peer command below with
`REPLOID_CHOICE_PEER_ACQUISITION=1`. The fixture blocks model-origin requests,
retains failure observations, and requires real corruption and departure events.

## Reproduction

After separate Node/browser qualification and signed Rig construction, run from
Reploid:

```sh
node tests/fixtures/doppler-choice-installed-physical.js \
  ../doppler/dist/decision-replay/consumer/node_modules/doppler-gpu \
  /path/to/installed/reploid \
  ../doppler/dist/decision-replay/capsule/capsule.json \
  ../doppler/dist/decision-replay/capsule/signing-public.json \
  ../doppler/dist/decision-replay/node.json.qualification.json \
  ../doppler/dist/decision-replay/archive/doppler-gpu-0.6.4.tgz \
  artifacts/doppler-choice/replay-node.json
node tests/fixtures/doppler-choice-peer-browser-check.js \
  ../doppler/dist/decision-replay/consumer/node_modules/doppler-gpu \
  /path/to/installed/reploid ../doppler/dist/decision-replay/capsule \
  artifacts/doppler-choice/replay-browser.json.qualification.json \
  ../doppler/dist/decision-replay/archive/doppler-gpu-0.6.4.tgz \
  artifacts/doppler-choice/replay-peer.json
```

Servers, browser contexts and owned Node providers are fixture-owned and closed.
No UI inspection or screenshots are part of these physical decision checks.
The executor opens the actual verified Capsule; no injected arithmetic is used.

## Other acceptance

Sixty-six operation, provider, signed-job and partition API tests pass. Library
types, generated browser delivery and all 39 CATSCAN charters pass. Ordinary peer
operation framing and Verification Worker checks pass in Chromium. The
[installed library acceptance](../library-acceptance/2026-10-05T02-12-38-345Z/report.json)
also passed; its model fixtures are synthetic and separately identified.

The new public adapter does not change the app's split.13 dependency. Upgrade,
selective partition acquisition, chat-model recovery and both physical numerical
directions remain separately gated. No deployment, published package, calibration or general
decision-quality claim is made.

Component: Reploid Doppler adapters and complete peer jobs.
Intent: preserved.
Acceptance evidence: summary, failure record, installed acceptance and named fixtures.
Boundary effects: explicit public operation/scoring adapter composition; Doppler
continues owning scoring and Reploid continues owning permission and transport.
