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
  reselection. The existing conversation suite still emits a localhost:3000
  connection-refused diagnostic; it exits successfully. This is not provider
  evidence.
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

Public-provider termination, a replacement provider, an actual remote adapter,
GPU recognition accuracy and Flash-Next qualification are outside this receipt.
The existing provider was not restarted. Reported hardware is not attestation.

Component: Poolday interface and verification evidence.
Intent: preserved. Boundary effects: browser radio selection notification and
regenerated hosted assets; no inference, permissions or model policy change.
