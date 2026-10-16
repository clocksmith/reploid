# Qwen 27B through Reploid whole-model chat

Functional evidence and frontend deployment from 2026-10-16; not a performance
comparison, general answer-quality evaluation, or continuous-availability qualification.

## Exact path

- Initial source control: Reploid `93b6208e`, isolated from unrelated working-tree
  changes. Repaired-source and hosted checks use `37feb3be` (including `72067a43`).
- Runtime: the pinned `doppler-gpu/0.6.30` archive.
- Model: `qwen3-8-27b-text-f16-af32`, manifest
  `sha256:f4ad42e6706edb4c8b1b236230bff713fc0fbe70b22a3996ddc0a4cb7d777735`.
- Checkpoint: Qwen/Qwen3.8-27B revision
  `1d4bf0f2ff6012fd82039f2fa52739d0dd7c60c0`; F16 weights, F32 activations,
  thinking disabled, 4,096 configured context tokens and 128 output tokens.
- mac-host Chrome requester, ordinary Reploid interface and WebRTC; amd-host
  native whole-model provider using Dawn/Vulkan. No partitioned execution.
- Private discovery namespace through the existing signaling service. The
  requester has no weights and uses the normal disclosure/routing controls.

## Observations

[Provider result](provider.json): loading took 25.58 seconds. It streamed `42`
for `17 + 25`, then a short movie recommendation. It closed successfully and
exited zero. Peak sampled GPU GTT use was 56,655,618,048 bytes; this is a
device-wide driver counter, not application allocation accounting. The previous
layer-29 hang did not recur; this does not establish its original root cause.

[Initial browser result](browser-before-fix.json) and [screenshot](preview-before-fix.png): the interface
selected Qwen 27B Whole model, received `42`, followed up with subtraction and
received `40`, cancelled a counting response, then received `42` on a subsequent
request. History survived reload. Completed attempts bind the exact manifest and
`peer-whole-request` execution. No requester weight/tokenizer requests or page
exceptions were observed. Two unrelated HTTP 404s occurred on the minimal static
preview server; this was not a full production server check.

The first exploratory browser harness incorrectly required a permission dialog
even when the current default already allowed network answers. The answer was
visible, but that harness assertion failed. The retained result uses the normal
permission flow and does not require an absent dialog.

[Failed handoff](failed-handoff.json): a separate Playwright run connected while
the provider prepared. The first request timed out without an observed generation
start. A subsequent run with diagnostic debugger probes passed the complete
journey (46.7 seconds). That run is not timing evidence; the exact dropped
message in the failed physical attempt was not retained.

## Repair and remaining proof

The identity verifier tracked active signing by peer, silently dropping a second
fresh challenge from that peer. A deterministic regression reproduced the timeout
with four concurrent challenges. Tracking each peer/nonce pair fixes that defect
without raising the pending bound or accepting replayed proofs. Duplicate active
challenges still receive only one signature.

The repair and tests were included by another session in `72067a43`. All 32 focused
identity, request-lifecycle and whole-generation tests pass. The actual
[Verification Worker result](verification-worker.json) passes with an existing
relative-import warning. An isolated browser delivery was rebuilt and checked.

An initial preflight refused the final rerun because it required less than 1 GiB
of existing GPU use. Inspection identified two unrelated public 0.8B/2B providers,
using about 3.6 GB together. They remained untouched. The functional rerun instead
required the measured 27B footprint plus 2 GiB of available GTT headroom and 80 GiB
available system memory; the guard retained its runtime memory reserve and deadline.
This shared-host run supplies no comparative performance claim.

The [repaired-source Playwright result](browser.json) passes the complete journey
without debugger probes (43.52 seconds for the test). The
[hosted Playwright result](hosted-browser.json) also passes on **https://replo.id**
([hosted screenshot](hosted-answer.png)). The hosted test used a controlled private
namespace and a prepared AMD provider; it does not establish public 27B supply.
These reruns pass after the concurrency repair but cannot retrospectively identify
the exact message dropped in the earlier failed attempt.

[Deployment](deployment.json): static Hosting frontend only, source `37feb3be`,
bundle `sha256:6a1c0130e439ea1d4f4c07484bf31be174edc55c3e43a68b5f530e18cc41ed83`.
The live catalog now contains the exact 27B manifest. Existing backend services and
public contributors were not changed. Keeping 27B available requires an explicitly
allocated prepared provider; a deployed selector alone does not provide capacity.

## Repeat the installed conversation check

Prepare the exact native model using `server/native-participant.js` with
`--execution-mode whole-model --contribute` and explicit model directory, identity,
provider modules and resource policy. For a private namespace, use
`--room-token-file`; keep capabilities out of retained commands and logs.
The test does not start providers or download their models.

```sh
REPLOID_NATIVE_CHAT_URL="$TEST_REQUESTER_URL" \
REPLOID_NATIVE_CHAT_MODEL=qwen3-8-27b-text-f16-af32 \
REPLOID_E2E_BASE_URL="$TEST_ORIGIN" \
REPLOID_E2E_SKIP_LOCAL_SERVER=1 \
REPLOID_E2E_CHROMIUM_CHANNEL=chrome \
npx playwright test --config tests/playwright.config.js \
  tests/e2e/chat-native-whole-model.spec.js --project chromium
```

Use the matching browser bundle and native source. The test verifies actual
execution identity, follow-up, cancellation, reuse and reload; a listed model or
ready advertisement alone cannot pass it.
