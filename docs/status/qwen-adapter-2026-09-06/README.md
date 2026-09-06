# Qwen adapter execution, 2026-09-06

Doppler [PR #8](https://github.com/clocksmith/doppler/pull/8), merged at
`575ffeb3a7ac66a070db2bd4c58cc68f2448a529`, fixes two failures exposed by real
PEFT weights. The runtime used the wrong matrix orientation, and signed adapter
verification hashed a string representation instead of the artifact bytes.
Checked JSON now declares the matrix layout; existing WGSL performs the
projections. Binary verification uses the byte-hashing function. Tests retain
legacy native-layout identity and use independent Node crypto for expected hashes.

One internal operator trained a 2,308,432-byte integration adapter against pinned
`Qwen/Qwen3-0.6B` revision `c1899de289a04d12100db370d81485cdf75e47ca`.
Four invented public summaries, eight training steps, three unseen prompts, and
exact-token acceptance were declared before evaluation. PyTorch/PEFT supplied
the independent source outputs. This is a runtime qualification exercise;
the short generations do not demonstrate useful coding or professional expertise.

| Check | Result |
| --- | --- |
| Original PEFT runtime | Base and unloaded outputs matched; all three adapted outputs failed |
| Offline transposed diagnostic control | All nine outputs matched |
| Corrected runtime, original PEFT bytes | All nine outputs matched |
| Signed public `executeOperation` | Three adapted and three base outputs matched |
| Wrong base, corruption, cancellation, subsequent base recovery | All four checks passed |
| Installed package on physical GPU | Same six outputs and four checks passed |
| Portable replay | Three Chromium startup failures, then one completed passing run |

Physical execution used AMD Radeon 8060S, Mesa RADV, and Chromium 151. The startup
failures returned no GPU adapter before model execution. Their cause remains
unresolved; a passing later run does not establish startup reliability.
The archive retains these failures, the earlier numerical and byte-hash failures,
the successful reports, and the separately identified offline transpose control.
The shipped adapter retains its original PEFT orientation and bytes.

The [GitHub workflow](https://github.com/clocksmith/doppler/actions/runs/34063984633)
passed: repository checks and 773 unit-test files, 71 browser kernel checks with
15 explicit skips, and the mocked application/offline contract. The paired Reploid
Capsule handoff also passed; its model programs are injected. That handoff does
not establish physical peer execution.

## Reproduction

[index.json](index.json) lists every retained file, its hash, and the 24 omitted
base-model files. [evidence.tar.gz](evidence.tar.gz) includes the small adapter,
source training policy and script, exact runtime patch, signed model metadata,
public signing key, reports, and the tested npm tarball. No base weights or
private signing keys are included.

The tarball is `doppler-gpu` 0.6.0 from source revision
`f0020460fe7a342cbca19478072e69e65cf43e6d`. Its SHA-256 is
`49f848d0de105a8e20e9d864fc2110ff03a90102c76488d3fd6b2a0bf657a615`.
All 1,779 installed files were compared byte-for-byte with the package. This is
a retained installable candidate; it has not been published to npm.

1. Run `python3 verify.py --extract /absolute/new-bundle-directory` from this
   directory. Extraction refuses to overwrite an existing directory.
2. Install the extracted `package/doppler-gpu-0.6.0.tgz` into a new consumer with
   `npm install --ignore-scripts --omit=optional --offline --no-audit --no-fund`.
   Pass the tarball's absolute path as the package argument. Node 22.22.1 and
   npm 9.2.0 were used for the retained install.
3. Supply the unchanged converted base weights and tokenizer named in the index.
   The original checkpoint revision, per-file source hashes, original conversion
   configuration, and adapter-kernel recipe are retained under `source/`.
   Conversion must reproduce the declared hashes; replacing signed metadata
   with newly generated metadata changes the experiment's identity.
4. Run `python3 restore-capsule.py /absolute/bundle /absolute/converted-model
   /absolute/new-capsule-directory`. It checks all 54 dependencies before linking
   them into the new directory. It does not copy the base weights.
5. Copy `replay/replay-config-debug-04.json` and set its explicit local paths:
   `runtimeRoot` to the installed package; `playwrightModule` to Playwright's
   installed module; `capsuleDirectory` to the restored directory; `adapterDir`
   to the extracted adapter; `referencePath` to `source/source-reference.json`;
   `openOptionsPath` to `capsule/open-options.json`; package receipt and file
   verification paths to their extracted files; `chromium` to the browser;
   and `outputDirectory` to a new directory. Preserve the declared numerical
   configuration when reproducing this comparison.
6. Run `node replay/replay-installed.mjs /absolute/replay-config.json`. It checks
   every runtime file before launching Chromium, requires the declared physical
   GPU, blocks outside browser requests, and writes a fresh report. A missing GPU
   is a failure; there is no software fallback or automatic retry.

The original CPU reference environment was Python 3.14, PyTorch 2.11.0+cu130,
Transformers 5.6.2, and PEFT 0.18.1. Its exact versions and training observations
are retained in `source/source-reference.json`. Reusing the retained adapter
does not require training it again. A different environment needs its own result.

## Remaining boundary

This proves original PEFT bytes affect real model execution through a signed,
installed Doppler operation. It does not prove WebRTC delivery, durable remote
replay, separately operated machines, a useful specialization, adapter promotion,
or public catalog admission. Reploid's public runtime pin remains 0.5.1 because
the required immutable npm release is still unpublished; the publishing identity
check returned HTTP 401. Qualified production specializations and independent
operators remain necessary to finish the user journeys.

Component: Doppler adapter execution and Reploid integration evidence.
Intent: preserved.
Acceptance evidence: linked CI, retained source comparison, signed physical
execution, package installation, archive verification, and dependency restoration.
Boundary effects: explicit adapter layout crosses the existing execution bridge;
artifact transport, public admission, and promotion authority remain with their
existing owners.
