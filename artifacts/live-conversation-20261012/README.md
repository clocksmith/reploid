# Ordinary distributed conversation — 2026-10-12

The actual conversation interface completed browser/browser and browser/native
requests. This is local physical integration evidence, not a public deployment or
numerical/model-quality qualification.

## Executed configurations

- Requester: headed Chrome on Mac, `http://localhost:8000/`, persistent profile
  `live-requester-20261012`. No model-origin/shard requests were observed by the
  request controllers. The requester never contributes or opens Doppler weights.
- File supplier: separate browser/profile on Mac, verified local model files.
- Input partition: Chromium on the physical Suby computer, layers 0–11,
  participant `peer:0b4018c83a3f71679522bb52`.
- Initial output partition: Chrome on Mac, layers 12–23,
  participant `peer:dd8252a3cc6dfe8aa08b10e6` after the diagnostic restart.
- Replacement output partition: actual Node on x@128 with Dawn/AMD Vulkan,
  participant `peer:6fef3a618f40d5acfc712941`. It does not launch a browser.
  [Native ownership, package and provider receipts](../native-participant-20261012/README.md).
- Standard Doppler 0.6.27 archive remains SHA-256
  `9280ead598b098f9f3ad49574a001e88c3ad4b1a433d58349e79ee0e9c01fccc`.
- Model: `qwen-3-5-0-8b-q4k-ehaf16`, identity
  `sha256:18fe30e2c65c47bfdaa1f6714ced9fa90ed8c482a8d57b95cf0cdd4490e842e9`.
- Plan: `sha256:c908ebff98a542b556e6b78417e4e6a4e4014c8c50a7c47ba36665cf4f2097a0`.
- Initial application manifest: `sha256:f99260044a90f747e7211732bc581c0c4e37cdef48eaee8c4b7b60062e72a1bc`.
  Requester manifest after the permission repairs:
  `sha256:4715180537328cad94623d85eef6f70855f4c0675b269cde289fd8b9a21d4c92`.
  After the remote-preparation repair and for the final return:
  `sha256:5d67a79a402ad04a146fe3b7d5c43a33ac907a0c2fdc11722ace629e7a992ac8`
  (1,904 served files freshly verified).
  Contributors remained loaded during requester fixes; these observations are
  deliberately not claimed as a frozen identical-build release sequence.

## Results and limits

| Observation | Retained result |
| --- | --- |
| Two browser participants stream an answer and follow-up | [requester.json](requester.json), complete; follow-up's explanation is inaccurate |
| Stop one browser conversation while another completes | [concurrency.json](concurrency.json), cancelled partial retained, other answer completes |
| Attached invoice | Correct $900 amount, missing required passage citation, false attribution to the Total line; quality **fails** |
| Native replaces stopped Mac contribution | [native-retry.json](native-retry.json), new approved attempt answers $36; prior failed attempt retained |
| Empty Node cache acquires its partition and generates | [native-cold-conversation.json](native-cold-conversation.json), $36 then history-dependent $48, reusable scoped approval, no requester weight HTTP requests; [75-piece acquisition](../native-files-20261012/README.md) |
| Browser replaces stopped native output owner | [output-owner-return.json](output-owner-return.json), new output identity requires fresh approval; same conversation correctly answers $60 for five tickets and preserves every earlier message |
| Native concurrent cancellation | [native-concurrency.json](native-concurrency.json), one cancelled, other answers $36 |
| Human review exceeds readiness TTL | [delayed-approval.json](delayed-approval.json), 15,000 ms review then completed $36 with the same approved pair |
| Close actual requester RTC input-owner connection | [rtc-recovery.json](rtc-recovery.json), new connection observed; all three other connections remain connected |
| Follow-up after RTC reconnection | [after-rtc-recovery.json](after-rtc-recovery.json), same history yields correct $48 for four tickets |
| Terminate input contributor during streaming | [input-owner-loss.json](input-owner-loss.json), 306-character partial retained; unknown remote cleanup remains explicit |
| Restart input contributor with a new identity | [input-owner-retry.json](input-owner-retry.json), separately approved fresh attempt completes; old attempt and messages remain byte-for-byte unchanged |
| Reuse and revoke disclosure permission | [permission-revocation.json](permission-revocation.json), approved answer, follow-up reuse, revoke while streaming, fresh approval required, declined input never executes |
| Return to saved conversation | [return.json](return.json), messages and thread draft retained; source disclosure, Copy and phone drawer work |

