# Preserve preparation failures at the tokenizer boundary

Component: browser/native partition host. Intent: preserved. The accepted Doppler
archive and model computation are unchanged.

The pinned tokenizer catches an authoritative host acquisition error before trying
fallback storage. This hid absent authorized supply behind a generic instruction
to clear browser storage, and could accept a fallback after the source failed.
The host now retains the original failure and refuses readiness in that case.
Existing resident/storage cleanup still runs. A cleanup failure remains visible
and does not release unresolved ownership.

## Evidence

- `regression-before.log`: four new browser/native cases fail before the repair.
- `tests.log`: 73 partition, contribution and automatic-lifecycle tests pass,
  including hidden-error, false fallback success, cleanup failure and unchanged
  successful acquisition/error cases.
- `worker-verification.json`: the actual browser Verification Worker passes the
  source and regression files; warnings are retained, with no errors.
- `cold-contributor.json`: fresh Mac Chrome on the public network, overriding only
  the two changed browser host modules (their exact sources are retained). The
  runtime and remaining served assets are unchanged. Temporarily withdrawing
  x's authorized file supply produces `No peer offers the required verified model
  piece`, without the misleading tokenizer/storage instruction. Restoring supply
  and explicitly retrying reaches Ready. The fresh contributor keeps file sharing
  disabled. Supplier restoration and inspector detachment are confirmed, with
  zero native active/unsettled reservations. This is preparation acceptance, not
  signed-Capsule or numerical inference qualification.

The operator harness `cold-contributor.js` controls only the existing authorized
supplier and its own disposable browser. It is not application code. The receipt
also exposes the old supplier's counter resetting on stop/start; durable allowance
repair is tracked separately and no lifetime usage is inferred from that counter.

Boundary effects: host tokenizer-source failures now survive runtime fallback;
no package pin, permission, model, scheduler or precision changes. Deployment and
native installation are separate from this source-override evidence.
