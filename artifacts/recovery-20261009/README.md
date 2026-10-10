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
