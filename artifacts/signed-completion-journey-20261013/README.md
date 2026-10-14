# Signed completion journey harness

Acceptance tooling for the installed signed application on the frozen ordered three-stage route (`doppler.layer-partition-contract/v3`, split layers 8 and 16): `mac-host` browser contributor at stage 0, `amd-host` native contributor at stage 1, `intel-host` native contributor at stage 2. A requester browser chooses the model and sends; Reploid selects the route. No physical journey has run. Only the unit tests below were executed.

Component: acceptance tooling. Intent: preserved. Acceptance evidence: `node --test` over this folder ([unit-tests.txt](unit-tests.txt)). Boundary effects: none. No application source, precedent artifact or other folder was modified.

---

## Files

| File | Job |
|------|-----|
| `config.mjs` | Loads the one JSON config, rejects missing/unknown keys, non-loopback URLs, private addresses and unfilled placeholders; validates the room file |
| `config.example.json` | Template with every key; its `REPLACE` values fail validation until filled |
| `harness.mjs` | Browser launch/CDP connection, request tracking, waits and every UI action, each tied to a `self/ui` selector |
| `observe.mjs` | Read-only CDP observation of host owners, adapted from the precedent observer; request classifier |
| `checks.mjs` | Requester journey checks, generalized from the precedent `checks.mjs` to N ordered stages |
| `loss-checks.mjs` | Contributor-loss checks |
| `contribution-checks.mjs` | Launch 2 storage checks (a) to (f), each a separate result |
| `timing.mjs` | Per-answer timing record and its validator |
| `run-requester.mjs`, `run-contributor-loss.mjs`, `run-contribution.mjs` | The three physical runners (unrun) |
| `journey.json`, `contributor-loss.json`, `contribution.json` | Frozen prompts, observation windows and review criteria |
| `test-fixtures.mjs`, `*.test.mjs` | Fixtures in the ordered shape and unit tests |

---

## What each harness does

### Requester journey (`run-requester.mjs`)

1. **Open.** Verifies the served `bundleHash` equals the frozen browser bundle, opens the loopback origin with the private room, and records the app's own `getOrderedParticipation` result for this instance (must be ordered mode with `stage: null`). "Install" is the operator's installation of the signed export; the product route has no in-app install control (`self/index.html:125-147` releases service workers).
2. **Model choice.** Selects the frozen ordered selection `<modelId>/partition/<planId>` in the model control and waits for the ready activity.
3. **Recipient approval.** Send is the authorization (`self/ui/pool-home/CATSCAN.md:28-30`, `self/host/chat-session.js:227-229`). Each attempt's stored `authorization` must be `source: 'send'`, disclose `ordered-partition-activations-and-tokens`, name exactly the frozen route, and equal the route the attempt executed.
4. **Two turns.** Streams the first answer (visible incomplete prefix required), copies it with the real Copy control, sends the history-aware follow-up in the same thread (actual first answer verbatim in the second request).
5. **Reload.** Saves an unsent draft, reloads, selects the thread, and observes for the fixture window that history, draft and running attempts are unchanged.
6. **Concurrent independent tabs.** Opens `concurrency.tabs` new tabs (each its own instance and requester identity, `self/instance.js:126-153`), sends in all, requires a sample where all execute simultaneously, then presses Stop in one. The stopped attempt must be a requester cancellation with its partial text, settled on every stage by the coordinator; every neighbour must complete its exact count with EOS and settled cleanup.
7. **Explicit retry after a failure.** Reloads a tab mid-answer (the workspace marks it interrupted, `packages/reploid/src/chat/workspace.js:45-49`), observes no redispatch, clicks Retry, and requires exactly one new attempt with `retryOf`, fresh Send authorization, completion, and unchanged earlier messages.
8. **Selective acquisition.** Every requester tab is tracked context-wide: zero weight HTTP requests and empty custody before, after, after reload, in every concurrent tab and in the retry tab.

### Contributor loss (`run-contributor-loss.mjs`)

Streams a long count, then calls the configured `stop` export for `contributorControl.lossTarget` (a native stage). It never cancels on its own. It records terminal and post-failure samples, the rendered failure status and technical details, and the stage 0 coordinator receipt for the attempt. It then calls `restore`, waits for the ready model and an enabled Retry, clicks Retry and follows the new attempt. Checks: `lossInjected`, `lossReported`, `ownershipExplicit`, `noSilentContinuation`, `explicitRetry`, `selectiveAcquisition`, `timing`.

