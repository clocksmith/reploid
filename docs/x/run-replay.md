# Recorded run playback

X and Zero expose **Recordings** on the boot screen, before Awaken, and passive
playback under runtime **Inspect**. Import a `reploid.run-trace.v1` JSON file,
then Play, Pause, Step, Restart or seek by event. Speeds are 1x, 8x, 64x and 256x.
Playback applies every event in original order and batches rendering. The panel
shows the latest 80 applied events; seek to inspect earlier records.

Playback is not a fresh run. It does not call a model, execute tools, restore a
VFS, select a provider, replace the goal or approve an operation. Imported code
and tool arguments are displayed as text. The older **Import setup JSON** control
only fills setup for a new run; it is not playback.

## Recording and export

The existing agent adapter records completed visible model replies, ordered tool
executor calls and their final results/errors, loop observations (including policy
rejections), and status/error events. Executor calls have unique call IDs; final
loop observations are distinguished from executor results. Timestamps, configured
model/provider identities and available build/source/model revisions are retained.
Unknown revisions stay null. Token-level streaming timing, interrupted partial replies, and internal retry timing are not recorded.

The recorder retains a bounded in-memory prefix of the current run: at most 4096
events, 128 KiB per event, less than 4 MiB total, and seven days of timestamps. The first overflow stops
recording further events and increments the visible omitted-event count. It never
silently evicts earlier evidence. The existing per-instance VFS saves the sanitized
trace after at most 250 ms of coalescing and flushes it when a run settles, exports,
or closes. Reloading the page does not erase a saved run. Abrupt tab termination
can lose the current unflushed tail; browser storage is local, not a backup.

Each new run gets a separate recording, up to eight files (at most 32 MiB). No old
recording is silently overwritten or evicted. At capacity, on storage or browser Web Locks failure, or
if another writer changes the saved file, the current run remains in memory and a
visible warning asks you to export it before leaving. **Refresh saved** and **Load
saved** work from boot Recordings without awakening an agent. Imported files are
playback-only and are not written into this instance's saved recordings.

**Export run JSON** opens a full preview. Download occurs only after **Download
reviewed JSON**. Exports omit system prompts, hidden reasoning, private request
context and raw VFS files. Credential-like keys and known credential patterns are
redacted, but arbitrary text and tool output may still contain private information.
Review before downloading or sharing. Recording and playback are evidence, not
independent evaluation, permission, promotion or a claim of recursive improvement.

Imports validate schema, UTF-8 size, nesting, event count, timestamps/order, event
types and tool call/result identities before replacing the current recording. A
malformed import leaves the previously loaded trace intact. No import is evaluated
as JavaScript or dispatched as a live runtime event.

Existing version 1.1 state exports and earlier run-replay VFS timeline bundles
also normalize to this passive trace format. Only timeline evidence is read;
other saved files are not restored. Known request/context/reasoning records are
omitted, unpaired tool results remain observations, and other event names become
inert attributed evidence. The same bounds apply before replacing loaded state,
including after redaction expands values. Oversized legacy exports are rejected,
not silently truncated.

## Focused evidence

- `tests/unit/run-trace-playback.test.js`: validation, redaction, bounded omission,
  exact ordered playback at all speeds, pause/seek/restart, inert content, export
  preview, durable roundtrip, bounded saved-run preservation and imported re-execution rejection.
- `tests/unit/zero-boot-recordings.test.js`: import and playback before awakening,
  without provider, goal or storage changes.
- `tests/integration/replay-engine.test.js` and `tests/unit/proto-replay.test.js`:
  bounded legacy normalization, retained-state rejection, and the existing
  workbench caller using supported speeds and escaped passive event text.
- `tests/integration/agent-loop.test.js`: mocked model response and real adapter
  recording of tool attempts, results and provenance. These are synthetic tests,
  not live model or RSI qualification runs.

A separate warm-instance browser check played 18 saved synthetic events at 256x
without fresh model calls. Fresh-file import through the browser picker remains
unverified. Neither this playback check nor source publication establishes an
L1, L2 or L3 pass.

*Last updated: October 2026*
