# Reploid Critical User Journeys

This catalogue describes what people intend to accomplish. It is not a list of
supported configurations or another engineering queue. Implementation, milestone
ordering and completion checkboxes remain in [TODO.md](../TODO.md). The
[chat contract](chat-mvp.md) and [mesh architecture](open-mesh-architecture.md)
explain the product and its mechanisms; neither advances acceptance by itself.

Each journey has one stable ID, actor/trigger, starting conditions, a three-step
main flow, observable success, interruption/recovery, deployment variants and
acceptance evidence. Variants reuse a journey rather than creating another goal
for every topology. Adding a route stage does not add a new user goal.

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

## Catalogue

| Family | User outcomes |
| --- | --- |
| [Ask and continue](#ask-and-continue) | Ask, follow up, attach, choose a model, inspect/copy |
| [Keep and recover work](#keep-and-recover-work) | Reopen, reconnect, stop, retry, manage history |
| [Contribute resources](#contribute-resources) | Offer compute/files, ask while contributing, limit, withdraw |
| [Share network capacity](#share-network-capacity) | Concurrent service, larger models, busy networks, missing coverage, queues |
| [Delegate work](#delegate-work) | Independent jobs, subtasks, tools, results, cancellation |
| [Control trust and change](#control-trust-and-change) | Disclosure, revocation, resource inspection, evaluation, adoption/restore |

## Ask and continue

### CHAT-01 — Ask without downloading model weights

- **Actor and trigger:** A requester opens Reploid to ask a question.
- **Starting conditions:** A supported model has eligible prepared capacity; disclosure is authorized.
- **Main flow:** 1. Open chat and choose an available model → 2. Submit a question and authorize its actual recipients → 3. Read the streamed, durably accepted answer.
- **Successful outcome:** A complete answer appears and remains in history; the requester acquires no weights.
- **Interruption and recovery:** Unavailable capacity is explicit. Interrupted published output remains; retry is a new authorized attempt.
- **Variants:** Phone/desktop requester; browser/native contributors; 1/2/N stages; cold or resident capacity.
- **Acceptance evidence:** [ordered chat/entry source tests](../tests/unit/ordered-partition-chat-entry.test.js); [retained short physical conversation/recovery](../artifacts/live-conversation-20261012/README.md). These cover different scopes/packages; signed N-stage release and [transactional publication milestones](../TODO.md#dr-5) remain open.

### CHAT-02 — Continue my conversation

- **Actor and trigger:** A returning requester asks a follow-up.
- **Starting conditions:** Saved messages exist; eligible contributors may differ from the previous request.
- **Main flow:** 1. Open the conversation and see saved history → 2. Submit a follow-up and authorize additional recipients if needed → 3. Read the durably accepted response.
- **Successful outcome:** The answer uses the authorized context, is saved once, and leaves concurrent conversations isolated.
- **Interruption and recovery:** Only published output survives. Explicit retry creates a new attempt; history does not restore lost GPU state.
- **Variants:** Phone/browser requester; browser/native hosts; 1/2/N stages; reused/new residents; overlapping routes.
- **Acceptance evidence:** [ordered chat/entry source tests](../tests/unit/ordered-partition-chat-entry.test.js); [context tests](../tests/unit/chat-context.test.js); [retained short physical conversation/recovery](../artifacts/live-conversation-20261012/README.md); exact-package durable release: [transactional publication milestones](../TODO.md#dr-5).

### CHAT-03 — Ask about an attachment

- **Actor and trigger:** A requester supplies a document with a question.
- **Starting conditions:** The format and input size are supported; permission includes its text.
- **Main flow:** 1. Attach and inspect the selected material → 2. Submit a question with scoped consent → 3. Open source references in the answer.
- **Successful outcome:** Authorized passages arrive in order and usable citations point back to the supplied source.
- **Interruption and recovery:** Keep the attachment and draft after failure; never silently drop input to fit a route.
- **Variants:** One/multiple attachments; follow-up reuse; changed recipients; long context.
- **Acceptance evidence:** [attachment/context controls](../tests/unit/chat-context.test.js); [application acceptance](../TODO.md#rep-7). Factual/citation qualification remains separate and incomplete; it does not gate basic chat.

### CHAT-04 — Start with another supported model

- **Actor and trigger:** A requester wants a different model for a new conversation.
- **Starting conditions:** The model and any adapter have an eligible declared configuration.
- **Main flow:** 1. Open model choices → 2. Start a new thread with the chosen model → 3. Submit and see that exact model execute.
- **Successful outcome:** The selected model identity is preserved; an unavailable choice is not silently substituted.
- **Interruption and recovery:** Keep the draft and original conversation if preparation fails.
- **Variants:** Ready/busy/preparing models; compatible adapters; local or distributed route.
- **Acceptance evidence:** [model identity tests](../tests/unit/chat-model-manifests.test.js); [application acceptance](../TODO.md#rep-7). Model-specific physical/release evidence must be attached before support is claimed.

### CHAT-05 — Inspect and copy an answer

- **Actor and trigger:** A requester wants to use or understand a response.
- **Starting conditions:** An answer or retained published partial answer is visible.
- **Main flow:** 1. Read the response → 2. Optionally expand its contributing-stage details or sources → 3. Copy text or code.
- **Successful outcome:** Copied content matches the visible accepted response; assigned contributors and unknown metrics are distinguishable.
- **Interruption and recovery:** Copy and history inspection remain available after contributors depart.
- **Variants:** Themes, phone widths, code, citations, 1/2/N stages, absent timing.
- **Acceptance evidence:** [activity/browser evidence](../artifacts/ordered-chat-activity-20261013/README.md); [presentation tests](../tests/e2e/chat-material.spec.js). No fresh physical-phone acceptance is implied.

## Keep and recover work

### KEEP-01 — Reopen saved history

- **Actor and trigger:** A returning requester reloads or upgrades the app.
- **Starting conditions:** There are committed conversations and saved drafts.
- **Main flow:** 1. Open the app → 2. Select a saved thread → 3. Inspect history and edit its restored draft.
- **Successful outcome:** The same committed messages and drafts return without redispatching old requests.
- **Interruption and recovery:** Storage failure is explicit; unreadable history is not overwritten with an empty success state.
- **Variants:** Fresh/returning installation; upgrade; browser restart; interrupted prior attempt.
- **Acceptance evidence:** [draft transaction tests](../tests/unit/chat-draft-transactions.test.js); [retained short physical conversation/recovery](../artifacts/live-conversation-20261012/README.md); frozen upgrade acceptance: [transactional publication milestones](../TODO.md#dr-5).

### KEEP-02 — Reconnect during a request

- **Actor and trigger:** A requester loses signaling or an execution connection.
- **Starting conditions:** An authorized attempt is running.
- **Main flow:** 1. Observe the connection state → 2. Reconnect when possible → 3. Continue receiving accepted output or choose an explicit retry.
- **Successful outcome:** Healthy authorized execution survives signaling loss; lost execution state is reported honestly.
- **Interruption and recovery:** Preserve published output and keep unknown remote allocations charged until settlement.
- **Variants:** Bootstrap loss; healthy data channel; contributor departure at any stage; independent networks.
- **Acceptance evidence:** [automatic network source integration](../artifacts/automatic-ordered-participation-20261013/README.md); [retained short physical conversation/recovery](../artifacts/live-conversation-20261012/README.md); independent-network and signed N-stage acceptance remain open in [combined-capacity acceptance](../TODO.md#dr-6).

### KEEP-03 — Stop one response

- **Actor and trigger:** A requester no longer needs a running answer.
- **Starting conditions:** One or more conversations are active.
- **Main flow:** 1. Select the response and press Stop → 2. Observe Stopping while cleanup is pending → 3. See the attempt settle.
- **Successful outcome:** No further output is published for the stopped attempt; unrelated conversations and weights survive.
- **Interruption and recovery:** Unknown or failed cleanup remains visible and charged; offer Retry stopping when supported.
- **Variants:** Queued/acquiring/prefilling/decoding attempts; overlapping stops; shared contributors.
- **Acceptance evidence:** [ordered runner controls](../artifacts/ordered-route-runner-20261013/README.md); [scoped physical cleanup/retry](../artifacts/cleanup-failure-20261012/README.md); concurrent long exact-package acceptance: [transactional publication milestones](../TODO.md#dr-5).

### KEEP-04 — Retry an interrupted answer

- **Actor and trigger:** A requester wants another attempt after failure.
- **Starting conditions:** A prior attempt and its published partial output remain visible.
- **Main flow:** 1. Inspect the failure → 2. Choose Retry and approve any changed recipients → 3. Read a separate new response.
- **Successful outcome:** The old response remains distinct; retry uses a fresh attempt and only authorized context.
- **Interruption and recovery:** Repeated failure leaves both attempts inspectable; no silent continuation from lost model state.
- **Variants:** Any failed stage; alternate replica; native/browser replacement; revoked prior grant.
- **Acceptance evidence:** [ordered chat/entry source tests](../tests/unit/ordered-partition-chat-entry.test.js); [retained short physical conversation/recovery](../artifacts/live-conversation-20261012/README.md); signed N-stage replacement and durable publication remain open in [transactional publication milestones](../TODO.md#dr-5).

### KEEP-05 — Manage retained conversations

- **Actor and trigger:** A requester organizes or exports their work.
- **Starting conditions:** Saved threads exist, possibly with active attempts.
- **Main flow:** 1. Open thread actions → 2. Rename, archive or export the selected conversation → 3. Return to the desired thread.
- **Successful outcome:** Organization affects the selected thread; export reflects its retained accepted messages.
- **Interruption and recovery:** Archiving does not implicitly cancel inference; cancellation stays a separate explicit action.
- **Variants:** Long history; archived active thread; phone drawer; failed storage write.
- **Acceptance evidence:** [workspace tests](../tests/unit/chat-workspace.test.js); [conversation UI tests](../tests/e2e/chat-material.spec.js). Exact upgrade and publication acceptance remains separate.

## Contribute resources

### CONTRIB-01 — Offer compute

- **Actor and trigger:** A device owner chooses to help answer questions.
- **Starting conditions:** An eligible browser/native executor has explicit limits and a compatible model plan.
- **Main flow:** 1. Enable compute contribution → 2. Observe authorized preparation → 3. See readiness only after required execution preparation completes.
- **Successful outcome:** The device serves admitted work within its permissions and limits.
- **Interruption and recovery:** Show missing supply and failed preparation; retain cleanup ownership rather than advertising false readiness.
- **Variants:** Browser/native; assigned entry/middle/final stage; resident/cold model.
- **Acceptance evidence:** [host preparation](../artifacts/ordered-host-preparation-20261013/README.md); [host lifecycle tests](../tests/unit/work-swarm-lifecycle.test.js). Physical N-stage host qualification remains open.

### CONTRIB-02 — Offer verified model files

- **Actor and trigger:** A device owner permits supplying cached model pieces.
- **Starting conditions:** Verified pieces exist; a separate bounded file-sharing grant is available.
- **Main flow:** 1. Select the model and transfer allowance → 2. Enable file sharing → 3. Inspect supplied bytes and remaining allowance.
- **Successful outcome:** Only permitted verified pieces are supplied and transfers consume the persistent allowance.
- **Interruption and recovery:** Restart does not silently renew the allowance; supply withdrawal preserves already verified recipient pieces.
- **Variants:** Storage-only or compute+storage; replacement supplier; interrupted transfer; process restart.
- **Acceptance evidence:** [custody acceptance](../TODO.md#rep-5); [source verification tests](../tests/unit/work-partition-blake3-source.test.js). Receipts must identify the model and ledger; compute consent alone is insufficient.

### CONTRIB-03 — Ask while contributing

- **Actor and trigger:** A contributor also starts their own conversation.
- **Starting conditions:** Their contribution and requester permissions are separate.
- **Main flow:** 1. Leave contribution enabled → 2. Submit a personal question → 3. Follow both activities independently.
- **Successful outcome:** The personal conversation receives service without sharing unrelated histories or exceeding admitted capacity.
- **Interruption and recovery:** Stopping the personal answer does not withdraw all contribution; withdrawing compute settles affected work explicitly.
- **Variants:** Requester on entry/middle/final host; shared resident weights; concurrent remote requests.
- **Acceptance evidence:** [automatic network source integration](../artifacts/automatic-ordered-participation-20261013/README.md); [ordered runner controls](../artifacts/ordered-route-runner-20261013/README.md). Injected numerical source controls are not physical combined-capacity acceptance.

### CONTRIB-04 — Set contribution limits

- **Actor and trigger:** A device owner wants bounded resource use.
- **Starting conditions:** Contribution has explicit memory, compute and transfer policies.
- **Main flow:** 1. Review current usage and limits → 2. Set supported allowances → 3. Observe admission respecting the resulting budget.
- **Successful outcome:** New work is rejected or queued predictably when it cannot be admitted; unknown allocations remain charged.
- **Interruption and recovery:** Lowering limits cannot erase outstanding ownership or silently claim immediate GPU preemption.
- **Variants:** Browser/native co-hosting; per-attempt state; shared physical GPU; retained cleanup debt.
- **Acceptance evidence:** [memory settlement tests](../tests/unit/partition-memory-settlement.test.js); [combined-capacity acceptance](../TODO.md#dr-6). Shared physical-device enforcement remains open; per-device accounting is not equivalent.

### CONTRIB-05 — Pause or withdraw contribution

- **Actor and trigger:** A contributor needs their device back.
- **Starting conditions:** Preparation or inference may be outstanding.
- **Main flow:** 1. Choose Stop contribution → 2. Observe affected work settling → 3. See idle only after owned resources settle.
- **Successful outcome:** Unrelated conversations survive and a new contribution cannot be closed by an older stop.
- **Interruption and recovery:** Failed cleanup remains retryable; file supply remains governed by its separate permission.
- **Variants:** Acquisition/execution/idle; overlapping stops; replacement sessions; native shutdown.
- **Acceptance evidence:** [host lifecycle tests](../tests/unit/work-swarm-lifecycle.test.js); [scoped physical cleanup/retry](../artifacts/cleanup-failure-20261012/README.md). Demanding signed N-stage and native-provider teardown acceptance remains configuration-specific.

## Share network capacity

### MESH-01 — Receive service while others are active

- **Actor and trigger:** A requester asks while other conversations are using the mesh.
- **Starting conditions:** A compatible route can admit another private conversation state.
- **Main flow:** 1. Submit the question → 2. Observe admitted execution or an honest queue → 3. Receive a streamed answer independently.
- **Successful outcome:** Conversations make bounded progress and cannot read or cancel each other’s state.
- **Interruption and recovery:** Cancel or fail one attempt while survivors continue; unknown ownership remains reserved.
- **Variants:** Shared/disjoint routes; replicas; multiple requester roles; uneven stage speeds.
- **Acceptance evidence:** [automatic network source integration](../artifacts/automatic-ordered-participation-20261013/README.md); [ordered runner controls](../artifacts/ordered-route-runner-20261013/README.md); physical fairness and long concurrency acceptance: [combined-capacity acceptance](../TODO.md#dr-6).

### MESH-02 — Access a model my device cannot run

- **Actor and trigger:** A requester selects a model requiring combined capacity.
- **Starting conditions:** An eligible complete route exists with the necessary authorized pieces and budgets.
- **Main flow:** 1. Choose the supported model → 2. Authorize the actual route → 3. Receive a complete answer without local weights.
- **Successful outcome:** The workload succeeds collaboratively under limits that prevent each executor running it alone.
- **Interruption and recovery:** Missing stages are explicit; replacement requires a new authorized attempt when state was lost.
- **Variants:** 2/N stages; uneven layer ranges; three stages with four replicas each on twelve computers.
- **Acceptance evidence:** [runtime/source composition](../artifacts/ordered-route-integration-20261013/README.md); [combined-capacity acceptance](../TODO.md#dr-6). The twelve-computer deployment and capacity advantage remain acceptance targets.

### MESH-03 — Join a busy network

- **Actor and trigger:** A new requester opens the app while prepared capacity is occupied.
- **Starting conditions:** Discovery is available; connected peers may be busy or incompatible.
- **Main flow:** 1. Open the app → 2. See actual compatible availability → 3. Submit when admitted or remain in a bounded queue.
- **Successful outcome:** Peer count does not promise available compute; the user can distinguish busy, preparing and unavailable.
- **Interruption and recovery:** Stale advertisements cannot turn into silent dispatch or replacement without approval.
- **Variants:** Fresh requester; expired offers; all replicas busy; bootstrap alternative.
- **Acceptance evidence:** [discovery controls](../artifacts/ordered-discovery-20261013/README.md); [automatic network source integration](../artifacts/automatic-ordered-participation-20261013/README.md). Sustained independent-network acceptance remains open.

### MESH-04 — Help make a missing model available

- **Actor and trigger:** A contributor offers capacity for incomplete model coverage.
- **Starting conditions:** The model is authorized but a required stage or verified supply is absent.
- **Main flow:** 1. Choose to contribute → 2. Observe which authorized dependency is being prepared → 3. See the model become usable only when a full route is ready.
- **Successful outcome:** Readiness reflects complete eligible coverage, not merely connected nodes or downloaded pieces.
- **Interruption and recovery:** Missing file consent or supplier departure is visible; preparation can stop without losing committed pieces.
- **Variants:** Cold contribution; complementary stages; replacement supplier; demand-driven replicas.
- **Acceptance evidence:** [stage preparation](../artifacts/ordered-host-preparation-20261013/README.md); [automatic network source integration](../artifacts/automatic-ordered-participation-20261013/README.md). Automatic cold complementary-stage assignment and demand-driven replication remain open in [combined-capacity acceptance](../TODO.md#dr-6).

### MESH-05 — Wait for capacity without losing my request

- **Actor and trigger:** A requester submits more demand than the network can admit immediately.
- **Starting conditions:** Queue limits and cancellation behavior are declared.
- **Main flow:** 1. Submit a request → 2. See queued or explicit rejection → 3. Receive service when admitted or cancel waiting.
- **Successful outcome:** Waiting is bounded and visible; admitted state stays within limits and competing requests do not starve.
- **Interruption and recovery:** Expired authorization is renewed explicitly before disclosure; cancellation cannot later dispatch the queued request.
- **Variants:** Queue saturation; slow stage; many requesters; freed/replaced capacity.
- **Acceptance evidence:** [ordered runner controls](../artifacts/ordered-route-runner-20261013/README.md); [request scheduling tests](../tests/unit/chat-scheduler.test.js). Per-stage FIFO controls do not qualify cross-route fairness or the twenty-conversation deployment.

## Delegate work

### JOB-01 — Submit an independent job

- **Actor and trigger:** A requester submits bounded work whose units can finish independently.
- **Starting conditions:** The operation, input scope, model and limits are supported and separately authorized.
- **Main flow:** 1. Submit the job → 2. Observe completed and pending units → 3. Collect committed results in original order.
- **Successful outcome:** One accepted result exists per unit; retries need not imply exactly-once execution.
- **Interruption and recovery:** Keep committed units and retry unfinished ones after contributor loss.
- **Variants:** Embedding/indexing or other qualified operations; many workers; reordered delivery.
- **Acceptance evidence:** [independent-job channel tests](../tests/unit/pool-peer-pack-job-channel.test.js); [durable job foundation](../TODO.md#rep-1). Indexing remains deferred; generation permission does not authorize another operation.

### JOB-02 — Let an agent coordinate bounded subtasks

- **Actor and trigger:** A requester delegates a goal with a bounded scope.
- **Starting conditions:** Permitted operations, budgets and completion criteria are explicit.
- **Main flow:** 1. Submit the goal → 2. Observe authorized subtask progress → 3. Inspect the combined result and its evidence.
- **Successful outcome:** The result distinguishes completed, failed and uncertain work without granting the agent extra authority.
- **Interruption and recovery:** Cancel remaining work while retaining committed subresults and unresolved ownership.
- **Variants:** Independent tasks versus dependent stages; local/remote workers; repeated subtasks.
- **Acceptance evidence:** [X journey registry](x/critical-user-journeys.md); [job policy tests](../tests/unit/pool-peer-pack-job-policy.test.js). Agent coordination is not established by split-model token execution.

### JOB-03 — Approve a tool action

- **Actor and trigger:** A requester reviews an agent’s proposed action.
- **Starting conditions:** The proposed action, arguments, recipients and effects are available for review.
- **Main flow:** 1. Inspect the proposal → 2. Approve or decline its exact scope → 3. See the observed outcome.
- **Successful outcome:** Only the approved action executes; a model score never substitutes for permission.
- **Interruption and recovery:** A retry with changed arguments or recipients requires the applicable fresh authorization.
- **Variants:** Local/remote tools; disclosure versus mutation; delayed/expired approval.
- **Acceptance evidence:** [Zero authority boundaries](zero/critical-user-journeys.md); [X approval journeys](x/critical-user-journeys.md). Tool permission is separate from compute and file supply.

### JOB-04 — Inspect a delegated result

- **Actor and trigger:** A requester wants to understand completed delegated work.
- **Starting conditions:** A job has retained results and provenance.
- **Main flow:** 1. Open the job → 2. Inspect unit outcomes and evidence → 3. Use or export the accepted results.
- **Successful outcome:** Completed work, failed experiments and unqualified capabilities remain distinguishable.
- **Interruption and recovery:** Missing evidence is reported; a departed worker does not erase committed results.
- **Variants:** Independent job, agent subtask, evaluated change; partial completion.
- **Acceptance evidence:** [independent-job channel tests](../tests/unit/pool-peer-pack-job-channel.test.js); [records journeys](poolday/critical-user-journeys.md). Those supporting surfaces do not establish ordinary chat release qualification.

### JOB-05 — Cancel unfinished delegated work

- **Actor and trigger:** A requester withdraws a running job.
- **Starting conditions:** Some units may be committed while others are running or queued.
- **Main flow:** 1. Cancel the remaining job → 2. Observe stop/settlement → 3. Retain already accepted results.
- **Successful outcome:** No newly unauthorized units are admitted and previously committed results remain inspectable.
- **Interruption and recovery:** Unknown remote execution stays charged until observed settlement; retry only unfinished authorized units.
- **Variants:** Worker loss; overlapping stops; partial job; storage failure.
- **Acceptance evidence:** [independent-job channel tests](../tests/unit/pool-peer-pack-job-channel.test.js); [durable jobs and contribution acceptance](../TODO.md#rep-3). Job cancellation is separate from generation-state recovery.

## Control trust and change

### TRUST-01 — Control disclosure to contributors

- **Actor and trigger:** A requester decides which computers may receive their input and derived data.
- **Starting conditions:** The selected model, actual recipients and input scope are known.
- **Main flow:** 1. Inspect recipient and operation scope through the conversation’s consent flow → 2. Send or decline → 3. Inspect the bound attempt.
- **Successful outcome:** Execution uses exactly the authorized recipients, model and inputs; changed placement cannot inherit broader consent.
- **Interruption and recovery:** Expired or changed grants require renewed approval before disclosure.
- **Variants:** All stage recipients and coordinator relays; reuse; an optional speculative drafter adds a recipient.
- **Acceptance evidence:** [ordered grant tests](../tests/unit/ordered-partition-grants.test.js); [deadline controls](../artifacts/ordered-disclosure-deadline-20261013/README.md). Exact physical signed journey remains separately gated.

### TRUST-02 — Revoke a reusable grant

- **Actor and trigger:** A requester removes permission for future work.
- **Starting conditions:** A reusable grant exists and its scope is inspectable.
- **Main flow:** 1. Open the grant → 2. Revoke it → 3. See subsequent requests require fresh permission.
- **Successful outcome:** Revocation blocks further authorized steps as defined by the contract and cannot be silently renewed.
- **Interruption and recovery:** Already disclosed bytes cannot be recalled; outstanding execution ownership still requires settlement.
- **Variants:** Queued/running requests; changed recipients; disconnected contributor.
- **Acceptance evidence:** [thread grant tests](../tests/unit/chat-thread-grants.test.js); [ordered grant tests](../tests/unit/ordered-partition-grants.test.js); exact-package revocation acceptance: [transactional publication milestones](../TODO.md#dr-5).

### TRUST-03 — Inspect contribution and execution costs

- **Actor and trigger:** A requester or contributor checks what the mesh is doing.
- **Starting conditions:** Observed attempt and resource receipts exist.
- **Main flow:** 1. Open secondary network details → 2. Inspect assigned stages, timings and resource observations → 3. Adjust supported limits or stop.
- **Successful outcome:** Measurements identify their scope; connected peers, allocated bytes, physical RAM, GPU time and token rate are not conflated.
- **Interruption and recovery:** Missing measurements stay unknown; lost remote contact does not prove freed resources.
- **Variants:** N-stage timing; native/browser hosts; stored history; co-hosted processes.
- **Acceptance evidence:** [activity evidence](../artifacts/ordered-chat-activity-20261013/README.md); [memory observation tests](../tests/unit/partition-memory-observation.test.js). Live requester timing, energy and device-wide accounting require their own evidence.

### TRUST-04 — Evaluate a proposed improvement

- **Actor and trigger:** An operator reviews a change intended to improve behavior.
- **Starting conditions:** A proposal, baseline, evaluator and bounded permissions are declared.
- **Main flow:** 1. Inspect the proposal → 2. Run independent evaluation → 3. Compare retained benefits, regressions and failures.
- **Successful outcome:** Evaluation results are attributable and do not automatically activate a candidate.
- **Interruption and recovery:** Failed experiments stay recorded; interrupted evaluation cannot be relabeled as acceptance.
- **Variants:** Policy/tool/runtime proposal; held-out cases; reversible changes.
- **Acceptance evidence:** [evaluated improvement tests](../tests/unit/improvement-episode.test.js); [X evaluation journeys](x/critical-user-journeys.md). Ordinary retries and multiple agents are not demonstrated self-improvement.

### TRUST-05 — Adopt or restore an accepted version

- **Actor and trigger:** An authorized operator chooses a qualified change or rollback.
- **Starting conditions:** Exact candidate and accepted identities, evaluation and rollback data are available.
- **Main flow:** 1. Review applicable gates → 2. Authorize adoption or restoration → 3. Verify the served/loaded identities and returning-user journey.
- **Successful outcome:** The intended bytes run and retained histories/drafts remain usable; unrelated experiments stay inactive.
- **Interruption and recovery:** Failed rollout preserves the prior accepted configuration and explicit recovery evidence.
- **Variants:** Browser/native/runtime releases; reversible policy; fresh/existing installations.
- **Acceptance evidence:** [evaluated improvement tests](../tests/unit/improvement-episode.test.js); [release gates](../TODO.md#all-6). Approval alone does not qualify numerical, lifecycle or application behavior.

## Coverage matrix

Select combinations for a declared claim; do not multiply journeys or claim
exhaustive coverage of an unbounded mesh. Each retained run records the journey
IDs, frozen identities, matrix values, injections and observed outcome.

| Dimension | Meaningful values and failure boundaries |
| --- | --- |
| Route/model | Whole model; 2/3/4/5/6/7 ordered stages; larger generated routes; uneven contiguous layer ranges; incompatible middle stage |
| Hosts | Browser/browser; browser/native; native/native; independent physical hosts versus several logical nodes on one GPU |
| Replicas | One owner per stage; multiple compatible replicas; stale offer; missing stage; selected replica departure |
| Demand | One requester; overlapping conversations; requester also contributes; saturated admission/queue; slow or starved stage |
| Permission | Fresh/reused/expired/revoked grants; changed model, input or recipients; compute and file supply separately authorized |
| Durability | Successful commit; failed write; unknown write outcome; duplicate delivery; refresh/upgrade; no publication before commit |
| Failure position | Before admission; acquisition; each stage; in-flight activation/output; storage commit; cleanup; reconnect/retry |
| Execution mode | Ordinary execution first; optional qualified draft/fork/replay separately; added recipients require applicable consent |

| Scenario | Journeys exercised | Deployment variant | Acceptance boundary |
| --- | --- | --- | --- |
| Ordinary conversation | CHAT-01/02/05, KEEP-01/03/04 | Current two-stage browser/native baseline | Existing scoped numerical/physical receipts must not be combined into an unrun signed release claim. |
| Ordered network | CHAT-01/02, CONTRIB-03, MESH-01, KEEP-02 | Three stages; two overlapping requesters; signaling loss | [Actual source integration](../artifacts/automatic-ordered-participation-20261013/README.md) uses injected numerical stages. Independent physical hosts and signed delivery remain separate. |
| Replicated larger model | MESH-01/02/03/05 | Twelve computers, three stages, four prepared replicas per stage | Intended capacity scenario; full-route admission, useful answers and independent failure domains need evidence. |
| Sustained concurrent demand | MESH-01/05, CONTRIB-04/05, KEEP-03/04 | Twenty conversations, sixty stage states, five states per computer on twelve computers | Intended scenario, not a supported setting. Prove memory, fair progress and settlement before increasing admission limits. Active states do not mean simultaneous GPU operations. |
| Mixed large mesh | CHAT-04, CONTRIB-01/02, MESH-03/04 | One hundred computers, several models, mixed file supply and compute | Intended scenario. Prove bounded discovery, compatible routing, preparation and replication within grants; do not broadcast every request to everyone. |

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
| Contributor loss | KEEP-02/04 | Failed stage and replacement placement; only durable output retained |
| Add capacity | CONTRIB-01 and MESH-04 | Joining versus complementary preparation and placement |
| Speculative decoding | Execution variant; TRUST-01 if disclosure changes | Qualified draft/fork/replay implementation and performance |

## Retained supporting-surface registries

| Surface | Route | Readable summary | Canonical registry |
| --- | --- | --- | --- |
| Poolday | `/`, `/ask`, `/compute`, `/records` | [Poolday journeys](./poolday/critical-user-journeys.md) | [`poolday-critical-user-journeys.json`](./status/poolday-critical-user-journeys.json) |
| Zero | `/zero` | [Zero journeys](./zero/critical-user-journeys.md) | [`zero-critical-user-journeys.json`](./status/zero-critical-user-journeys.json) |
| X | `/x` | [X journeys](./x/critical-user-journeys.md) | [`x-critical-user-journeys.json`](./status/x-critical-user-journeys.json) |

These retained registries own status for their named supporting surfaces; they
do not qualify the distributed-chat catalogue above. Implementation sequencing
for the shared mesh remains in TODO.md.
Architecture documents and blueprints may explain mechanisms, but they do not
advance completion status.

Run `npm run verify:journeys` to validate all three registries. The validator
fails on missing evidence paths, unlinked work, invalid status, uncovered
routes, or a missing release gate. Poolday additionally verifies that every
journey model is enabled and permitted by every policy named by that journey.

`Supported` means an executable outcome with automated end-to-end contract
coverage. It does not mean every model, device, network, or objective works.
`Conditional` names those prerequisites. `Limited` names the narrower outcome
that works while the complete user expectation remains unproved. Deployed
claims also require a retained artifact; a passing test mentioned only in prose
does not satisfy that requirement.