### Launch 2 contribution (`run-contribution.mjs`)

| Step | Result | What is observed |
|------|--------|------------------|
| (a) | `sharedWhileChatting` | Bounded acquisition started while the participant's own ordered answer streams; offered verified pieces within the allowance; overlap; the answer completes |
| (b) | `peerAcquisition` | Acquirer on another machine waits for the sharer's offer, acquires; receipts show accepted chunks from the sharer's custody identity, zero acquirer weight HTTP requests, sharer supply accounting covers the bytes |
| (e) | `cachedOnly` | New tab on the sharer origin in cached-only mode: zero model-file requests, no new receipts, ledger unchanged, nothing pending |
| (c) | `reloadPreserved` | Sharer reload, cached-only restart: offered pieces are a superset of the pre-reload inventory; ledger cap equal, consumption not reset; zero requests |
| (f) | `stopSettles` | Fresh context: answer streaming, bounded acquisition in flight, Stop sharing; files settle (not sharing/preparing/stopping, nothing pending), charges retained, no later requests, answer completes uncancelled |
| (d) | `competingTabs` | Fresh context, two tabs start at once on one origin ledger: no overspend, every observed transfer charged, one cap |
| (d) | `interruptedResume` | Fresh context: reload while a second piece transfers; resume never re-downloads completed transfers; the interrupted transfer is re-acquired or excluded by the remaining allowance; every transfer charged |

Offers from this run are withdrawn before (f) and (d) so their transfers are observable over HTTP. Peer transfers are also counted from custody receipts.

### Timing record (`timing.mjs`)

One record per attempt; completed answers must be complete. Each measured value keeps its clock and source; unexposed boundaries are `not-observable` with a reason and source, never estimated. Only the boundaries listed below may be `not-observable`; any other absent boundary is `missing` and fails.

| Boundary | Status | Clock / source |
|----------|--------|----------------|
| `requester.attemptMs` | measured | requester app, `workspace.js:116` and `:248` |
| `requester.firstVisibleTextMs` | measured | harness poll, resolution `observation.pollMs` |
| `coordinator.stages[].stepMsTotal`, `stepCount`, `decodeSteps` | measured | coordinator, `partition-route-execution.js:167-175`, aggregated by `partition-summary.js:9-14`; includes remote transport for stages 1 and 2 |
| `coordinator.activationBytes` | measured | `partition-route-execution.js:209` |
| `runtime.executionMs`, `logitsReadbackMs`, `samplingMs` | not-observable | produced by Doppler `resident-partition.js:173-202,230`, dropped by `partition-summary.js:16-18` |
| `scheduler.queuedMs`, `loadMs`, `executionMs` | not-observable | ordered route bypasses the scheduler, `self/host/chat-execution.js:48-51`; observations discarded at `:29` |
| `transport` | not-observable | ordered v2 summary carries none (`partition-summary.js:16-18` versus `:43-45`) |
| `persistence` | not-observable | `workspace.js:63-94` saves ordinary history untimed |

---

## Running

```sh
# Unit tests (the only thing run for this artifact)
node --test artifacts/signed-completion-journey-20261013/*.test.mjs

# Physical runs, each with one explicit absolute config path
node artifacts/signed-completion-journey-20261013/run-requester.mjs /abs/journey-config.json
node artifacts/signed-completion-journey-20261013/run-contributor-loss.mjs /abs/journey-config.json
node artifacts/signed-completion-journey-20261013/run-contribution.mjs /abs/journey-config.json
```

Prerequisites the harness does not create: the installed signed export served at each loopback origin; the operator's stage assignment (stage 0 in the Mac browser instance's `reploid.ordered-stage.v1`, natives with `--ordered-config`); a running stage 0 browser reachable over a loopback CDP endpoint; remote browsers forwarded to loopback ports; native file sharing off during (d) and (f). Each run writes a new timestamped report in `reportDirectory` (`wx`, never overwritten); the room token and private addresses are redacted before every write. `report.ok` is true only when the run finished and every automated check passed. `manualReview.answerUsefulness` stays `null` for independent review.

### Configuration schema

All keys are required; unknown keys are rejected; `null` is accepted only for `application.signalingUrl`. Every URL must be loopback with an explicit port. No string may contain a tailnet domain, a login address or a `REPLACE` placeholder. Machines are `mac-host`, `amd-host` or `intel-host`.

