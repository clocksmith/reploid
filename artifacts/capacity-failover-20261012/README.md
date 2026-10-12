# Public capacity loss and preparation recovery

Component: Reploid automatic partition preparation, authorized custody and native status.
Intent: preserved. Doppler archive and numerical/model-quality gates unchanged.
Boundary effects: browser/native hosts can release a successfully settled preparation
registration; inventory replacement cannot renew the custody owner's byte allowance;
periodic native status omits full receipts, which remain available through getFileState().

## Physical public controls

The public bundle was `baaaa699e6738a968c500e060993a3139f8b7f79016d10b0b0f998f97066d4bf`,
using accepted Doppler 0.6.27. Model/plan/package identities are retained in the receipts.
Opening used verified pinned manifests, **not qualified signed Capsule inference**.

- At 15:28:09 UTC, x@128's native input compute stopped with zero active/unsettled
  reservations; its separately authorized file supplier stayed on. Suby's native
  output automatically selected input ownership and acquired missing verified pieces.
- A fresh public requester, without invitations or selected participants, completed
  `$36` then `$48` using Suby native input and x@128 browser output. Both approval
  records name the actual pair, model and complete input history. No HTTP weight
  request was observed. The input owner recorded two settled reservations, zero
  active reservations and zero unsettled owners. This is an observed recovery, not
  a latency benchmark: receipt polling/debugger inspection was present.
- Re-enabling x's compute prepared it as an output replica, preserving Suby's
  new input placement. Disabling only x's file supply then left that prepared
  path able to complete another `$36`/`$48` conversation.
- A fresh Mac browser with no supplier reproduced a preparation failure and
  misleading `Cleanup not confirmed` state. The original failed harness also
  expected the nonexistent label `Unavailable` and tried the disabled switch;
  that failed receipt is retained separately, not called acceptance.

## Repairs and physical retry

The host had already closed the failed preparation, but automatic coordination
retained its registration unconditionally. The registration now returns a release
callback; browser/native hosts invoke it only after every owned cleanup succeeds.
Failed or unconfirmed cleanup stays owned and continues to require explicit retry.

The patched local browser joined the same public network. With supplier disabled,
it displayed `Failed` with no false unsettled owner. After the existing supplier
was restored, explicit off/on preparation acquired assigned pieces and became
Ready at 15:39:02 UTC, then stopped. Peak tracked GPU allocation was 497,336,720
bytes under the unchanged 1,420,000,000-byte ceiling. This cold control did not
execute a conversation. Tokenizer failure copy still obscures the missing-supplier
cause; this test does not qualify that error presentation.

The operational test also observed supply accounting reset on an inventory offer.
The fix preserves the exchange owner's charged bytes across inventory replacement
and stop/start. A regression consumes its full allowance and proves both routes
cannot acquire further bytes. The old running supplier's counters reset during the
physical test; their cumulative observed total was 2,189,643,264 bytes, below its
4 GiB allowance. These observations do not qualify persistence across process restart.

Suby's existing native status repeatedly serialized all signed transfer receipts,
producing a log exceeding 1 GiB. Periodic status now requests a summary with a receipt
count; direct inspection retains the complete bounded receipt history. The new
native artifact is recorded in `native-package.json`; building it does not establish
that existing public native processes have upgraded.

## Validation and limits

- 115 focused preparation/resident/placement/native tests passed.
- 106 custody/native-file tests passed (overlap with the previous group).
- 12 chat/rail/browser-owner checks and five real-browser custody checks passed.
- The actual Verification Worker passed changed production and unit-test sources
  with warnings and no errors (`worker-verification.json`).
- The operator harness scan was separately rejected for Node process/SSH/inspector
  and direct test-storage operations. That rejection remains retained; these tools
  are not being admitted into the browser agent sandbox.
- Generated library mirrors and the 1,909-file bundle were refreshed from sources.
- `compressed-evidence.json` binds gzip receipts to exact uncompressed SHA-256s.

No new numerical/model-quality acceptance, simultaneous long-prompt acceptance,
physical-phone observation or arbitrary-NAT claim follows. Both existing native
contributors were ready, idle and settled at final inspection; both loopback
inspectors were closed. Existing public browser contributors remained running.
