# Remote adapter integration, 2026-09-06

Reploid `41abc7d` supports exact adapters and ordinary generation through the
current Doppler Capsule API. Its [CI run](https://github.com/clocksmith/reploid/actions/runs/34060513244)
passed. Doppler's adapter implementation is merged at `693d7e62`; its
[CI run](https://github.com/clocksmith/doppler/actions/runs/34060567092) passed.

Reploid's final local suite passed 2,427 tests. Twelve Chromium job and recovery
tests passed; the three affected browser checks passed again after the final
loading changes. The paired source-checkout handoff passed for both signed
formats, including all four operations, peer artifact recovery, and receipt
validation. These integration tests inject model programs. They do not prove
physical remote adapter execution or independent-machine operation.

## Physical observation

One internal operator ran Gemma 3 270M and the previously trained JavaScript
adapter on an AMD Radeon 8060S GPU. The current source-tree runtime loaded the
743,652-byte adapter, generated twelve tokens, and unloaded it. A second run
declared the adapter's matrix multiplication and scaling shaders using the
existing `execution.mechanismKernels` contract. Both declarations appeared in the
observed initial execution identity. Adapter identity, output text, and all twelve
output tokens matched the first run.

The candidate manifest is separate from the original manifest. It references
536,196,352 bytes of unchanged model weights through local filesystem links;
all eight weight-file hashes were rechecked. No model weights were copied into
the adapter. Existing signed model files were not modified.

[index.json](index.json) identifies the eight retained files and the compressed
[evidence archive](evidence.json.gz): both runners, configurations, complete
diagnostic reports, the candidate recipe, and its manifest. The source checkout
`f306bf9b` has the same tracked tree as merged revision `693d7e62`.
The archive contains no model weights or signing keys. Reproduction requires
the named weights and adapter, the exact runtime checkout, physical WebGPU,
and remapping the local paths in the runners.

These are direct model-session diagnostics. They do not use a signed Capsule,
`executeOperation`, WebRTC, or a second machine. They establish physical adapter
activation and unchanged output after explicit shader declaration. They do not
qualify coding quality or compare against an independent source implementation.

## Remaining inputs

The pinned original `google/gemma-3-270m-it` checkpoint is needed for independent
source-reference qualification before issuing the new signed model. Its recorded
local source directory is absent; downloading its configuration at revision
`ac82b4e820549b854eebf28ce6dedaf9fdfa17b3` returned HTTP 401. Access must be restored
or an authorized local checkpoint supplied. A successful raw-session run does not
satisfy that gate.

`npm whoami --registry=https://registry.npmjs.org` also returned HTTP 401.
The immutable runtime is not published, and Reploid's verified public pin remains
0.5.1. Independent operators and machines are still required for network proof.

Component: Poolday execution integration and Doppler adapter execution.
Intent: preserved.
Acceptance evidence: the linked CI runs, local tests, browser Verification
Worker, paired source handoff, and hashed physical diagnostic archive.
Boundary effects: new signed-format compatibility; model qualification,
publication, specialist quality, and independent operation remain separate.

*Last updated: September 2026*
