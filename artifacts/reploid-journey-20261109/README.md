# Deliberate model selection and live whole-model chat

Clicking the already checked automatic model did not emit the select's change
notification. Discovery could replace that staged choice before the user pressed
Use model. The regression first failed with the selected 0.8B replaced by 2B.
The shared radio binding now reports deliberate reselection by mouse or Space,
without duplicating a new choice or interfering with arrow navigation. Untouched
pickers still follow discovery; cancellation neither pins a choice nor downloads
weights. Confirmation remains the commitment.

## Acceptance

- 50 tests pass across `model-select.test.js` and
  `conversation-workspace.test.js`, including discovery after deliberate
  reselection. The original localhost:3000 diagnostic was traced to a download
  metadata read in a presentation fixture. That fixture now supplies the same
  explicit download-metadata port as the other component fixtures; no network
  request or suppressed exception is needed. This is not provider evidence.
- 29 controlled tests pass across `chat-peer-lifecycle.test.js` and
  `work-swarm-lifecycle.test.js`. These cover signed in-process peers and
  controlled execution, not physical inference.
- [Chrome control check](picker-browser.json) exercises the packaged picker with
  mouse reselection, a different radio, ArrowUp and Space, emitting one event
  per action.
- [Live 27B check](live-27b.json) uses the deployed application and an existing
  prepared AMD provider: 42, contextual follow-up 40, Stop, explicit retry,
  reuse, recorded hardware, independent drafts and reload. It downloads no
  requester weights and reports no page errors. These tiny answers do not
  qualify general model quality or throughput. This pre-publication observation
  uses the preceding deployed build; post-publication evidence is separate.
- Changed-file ESLint, CSS layers and exact hosting packaging pass. The existing
  physical browser test now opens the current Model details disclosure, uses
  the visible Stop control and inspects hardware in the conversation drawer.

The [deployed check](deployed.json) matches the served bundle and model-control
module byte for byte, then verifies deliberate reselection by desktop mouse,
keyboard and touch at 390 pixels. No page errors or horizontal overflow.

## Native startup repair

The isolated provider journey exposed a startup crash before inference:
`config.mesh.maxRetainedJobs` read the resolved configuration envelope as its
settings. The journal now consumes the validated value from
`requireResolvedConfig`, preserving the configured retention and message limits.
The regression failed with the original TypeError and now opens a real SQLite
journal, closes it with its participant, recovers its result after restart and
rejects replay. Transport and inference remain doubles in that regression.
All 21 tests across native earning, native participant and generation recovery
pass. Existing public providers remain untouched; this is a source repair for
new native processes, not a restart of a serving participant.

## Owned physical-provider journey

[The final private-room run](owned-provider.json) passes nine actual inference
attempts with two isolated Chromium requesters and one AMD native provider:
follow-up, reload, overlapping requests, cancellation of one while the other
finishes, reuse, provider process termination, preserved partial output, and
explicit retry to a different signing identity. The replacement completes all
20 requested numbers. The other conversation and both histories stay intact.
Every request binds the same catalog model identity; requester weight requests
and page errors are empty.

An earlier run correctly refused the 100-number retry as incomplete at the
unchanged 256-token cap. Its failed verdict, completion record and raw receipt
digest remain in the final receipt. The lifecycle fixture now uses the existing
20-number prompt, which fits that bound, and checks the entire answer. No
production limit or quality threshold was changed to obtain a pass.

The native runtime's 1,852 packaged files match Reploid's exact 0.6.33 archive.
The test uses the shared GPU lock. Its processes and local web server are stopped;
the existing public 27B process and TTM setting remain unchanged. Large original
logs and private room configuration remain in operator-local test state.

Reproduce with `tests/e2e/chat-model-service-journey.spec.js`, an operator-owned
`REPLOID_SERVICE_CAMPAIGN`, prepared exact model files and private room token.
The harness owns provider startup, termination and replacement. Never configure
it with an existing provider's identity/state directory. SwiftShader supplies
requester presentation only; native inference uses the physical AMD GPU.

This does not test different physical providers/operators, an actual remote
adapter, general answer quality, throughput, GPU recognition accuracy or
Flash-Next qualification. The existing provider was not restarted. Reported
hardware is not attestation. No billing was activated.

Component: Poolday interface and verification evidence.
Intent: preserved. Boundary effects: browser radio selection notification and
regenerated hosted assets; no inference, permissions or model policy change.
