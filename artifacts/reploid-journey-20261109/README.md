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

Public-provider termination, a replacement provider, an actual remote adapter,
GPU recognition accuracy and Flash-Next qualification are outside this receipt.
The existing provider was not restarted. Reported hardware is not attestation.

Component: Poolday interface and verification evidence.
Intent: preserved. Boundary effects: browser radio selection notification and
regenerated hosted assets; no inference, permissions or model policy change.
