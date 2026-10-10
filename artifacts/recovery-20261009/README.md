# Contributor recovery and standard-package qualification

Component: Reploid model delivery and distributed conversation. Intent: preserved.
Boundary effects: ordinary browser delivery consumes Doppler's standard 0.6.19
archive; numerical correctness remains owned by Doppler.

The initial Linux reproduction failed before loading: both catalog-pinned
GCS manifest objects returned HTTP 404. The same exact manifest bytes are now
shipped by ordinary Hosting under `config/model-manifests/<sha256>.json`.
Catalog identity, byte counts, tokenizer, weights, precision, and frozen
generation settings are unchanged. The unit test checks delivery inclusion,
hash, size, and model identity.

`restart-hosted-manifest-linux.log` passes with the installed 0.6.18 package.
`restart-standard-019-linux.log` passes with the ordinary 0.6.19 package:
both layer ranges stop, restart, become executable, and answer YES. The other
contributor's retained-piece inventory remains unchanged; unrelated history and
drafts are preserved. Requester weight requests and browser errors are empty.
`restart-standard-019-linux-summary.json` records this bounded result.
These runs use one physical Linux GPU. Their original fixture's legacy `mac`
host labels do not establish Mac execution; the fixture now labels local hosts
from the actual platform. Raw receipts remain unchanged.

Both full CPU runs pass 2,919 tests, with 29 skipped. The 0.6.19 ordinary Hosting
build and bundle verification pass. Standard archive identity:

- SHA-256: `d35550b0fd80753ed20512e6da36da34a468ce7cede51de4cab1dd4f2894dbaf`
- Browser bundle: `sha256:6f2d914394947a917711d8791e2ee67f9d43e3da121a5f62448ee726b114a5ec`

The Mac installs the identical archive and derives the identical browser bundle.
Doppler's complete Q/K shader matches bit for bit on both physical GPUs for
the captured inputs and head-size controls. That operator result is not full
generation acceptance.

The standard 0.6.19 physical run remains FAILED: 46/110 frozen-reference
comparisons exceed 0.001, maximum 0.0018558502197265625. Linux-Mac fails 24/55;
Mac-Linux fails 22/55. `numerical-019-physical-result.json` retains the package,
reference, host-placement, and failure identities. Full raw captures remain
on the Mac under `artifacts/distributed/2026-10-10T00-33-25-875Z`; a copy of the
first placement is retained here for diagnosis.

The first three layer outputs match across hosts; the next discrepancy is
inside layer three. Detailed operation capture is in progress. Keep precision,
the frozen reference, and tolerance unchanged. Installed-package diagnostics
read verified local model bytes and do not establish ordinary peer acquisition.
No package publication or production deployment occurred in this qualification.
After numerical acceptance, physical memory/lifecycle and normal application
acceptance still remain required.

## Synchronized 0.6.21 investigation candidate

After pulling d9b1f499 application changes, both physical machines advertise
sha256:72354df869fd6587e2329b25c9122e5dc2ed84d477ead16e44ede4d0905f7bcf.
The standard package archive SHA256 is
bcd0d7b9a1138fa9d21c2798b1f9a4f28067f4437447c276b64946de72705cb5.
Numerical qualification remains open: the first placement failed 27/55 frozen
comparisons, maximum 0.0018510818481445312; reverse placement is pending.
The preserved 0.6.20 archive failed identity validation before execution
(npm/runtime version mismatch). No npm publication or deployment occurred.

## Installed 0.6.23 contributor recovery

`recovery-023-physical-summary.json` records two unassisted physical runs with
the same standard archive and browser bundle on AMD/Vulkan and Apple/Metal.
Both hosts stop, restart, become executable, and answer YES in both layer roles.
The unaffected contributor keeps its weights and retained-piece inventory;
unrelated conversations and drafts survive. Requester weight requests,
contributor origin weight requests, and browser errors are empty. Tracked
allocations remain within 1,420,000,000 bytes per executor. The raw receipts are
retained in `recovery-023-corrected/` and `recovery-023-corrected-reverse/`.

