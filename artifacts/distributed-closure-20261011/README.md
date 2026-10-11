# Combined distributed execution closure checkpoint

Component: Reploid partition coordination and transport. Intent: preserved.
Boundary effects: sanitized runtime-to-application failure translation; no arithmetic,
model, reference, numerical tolerance, resource limit or package-pin change.

`DOPPLER_RESIDENT_OUTPUT_LIMIT` becomes `OUTPUT_LIMIT_EXCEEDED`. The requester sees
that the answer allowance was exceeded and the partial answer is incomplete.
The pinned standard 0.6.27 archive emits the exact older untyped message; a fixed,
local compatibility allowlist recognizes it without rebuilding that archive.
Unknown remote exception text stays private. Signed API tests exercise typed,
legacy and unknown errors through the chat adapter and confirm attempt settlement.
Doppler source also adds the typed error and an actual-GPU denial/cleanup regression
in commit `2c20aaa1`.

Acceptance: `npm test` passes 2,979 tests, skips 29 (274 files pass, 3 skip).
Library layers, declarations and CATSCAN checks pass. Detached installed-package
acceptance passes; its report is retained. The partition-chat and peer-job browser
suites pass 17 checks. The Verification Worker also passes with the modified
resident and peer modules explicitly included. Generated browser bundle:
`sha256:3bc724ffabfb5829a3f89485dc8c2af01d740441b9c701690796bb94e66af44d`.
Two earlier aggregate runs timed out the existing archive-installation test under
concurrent diagnostic load. The unchanged timeout passed in isolation and the
complete final run; no timeout or assertion was relaxed.

Doppler commit `02c864cf` retains the [independent numerical and counting evidence](https://github.com/clocksmith/doppler/blob/02c864cf/artifacts/source-model-reference-20261010/README.md).
The source implementation reproduces every one of 4,096 generated tokens and all
16,821 output characters, ending at max-tokens without EOS. That establishes this
specific model/settings task-quality failure independently of Doppler. It does not
qualify a prompt/model replacement. Numerical acceptance still fails: request 2,
decode step 3 differs by 0.0014121532440185547. Physical instrumentation changes no
controlled logits; captured-input normalization and projection checks have small
local errors but do not resolve accumulated-state error. Historical failures and
0.001 remain intact; no replacement reference is activated.

The acquisition failure remains retained. Its original log shows successful piece
progress followed by missing suppliers; no first connection-close reason was
recorded. Healthy direct-channel survival after signaling loss is independently
repaired/tested, without claiming it explains that incident.

Remaining work at this checkpoint follows the [retained closure sequence](https://github.com/clocksmith/reploid/blob/f4580f5b41492cdf551f9a15d426f8f963778bc4/docs/doppler-partition-handoff.md#combined-closure-sequence):
numerical and task-quality closure, acquisition diagnosis, physical signed-Capsule
opening, both-placement ordinary application acceptance including document reuse
and contributor retry, then deployment and served-identity/fresh-browser checks.
None of this record is a full end-to-end pass or a public deployment claim.
