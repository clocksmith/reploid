# Concurrent fixture memory observation repair

CPU preparation for the existing simultaneous 1,588-token test found that its memory assertion demanded `device.lost`, a field absent from Doppler's actual `inspectDeviceMemory` snapshot. The frozen preparation observer already retains device loss/uncaptured errors in `deviceEvents` and read failures in `observationErrors`; snapshots follow a completed queue barrier.

The fixture now requires both observed arrays to exist and be empty. It preserves the unchanged device ceiling, two live attempts, submitted cancellation, unchanged survivor tokens, retained weights and explicit fresh retry checks. The regression fixture now matches the actual snapshot shape rather than inventing `lost:false`.

Before-fix failure and after-fix 7 passing CPU controls are retained, including device loss, missing observation and failed observation rejection. Actual Verification Worker passed with no errors and one tooling warning. This is fixture validation, not physical concurrency evidence; the next physical run uses the unchanged standard 0.6.28 archive.

Component: verification evidence. Intent: preserved. Boundary effects: fixture observation schema only, no production runtime or allocation policy change.

The first physical concurrent baseline on standard archive `102fd0c4…` did not
produce a token from the unchanged 1,588-token prompt. It was stopped by the
operator after the controller was found to have no elapsed bound on execution
or its first cleanup queue barrier. `failed-unbounded/operator-stop.json` binds
the raw failed capture and process observations. AMD close and queue settlement
were confirmed; Mac browser/process termination did **not** confirm Mac GPU
ownership settlement. Two live attempts, survivor correctness and reuse were
never reached. This is a rejected incomplete control, not memory acceptance.

The fixture now declares a 300,000 ms operation deadline, 10,000 ms cleanup
operation deadline, 2,000 ms observation deadline and 1,000 ms sampling interval.
Preparation and every group invocation are observed while pending. Snapshots
retain actual last submissions and pending shader/pipeline preparation without
waiting for queue completion. Recent history is bounded with dropped-record
counts; failed operations are retained. Timeout leaves completion and ownership
unknown; an unrelated owner still receives its close attempt. Context/browser
close is separately bounded and does not retroactively establish GPU cleanup.
The application's 300-second policy, model, inputs, runtime archive and budgets
are unchanged. These are test-controller bounds, not permission to extend an
application request or evidence that a timed-out GPU operation was cancelled.

Fourteen focused synthetic controls cover completion, cancellation, preservation
of the original failure, a stalled execution/close pair, nonresponsive observer,
and rejection of expanded execution limits. The actual Verification Worker
passed with zero errors and twelve warnings (`bounded-worker.json`). Physical
rerun of this corrected controller remains pending a separately frozen delivery
and the next explicitly released GPU window.

The same canonical fixture commit also retains the separately authorized native preparation and group-stage timestamps. They do not alter computation or execution options. Sampling persistence failures have separate records and cannot replace the original timeout; successful work with failed evidence persistence is rejected.
