# Installed Doppler resident conformance checkpoint

The [numerical receipt](installed-physical.json) is from
`tests/contracts/doppler-partition-installed-physical.js` with the pinned
`doppler-gpu@0.6.3-dev.split.1` archive and the identified local Gemma 3 270M
F16 model. Reploid's existing numerical harness drove two real Doppler
residents through its layer partition runner. All three generated tokens and
every compared logit matched the unsplit installed Doppler reference within the
declared tolerance. The final text and length stopping matched. A separate
split stop-sequence run stopped after one token and matched its unsplit logits.

Both residents used one Node WebGPU provider on one machine. The driver uses
installed Doppler internals to load the local model; it does not exercise public
signed Capsule acquisition or peer transport. `residentWeightBytes` records
owned GPU buffer allocation, not physical residency. `transferMs` measures an
in-process frame copy here. The receipt's generic placement label names the
runner's two partition slots, not two physical devices.

The [browser conversation receipt](browser-real.json) and
[cancellation receipt](browser-cancellation.json), with the
[participant departure receipt](browser-departure.json), come from
`tests/e2e/partition-chat-real.spec.js`. Two Chromium tabs on this machine
loaded different real partitions and used Reploid's authenticated RTC path for
two concurrent ordinary chat threads. Each thread's selected tokens and final
text matched its installed unsplit Node reference; the output stopped at the
three-token limit. A third conversation was cancelled while B was held before
execution. Its attempt settled as cancelled without unloading the residents.
A fourth conversation failed when B's connection closed; the two completed
conversations remained completed.
These browser checks use direct local model loading through installed Doppler
internals. They do not qualify signed public Capsule acquisition, separate
devices, selective downloads, or capacity pooling.

The [installed consumer receipt](installed-consumer.json) records Reploid's
existing signed fixture, streaming, adapter, cancellation, and library contract
checks against the same archive. That fixture injects logits; it is distinct
from the real model numerical receipt.

The [signed partition opening receipt](installed-signed-opening.json) exercises
the installed public resident factory with a signed synthetic Capsule. Index 0
opens only when its exact plan digest and partition qualification are present;
index 1 is rejected before program creation. The fixture has no model math, so
this establishes the installed signature and authorization gate, not verified
acquisition of an executable chat Capsule.