The phone check uses a 390 × 844 browser viewport. It is not a physical phone or
an unfamiliar-user session. Reopening the saved thread restores its draft;
automatic selection of that thread on reload is not claimed.

Native resident weights were 285,497,344 bytes; its observed accounted peak was
497,336,720 bytes. These short-request results do **not** replace the frozen
1,588-token memory sequence or measure total process RAM. Native requests settled
and weights remained resident between them; provider receipts retain the details.

The replacement checklist completes ten items, but contains questionable backup advice
(for example reinstalling the backup app as a routine step). This qualifies recovery,
not useful-answer quality. Suby was restarted on `29f4b223`; its new input identity is
`peer:39b36f733c5fe9229a0331ee`. The Mac output stayed resident.

Full Linux repository validation at `5a1f6e27` passed 287 test files and 3,100 tests,
with 3 files / 29 tests explicitly skipped. Raw output: `full-unit-linux.log.gz`.
This sweep predates the subsequent native file-sharing implementation.

## Broken boundaries repaired

1. The operator launcher still selected removed UI controls. It now uses the
   current device inspector and explicit contribution switch.
2. A failed direct peer was removed permanently while signaling stayed healthy.
   The transport now uses its existing bounded discovery rejoin to reacquire the
   admitted peer list, preserving healthy direct channels and never replaying work.
3. Readiness expired during human approval. The requester now refreshes readiness
   after approval, freezes reviewed inputs, retains consent expiry, and rejects a
   changed model/plan/recipient pair without sending the input.
4. Attachment serialization appeared in thread labels. Labels now use the same
   parsed question projection as messages; execution inputs remain unchanged.
5. Partition approval visually showed only one recipient. It now displays both
   recipient labels and their disclosure roles; technical details retain exact
   identities and the model/plan binding.

Focused regressions failed before their respective repairs. Transport, partition,
conversation and actual Verification Worker results are retained alongside this
receipt. The preparation observer also now resumes only its own breakpoint; an
initial conflicting diagnostic attachment terminated its owned Mac launcher.
That diagnostic failure is not classified as a runtime or GPU failure.

6. Ordinary partition previews identified the input contributor, while reusable
   grant matching expected the output contributor. The existing persisted pair
   now binds both explicitly reviewed identities, preserving legacy grants and
   requiring new approval for either replacement. Declining disclosure cancels
   before dispatch and displays “Not sent” rather than a network failure.
   The regression failed before correction; 64 focused tests and the actual
   Verification Worker pass. The physical reuse/revoke/decline sequence passes.

7. During real cold acquisition, the requester displayed “No model available”
   and Retry connection despite an authenticated contributor advertising loading.
   It now projects that observed preparation state for a matching catalog model;
   Send stays disabled, the draft stays local, and unavailable/expired peers do
   not count as preparation. The focused regression failed before repair;
   19 UI unit checks and the actual Verification Worker pass. This repair's
   preparing-state check is simulated; the source failure was physically observed.

The combined Linux repository suite at `ce4ff445` passes 288 files / 3,112 tests,
with 3 files / 29 tests skipped. `reploid-combined-unit-final-20261012.log.gz`
retains the complete result. Its initial single charter-length failure is kept in
`reploid-combined-unit-20261012.log.gz`; the charter was shortened before rerun.
The subsequent preparing-state UI change has the focused checks above.

The final browser check passes all 12 scripted interaction/layout cases in
`conversation-acceptance.spec.js` and `conversation-repair.spec.js`, including
the actual Verification Worker. `browser-conversation-pass.log.gz` retains the
result. The first run failed five cases: its permission fixture omitted the
second recipient, and its visual fixture mounted a second inspector without
detaching the real host. Both fixtures now follow the actual host contract;
assertions remain intact. `browser-fixture-failures.log.gz` preserves that run.
These fixtures do not add numerical, physical-phone or human acceptance.

## Failed and invalid observations

- [native-cold-preparation-timeout.json](native-cold-preparation-timeout.json)
  retains the 180-second controller wait expiring while acquisition was still
  progressing. No request had been submitted. Actual acquisition continued to
  readiness; there was no origin fallback or budget increase.
- [native-cold-url-classifier-failure.json](native-cold-url-classifier-failure.json)
  records two completed correct answers but a false-positive weight request:
  the controller mistook `piece-acquisition.js` for a weight-piece URL. The fixed
  classifier requires a full 64-digit piece hash; repeating both requests passes.
- [permission-revocation-unavailable.json](permission-revocation-unavailable.json)
  retains the hidden reusable-approval control.
- [permission-decline-failure.json](permission-decline-failure.json) retains the
  successful revocation but incorrect failure classification after Decline.
