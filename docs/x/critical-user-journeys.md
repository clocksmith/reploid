# X Critical User Journeys

X is the mature governed agent workspace at `/x`. Its canonical status registry
is [`../status/x-critical-user-journeys.json`](../status/x-critical-user-journeys.json).
It extends [Zero's registry](../status/zero-critical-user-journeys.json): each Zero
journey is either inherited by reference or overridden by an X journey whose
status or outcome differs, and X never restates one (`npm run verify:journeys`).
X starts from the Zero core: its **Optional upgrades** selector defaults to
"None: Zero core" ([self-source contract](self-source.md)). With no upgrade `/x`
boots Zero's capsule (`self/zero/boot.js`) through `self/host/boot-x.js` with
Zero's exact tools and capsule closure; the prebuilt file, promotion,
optimization, cognition, worker, and swarm capabilities (and the denser operator
UI) load only when an operator selects an upgrade level above `spark`.
[zero-extension.json](zero-extension.json) records the two-file `/x`
upgrade-selector adapter (`npm run verify:x-extension`).

## Current journey status

<!-- generated:journey-status (npm run build:journeys) -->
| Journey | Status | Honest outcome |
| --- | --- | --- |
| Configure and awaken | Conditional | Browser, direct, or proxy inference can awaken the full substrate when configuration and VFS loading succeed. |
| Run, steer, stop, and resume | Conditional | Timeline, human input, stop/resume, status, and telemetry exist; the complete control loop is not yet one end-to-end test. |
| Inspect, edit, and recover workspace | Supported | The operator can browse the VFS, use writable roots, preserve state across reload, and keep direct `/self` writes blocked. |
| Evaluate and promote a candidate | Supported | Arena evaluation, byte-bound replay evidence, rollback preservation, allowlisting, quarantine, and promotion execute end to end. |
| Optimize Doppler | Conditional | The governed optimization UI and activation contracts work when current Doppler tooling and model artifacts satisfy them. |
| Delegate to workers | Limited | Worker contracts and panels exist, but the browser journey currently proves empty UI states rather than useful completed work. |
| Inspect memory and cognition | Limited | The panels expose produced records, but no held-out evaluation proves that retrieval improves outcomes. |
| Export and replay | Limited | Export and event-replay components exist, but no browser test round-trips one exported X run through the importer. |
| Share files with peers | Limited | Swarm protocols and tools are tested as components, but there is no retained deployed remote-peer exchange. |

X inherits these Zero journeys by reference; their status and evidence stay in the [Zero table](../zero/critical-user-journeys.md#current-journey-status), proved on `/zero`: Grow the tool surface; Apply a self-modification; Prove actual local RSI.
<!-- /generated:journey-status -->

## Promotion boundary

X's `Promote` copies an allowlisted Shadow candidate into `/self` only when
evidence binds the requested paths, candidate bytes, target bytes, and
`replayPassed: true`. It preserves rollback material and quarantines validator
targets. Clockwork-tagged changes require additional trusted Gamma evidence.

Ordinary promotion is not universally human-only. `Promote` is in the X agent's
tool inventory, and the optimization UI can also invoke it. The registry tracks
making this actor and authority visible before activation. Hashes and replay
prove the declared evidence chain; they do not prove arbitrary semantic
correctness.

## Capability versus journey

A loaded module, registered tool, visible tab, or passing unit test is not by
itself a completed user journey. Workers, memory, replay, optimization, and
swarm are separately marked supported, conditional, or limited according to
the strongest executable user-level evidence currently present.

## Open work

Remaining work belongs only in the registry's `openWork` collection. Blueprint
checklists and architecture prose do not own current journey status.

`openWork` records describe journey acceptance gaps, not a second execution
queue. This applies to the X, Zero and archived Poolday registries. The owner's
private roadmap selects implementation; a selected item links back to the
existing journey and evidence IDs. Unselected gaps remain visible
without authorizing another campaign.
