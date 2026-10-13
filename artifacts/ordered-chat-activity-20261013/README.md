# Ordered-route chat activity

Component: ordinary ordered execution receipts and conversation activity. Intent: preserved. Boundary effects: per-stage elapsed invocation time enters the existing bounded completion summary; UI reads the actual full route rather than an A/B pair. No protocol identity, runtime package, public pin, generated delivery, or CSS recipe changes.

The runner records stage invocation time (including remote invocation/runtime overhead, excluding the stage lease wait). Each completed traversal returns one selected token. The compact summary retains measured count/total per stage and does not turn missing observations into zero-duration samples. The conversation projection displays every assigned stage, keeps friendly labels after discovery disappears, identifies requesters that also execute, and renders one recorded-time-share bar with per-stage token rates only when observations exist. Stage labels do not invent layer ranges or physical-machine independence.

Validation:

- `unit.log`: focused UI, bounded summary, runner and ordered entry checks. Initial exact-shape assertion failure is retained in `initial-failure.md`; the follow-up requires measured fields without dropping identity/order/count assertions.
- `node artifacts/ordered-chat-activity-20261013/verify-worker.js`: actual Verification Worker, hashed source and retained warnings in `worker.json`.
- `npm run verify:library-types` and `npm run verify:catscan` pass.
- `node artifacts/ordered-chat-activity-20261013/browser-check.js`: eight Chromium presentation cases, light/dark, 320/1280 px, pending/measured seven-stage activity. Actual source modules and CSS, injected attempt receipts. Screenshots and `browser.json` retained; owned browser/server close in finally. No GPU/model execution. The 320 px light measured screenshot was visually inspected; it has one bar, seven readable rows and no horizontal overflow.

Limits: requester entry currently forwards text during generation and timing in the final bounded receipt. Before that receipt, missing metrics stay pending; this change does not establish live per-token telemetry. UI fixtures are not physical-phone or unfamiliar-user acceptance. Source numerical stages are injected, so their elapsed values establish measurement plumbing only, not hardware speed. Exact installed N-stage inference, signed acquisition, demanding concurrent conversations, automatic host composition and deployment remain open in [ROADMAP.md](../../ROADMAP.md).