Two acceptance-script defects blocked earlier diagnostics: export was clicked
inside a closed Actions disclosure, and readiness was inferred from obsolete
model-option text. The corrected script opens Actions through its normal control,
checks actual model readiness and send eligibility, then proves fresh execution.
`recovery-023-intervention.json` preserves the earlier manually assisted run;
it is not counted as acceptance.

These runs use shared isolated loopback signaling, not deployed authentication
or TURN. They cover Qwen 3.5 0.8B and idle contributor restart. They do not
qualify active-generation interruption, concurrent conversations, cancellation,
long prompts, or the 2B model. Numerical qualification separately remains failed:
54/110 frozen comparisons exceed 0.001, maximum 0.002967357635498047. No npm
publication or production deployment occurred.

Run each retained category independently without weakening its assertions:

```
node scripts/test-distributed.js --recovery --local
node scripts/test-distributed.js --recovery --local --reverse
node scripts/test-distributed.js --memory-only
```

`--memory-only` reuses the retained long-prompt, resident-reuse, and submitted
prefill-cancellation controls. Its receipt excludes numerical and application
qualification. It rejects required numerical qualification and incompatible
diagnostic flags. `REPLOID_E2E_CAPACITY=1` with `--recovery` additionally runs
the existing independent standalone-opening denial controls on both hosts;
a generated-code assertion cannot prevent those controls from recording results.

## Installed 0.6.23 memory and submitted cancellation

[The memory receipt](memory-023-physical/result.json) completes the original
Mac-prefix/Linux-suffix placement: 494 tokens, then the same 1,588-token request
twice, all with EOS. Repeated output is identical and settled attempt allocations
do not grow. Peak tracked allocations are 922,615,176 bytes on the Mac and
560,124,072 bytes on Linux, below the unchanged 1,420,000,000-byte ceiling.

[Cancellation and reuse](memory-023-physical/cancellation-summary.json) records
an abort after `queue.submit` returned, allocation-guard rejection on both hosts,
and complete reuse with the identical 1,588-token input. This is cooperative
settlement, not immediate interruption of submitted GPU work. Both GPU error
lists are empty. Raw receipts are retained losslessly as compressed JSON.

The original resident-close snapshots have no active or retained ownership but
still show deferred destruction. They do not prove final weight destruction.
The existing fixture now separately observes deferred cleanup before closing
the browser, preserving the immediate snapshots. [Reversed placement](memory-023-physical-reverse/summary.json)
now passes repetition, actual submitted cancellation, rejection and resident
reuse. Both phases settle with zero weight allocations and zero retained,
active or deferred ownership before teardown. The observation uses GPU
completion and the ownership counters; a delay cannot satisfy acceptance.
Standalone failed initialization receives the same
settled-cleanup requirement. [Harness validation](memory-023-physical/harness-validation.json)
records passing CPU checks; those checks do not substitute for physical execution.

[The separate factual review](memory-023-physical/document-quality-review.json)
fails the retained 0.8B answer: it adds an included allowance to Harbor's price,
misidentifies Cedar's passages, and invents a precedence rule. This bounded
observation does not establish whether unsplit inference produces the same errors.
Neither identical output nor EOS completion qualifies task quality.

These diagnostics use HTTP model fixtures and Node tensor forwarding. They do
not establish ordinary peer acquisition, requester download behavior, numerical
qualification, public deployment, or performance superiority. The ordinary
larger-model recovery check separately exercises concurrent conversations,
cancellation while another conversation remains active, document generation,
contributor loss/retry and independent standalone denial. Its physical result
remains open. No npm publication or production deployment occurred.

[The numerical control audit](numerical-controls-023-audit.json) retains the
existing same-token-prefix comparisons rather than rerunning them. Each mixed
placement stays within 0.001 of the unsplit device owning its prefix at all 55
steps. Comparisons with the other unsplit device fail 13 or 15 steps. The missing
same-device partition controls and materially divergent decode-step operand
replay remain diagnostic work, not an arithmetic correction or qualification.
