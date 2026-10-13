# Public streamed-answer interruption

Component: model partition coordination. Intent: preserved. Boundary effects: discovery-to-execution lifetime only; runtime archive, math, permissions and wire format unchanged.

The user's replo.id screenshot shows partial JavaScript output followed by `Partition peer declined or failed request`. The deployed bundle remains `55978b55…` from `07907105`, on accepted Doppler 0.6.27.

The adjacent native snapshots in `native-trace.json` identify an attempt in the screenshot time window: `17f433e3-b437-488b-ac89-184ec92cae15`. Its output contributor advertisement expired at 01:35:53.907Z. The input owner's placement became empty; the active runner failed with `Partition runner closed` at 01:35:53.952Z. The same output transport reappeared at 01:35:55.962Z. The screenshot has no attempt identifier, so exact screenshot attribution remains provisional; this trace independently proves the active-route interruption defect.

`automatic-partitions.js` previously closed the chat on missing or changed discovery placement, even during active execution. It now retains that route while attempts remain active and its execution channel is open. Signed request permissions still apply; channel closure and explicit contribution stop retain their cleanup paths. After settlement, placement may choose a replacement while preserving resident weights.

The new regression fails on the original close and passes after the repair. Thirteen focused lifetime, stop/cleanup and placement tests pass. Tests inject discovery/chat ports and establish owner behavior, not physical execution. `regression-before.txt` and `regression-after.txt` preserve both results.

Fresh public observations are separate: the first harness incorrectly waited for an obsolete approval selector while the ordinary Send-authorized request had already streamed. A second eight-second observer was closed during streaming; it proves neither completion nor the user's failure. The subsequent requester could not obtain usable capacity within 45 seconds. These harness failures are retained, not counted as release acceptance. The continuing observation retains current availability and any actual request outcome. No new runtime or public deployment is claimed by this receipt.