| Key | Type | Rule |
|-----|------|------|
| `schema` | string | `reploid.signed-completion-journey-config/v1` |
| `reportDirectory` | absolute path | New report files only |
| `application.roomFile` | absolute path | `{roomId, token}`; private `reploid-swarm-*` room, token of 32+ characters |
| `application.descriptorPath`, `partitionPolicyPath` | app path | Served JSON paths |
| `application.signalingUrl` | loopback ws(s) URL or null | null keeps the app's private-loopback rule (`self/capabilities/communication/swarm-join-policy.js:24-25`) |
| `freeze.browserBundle`, `runtimeArchive`, `modelIdentity`, `planId` | `sha256:<64 hex>` | Exact identities |
| `freeze.modelId`, `planSchema`, `splitLayers` | string, v3, increasing ints | Route length must be `splitLayers + 1` |
| `freeze.nativeArtifacts` | map | Exactly one identity per native stage machine (replaces precedent `run.mjs:14` single `nativeArtifact`) |
| `freeze.route[]` | `{index, machine, host, participantId[, orderedConfig]}` | Distinct machines and peers; stage 0 is the browser; natives carry an absolute `orderedConfig` passed to the control module |
| `browsers.requester`, `coordinator`, `storageSupplier`, `storageAcquirer` | `{machine, origin, connect}` | `connect` is `{kind:'launch', channel, headless, remoteDebuggingPort}` or `{kind:'cdp', endpoint}`; coordinator must be `cdp` on the stage 0 machine; acquirer must be another machine than supplier; endpoints distinct |
| `contributorControl` | `{module, stopExport, restoreExport, lossTarget}` | Absolute module; `lossTarget` is a native route machine |
| `timeouts` | `readyMs, answerMs, lossReportMs, capacityReturnMs, transferMs, settlementMs` | Positive ms; `answerMs` replaces the precedent's fixed 180000 (`run.mjs:58`) |
| `observation.pollMs` | int 1..1000 | Sampling interval |
| `concurrency.tabs` | int 2..8 | Also checked against the served `limits.maxConcurrentAttempts` |
| `modelFiles.pathPatterns` | path-only regex list | Adds model-file classes; the precedent weight regex always applies |
| `storage.sharingAllowanceMiB`, `stopAllowanceMiB`, `contentionAllowanceMiB`, `interruptionAllowanceMiB` | int MiB | Ledgers are immutable per origin (`work-model-files.js:355`). Interruption must fit metadata plus three 4 MiB pieces (13 MiB for the 0.8B pieces) to show a completed resume |

Control module contract: `stop(stage)` and `restore(stage)` receive `{machine, stage, participantId, orderedConfig, nativeArtifact}` and resolve `{method, stoppedAt|restoredAt, detail?}`. The harness records the method; it never contacts a machine itself.

---

## Selectors and application hooks

| Use | Selector or hook | Source |
|-----|------------------|--------|
| Composer, Send | `[data-composer-input]`, `[data-composer-send]` | `self/ui/pool-home/conversation-workspace.js:50,53,305-333` |
| Stop (selected thread) | `[data-composer-stop]` | `conversation-workspace.js:54,337` |
| Model choice and readiness | `[data-active-model-select]`, `[data-model-control][data-activity="ready"]` | `conversation-workspace.js:27,217,270` |
| Thread rail and items | `[data-toggle-thread-rail]`, `[data-thread-item-id]` | `shell-view.js:41`, `conversation-list.js:12`, `conversation-workspace.js:304` |
| Message body, Copy, Retry, failure status | `.chat-message-content`, `[data-copy-message]`, `[data-retry-attempt]`, `.chat-message-actions [role=status]` / `details pre` | `message-list.js:10,36-38,63-66`; `conversation-workspace.js:338-347` |
| Device pane | `[data-toggle-inspector]`, `[data-contextual-inspector]`, `[data-inspector-section="device"]` | `network-inspector.js:12-18,95` |
| File controls | `[data-contribution-model]`, `[data-file-mode]`, `[data-file-download]`, `[data-toggle-file-contribution]` | `network-controls.js:15,26-33,172-180` |
| Host session | listener on `[data-toggle-contribution]` closes over `session` | `network-controls.js:163` |
| Chat state, drafts | `session.getState()`, `getDraft()` | `self/host/chat-session.js:139,180` |
| Network, contribution, coordinator receipts | `getState().network.contribution.attempts` | `chat-session.js:125`, `work-swarm.js:193`, `automatic-ordered-partitions.js:39` |
| Custody state, receipts | `swarm` then `modelFiles.getState()/getReceipts()` | `work-swarm.js:317`, `work-model-files.js:70-76,447` |
| Offered inventory, custody identity | closure `offered`, `identity` of the exchange | `packages/reploid/src/artifacts/custody/exchange.js:2,22` |
| Ordered participation | `getOrderedParticipation(getCurrentReploidStorage())` | `self/host/product-context.js:11-22`, `self/instance.js:268` |
| Acquisition ledger | `openBrowserAcquisitionBudget({existingOnly:true})` | `self/infrastructure/custody-supply-budget.js:4-49` |

