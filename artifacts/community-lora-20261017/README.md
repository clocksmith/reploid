# Reploid LoRA training integration

The Changes route (`/improve`) now offers individual training and automatic
coordination of one pooled round across explicitly selected, connected peers.
Doppler 0.6.32 supplies the computation. This integration does not establish a
useful trained model, browser GPU qualification, or cross-machine training.

Component: `reploid/training`, browser host and Changes controls.
Intent: deliberately extended with separately authorized training; inference,
model mathematics, independent evaluation and activation authority preserved.
Boundary effects: the existing authenticated channel setup and bounded binary
framing accept a dedicated `reploid-training` channel. Training does not enter
partition execution. Doppler owns checkpoint/sample identities and aggregation.

## Use

1. Open Changes and expand **Train a LoRA adapter**. Select a JSON array of
   tokenized samples. Each sample supplies `inputIds`, aligned `targetIds`, and
   the number of nonnegative targets as `supervisedTokenCount`.
2. Review the model/download and gradient-disclosure text. Explicitly approve
   training, then choose **Train on this device**, or connect training on each
   participating device.
3. For a pooled round, contributors select the coordinator and enable one round.
   The coordinator selects those contributors and starts training. Reploid
   exchanges the frozen checkpoint and gradients automatically, then applies one
   optimizer update only after every selected contribution succeeds.
4. Download `adapter.json` and `adapter.safetensors`. Export verifies their weight
   checksum. Evaluation, import into a serving catalog, and activation remain
   separate decisions. Stop revokes contribution and waits for GPU settlement.

The scoped target is Qwen3.5 0.8B Q4_K, layer 23 `down_proj`, rank 2, alpha 4,
f32 adapter/gradient precision. Policy bounds eight local samples, 128 tokens
per sample, four total participants and a five-minute activity/grant deadline.
Pooled training accepts one sample per participant. Samples stay local; gradients
can reveal training information. This is not private aggregation or validation
of an untrusted peer's numerical honesty. A failed round is not retried
implicitly. Page reload does not resume an optimizer or preserve an export.

## Evidence

- [Native application check](native.json): an actual local M3 GPU step through
  Reploid's session and executor, with a 37,051-byte checksummed export; loss
  9.030719757080078. The fixture inputs are qualification tokens, not a useful
  training corpus. Command:
  `node tests/fixtures/community-lora-native.js /path/to/provisioned/model`.
- [Verification Worker](verification.json): changed browser runtime sources
  passed the actual classic worker's static/AST checks. Warnings are retained.
  Node build tools are outside that browser sandbox and receive scoped lint and
  delivery checks instead.
- [Browser check](browser.json): real Chrome loaded the shipped `/improve` view,
  rejected an empty training submission, and showed reachable controls at 390
  and 1280 pixels without horizontal overflow. [Mobile](training-390.png) and
  [desktop](training-1280.png) screenshots are retained. No browser training ran.
- 48 focused tests passed across `lora-training`, `lora-training-network`,
  `lora-training-ui`, `partition-data-channel`, `work-partition-network-cleanup`
  and `catscan`. They cover consent, checksum failures, one shared update,
  missing participants, replay, revocation, cancellation settlement and a full
  two-session round through production authentication/framing with injected
  certificates/channels and computation. These are not real WebRTC/GPU rounds.
- Library types, changed-module lint, layer/delivery checks and the charter graph
  passed. Registry regeneration reported zero unresolved issues. The charter
  scanner now excludes disposable dependency/deployment snapshots while retaining
  actual hidden components; an obsolete CSS-evidence link was repaired.

The earlier product-session tests still expect permission popups removed by
`55913bbe` and have outdated transport mocks. A diagnostic run reached two
obsolete approval assertions after supplementing those mocks; its temporary
fixture edits were removed. No full repository suite or deployment was run.

The package archive and integrity are retained in `native.json`. Doppler's
version-only integration commit is `ea034747`; unrelated in-progress kernel work
was excluded from this package and commit. Reproduce browser checks with
`tests/fixtures/community-lora-browser.mjs`.
