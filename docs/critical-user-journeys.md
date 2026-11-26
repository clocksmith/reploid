# Reploid Critical User Journeys

This is Reploid's one catalogue of critical user journeys: what people intend to
accomplish, the pass/fail criteria for each, and how far each has been shown. It is not
a list of supported configurations or another engineering queue. Implementation
ordering, milestones and plans stay private; the acceptance criteria and evidence status
are here, in public, and nowhere else. The [chat contract](chat-mvp.md) and
[mesh architecture](open-mesh-architecture.md) explain the product and its mechanisms;
neither advances acceptance by itself.

It opens with [the public-page bar](#the-public-page-bar): the owner's four journeys for a
first-time visitor, in the owner's words. The [catalogue](#catalogue) below them holds every
outcome Reploid supports, and each of the four names the catalogue journeys it covers.

## The public-page bar

These four journeys are the owner's statement of what a first-time visitor to
[replo.id](https://replo.id) must be able to do. The owner calls them critical. The text of
each journey and of the acceptance line is the owner's and is kept unchanged; change it only
on the owner's word (a test compares it byte for byte with a pinned copy). Journey *n* in the
list has the stable ID FIRST-0*n*.

<!-- owner-text:start -->
1. **First visit → join the mesh.** When replo.id opens, the browser automatically joins the
   peer network and discovers available model storage and compute. No Join button or network
   setup. Joining lets the visitor use the mesh. It does not make their device a contributor.
2. **Join → ask → get an answer.** The visitor types and sends. Reploid picks defaults
   automatically using what the browser can detect or infer about the device and what's
   available on the mesh. The visitor can change the model or request settings, but neither is
   a prerequisite for sending. Do not infer a privacy preference or budget. The answer appears
   in the conversation, where the visitor can continue chatting.
3. **Use the mesh → contribute.** A visitor can find and start contribution from the same
   experience. They explicitly choose to offer model storage, compute, or both. The journey is
   complete when they can tell what their device is offering and whether it's available to the
   mesh.
4. **Inspect the mesh.** When curious or troubleshooting, a visitor can see which devices are
   ready and what each offers. This is optional; it never gates Ask.

**Acceptance:** A first-time visitor can open replo.id and get an answer without configuring
anything. If they want to contribute, they can find that path without leaving the experience
to figure out how the network works.
<!-- owner-text:end -->

### FIRST-01 — First visit → join the mesh

- **Owner's journey:** 1.
- **Covers:** MESH-03, CHAT-01
- **Acceptance criteria:** Passes when, in a fresh browser profile:
  1. Opening the page joins the peer network with no Join button, network choice or other press.
  2. Without any press, the page lists the computers that are ready and the models they serve, and finds peers that supply model files.
  3. Joining does not start any contribution: the device reports that it is not sharing compute or storage until the visitor opts in (FIRST-03).
- **Evidence status:** not shown. Criteria 1 and 3, and criterion 2 for computers serving models, hold on the deployed page: the public-answer walk at 9aa668035 and the scored fresh-profile batches on the deployed build at bbc49a7ec (every session found its model listed Ready within 60 s, on the tested network, sequentially). Nothing on the page shows that it found peers supplying model files, so criterion 2 is not shown for storage. No catalogue journey states that joining is not contributing; that criterion lives here and in MESH-03.

### FIRST-02 — Join → ask → get an answer

- **Owner's journey:** 2.
- **Covers:** CHAT-01, CHAT-02, CHAT-04, TRUST-01
- **Acceptance criteria:** Passes when, in a fresh browser profile:
  1. The visitor types and presses Send once and an answer appears; no sheet, permission prompt, Join step, charge, budget or authorization step stands in between.
  2. With nothing picked, the page chooses a ready model from what it can detect about the device and what the mesh offers, and names it before Send; the model shown before Send, the model named on the answer and the model that served it (by its signed receipt, when one is sent) are the same.
  3. Before Send, the line above the message field states where the question goes and that the answering computer can read the prompt.
  4. Changing the model is optional, and a model the visitor picks is the model that answers. (What happens to a pick that nothing serves, and across a reload, is CHAT-04's.)
  5. No privacy preference or budget is inferred: nothing asks for one and nothing is charged.
  6. The answer stays in the conversation and the composer stays usable for a follow-up.
- **Evidence status:** physical acceptance on the tested network, sequential sessions only. On the deployed build at bbc49a7ec: 20/20 explicit picks in the scored fresh-profile batch were answered by the picked model with a verifying receipt; first visit 8/8 usable answers, 7/8 from a provider whose identity was verified. The disclosure line has been visible above the message field since 9aa668035, and the public-answer walk on the deployed 9aa668035 passed on desktop and mobile with one press, no prompt or dialog, and an explicit pick. Not shown: remote networks, concurrent visitors, and follow-ups in a scored batch (CHAT-02).

### FIRST-03 — Use the mesh → contribute

- **Owner's journey:** 3.
- **Covers:** CONTRIB-01, CONTRIB-02, CONTRIB-05
- **Acceptance criteria:** Passes when, on desktop and on mobile, a fresh visitor on the same page:
  1. Finds the path to contribute without leaving the experience.
  2. Explicitly chooses to offer model storage, compute or both.
  3. Sees the device report ready for exactly that choice; storage-only never starts compute.
  4. Is seen by another peer as offering it.
  5. Presses Pause; the device stops, and the other peer sees it stop.
- **Evidence status:** not shown. Only criterion 1 is shown: the public-answer walk on the deployed page checks that the path to contribute is visible. No retained run shows criteria 2 to 5 passing; until one does, this journey is unproven beyond discoverability.

### FIRST-04 — Inspect the mesh

- **Owner's journey:** 4.
- **Covers:** MESH-06
- **Acceptance criteria:** Passes when:
  1. From the same page, a visitor can open a view of the mesh and see which computers are ready.
  2. Each listed computer shows what it offers: the model it serves, and whether it supplies model files.
  3. Opening the view is optional: Send stays usable while it is open and after it closes, and nothing in it is required before Ask.
- **Evidence status:** not shown. Criteria 1 and 3, and criterion 2 for served models, hold in the public-answer walk on the deployed 9aa668035. The view does not show which computers supply model files, so criterion 2 is not shown for storage. The catalogue had no journey for this outcome; MESH-06 was added for it.

### Rules that follow from them

These are the owner's rulings on how the page applies the journeys. The code that implements
them is the conversation controller
([`apps/poolday/host/decisions/conversation-controller.js`](../apps/poolday/host/decisions/conversation-controller.js)).

- **The bar is type and send.** Between opening the page and the first answer the visitor
  presses Send once. No sheet, permission prompt, Join step, charge, budget or authorization
  step stands in between.
- **The page may choose the model; it must say which.** With no model picked by the visitor,
  any ready model may answer. The model shown before Send, the model named on the answer and
  the model that served it are the same model, and the shown default follows availability as
  computers come and go, without the visitor acting.
- **A pick is kept.** A model the visitor picked is never replaced for them. When nothing
  serves it, the page says so and sends to no other model. A pick stays a pick across a reload;
  a choice the page made is not remembered as one.
- **Before Send the composer states where the question goes and who can read it.** A visitor
  who chose nothing, on a device that stores no model, asks a public computer; the composer
  names that computer kind, the model and "The answering computer can read your prompt."
  That sentence is shown on the line above the message field, not kept for a screen reader.
  With nobody to answer, nothing leaves the device.

### Checking them

- `npm run verify:public-answer -- --url <site> [--viewport mobile|desktop] [--follow-up]`
  ([`scripts/verify-public-answer.js`](../scripts/verify-public-answer.js)) walks the journeys in
  a fresh browser profile and prints what held and what did not. It sends one fixed public
  prompt to a public computer (two with `--follow-up`). It checks that who can read the prompt
  is visible beside the message field before Send, that one press produced the answer, that the composer, the answer row, the conversation and the stored execution record
  name one model, that a provider-signed receipt verifies when one was sent, and that the
  Computers view lists ready computers, shows where to contribute and shows this device as not
  sharing. It never starts a contribution. `npm run deploy` runs it after each deploy. For
  journey 3 (FIRST-03) it checks **discoverability only**: that the path to contribute is
  visible, not that a visitor can start contributing and become ready.
- **Contribution acceptance (separate check, desktop and mobile).** Journey 3 (FIRST-03) passes
  only when, on each viewport, a fresh visitor opts in to storage, compute or both from the same
  page; the device reports ready for exactly that choice; another peer sees the device offering
  it; and Pause stops it and the other peer sees it stop. Storage-only must never start compute.
  This check is not automated yet, and no retained run shows it passing; until one does,
  journey 3 is unproven beyond discoverability.
- [`tests/unit/first-answer-defaults.test.js`](../tests/unit/first-answer-defaults.test.js) holds
  the decisions behind journey 2 (FIRST-02): the automatic computer and model, following
  availability, a held Send while computers are being found, and kept picks.

A run of the check on one day shows that the journeys held for that browser, on that network,
with the computers then online. It is not a statement about capacity or reliability.

## How journeys are described

Each catalogue journey has one stable ID, actor/trigger, starting conditions, a
main flow, observable success, interruption/recovery, deployment variants, acceptance
evidence, pass/fail acceptance criteria and an evidence status. Variants reuse a journey
rather than creating another goal for every topology. Adding a route stage does not add a
new user goal. Flow length and journeys per family follow the outcomes; neither has a fixed
count.

## Evidence and acceptance

- **Source integration:** linked tests and receipts identify exercised owners,
  injected numerical work and failure controls. They do not establish hardware
  capacity or deployed operation.
- **Physical acceptance:** a retained receipt must bind runtime/archive, model,
  application, providers, placements, resource limits and observed outputs. An
  older or different package's pass does not qualify changed bytes.
- **Release qualification:** the applicable journey must pass on one frozen
  browser/native/runtime/model combination, including fresh and returning users.
  None of the links below grants general N-stage release acceptance.
- **Publication:** the target is output visible only after durable acceptance.
  Physical streaming or preserved text alone does not establish transactional
  publication. Unpublished output must remain hidden; saved text is not a GPU
  checkpoint. Canonical component proof and ordinary physical chat remain
  distinct until integrated for the declared configuration.

Evidence entries point to relevant starting evidence, not blanket journey passes.
Where no physical result is identified, that acceptance remains open. Attachments,
independent jobs and speculative execution have their own gates; they do not
become prerequisites for otherwise qualified ordinary chat.

**Evidence status.** Every journey's **Evidence status** field starts with one of
`not shown`, `source integration`, `physical acceptance` or `release qualified`: the
highest rung of the ladder above that **every** one of its acceptance criteria has reached
on the current code. Physical acceptance and release qualification name the retained
receipt or the commit they ran on. Narrower evidence (some criteria, or an older package)
is named after the status with its scope; it does not raise the status. No journey is
release qualified today.

## Acquisition, residency and recovery paths

Avoiding repeated acquisition and retaining useful verified pieces are explicit
objectives. These four paths are variants of the existing journeys, not new
queues or claims of working recovery:

| Path | Starting point and intended outcome | Existing journeys |
| --- | --- | --- |
| Cold acquisition | Required verified pieces are missing. Authorized transfers complete useful stage coverage, followed by GPU preparation and a runnable route. | CONTRIB-01, CONTRIB-02, MESH-04, CHAT-01 |
| Prepared service | Weights are resident and executable. Requests reuse them and move authorized inputs, activations and outputs without downloading weights again; conversation state remains separately admitted. | CHAT-01, CHAT-02, MESH-01 |
| Warm replacement | A replacement already has the required weights, but lacks this conversation's inference state. Check execution readiness separately, then reconstruct from authorized history for an explicit fresh attempt. | KEEP-04, MESH-03 |
| Cold replacement | The replacement lacks both weights and inference state. Show acquisition and reconstruction requirements; offer an explicit restart or unavailable capacity rather than promising transparent continuation. | KEEP-04, MESH-04 |

For each applicable run, record missing verified bytes, actual supplier throughput,
retries and verification cost, GPU preparation, time to complete a runnable route,
state reconstruction, prefill and decode separately. Also retain end-to-end time
and overlap, so parallel phases are not double counted. Measure how often requests
encounter missing weights, bytes avoided through retention, and whether preparation
finishes before the contributing computer leaves. Peer supply does not remove
bandwidth cost; no bottleneck is presumed dominant in both cold and resident use.

Ordinary layer execution retains each stage's inference state locally. Warm
weights do not provide a conversation checkpoint. If a future, separately qualified
recovery contract transfers state, measure bytes and latency by model, context and
active-conversation count, including attention caches, recurrent/convolution state
and required replay history. Sparse attention alone does not establish retained
state size, and KV transfer is not assumed cheap. Current recovery uses explicit
authorized retry; portable checkpoints and transparent failover remain excluded
by [RD-CANON/1](roadmap/rd-canon-1.md).

## Catalogue

| Family | User outcomes |
| --- | --- |
| [Ask and continue](#ask-and-continue) | Ask, follow up, attach, choose a model, inspect/copy |
| [Keep and recover work](#keep-and-recover-work) | Reopen, reconnect, stop, retry, manage history |
| [Contribute resources](#contribute-resources) | Offer compute/files, ask while contributing, limit, withdraw |
| [Share network capacity](#share-network-capacity) | Concurrent service, larger models, busy networks, missing coverage, queues, inspecting the mesh |
| [Delegate work](#delegate-work) | Independent jobs, subtasks, tools, results, cancellation, bounded coding |
| [Control trust and change](#control-trust-and-change) | Disclosure, revocation, resource inspection, evaluation, adoption/restore, the credit trade |
| [Compose an application](#compose-an-application) | Embed public interfaces with application-owned ports and lifecycle |

## Ask and continue

### CHAT-01 — Ask without downloading model weights

- **Actor and trigger:** A requester opens Reploid to ask a question.
- **Starting conditions:** A supported model has eligible prepared capacity. No model pick, approval screen, charge or budget step is required.
- **Main flow:** 1. Open replo.id; the page joins the mesh and names the automatically chosen model, the computer kind and that the answering computer can read the prompt → 2. Type and press Send once; Send authorizes the disclosed attempt → 3. Read the streamed, durably accepted answer. Picking a model is optional; a pick stays pinned and is never replaced ([first-visit rules](#rules-that-follow-from-them)).
- **Successful outcome:** A useful, complete answer addresses the question accurately, or explicitly identifies insufficient knowledge instead of inventing facts. It remains in history; the requester acquires no weights. Prepared contributors reuse resident weights without downloading them again per request. Basic-chat acceptance does not depend on attachment qualification.
- **Interruption and recovery:** Unavailable capacity is explicit. Interrupted published output remains; retry is a new authorized attempt.
- **Variants:** Phone/desktop requester; browser/native contributors; 1/2/N stages; prepared service or waiting for cold acquisition through MESH-04; unfamiliar first use without coaching. Record the separate readiness and service phases above. A requester who downloads a model in Settings can run it on their own device; that is an explicit choice, never automatic, and the first run can need a large download (carried over from the archived Poolday local-inference journey).
- **Acceptance evidence:** [ordered chat/entry source tests](../tests/unit/ordered-partition-chat-entry.test.js); [retained short physical conversation/recovery](https://github.com/clocksmith/reploid/blob/e543183bed54dfdf2b6e6139dd4c31c8686f47bd/artifacts/live-conversation-20261012/README.md). These cover different scopes/packages; signed N-stage release and transactional publication milestones (DR-5) remain open.
- **Acceptance criteria:**
  1. A fresh requester on desktop and on phone discovers ready capacity, sees who receives the input, asks and follows up with no operator coaching, invitation, manual placement or model download.
  2. When nothing can answer, the page shows one actionable unavailable or preparing state, keeps the draft, and does not force a local download or send later without the requester acting.
  3. Using the mesh is visibly distinct from contributing to it.
  4. Unfamiliar people are observed on physical phones and desktops, including on-screen keyboards and returning sessions; setup actions, time to first useful answer, task and recovery success and help needed are recorded against a pinned baseline, with failures retained, not only screenshots or token completion.
  5. The answer is complete and useful, or says it does not know; an answer that reaches its end with wrong content is a failure.
- **Evidence status:** not shown. Criterion 1 apart from a scored follow-up, and criterion 3, hold on the deployed page for the public-page bar (FIRST-02, physical acceptance on the tested network); criterion 2 has source tests ([first-answer defaults](../tests/unit/first-answer-defaults.test.js)). No observation of unfamiliar people (criterion 4) and no frozen answer-quality review (criterion 5) is retained.

### CHAT-02 — Continue my conversation

- **Actor and trigger:** A returning requester asks a follow-up.
- **Starting conditions:** Saved messages exist; eligible contributors may differ from the previous request.
- **Main flow:** 1. Open the conversation and see saved history → 2. Submit a follow-up and authorize additional recipients if needed → 3. Read the durably accepted response.
- **Successful outcome:** The answer uses the authorized context, is saved once, and leaves concurrent conversations isolated. Reused weights avoid reacquisition; retained conversation state and reconstruction from saved history are measured separately.
- **Interruption and recovery:** Only published output survives. Explicit retry creates a new attempt; history does not restore lost GPU state.
- **Variants:** Phone/browser requester; browser/native hosts; 1/2/N stages; reused/new residents; overlapping routes.
- **Acceptance evidence:** [ordered chat/entry source tests](../tests/unit/ordered-partition-chat-entry.test.js); [conversation isolation/history tests](../tests/unit/chat-workspace.test.js); [retained short physical conversation/recovery](https://github.com/clocksmith/reploid/blob/e543183bed54dfdf2b6e6139dd4c31c8686f47bd/artifacts/live-conversation-20261012/README.md); exact-package durable release: transactional publication milestones (DR-5).
- **Acceptance criteria:**
  1. A follow-up uses the conversation's saved, authorized context and its answer is saved once.
  2. Two conversations running at once stay isolated: neither reads, changes nor cancels the other's history or state.
  3. Answering again reuses resident weights; no weights are acquired again for the follow-up.
  4. After a reload only published output is shown; a lost attempt is retried as a new attempt, never continued from lost GPU state.
- **Evidence status:** source integration. Physical acceptance on an older ordered-route package: the [installed journeys on the faster candidate](https://github.com/clocksmith/reploid/blob/d77f295967c5cf064cf16c9978fed0be7765ae7f/artifacts/faster-candidate-20261015/journeys/README.md) pass 13/13 (follow-up, reload, two concurrent requesters, isolated cancellation). Not re-run on the current page's whole-model route in a scored batch.

### CHAT-03 — Ask about an attachment

- **Actor and trigger:** A requester supplies a document with a question.
- **Starting conditions:** The format and input size are supported; permission includes its text.
- **Main flow:** 1. Attach and inspect the selected material → 2. Submit a question with scoped consent → 3. Open source references in the answer.
- **Successful outcome:** The answer addresses the question accurately, with factual claims supported by the cited passages, or explicitly identifies insufficient evidence. Authorized passages arrive in order, and usable citations navigate to the supporting source. Citation presence alone is insufficient.
- **Interruption and recovery:** Keep the attachment and draft after failure; never silently drop input to fit a route.
- **Variants:** One/multiple attachments; follow-up reuse; changed recipients; long context.
- **Acceptance evidence:** [attachment passages/history/export controls](../tests/unit/document-comparison.test.js); application acceptance (REP-7). Factual/citation qualification remains separate and incomplete; it does not gate basic chat.
- **Acceptance criteria:**
  1. Before execution the request binds the attachment's input scope, the operation, the model and the recipients; changed input, wrong operation, expired or revoked permission are refused before anything is sent.
  2. Authorized passages arrive in order and nothing is dropped silently to fit a route.
  3. Every material claim in the answer is supported by a cited passage, or the answer says the evidence is insufficient; citations open the supporting source. Citation presence alone does not pass.
  4. After a failure the attachment and draft are kept.
- **Evidence status:** not shown. Permission and passage handling have source tests; factual and citation qualification is incomplete.

### CHAT-04 — Start with another supported model

- **Actor and trigger:** A requester wants a different model for a new conversation.
- **Starting conditions:** The model and any adapter have an eligible declared configuration.
- **Main flow:** 1. Open model choices → 2. Start a new thread with the chosen model → 3. Submit and see that exact model execute.
- **Successful outcome:** The selected model identity is preserved; an unavailable choice is not silently substituted.
- **Interruption and recovery:** Keep the draft and original conversation if preparation fails.
- **Variants:** Ready/busy/preparing models; compatible adapters; local or distributed route.
- **Acceptance evidence:** [model/adapter substitution tests](../tests/unit/chat-workspace.test.js); application acceptance (REP-7). Model-specific physical/release evidence must be attached before support is claimed.
- **Acceptance criteria:**
  1. Only models that are actually available are offered as ready; the selected model is the one that executes, by the answer's record and receipt.
  2. A pick that nothing serves is never replaced: the page says so and sends to no other model.
  3. A pick stays a pick across a reload; a choice the page made is not remembered as one.
  4. If preparation fails, the draft and the original conversation are kept.
- **Evidence status:** source integration ([first-answer defaults](../tests/unit/first-answer-defaults.test.js), model substitution tests). Criterion 1 has physical acceptance: 20/20 explicit picks answered by the picked model on the deployed build at bbc49a7ec, tested network, sequential.

### CHAT-05 — Inspect and copy an answer

- **Actor and trigger:** A requester wants to use or understand a response.
- **Starting conditions:** An answer or retained published partial answer is visible.
- **Main flow:** 1. Read the response → 2. Optionally expand its contributing-stage details or sources → 3. Copy text or code.
- **Successful outcome:** Copied content matches the visible accepted response; assigned contributors and unknown metrics are distinguishable.
- **Interruption and recovery:** Copy and history inspection remain available after contributors depart.
- **Variants:** Themes, phone widths, code, citations, 1/2/N stages, absent timing. An answer from a public computer carries a provider-signed receipt that the page verifies; a verified signature shows what was signed, not that the answer is correct or that the computation was honest (carried over from the archived Poolday receipt journey).
- **Acceptance evidence:** [activity/browser evidence](https://github.com/clocksmith/reploid/blob/e543183bed54dfdf2b6e6139dd4c31c8686f47bd/artifacts/ordered-chat-activity-20261013/README.md); [presentation tests](../tests/e2e/chat-material.spec.js). No fresh physical-phone acceptance is implied.
- **Acceptance criteria:**
  1. Streaming and completed answers keep stable message nodes, readable prose and code, working source links, selection and scroll position, and a visible composer with keyboard focus.
  2. Copy yields exactly the visible accepted text.
  3. Assigned contributors and unknown metrics are distinguishable in the details; missing timing stays unknown.
  4. Copy and details stay available after the contributors leave, on both themes and at phone widths.
- **Evidence status:** source integration ([presentation tests](../tests/e2e/chat-material.spec.js)). No fresh physical-phone run is retained.

## Keep and recover work

### KEEP-01 — Reopen saved history

- **Actor and trigger:** A returning requester reloads or upgrades the app.
- **Starting conditions:** There are committed conversations and saved drafts.
- **Main flow:** 1. Open the app → 2. Select a saved thread → 3. Inspect history and edit its restored draft.
- **Successful outcome:** The same committed messages and drafts return without redispatching old requests.
- **Interruption and recovery:** Storage failure is explicit; unreadable history is not overwritten with an empty success state.
- **Variants:** Fresh/returning installation; upgrade; browser restart; interrupted prior attempt. Saved conversations live in this browser's storage; no account-synchronized, cross-device history is claimed (carried over from the archived Poolday records journey).
- **Acceptance evidence:** [draft transaction tests](../tests/unit/chat-draft-transactions.test.js); [retained short physical conversation/recovery](https://github.com/clocksmith/reploid/blob/e543183bed54dfdf2b6e6139dd4c31c8686f47bd/artifacts/live-conversation-20261012/README.md); frozen upgrade acceptance: transactional publication milestones (DR-5).
- **Acceptance criteria:**
  1. After a reload, browser restart or upgrade, the same committed messages and drafts return.
  2. No old request is sent again on reopening.
  3. A storage failure is reported; unreadable history is never overwritten with an empty success state.
  4. A successful request after an interruption still works in the reopened app.
- **Evidence status:** source integration. Physical acceptance on an older package: transactional history restored after reload in the [signed completion journey](https://github.com/clocksmith/reploid/blob/d77f295967c5cf064cf16c9978fed0be7765ae7f/artifacts/signed-completion-journey-20261013/README.md). Upgrade acceptance on a frozen release is not shown.

### KEEP-02 — Reconnect during a request

- **Actor and trigger:** A requester loses signaling or an execution connection.
- **Starting conditions:** An authorized attempt is running.
- **Main flow:** 1. Observe the connection state → 2. Reconnect when possible → 3. Continue receiving accepted output or choose an explicit retry.
- **Successful outcome:** Healthy authorized execution survives signaling loss; lost execution state is reported honestly.
- **Interruption and recovery:** Preserve published output and keep unknown remote allocations charged until settlement.
- **Variants:** Bootstrap loss; healthy data channel; contributor departure at any stage; independent networks.
- **Acceptance evidence:** [automatic network source integration](https://github.com/clocksmith/reploid/blob/e543183bed54dfdf2b6e6139dd4c31c8686f47bd/artifacts/automatic-ordered-participation-20261013/README.md); [retained short physical conversation/recovery](https://github.com/clocksmith/reploid/blob/e543183bed54dfdf2b6e6139dd4c31c8686f47bd/artifacts/live-conversation-20261012/README.md); independent-network and signed N-stage acceptance remain open in combined-capacity acceptance (DR-6).
- **Acceptance criteria:**
  1. Losing signaling does not end healthy authorized execution.
  2. Losing an executing contributor is reported as lost, not as an answer; published output stays.
  3. A lost transport never counts as proof that remote GPU work was cleaned up: unknown remote allocations stay owned and charged until settlement.
  4. Recovery is an explicit, newly authorized retry.
- **Evidence status:** source integration. Physical acceptance on an older ordered-route package: contributor loss 7/7 in the [installed journeys on the faster candidate](https://github.com/clocksmith/reploid/blob/d77f295967c5cf064cf16c9978fed0be7765ae7f/artifacts/faster-candidate-20261015/journeys/README.md). Independent networks are not shown.

### KEEP-03 — Stop one response

- **Actor and trigger:** A requester no longer needs a running answer.
- **Starting conditions:** One or more conversations are active.
- **Main flow:** 1. Select the response and press Stop → 2. Observe Stopping while cleanup is pending → 3. See the attempt settle.
- **Successful outcome:** No further output is published for the stopped attempt; unrelated conversations and weights survive.
- **Interruption and recovery:** Unknown or failed cleanup remains visible and charged; offer Retry stopping when supported.
- **Variants:** Queued/acquiring/prefilling/decoding attempts; overlapping stops; shared contributors.
- **Acceptance evidence:** [ordered runner controls](https://github.com/clocksmith/reploid/blob/e543183bed54dfdf2b6e6139dd4c31c8686f47bd/artifacts/ordered-route-runner-20261013/README.md); [scoped physical cleanup/retry](https://github.com/clocksmith/reploid/blob/e543183bed54dfdf2b6e6139dd4c31c8686f47bd/artifacts/cleanup-failure-20261012/README.md); concurrent long exact-package acceptance: transactional publication milestones (DR-5).
- **Acceptance criteria:**
  1. After Stop no further output is published for that attempt.
  2. Stopping is visibly distinct from settled; partial text stays.
  3. Unrelated conversations and resident weights survive.
  4. Unknown or failed cleanup stays visible and charged, with Retry stopping where supported.
- **Evidence status:** source integration. A one-operator dry run on a real model on the charged whole-model route (Reploid bbc49a7ec with 0f4da29bb and 88c253471) stopped during streaming and settled at zero charge with the hold released; it is one operator on one machine and does not qualify concurrent stops.

### KEEP-04 — Retry an interrupted answer

- **Actor and trigger:** A requester wants another attempt after failure.
- **Starting conditions:** A prior attempt and its published partial output remain visible.
- **Main flow:** 1. Inspect the failure and whether replacement needs model acquisition or conversation reconstruction → 2. Choose Retry and approve any changed recipients → 3. Read a separate new response after eligible capacity is ready.
- **Successful outcome:** The old response remains distinct; retry uses a fresh attempt and only authorized context.
- **Interruption and recovery:** Repeated failure leaves both attempts inspectable; no silent continuation from lost model state. Warm weights do not establish state readiness. Cold replacement can remain unavailable; acquisition or reconstruction failure preserves the original published answer.
- **Variants:** Any failed stage; warm replacement with weights but missing conversation state; cold replacement missing both; native/browser replacement; revoked prior grant. Measure acquisition, preparation and authorized reconstruction separately.
- **Acceptance evidence:** [ordered chat/entry source tests](../tests/unit/ordered-partition-chat-entry.test.js); [retained short physical conversation/recovery](https://github.com/clocksmith/reploid/blob/e543183bed54dfdf2b6e6139dd4c31c8686f47bd/artifacts/live-conversation-20261012/README.md); signed N-stage replacement and durable publication remain open in transactional publication milestones (DR-5).
- **Acceptance criteria:**
  1. Retry is a new attempt with its own identity; the earlier response and its partial text stay separate and inspectable.
  2. The retry uses only authorized context; changed recipients need fresh permission.
  3. Changed bindings are refused; there is no silent continuation from lost model state, and warm weights are not treated as restored conversation state.
  4. A replacement that cannot be prepared is reported as unavailable capacity, and the original published answer is kept.
- **Evidence status:** source integration. Physical acceptance on an older package: explicit retry after contributor loss in the [installed journeys on the faster candidate](https://github.com/clocksmith/reploid/blob/d77f295967c5cf064cf16c9978fed0be7765ae7f/artifacts/faster-candidate-20261015/journeys/README.md).

### KEEP-05 — Manage retained conversations

- **Actor and trigger:** A requester organizes or exports their work.
- **Starting conditions:** Saved threads exist, possibly with active attempts.
- **Main flow:** 1. Open thread actions → 2. Rename, archive or export the selected conversation → 3. Return to the desired thread.
- **Successful outcome:** Organization affects the selected thread; export reflects its retained accepted messages.
- **Interruption and recovery:** Archiving does not implicitly cancel inference; cancellation stays a separate explicit action.
- **Variants:** Long history; archived active thread; phone drawer; failed storage write.
- **Acceptance evidence:** [workspace tests](../tests/unit/chat-workspace.test.js); [conversation UI tests](../tests/e2e/chat-material.spec.js). Exact upgrade and publication acceptance remains separate.
- **Acceptance criteria:**
  1. Rename, archive and export affect only the selected thread.
  2. An export contains exactly that thread's retained accepted messages.
  3. Archiving an active thread does not cancel its inference.
  4. A failed storage write is reported and leaves the thread unchanged.
- **Evidence status:** source integration ([workspace tests](../tests/unit/chat-workspace.test.js)).

## Contribute resources

### CONTRIB-01 — Offer compute

- **Actor and trigger:** A device owner chooses to help answer questions.
- **Starting conditions:** An eligible browser/native executor has explicit limits and a compatible model plan.
- **Main flow:** 1. Enable compute contribution → 2. Observe authorized preparation → 3. See readiness only after required execution preparation completes.
- **Successful outcome:** The device serves admitted work within its permissions and limits.
- **Interruption and recovery:** Show missing supply and failed preparation; retain cleanup ownership rather than advertising false readiness.
- **Variants:** Browser/native; assigned entry/middle/final stage; resident/cold model. Whole-model browser contributor: one tab loads one complete model, advertises it, answers compatible requests, signs receipts and stops; keeping a tab open is voluntary and promises no uptime (carried over from the archived Poolday browser-compute journey).
- **Acceptance evidence:** [host preparation](https://github.com/clocksmith/reploid/blob/e543183bed54dfdf2b6e6139dd4c31c8686f47bd/artifacts/ordered-host-preparation-20261013/README.md); [host lifecycle tests](../tests/unit/work-swarm-lifecycle.test.js). Physical N-stage host qualification remains open.
- **Acceptance criteria:**
  1. Contribution starts only on the owner's explicit choice, within explicit allowances and permissions.
  2. The device reports ready only after execution preparation completes, and other peers see it offering exactly what was chosen.
  3. It serves admitted work within its limits and idles when no work needs it.
  4. Failed preparation and missing supply are shown; readiness is never advertised falsely, and a rejected offer is withdrawn.
  5. Stop is responsive and does not cancel the owner's own conversations.
- **Evidence status:** source integration ([host lifecycle tests](../tests/unit/work-swarm-lifecycle.test.js)). Physical acceptance on an older package: bounded contribution 7/7 in the [installed journeys on the faster candidate](https://github.com/clocksmith/reploid/blob/d77f295967c5cf064cf16c9978fed0be7765ae7f/artifacts/faster-candidate-20261015/journeys/README.md). Not shown on the current page end to end (see FIRST-03).

### CONTRIB-02 — Offer verified model files

- **Actor and trigger:** A device owner permits supplying cached model pieces.
- **Starting conditions:** Verified pieces exist; a separate bounded file-sharing grant is available.
- **Main flow:** 1. Select the model and transfer allowance → 2. Enable file sharing → 3. Inspect supplied bytes and remaining allowance.
- **Successful outcome:** Only permitted verified pieces are supplied and transfers consume the persistent allowance.
- **Interruption and recovery:** Restart does not silently renew the allowance. Resume interrupted acquisition within renewed or still-valid grants; retain and verify committed pieces across restarts rather than reacquiring them. Supply withdrawal preserves already verified recipient pieces within retention policy.
- **Variants:** Storage-only or compute+storage; replacement supplier; interrupted/resumed transfer; process restart; contended or slow supply. Record actual throughput, transferred/verified bytes and avoided reacquisition.
- **Acceptance evidence:** custody acceptance (REP-5); [persistent transfer-budget tests](../tests/unit/native-supply-budget.test.js) and [source verification tests](../tests/unit/work-partition-blake3-source.test.js). Receipts must identify the model and ledger; compute consent alone is insufficient.
- **Acceptance criteria:**
  1. Cached-only sharing serves only bytes already cached and verified, never fetches missing metadata or pieces, and leaves a piece without local verification material unavailable.
  2. Bounded acquisition covers metadata, pieces and retries under an explicit allowance whose usage persists across reloads and competing tabs, so concurrent activity cannot overspend it; interrupted transfers, exhausted budgets and retry accounting are tested.
  3. Full-model seeding is a separate grant that shows its resource scope before approval; neither cached-only nor bounded sharing implies it.
  4. After a reload or interruption the inventory is rebuilt from verified metadata and actual cached bytes; stale inventory is not proof of custody.
  5. A restart does not silently renew the allowance, and Stop aborts an in-flight transfer while keeping its charges.
- **Evidence status:** source integration ([transfer-budget tests](../tests/unit/native-supply-budget.test.js)). Physical acceptance on an older package: bounded contribution 7/7 and full-model seeding 7/7 in the [installed journeys on the faster candidate](https://github.com/clocksmith/reploid/blob/d77f295967c5cf064cf16c9978fed0be7765ae7f/artifacts/faster-candidate-20261015/journeys/README.md). Not shown on the current page (see FIRST-03).

### CONTRIB-03 — Ask while contributing

- **Actor and trigger:** A contributor also starts their own conversation.
- **Starting conditions:** Their contribution and requester permissions are separate.
- **Main flow:** 1. Leave contribution enabled → 2. Submit a personal question → 3. Follow both activities independently.
- **Successful outcome:** The personal conversation receives service without sharing unrelated histories or exceeding admitted capacity.
- **Interruption and recovery:** Stopping the personal answer does not withdraw all contribution; withdrawing compute settles affected work explicitly.
- **Variants:** Requester on entry/middle/final host; shared resident weights; concurrent remote requests.
- **Acceptance evidence:** [automatic network source integration](https://github.com/clocksmith/reploid/blob/e543183bed54dfdf2b6e6139dd4c31c8686f47bd/artifacts/automatic-ordered-participation-20261013/README.md); [ordered runner controls](https://github.com/clocksmith/reploid/blob/e543183bed54dfdf2b6e6139dd4c31c8686f47bd/artifacts/ordered-route-runner-20261013/README.md). Injected numerical source controls are not physical combined-capacity acceptance.
- **Acceptance criteria:**
  1. With contribution on, the owner's own conversation is served without exposing unrelated histories or exceeding admitted capacity.
  2. Stopping the personal answer does not withdraw contribution.
  3. Withdrawing compute settles the affected work explicitly and does not cancel the personal conversation.
- **Evidence status:** source integration. Physical acceptance on an older package: sharing while chatting in the [signed completion journey](https://github.com/clocksmith/reploid/blob/d77f295967c5cf064cf16c9978fed0be7765ae7f/artifacts/signed-completion-journey-20261013/README.md).

### CONTRIB-04 — Set contribution limits

- **Actor and trigger:** A device owner wants bounded resource use.
- **Starting conditions:** Contribution has explicit memory, compute and transfer policies.
- **Main flow:** 1. Review current usage and limits → 2. Set supported allowances → 3. Observe admission respecting the resulting budget.
- **Successful outcome:** New work is rejected or queued predictably when it cannot be admitted; unknown allocations remain charged.
- **Interruption and recovery:** Lowering limits cannot erase outstanding ownership or silently claim immediate GPU preemption.
- **Variants:** Browser/native co-hosting; per-attempt state; shared physical GPU; retained cleanup debt.
- **Acceptance evidence:** [memory settlement tests](../tests/unit/partition-memory-settlement.test.js); combined-capacity acceptance (DR-6). Shared physical-device enforcement remains open; per-executor accounting is not equivalent.
- **Acceptance criteria:**
  1. Approved schedules, power, temperature and memory bounds, bandwidth rates and cumulative transfer allowances are enforced where the platform supports them; unsupported sensors and controls are declared, and a setting alone is not claimed as enforcement.
  2. Equipment and network authorization is required, including for workplace resources.
  3. Foreground activity or a crossed limit reduces new admission, settles owned work safely and keeps unknown cleanup owned.
  4. Limits survive a restart; lowering a limit never erases outstanding ownership or claims immediate GPU preemption.
  5. Actual resource consumption is measured and reported alongside any reward.
- **Evidence status:** not shown. Persisted byte and storage budgets have source tests; rate and host-impact controls are missing.

### CONTRIB-05 — Pause or withdraw contribution

- **Actor and trigger:** A contributor needs their device back.
- **Starting conditions:** Preparation or inference may be outstanding.
- **Main flow:** 1. Choose Stop contribution → 2. Observe affected work settling → 3. See idle only after owned resources settle.
- **Successful outcome:** Unrelated conversations survive and a new contribution cannot be closed by an older stop.
- **Interruption and recovery:** Failed cleanup remains retryable; file supply remains governed by its separate permission.
- **Variants:** Acquisition/execution/idle; overlapping stops; replacement sessions; native shutdown.
- **Acceptance evidence:** [host lifecycle tests](../tests/unit/work-swarm-lifecycle.test.js); [scoped physical cleanup/retry](https://github.com/clocksmith/reploid/blob/e543183bed54dfdf2b6e6139dd4c31c8686f47bd/artifacts/cleanup-failure-20261012/README.md). Demanding signed N-stage and native-provider teardown acceptance remains configuration-specific.
- **Acceptance criteria:**
  1. Stop contribution shows affected work settling and reports idle only after owned resources settle.
  2. Overlapping stops coalesce, and an older stop cannot close a newer contribution.
  3. Failed cleanup stays owned and retryable; file supply follows its own permission.
  4. Unrelated conversations survive.
- **Evidence status:** source integration ([host lifecycle tests](../tests/unit/work-swarm-lifecycle.test.js)). Physical acceptance on an older package: [scoped physical cleanup/retry](https://github.com/clocksmith/reploid/blob/e543183bed54dfdf2b6e6139dd4c31c8686f47bd/artifacts/cleanup-failure-20261012/README.md). Pause on the current page is not shown (see FIRST-03).

## Share network capacity

### MESH-01 — Receive service while others are active

- **Actor and trigger:** A requester asks while other conversations are using the mesh.
- **Starting conditions:** A compatible route can admit another private conversation state.
- **Main flow:** 1. Submit the question → 2. Observe admitted execution or an honest queue → 3. Receive a streamed answer independently.
- **Successful outcome:** Conversations make bounded progress and cannot read or cancel each other’s state.
- **Interruption and recovery:** Cancel or fail one attempt while survivors continue; unknown ownership remains reserved.
- **Variants:** Shared/disjoint routes; replicas; multiple requester roles; uneven stage speeds.
- **Acceptance evidence:** [automatic network source integration](https://github.com/clocksmith/reploid/blob/e543183bed54dfdf2b6e6139dd4c31c8686f47bd/artifacts/automatic-ordered-participation-20261013/README.md); [ordered runner controls](https://github.com/clocksmith/reploid/blob/e543183bed54dfdf2b6e6139dd4c31c8686f47bd/artifacts/ordered-route-runner-20261013/README.md); physical fairness and long concurrency acceptance: combined-capacity acceptance (DR-6).
- **Acceptance criteria:**
  1. Two separate people with distinct, independently checkable tasks, histories and permissions send overlapping requests over shared physical contributors.
  2. Capacity joining, an idle supplier withdrawing, one request cancelled and an assigned executor lost, each as a separate control, leave unaffected work correct and durably saved.
  3. Affected output stays separate, replacement needs a fresh authorized attempt, and reservations settle or stay charged as unknown.
  4. Host failure domains, route and replica choices and per-person results are recorded, with no weights downloaded by either requester. Source runs and two tabs on one machine do not pass.
- **Evidence status:** source integration (injected numerical stages). The physical two-person demonstration is not shown.

### MESH-02 — Access a model my device cannot run

- **Actor and trigger:** A requester selects a model requiring combined capacity.
- **Starting conditions:** An eligible complete route exists with the necessary authorized pieces and budgets.
- **Main flow:** 1. Choose the supported model → 2. Authorize the actual route → 3. Receive a complete answer without local weights.
- **Successful outcome:** The workload succeeds collaboratively under limits that prevent each executor running it alone.
- **Interruption and recovery:** Missing stages are explicit; replacement requires a new authorized attempt when state was lost.
- **Variants:** 2/N stages; uneven layer ranges; three stages with four replicas each on twelve computers.
- **Acceptance evidence:** [runtime/source composition](https://github.com/clocksmith/reploid/blob/e543183bed54dfdf2b6e6139dd4c31c8686f47bd/artifacts/ordered-route-integration-20261013/README.md); combined-capacity acceptance (DR-6). The twelve-computer deployment and capacity advantage remain acceptance targets.
- **Acceptance criteria:**
  1. Each participating executor fails to run the model alone for a measured memory reason at the same pinned model, context and precision, under fixed per-contributor budgets.
  2. The combined route returns a complete, useful answer under the same budgets, without raising budgets or trimming prompts.
  3. Missing stages are reported, and replacement after lost state is a new authorized attempt.
- **Evidence status:** not shown. Configured multistage composition has source evidence; no run shows a model that no participant could run alone.

### MESH-03 — Join a busy network

- **Actor and trigger:** A new requester opens the app while prepared capacity is occupied.
- **Starting conditions:** Discovery is available; connected peers may be busy or incompatible.
- **Main flow:** 1. Open the app → 2. See actual compatible availability → 3. Submit when admitted or remain in a bounded queue.
- **Successful outcome:** Peer count does not promise available compute; the user can distinguish busy, preparing and unavailable.
- **Interruption and recovery:** Stale advertisements cannot turn into silent dispatch or replacement without approval.
- **Variants:** Fresh requester; expired offers; all replicas busy; bootstrap alternative.
- **Acceptance evidence:** [discovery controls](https://github.com/clocksmith/reploid/blob/e543183bed54dfdf2b6e6139dd4c31c8686f47bd/artifacts/ordered-discovery-20261013/README.md); [automatic network source integration](https://github.com/clocksmith/reploid/blob/e543183bed54dfdf2b6e6139dd4c31c8686f47bd/artifacts/automatic-ordered-participation-20261013/README.md). Sustained independent-network acceptance remains open.
- **Acceptance criteria:**
  1. Opening the page joins the network without a Join step, and joining alone does not make the device a contributor.
  2. The page shows actual compatible availability: busy, preparing and unavailable are distinguishable, and peer count is not presented as available compute.
  3. Stale advertisements never turn into silent dispatch or replacement.
  4. A request is admitted, waits in a bounded queue, or is refused with a stated reason.
- **Evidence status:** source integration ([discovery controls](https://github.com/clocksmith/reploid/blob/e543183bed54dfdf2b6e6139dd4c31c8686f47bd/artifacts/ordered-discovery-20261013/README.md)). Criterion 1 holds on the deployed page (FIRST-01). Sustained independent-network acceptance is not shown.

### MESH-04 — Help make a missing model available

- **Actor and trigger:** A contributor offers capacity for incomplete model coverage.
- **Starting conditions:** The model is authorized but a required stage or verified supply is absent.
- **Main flow:** 1. Choose to contribute → 2. Observe authorized acquisition prioritizing pieces that complete a useful route, then GPU preparation → 3. See the model become usable only when a full route is executable.
- **Successful outcome:** Readiness reflects complete eligible coverage, not merely connected nodes or downloaded pieces. Useful retained pieces reduce future missing bytes and repeated acquisition; measured route readiness includes supplier throughput and preparation.
- **Interruption and recovery:** Missing file consent or supplier departure is visible. Resume authorized transfers and preserve verified pieces across restarts; unverified partial data never becomes executable merely because a transfer resumed.
- **Variants:** Cold acquisition; complementary stages; replacement supplier; cold replacement; demand-driven replicas; contributor departure before preparation completes. Record time and bytes to a runnable route, and unsuccessful preparation as well as completed service.
- **Acceptance evidence:** [stage preparation](https://github.com/clocksmith/reploid/blob/e543183bed54dfdf2b6e6139dd4c31c8686f47bd/artifacts/ordered-host-preparation-20261013/README.md); [automatic network source integration](https://github.com/clocksmith/reploid/blob/e543183bed54dfdf2b6e6139dd4c31c8686f47bd/artifacts/automatic-ordered-participation-20261013/README.md). Automatic cold complementary-stage assignment and demand-driven replication remain open in combined-capacity acceptance (DR-6).
- **Acceptance criteria:**
  1. Acquisition prioritizes pieces that complete a useful route, then GPU preparation; the model is shown usable only when a full route is executable.
  2. Missing file consent and supplier departure are visible; authorized transfers resume, verified pieces survive restarts, and unverified partial data never becomes executable.
  3. Time and bytes to a runnable route are recorded, including unsuccessful preparation.
  4. Cold complementary stages are assigned automatically, without manual placement.
- **Evidence status:** not shown. Stage preparation and resumed acquisition have source and older physical evidence; automatic cold complementary assignment and demand-driven replication are open.

### MESH-05 — Wait for capacity without losing my request

- **Actor and trigger:** A requester submits more demand than the network can admit immediately.
- **Starting conditions:** Queue limits and cancellation behavior are declared.
- **Main flow:** 1. Submit a request → 2. See queued or explicit rejection → 3. Receive service when admitted or cancel waiting.
- **Successful outcome:** Waiting is bounded and visible; admitted state stays within limits and competing requests do not starve.
- **Interruption and recovery:** Expired authorization is renewed explicitly before disclosure; cancellation cannot later dispatch the queued request.
- **Variants:** Queue saturation; slow stage; many requesters; freed/replaced capacity.
- **Acceptance evidence:** [ordered runner controls](https://github.com/clocksmith/reploid/blob/e543183bed54dfdf2b6e6139dd4c31c8686f47bd/artifacts/ordered-route-runner-20261013/README.md); [request scheduling tests](../tests/unit/chat-scheduler.test.js). Per-stage FIFO controls do not qualify cross-route fairness or the twenty-conversation deployment.
- **Acceptance criteria:**
  1. A request that finds its route full waits in a bounded first-in-first-out queue and shows Queued, instead of failing.
  2. Overflow, wait timeout and capacity refusal each fail with a declared reason.
  3. A queued attempt that never runs settles at zero charge with its hold released.
  4. Cancelling a wait means the request is never dispatched later; competing requests do not starve.
- **Evidence status:** source integration ([request scheduling tests](../tests/unit/chat-scheduler.test.js)). The installed queue is not re-run.

### MESH-06 — See which computers are ready and what each offers

- **Actor and trigger:** A visitor is curious about the mesh or is troubleshooting.
- **Starting conditions:** The page has joined the network; this view is never required before asking.
- **Main flow:** 1. Open the Computers view from the same page → 2. Read which computers are ready and what each offers → 3. Close it and continue.
- **Successful outcome:** Ready computers are listed with what each offers (the model it serves, file supply where present) and why a computer is not used, while the visitor's own conversation and Send are unaffected.
- **Interruption and recovery:** Computers that leave drop out of the list; a stale entry is never used for dispatch because it is listed.
- **Variants:** Desktop/phone; no computers ready; this device contributing or not.
- **Acceptance evidence:** [public-answer walk](../scripts/verify-public-answer.js), run after each deploy.
- **Acceptance criteria:**
  1. The view opens from the same page, without leaving the experience.
  2. Each ready computer shows the model it serves, and whether it supplies model files.
  3. This device's own state (sharing or not) is shown.
  4. Send stays usable while the view is open and after it closes.
- **Evidence status:** not shown. Criteria 1, 3 and 4, and criterion 2 for served models, hold in the public-answer walk on the deployed 9aa668035; the view does not show which computers supply model files.

## Delegate work

### JOB-01 — Submit an independent job

- **Actor and trigger:** A requester submits bounded work whose units can finish independently.
- **Starting conditions:** The operation, input scope, model and limits are supported and separately authorized.
- **Main flow:** 1. Submit the job → 2. Observe completed and pending units → 3. Collect committed results in original order.
- **Successful outcome:** One accepted result exists per unit; retries need not imply exactly-once execution.
- **Interruption and recovery:** Keep committed units and retry unfinished ones after contributor loss.
- **Variants:** Embedding/indexing or other qualified operations; many workers; reordered delivery.
- **Acceptance evidence:** [durable job tests](../tests/unit/pool-peer-pack-job.test.js) and [independent-unit acceptance fixture](../tests/e2e/independent-units.spec.js); durable job foundation (REP-1). Indexing remains deferred; generation permission does not authorize another operation.
- **Acceptance criteria:**
  1. Each unit has exactly one accepted result; retries need not imply exactly-once remote execution.
  2. Committed units survive contributor loss and reload; only unfinished units are retried.
  3. Results are collected in original order; duplicate inclusion and superseded attempts are rejected.
  4. Generation permission does not authorize another operation.
- **Evidence status:** source integration ([durable job tests](../tests/unit/pool-peer-pack-job.test.js)), with older installed interrupted-job controls on one machine.

### JOB-02 — Let an agent coordinate bounded subtasks

- **Actor and trigger:** A requester delegates a goal with a bounded scope.
- **Starting conditions:** Permitted operations, budgets and completion criteria are explicit.
- **Main flow:** 1. Submit the goal → 2. Observe authorized subtask progress → 3. Inspect the combined result and its evidence.
- **Successful outcome:** The result distinguishes completed, failed and uncertain work without granting the agent extra authority.
- **Interruption and recovery:** Cancel remaining work while retaining committed subresults and unresolved ownership.
- **Variants:** Independent tasks versus dependent stages; local/remote workers; repeated subtasks.
- **Acceptance evidence:** [X journey registry](x/critical-user-journeys.md); [job policy tests](../tests/unit/pool-peer-pack-job-policy.test.js). Agent coordination is not established by split-model token execution.
- **Acceptance criteria:**
  1. The agent acts only within the permitted operations, budgets and completion criteria; delegation never grants it extra authority.
  2. The combined result distinguishes completed, failed and uncertain work, with evidence for each.
  3. Cancel stops remaining subtasks while committed subresults and unresolved ownership are kept.
- **Evidence status:** not shown. Agent coordination of subtasks is not integrated; split-model token execution does not establish it.

### JOB-03 — Approve a tool action

- **Actor and trigger:** A requester reviews an agent’s proposed action.
- **Starting conditions:** The proposed action, arguments, recipients and effects are available for review.
- **Main flow:** 1. Inspect the proposal → 2. Approve or decline its exact scope → 3. See the observed outcome.
- **Successful outcome:** Only the approved action executes; a model score never substitutes for permission.
- **Interruption and recovery:** If the tool may have executed before its response was lost, report outcome unknown and reconcile using its operation identity and authoritative outcome record. Retry only under the tool’s declared idempotency contract or after establishing that no effect occurred; otherwise require explicit resolution without blind replay. Fresh approval alone cannot prevent duplicate external effects. Changed arguments or recipients additionally require the applicable fresh authorization.
- **Variants:** Local/remote tools; disclosure versus mutation; delayed/expired approval; response lost after execution; idempotent versus non-idempotent effects.
- **Acceptance evidence:** [Zero authority boundaries](zero/critical-user-journeys.md); [X approval journeys](x/critical-user-journeys.md). Tool permission is separate from compute and file supply.
- **Acceptance criteria:**
  1. Only the approved action, with the approved arguments and recipients, executes; a model score never substitutes for permission.
  2. Changed arguments or recipients need fresh approval.
  3. If the tool may have run before its response was lost, the outcome is reported unknown and reconciled by operation identity before any retry; non-idempotent effects are never replayed blindly.
- **Evidence status:** not shown. Approve and decline have source evidence in the Zero and X workspaces; outcome-unknown reconciliation is not shown.

### JOB-04 — Inspect a delegated result

- **Actor and trigger:** A requester wants to understand completed delegated work.
- **Starting conditions:** A job has retained results and provenance.
- **Main flow:** 1. Open the job → 2. Inspect unit outcomes and evidence → 3. Use or export the accepted results.
- **Successful outcome:** Completed work, failed experiments and unqualified capabilities remain distinguishable.
- **Interruption and recovery:** Missing evidence is reported; a departed worker does not erase committed results.
- **Variants:** Independent job, agent subtask, evaluated change; partial completion.
- **Acceptance evidence:** [durable job tests](../tests/unit/pool-peer-pack-job.test.js) and [independent-unit acceptance fixture](../tests/e2e/independent-units.spec.js); [archived Poolday records journey](archive/poolday-critical-user-journeys.md). Those supporting surfaces do not establish ordinary chat release qualification.
- **Acceptance criteria:**
  1. Unit outcomes, failed experiments and unqualified capabilities are distinguishable.
  2. Missing evidence is reported as missing.
  3. A departed worker does not erase committed results, and accepted results can be used or exported.
- **Evidence status:** source integration ([durable job tests](../tests/unit/pool-peer-pack-job.test.js)).

### JOB-05 — Cancel unfinished delegated work

- **Actor and trigger:** A requester withdraws a running job.
- **Starting conditions:** Some units may be committed while others are running or queued.
- **Main flow:** 1. Cancel the remaining job → 2. Observe stop/settlement → 3. Retain already accepted results.
- **Successful outcome:** No newly unauthorized units are admitted and previously committed results remain inspectable.
- **Interruption and recovery:** Unknown remote execution stays charged until observed settlement; retry only unfinished authorized units.
- **Variants:** Worker loss; overlapping stops; partial job; storage failure.
- **Acceptance evidence:** [durable job tests](../tests/unit/pool-peer-pack-job.test.js) and [independent-unit acceptance fixture](../tests/e2e/independent-units.spec.js); durable jobs and contribution acceptance (REP-3). Job cancellation is separate from generation-state recovery.
- **Acceptance criteria:**
  1. Through the application's job controls, Cancel stops admission of new units.
  2. Committed units stay inspectable across reload; unfinished units can be replaced or retried, with original order restored.
  3. Storage failure and revoked read permission are handled without losing committed results.
  4. Unknown remote execution stays charged until observed settlement; unrelated conversations survive.
- **Evidence status:** not shown in the application. Library interruption controls exist (source integration); the ordinary host and UI path is not shown.

### JOB-06 — Build and check a change with coding tools

- **Actor and trigger:** A requester wants an agent to make a bounded code change and demonstrate its behavior.
- **Starting conditions:** A supported model and authorized workspace are selected; reading files, running tools and modifying real folders have separate scopes.
- **Main flow:** 1. Describe the change and authorize required reads → 2. Review a proposed edit and run permitted checks in an isolated preview → 3. Inspect console/test feedback and a concrete diff → 4. Approve the exact real-folder changes and verify the result.
- **Successful outcome:** The requested behavior passes declared checks, the applied files match the approved diff, and unrelated files remain intact. An unsuccessful proposal is reported as unsuccessful.
- **Interruption and recovery:** Denied writes, changed file versions and unavailable tools stop the affected action. Reconcile unknown external effects under JOB-03 before retry; preserve existing files and accepted results when cancellation occurs.
- **Variants:** Browser preview; host file ports; native workspace adapters; read-only review; failed checks; concurrent file edits.
- **Acceptance evidence:** [tool authority journey](zero/critical-user-journeys.md); application implementation and acceptance queue (REP-7). Existing tool components do not qualify this complete coding workflow; its integration follows basic chat.
- **Acceptance criteria:**
  1. Reading files, running tools and writing real folders are separately authorized.
  2. A reviewable diff is shown before any change is applied, and the applied files match the approved diff.
  3. Preview isolation, denied and outside-root writes, stale file versions, failed tests, cancellation and unknown tool outcomes are each tested, with reconciliation before retry.
  4. Prior files are preserved and failures are reported as failures, on frozen real tasks on the supported model.
- **Evidence status:** not shown. Existing tool components do not qualify the complete workflow.

## Control trust and change

### TRUST-01 — Control disclosure to contributors

- **Actor and trigger:** A requester decides which computers may receive their input and derived data.
- **Starting conditions:** The selected model, actual recipients and input scope are known.
- **Main flow:** 1. Inspect recipient and operation scope through the conversation’s consent flow → 2. Send or decline → 3. Inspect the bound attempt.
- **Successful outcome:** Execution uses exactly the authorized recipients, model and inputs; changed placement cannot inherit broader consent.
- **Interruption and recovery:** Expired or changed grants require renewed approval before disclosure.
- **Variants:** All stage recipients and coordinator relays; reuse; an optional speculative drafter adds a recipient.
- **Acceptance evidence:** [ordered grant tests](../tests/unit/ordered-partition-grants.test.js); [deadline controls](https://github.com/clocksmith/reploid/blob/e543183bed54dfdf2b6e6139dd4c31c8686f47bd/artifacts/ordered-disclosure-deadline-20261013/README.md). Exact physical signed journey remains separately gated.
- **Acceptance criteria:**
  1. Before Send, the page states where the request goes and who can read it, on the line above the message field.
  2. One clearly explained permission to use remote contributors states what is sent and who receives it; after it is granted, Send sends with no per-request screen, and each attempt's record cites the permission and names its recipients.
  3. Execution uses exactly the authorized recipients, model and inputs; a changed placement, disclosure kind, sharing scope or model needs renewed permission before disclosure.
  4. Nothing leaves the device without the permission.
- **Evidence status:** source integration ([ordered grant tests](../tests/unit/ordered-partition-grants.test.js)). Criterion 1 has physical acceptance: visible above the message field since 9aa668035, checked by the public-answer walk on that deployed build.

### TRUST-02 — Revoke a reusable grant

- **Actor and trigger:** A requester removes permission for future work.
- **Starting conditions:** A reusable grant exists and its scope is inspectable.
- **Main flow:** 1. Open the grant → 2. Revoke it → 3. See subsequent requests require fresh permission.
- **Successful outcome:** Revocation blocks further authorized steps as defined by the contract and cannot be silently renewed.
- **Interruption and recovery:** Already disclosed bytes cannot be recalled; outstanding execution ownership still requires settlement.
- **Variants:** Queued/running requests; changed recipients; disconnected contributor.
- **Acceptance evidence:** [thread grant tests](../tests/unit/chat-thread-grants.test.js); [ordered grant tests](../tests/unit/ordered-partition-grants.test.js); exact-package revocation acceptance: transactional publication milestones (DR-5).
- **Acceptance criteria:**
  1. The permission and its disclosure scope are visible and revocable in Settings.
  2. After revocation new disclosures stop and the next request asks again; revocation never silently changes an active request's route.
  3. Outstanding execution ownership still settles; already disclosed bytes are not claimed to be recalled.
- **Evidence status:** source integration ([thread grant tests](../tests/unit/chat-thread-grants.test.js)).

### TRUST-03 — Inspect contribution and execution costs

- **Actor and trigger:** A requester or contributor checks what the mesh is doing.
- **Starting conditions:** Observed attempt and resource receipts exist.
- **Main flow:** 1. Open secondary network details → 2. Inspect assigned stages, timings and resource observations → 3. Adjust supported limits or stop.
- **Successful outcome:** Measurements identify their scope; connected peers, allocated bytes, physical RAM, GPU time and token rate are not conflated.
- **Interruption and recovery:** Missing measurements stay unknown; lost remote contact does not prove freed resources.
- **Variants:** N-stage timing; native/browser hosts; stored history; co-hosted processes. The contribution records list recent executions on this device; they do not establish delivery or earnings (carried over from the archived Poolday records journey).
- **Acceptance evidence:** [activity evidence](https://github.com/clocksmith/reploid/blob/e543183bed54dfdf2b6e6139dd4c31c8686f47bd/artifacts/ordered-chat-activity-20261013/README.md); [memory observation tests](../tests/unit/partition-memory-observation.test.js). Live requester timing, energy and device-wide accounting require their own evidence.
- **Acceptance criteria:**
  1. Each measurement names its scope; connected peers, allocated bytes, physical memory, GPU time and token rate are never conflated.
  2. Missing measurements stay unknown, and lost contact is never shown as freed resources.
  3. A contributor can see the actual resource consumption of their contribution, including foreground impact where it can be measured.
- **Evidence status:** not shown. Live requester timing, energy and device-wide accounting have no retained evidence; activity and memory observation have source tests.

### TRUST-04 — Evaluate a proposed improvement

- **Actor and trigger:** An operator reviews a change intended to improve behavior.
- **Starting conditions:** A proposal, baseline, evaluator and bounded permissions are declared.
- **Main flow:** 1. Inspect the proposal → 2. Run independent evaluation → 3. Compare retained benefits, regressions and failures.
- **Successful outcome:** Evaluation results are attributable and do not automatically activate a candidate.
- **Interruption and recovery:** Failed experiments stay recorded; interrupted evaluation cannot be relabeled as acceptance.
- **Variants:** Policy/tool/runtime proposal; held-out cases; reversible changes.
- **Acceptance evidence:** [evaluated improvement tests](../tests/unit/improvement-episode.test.js); [X evaluation journeys](x/critical-user-journeys.md). Ordinary retries and multiple agents are not demonstrated self-improvement.
- **Acceptance criteria:**
  1. Evaluation is independent of the proposer, against a declared baseline and held-out cases.
  2. Results are attributable, and failed experiments stay recorded.
  3. No result activates a candidate; an interrupted evaluation is never relabeled as acceptance.
- **Evidence status:** source integration ([evaluated improvement tests](../tests/unit/improvement-episode.test.js)).

### TRUST-05 — Adopt or restore an accepted version

- **Actor and trigger:** An authorized operator chooses a qualified change or rollback.
- **Starting conditions:** Exact candidate and accepted identities, evaluation and rollback data are available.
- **Main flow:** 1. Review applicable gates → 2. Authorize adoption or restoration → 3. Verify the served/loaded identities and returning-user journey.
- **Successful outcome:** The intended bytes run and retained histories/drafts remain usable; unrelated experiments stay inactive.
- **Interruption and recovery:** Failed rollout preserves the prior accepted configuration and explicit recovery evidence.
- **Variants:** Browser/native/runtime releases; reversible policy; fresh/existing installations.
- **Acceptance evidence:** [evaluated improvement tests](../tests/unit/improvement-episode.test.js); release gates (ALL-6). Approval alone does not qualify numerical, lifecycle or application behavior.
- **Acceptance criteria:**
  1. Only a configuration that passed its applicable gates is promoted, with explicit deployment authorization.
  2. After deployment, the served application and package identities match the intended bytes.
  3. A fresh browser works, and saved history and drafts stay usable, as do successful requests after an interruption.
  4. A failed rollout keeps the prior accepted configuration, with recovery evidence.
- **Evidence status:** not shown. Deployment checks served identities on every deploy (9aa668035 most recently); returning-user and rollback acceptance on a frozen release are not shown.

### TRUST-06 — Earn credits by serving, spend them, and have an outsider verify the charge

- **Actor and trigger:** One person serves another person's request on their own machine to earn credits; another person spends credits on a request; a third person checks the charge.
- **Starting conditions:** The earner and the spender are different people on their own machines, each with their own key, and both run one pinned Reploid commit. A ledger is running and signs settlement statements with a coordinator key.
- **Main flow:** 1. The earner serves on the ordinary whole-model route → 2. The spender pays for a request with credits → 3. Each exports their signed records → 4. The outsider verifies the debit, every payout and every hold release from those records.
- **Successful outcome:** The outsider confirms, from signed records alone, that the debit, payouts and releases are what the signed terms say.
- **Interruption and recovery:** Stop during streaming and a silent provider each settle with no hold left; an incomplete record set exports as incomplete with its reason.
- **Variants:** Completion; Stop during streaming; silent provider failure; the same account earning and spending, or two named accounts.
- **Acceptance evidence:** [Verify a trade](verify-a-trade.md#run-a-trade-between-two-people).
- **Acceptance criteria:**
  1. The earner and the spender are two different people on their own machines with their own keys.
  2. The spender spends credits the same account earned by serving, or the result states explicitly which account earned and which spent.
  3. Both run one pinned commit.
  4. The outside verifier is a third person who does not run the ledger and verifies, from signed records only, without ledger or coordinator database access and with the coordinator's key obtained independently, the debit, every payout and the hold release.
  5. The route is the ordinary whole-model route, and the page discloses before Send that the serving computer can read the request; this is not confidential split inference.
  6. Completion, Stop during streaming and silent provider failure each settle correctly, with no hold left.
- **Evidence status:** not shown. Two rehearsals exist and do not qualify it: a one-operator rehearsal across four processes on one machine with test keys (Reploid 3cdffd76a..4e5995ce5), and a one-operator dry run with a real model on one machine, in which one person held all three keys and ran the outsider check (Reploid bbc49a7ec with 0f4da29bb and 88c253471). Neither has two people, two machines or an independent verifier.

## Compose an application

### DEV-01 — Use Reploid inside my application

- **Actor and trigger:** An application developer wants distributed execution without adopting Reploid’s UI or credential system.
- **Starting conditions:** The developer selects a supported package and supplies host, storage and authorization ports under their application’s policies.
- **Main flow:** 1. Compose the library through its public interfaces → 2. Submit authorized work → 3. Receive accepted results through application-owned delivery and persistence → 4. Cancel outstanding work and shut down cleanly.
- **Successful outcome:** The application receives only accepted results and preserves its own interface, credentials and storage authority. Shutdown settles owned resources without disrupting other consumers.
- **Interruption and recovery:** Failed or unknown storage outcomes cannot publish candidate results. Revocation stops further admission; uncertain remote ownership remains charged until observed settlement. Restart uses explicit authorized recovery rather than assuming retained GPU state.
- **Variants:** Browser/native composition; injected ports; independent consumers sharing prepared capacity; installed package outside the repository; cancellation and shutdown failures.
- **Acceptance evidence:** [public library consumer harness](../tests/library-package-acceptance.js); [typed public contracts](../tests/types/library-contracts.ts); [browser cancellation controls](../tests/unit/browser-library-cancellation.test.js). These identify component and consumer checks, not full signed N-stage acceptance; exact-package release gates (ALL-6) remain applicable.
- **Acceptance criteria:**
  1. An application composes the library through its public interfaces only, with its own host, storage and authorization ports.
  2. It receives only accepted results; failed or unknown storage outcomes never publish candidates.
  3. Cancel and shutdown settle owned resources without disrupting other consumers; uncertain remote ownership stays charged.
  4. An installed package outside the repository passes the same checks.
- **Evidence status:** source integration ([public library consumer harness](../tests/library-package-acceptance.js)).

### DEV-02 — Connect an existing model client

- **Actor and trigger:** An application developer wants a supported model client to use authorized Reploid capacity.
- **Starting conditions:** An explicitly versioned compatibility adapter and its supported parameters, host credentials and model capabilities are available.
- **Main flow:** 1. Configure the client through the documented public adapter → 2. Submit supported messages and generation settings → 3. Consume accepted streaming events and completion metadata → 4. Cancel or close the client and observe settlement.
- **Successful outcome:** Supported parameters preserve declared semantics, unsupported parameters fail explicitly before execution, and accepted output reaches the application without exposing unpublished candidates.
- **Interruption and recovery:** Protocol errors, capacity loss, revoked grants and unknown persistence outcomes remain distinguishable. Tool outcomes require JOB-03 reconciliation; reconnecting does not silently replay external effects.
- **Variants:** OpenAI Chat Completions/Responses; Anthropic Messages; tool calls/results; structured outputs; seed/top_p; browser/native consumers; streaming and nonstreaming calls.
- **Acceptance evidence:** [existing library consumer harness](../tests/library-package-acceptance.js); compatibility implementation queue (REP-7). This is a compatibility target, not a claim that all listed protocols or settings are currently supported.
- **Acceptance criteria:**
  1. Versioned OpenAI Chat Completions/Responses and Anthropic Messages adapters cover streaming event order, completion reasons, cancellation, tool-call and result boundaries, structured outputs, errors and usage.
  2. A published parameter matrix maps each sampling control faithfully or rejects it before execution; nothing is silently ignored.
  3. Host-owned credentials, grants and durable accepted output are preserved.
  4. Model-backed sessions through installed SDKs and clients pass, including tool results, continuation, cancellation and recovery. Protocol similarity is not conformance.
- **Evidence status:** not shown. An installed Chat Completions adapter passes with injected computation (source integration); model-backed compatibility is not shown.

## Coverage matrix

Select combinations for a declared claim; do not multiply journeys or claim
exhaustive coverage of an unbounded mesh. Each retained run records the journey
IDs, frozen identities, matrix values, injections and observed outcome.

| Dimension | Meaningful values and failure boundaries |
| --- | --- |
| Route/model | Whole model; 2/3/4/5/6/7 ordered stages; larger generated routes; uneven contiguous layer ranges; incompatible middle stage |
| Hosts | Browser/browser; browser/native; native/native; independent physical hosts versus several logical nodes on one GPU |
| Replicas | One owner per stage; multiple compatible replicas; stale offer; missing stage; selected replica departure |
| Readiness path | Cold acquisition; prepared service; warm replacement with weights but no conversation state; cold replacement missing both; verified local pieces still needing GPU preparation |
| Acquisition and retention | Missing bytes; useful complementary pieces; supplier throughput/contention; interrupted/resumed transfer; verification failure; retained pieces after restart; contributor leaves before route readiness |
| Inference state | Stage-local attention/recurrent/convolution state; model/context/conversation-count geometry; authorized history reconstruction; measured future state transfer only under a separately qualified contract |
| Demand | One requester; overlapping conversations; requester also contributes; saturated admission/queue; slow or starved stage |
| Permission | Fresh/reused/expired/revoked grants; changed model, input or recipients; compute and file supply separately authorized |
| Durability | Successful commit; failed write; unknown write outcome; duplicate delivery; refresh/upgrade; no publication before commit |
| Cancellation ordering | Publication wins before cancellation versus cancellation wins before publication; delayed acknowledgments; no later candidate output leaks (KEEP-03, CHAT-01) |
| Generation endings | Zero-output requests; context exhaustion; natural completion; output limits; stop strings spanning chunks; tool-call boundaries before and after accepted publication (CHAT-01, JOB-03) |
| Tool outcomes | Known success/failure versus outcome unknown after external execution; reconciliation; idempotency-key reuse; non-idempotent replay blocked (JOB-03) |
| Failure position | Before admission; acquisition; each stage; in-flight activation/output; storage commit; cleanup; reconnect/retry |
| Execution mode | Ordinary execution first; optional qualified draft/fork/replay separately; added recipients require applicable consent |

| Scenario | Journeys exercised | Deployment variant | Acceptance boundary |
| --- | --- | --- | --- |
| Independent users under churn | CHAT-01, CHAT-02, KEEP-03, KEEP-04, MESH-01, CONTRIB-05 | Distinct users and tasks over shared physical contributors; join, withdrawal, cancellation and assigned-owner loss | Useful survivor answers, isolated histories/grants, fresh retry and observed settlement; source simulation remains separate. |
| Existing client integration | DEV-02, JOB-03, KEEP-03 | Versioned compatibility adapters, streaming, tools and structured outputs | Declared protocol and parameter semantics must pass installed-consumer checks; unsupported settings reject explicitly. |
| Bounded coding task | JOB-06, JOB-03, TRUST-01 | Authorized files, isolated preview, console feedback and reviewed real-folder writes | Complete task behavior and effect reconciliation require evidence; optional after basic chat. |
| Application composition | DEV-01, KEEP-03, TRUST-02 | Browser/native consumers with host-owned ports and independently installed packages | Public import, accepted delivery, persistence failures and settled shutdown require exact-package evidence. |
| Ordinary conversation | CHAT-01, CHAT-02, CHAT-05, KEEP-01, KEEP-03, KEEP-04 | Current two-stage browser/native baseline | Existing scoped numerical/physical receipts must not be combined into an unrun signed release claim. |
| Acquire once, serve repeatedly | CONTRIB-01, CONTRIB-02, MESH-04, CHAT-01, CHAT-02 | Cold route acquisition, interrupted supply, contributor restart, then prepared repeated requests | Verify piece retention and resumed transfer; measure acquisition, GPU preparation, route readiness and generation separately. Prepared requests must avoid repeated weight downloads. This acceptance remains open. |
| Replace with warm or cold capacity | KEEP-04, MESH-03, MESH-04, TRUST-01 | Weights present/state absent versus both absent; long contexts and overlapping conversations | Explicit authorized retry, separate reconstruction cost and honest unavailable capacity; warm weights never imply transferred GPU state. Preserve prior output and unaffected conversations. Physical acceptance remains open. |
| Ordered network | CHAT-01, CHAT-02, CONTRIB-03, MESH-01, KEEP-02 | Two through seven stages; two overlapping requesters; signaling loss | [Actual source integration](https://github.com/clocksmith/reploid/blob/e543183bed54dfdf2b6e6139dd4c31c8686f47bd/artifacts/automatic-ordered-participation-20261013/README.md) uses injected numerical stages. Independent physical hosts and signed delivery remain separate. |
| Replicated larger model | MESH-01, MESH-02, MESH-03, MESH-05 | Twelve computers, three stages, four prepared replicas per stage | Intended capacity scenario; full-route admission, useful answers and independent failure domains need evidence. |
| Sustained concurrent demand | MESH-01, MESH-05, CONTRIB-04, CONTRIB-05, KEEP-03, KEEP-04 | Twenty conversations, sixty stage states, five states per computer on twelve computers | Intended scenario, not a supported setting. Prove memory, fair progress and settlement before increasing admission limits. Active states do not mean simultaneous GPU operations. |
| Mixed large mesh | CHAT-04, CONTRIB-01, CONTRIB-02, MESH-03, MESH-04 | One hundred computers, several models, mixed file supply and compute | Intended scenario. Prove bounded discovery, compatible routing, preparation and replication within grants; do not broadcast every request to everyone. |

Numerical agreement qualifies identified computation, not scheduling, durability,
recovery or additional capacity. Speculative decoding is an execution variant
behind an answer-speed objective; it does not block ordinary multistage capacity.
If it changes recipients, TRUST-01 applies before any additional disclosure.

## Mapping the earlier seven examples

| Earlier example | Stable outcome IDs | Detail moved to variants |
| --- | --- | --- |
| Ask without preparation | CHAT-01 | Requester/host type and resident readiness |
| Follow-up plus concurrency | CHAT-02 and MESH-01 | Overlapping routes and demand |
| Larger model across replicas | MESH-02 | Twelve-computer/three-stage/four-replica arrangement |
| Ask while contributing | CONTRIB-03; withdrawal is CONTRIB-05 | Shared device and independent permissions |
| Contributor loss | KEEP-02, KEEP-04 | Failed stage and replacement placement; only durable output retained |
| Add capacity | CONTRIB-01 and MESH-04 | Joining versus complementary preparation and placement |
| Speculative decoding | Execution variant; TRUST-01 if disclosure changes | Qualified draft/fork/replay implementation and performance |

## Other products in this repository

The `/zero` and `/x` agent workspaces are different products in this repository. They keep
their own journey catalogues, which do not qualify the journeys above:

| Product | Route | Readable summary | Registry |
| --- | --- | --- | --- |
| Zero | `/zero` | [Zero journeys](./zero/critical-user-journeys.md) | [`zero-critical-user-journeys.json`](./status/zero-critical-user-journeys.json) |
| X | `/x` | [X journeys](./x/critical-user-journeys.md) | [`x-critical-user-journeys.json`](./status/x-critical-user-journeys.json) |

## Archived: Poolday coordinator lanes

The Poolday journey registry described the retired coordinator lanes. It was archived on
2026-11-26 to [`archive/poolday-critical-user-journeys.md`](./archive/poolday-critical-user-journeys.md)
and [`archive/poolday-critical-user-journeys.json`](./archive/poolday-critical-user-journeys.json).
What was still true and user-facing moved here:

| Archived Poolday journey | Where it went |
| --- | --- |
| Recover with local inference | CHAT-01 variants: running a downloaded model on this device is an explicit choice |
| Contribute browser compute | CONTRIB-01 variants: whole-model browser contributor, no uptime promise |
| Verify receipt agreement | CHAT-05 variants: the signed receipt and what a signature does not show |
| Inspect records | KEEP-01 variants (history stays in this browser); TRUST-03 variants (contribution records are not earnings) |

Dropped, because they are not on the current page or were superseded: requesting a
coordinator text answer (the coordinator's text models are disabled; CHAT-01 replaces it),
the coordinator's ring, canary and redundant receipt-agreement policies, public protein
embeddings, published adapter packs, local protocol reputation points (TRUST-06 replaces
them with credits earned by serving), paid monetary compensation (none exists; credits are
not money), and the `/records` and `/history` route aliases.

## Checking the catalogue

Run `npm run verify:journeys` to check this catalogue alongside the Zero and X registries.
For this file it checks that every journey has a unique ID, its required fields, pass/fail
acceptance criteria and an evidence status from the allowed set; that every FIRST journey
covers existing catalogue journeys; that the owner's four journeys and acceptance line equal
the pinned copy byte for byte; and that local links, anchors and scenario references
resolve. Catalogue integrity is not runtime qualification. Architecture documents and
blueprints may explain mechanisms, but they do not advance an evidence status; a passing test
mentioned only in prose does not either.