The precedent controllers' `[data-approval-consent]`/`[data-approval-send]` no longer exist in `self/ui` and are not used.

---

## Acceptance mapping

| Check | Requirement lines |
|-------|-------------------|
| `open` | REP-7 `docs/roadmap/requirements.md:133`; `ROADMAP.md:28,34` |
| `modelChoice` | REP-7 `requirements.md:135`; `ROADMAP.md:34` |
| `recipientApproval` | REP-7 `requirements.md:135,145`; DR-3 `requirements.md:417` |
| `selectiveAcquisition` | REP-7 `requirements.md:133,173` |
| `streaming`, `copy` | REP-7 `requirements.md:146,173` |
| `completion` | DR-5 `requirements.md:190`; REP-7 `requirements.md:133,173` |
| `followUp` | REP-7 `requirements.md:133,173` |
| `reload` | REP-7 `requirements.md:147,173`; DR-5 `requirements.md:195` |
| `concurrency` | REP-7 `requirements.md:133`; DR-5 `requirements.md:190`; REP-4 `requirements.md:272` |
| `isolatedCancellation` | DR-5 `requirements.md:190`; REP-7 `requirements.md:148` |
| `explicitRetry` (both harnesses) | DR-5 `requirements.md:190`; REP-6 `requirements.md:406`; REP-7 `requirements.md:148` |
| `lossInjected`, `lossReported`, `noSilentContinuation` | DR-5 `requirements.md:190`; REP-6 `requirements.md:406`; `ROADMAP.md:28` |
| `ownershipExplicit` | REP-6 `requirements.md:406`; REP-4 `requirements.md:272` |
| `timing` | `ROADMAP.md:14` |
| `sharedWhileChatting` | REP-5 `requirements.md:304,321`; `ROADMAP.md:29,88` |
| `peerAcquisition` | REP-5 `requirements.md:302,312` |
| `reloadPreserved` | REP-5 progressive storage `requirements.md:321,323`; `ROADMAP.md:29,92` |
| `competingTabs` | `requirements.md:321`; `ROADMAP.md:29,92` |
| `interruptedResume` | `requirements.md:321,323`; REP-4 `requirements.md:272` |
| `cachedOnly` | `requirements.md:320`; `ROADMAP.md:92` |
| `stopSettles` | `ROADMAP.md:29,93`; REP-4 `requirements.md:272`; REP-1 `requirements.md:393` |

DR-2 (`requirements.md:233`, embedding and scoring replay) is not exercised.

---

## Precedent generalization

From `artifacts/signed-host-opener-20261012/requester-return-control/`:

- `checks.mjs:28-30` two-device fields become `identity.route.stages`: schema `reploid.mesh.partition-summary/v2`, frozen model and plan, distinct contributors equal to the frozen count, frozen stage order, requester outside the route. Cleanup rows `{partitionIndex,status,error}` must cover each stage once, all `settled` with `error: null`, phase `completed`; every stage reserved and timed every step.
- `plain-chat.json` criterion 5 now names the frozen ordered route instead of "two distinct contributors".
- Retained unchanged: two turns, same thread, one new follow-up attempt, natural EOS, verbatim history, visible incomplete prefix, real clipboard, zero weights with non-empty custody evidence, reload history/draft/redispatch window. The READY control mode was not ported. Weight tracking is context-wide instead of first-page only.
- Unsigned harnesses: the capacity-failover single-tab, localStorage, public-site flow is replaced by host-owner observation of independent loopback tabs; the live-conversation hard-coded ports and approval clicks are replaced by config endpoints and Send authorization.

---