- [preparation-timeout.json](preparation-timeout.json) and
  [second-preparation-timeout.json](second-preparation-timeout.json) retain the
  unavailable-model runs before connection recovery. Restart/reload restored the
  path before the transport repair; those restarts alone did not prove a fix.
- [native-approval-visibility-failure.json](native-approval-visibility-failure.json)
  records the missing visible second recipient. Exact identities were present in
  collapsed technical details, so it is a presentation failure, not evidence of
  an unauthorized recipient.
- `native-conversation.json` is **not an acceptance receipt**: its polling followed
  the thread's latest attempt and could observe a later retry. Use `native-retry.json`
  and the later attempt-ID-bound controls instead. The failed original attempt
  reports `Refresh an available entry before requesting execution`.
- A return-controller initially expected the previous thread to be automatically
  selected after reload. Its stored draft was intact; the corrected control
  explicitly reopened that thread.

## Prepared delivery bytes

`npm run prepare:hosting` validates the exact accepted archive projection and
produces 1,905 hosting files (1,904 assets plus the manifest). Fresh HTTP reads
from the local server match every declared asset at bundle identity
`5d67a79a402ad04a146fe3b7d5c43a33ac907a0c2fdc11722ace629e7a992ac8`.
`hosting-preparation.log.gz` and `local-served-identity.log.gz` retain these checks.
This is prepared local delivery, not a public deployment or runtime promotion.

## Contribution settlement and explicit recovery

Component: automatic partition contribution, resident ownership, and its existing
Network controls. Intent: preserved. Failed cleanup retains the owner and charged
reservations; overlapping stops share settlement. A cancelled loader cannot
retire a replacement, and replacement admission stays closed until cleanup succeeds.
The existing panel offers **Retry stopping** after failed cleanup. A successful
retry clears only its own error. Boundary effects: shared partition lifecycle,
browser host state, and its presentation; Doppler and its accepted archive are unchanged.

Three automatic-owner regressions and one resident-disposal regression failed
before the fix. The UI retry regression also failed before implementation.
The retained `*-before.log.gz` files show these failures. The canonical focused
run passes **74 tests across six files** (`contribution-settlement-final.log.gz`),
**12 Chromium interaction checks** pass (`settlement-browser.log.gz`), architecture
checks pass (`settlement-layers.log.gz`), and the actual Verification Worker passes
with 13 warnings and no errors (`settlement-worker.json`). Cleanup failure is
injected in these focused tests; no physical GPU driver failure is claimed.

The physical Mac contributor was stopped during a Suby/Mac answer. It settled to
Not sharing, retained the partial answer, and was explicitly enabled again.
The immediate retry encountered stale ready presentation and failed before
approval: `contribution-stop-readiness-failure.json` retains that observation.
A later explicit approved retry completed, retaining prior messages exactly:
`contribution-stop-retry.json`. Its `ok` field establishes lifecycle completion,
not answer quality: the answer wrongly describes an online cloud service as an
offline backup. That remains a model-quality failure. Controllers are retained.
`settlement-owner-return.json` separately records the fresh recipient approval
and correct $72 follow-up after contributor reload. These runs use the accepted
pin and pinned-manifest opening; they are not a frozen signed release sequence.

## Full unit sweep on x@128

At `61c2290f`, all **258 unit files / 2,697 tests** pass with 18 declared skips:
`npx vitest run --config tests/vitest.config.js tests/unit --maxWorkers=2`.
`settlement-unit-pass.log.gz` retains the run. The first unrestricted run hit
its unchanged five-second timeout importing the pinned package; its failure is
retained in `settlement-unit-timeout.log.gz`. Limiting test concurrency resolved
that observation; no assertion or timeout was weakened. The CLI rejects Vitest's
`--maxWorkers` argument, so the successful bounded invocation used Vitest directly.

The same committed source packaged and verified all 1,904 served assets at
`70caf8f9efd3bba10b6c3611247dc40046a7882c85b9cb0b47ee752900dc2e1a`.
`settlement-hosting.log.gz` and `settlement-served.log.gz` retain local delivery
checks. Later readiness changes receive their own generated bundle identity.

## Still open

Numerical acceptance remains failed against the approved F64 target at 0.001.
Document usefulness/citations remain unqualified. Opening here uses verified
pinned manifests, not signed Capsule physical opening. Both-placement release
acceptance, the exact long-prompt lifecycle sequence on a replacement archive,
and deployment remain open in the [canonical TODO](../../TODO.md).