## Application gaps

These are source readings, not run observations. Each affected check fails closed.

1. **Contributor loss is not reported to the requester when the lost stage's cleanup is unconfirmed** (`lossReported` fails). After an abrupt loss, the coordinator cannot confirm the lost stage: `partition-ordered-peer.js:248` rethrows on a closed channel without a retirement receipt. The runner then replaces the original `CONNECTION_LOST` or `REQUEST_TIMEOUT` with a new `CLEANUP_FAILED` AggregateError in its `finally` (`packages/reploid/src/mesh/partitions/partition-route-execution.js:248-251`). One code crosses the wire (`packages/reploid/src/transport/partition-data-channel.js:40,160,215`); the requester stores only the message (`packages/reploid/src/chat/workspace.js:244`); the UI label matches only disconnect wording (`self/ui/pool-home/message-list.js:10`), so the person sees "This answer could not finish." For a graceful SIGTERM retirement the code depends on ordering (`EXECUTION_FAILED` or `CONNECTION_LOST`). `ownershipExplicit` still passes for `CLEANUP_FAILED`, because that message does report unconfirmed ownership.
2. **Failed and cancelled settlement never reaches the requester.** On failure the requester keeps only `{placement, identity, stepSummary}` (`automatic-ordered-partitions.js:268`; `workspace.js:168-178,243-245`). Cleanup rows exist only in the coordinator receipt (`partition-route-execution.js:57-77`), reached through `automatic-ordered-partitions.js:39` and `work-swarm.js:193`. The harness reads them from the stage 0 browser by CDP; a native coordinator would leave `isolatedCancellation`, `explicitRetry` and `ownershipExplicit` unobservable, so the config requires a browser stage 0.
3. **No public accessor for offered inventory or custody identity.** `work-model-files.js:70-76` exposes neither; the harness reads exchange closure variables (`exchange.js:2,22`). A changed closure layout makes `sharedWhileChatting`, `peerAcquisition`, `reloadPreserved` and `interruptedResume` fail closed.
4. **Doppler per-stage metrics, scheduler, transport and persistence timings are not exposed** for ordered routes (table above). They are recorded `not-observable`.

## Contract question for review

Send authorizes the actual recipients without a separate review step (`self/ui/pool-home/CATSCAN.md:28-30`; `conversation-workspace.js:320,347`; `chat-session.js:228,247`), and no route is shown before admission (`execution-ribbon.js:72`). REP-7 `requirements.md:145` asks for readable recipients with Approve/Decline; `session.approve` (`chat-session.js:249-252`) has no UI caller. `recipientApproval` therefore checks the stored Send authorization against the frozen route; it cannot show the person saw the recipients first. `manualReview.recipientDisclosureContract` stays `null` until someone decides which contract governs.

## Predicted risks (source-inferred, unverified)

- After an abrupt loss, the coordinator's route owner cannot close: `reconcile` retries `closeOwner(owner.chat)` (`automatic-ordered-partitions.js:141-146`), and runner close rethrows the unknown cleanup (`partition-route-execution.js:264-273`). No replacement route may form until the stage 0 contributor itself is restarted. In that case, restoring only the native contributor would make `explicitRetry` fail with "Capacity did not return". The `restore` callback decides what is restarted.
- A reload during an answer can persist either `interrupted` (on next load, `workspace.js:45-49`) or `cancelled` with "Workspace closed" (page hide, `self/ui/pool-home/index.js:145-155`). Both count as a failure for `explicitRetry`; a user stop does not.

## What this harness cannot establish

Answer usefulness or correctness beyond the frozen counts; numerical accuracy; signed Capsule opening and selective acquisition on the contributors; both browser/native placements of each stage; the 1,588-token long-prompt workload and the 1,420,000,000-byte allocation gate (DR-5 `requirements.md:190`); useful combined capacity (DR-6); embedding and scoring (DR-2); full-model seeding; arbitrary NAT or cable loss; cleanup of GPU memory beyond the reported receipts; first-use or phone behaviour; served-asset integrity beyond the descriptor hash (the bundle verifier owns that); installed native artifact identities on the remote machines (recorded from config, not verified).

## Verification performed

- `node --test` over the six test files: see [unit-tests.txt](unit-tests.txt).
- `node --check` on every module.
- Not run: any runner, browser, server, GPU, contributor, SSH, or the Verification Worker on these files.

*Last updated: October 2026*
