# Signed completion journey harness

Acceptance tooling for the installed signed application on the frozen ordered three-stage route (`doppler.layer-partition-contract/v3`, split layers 8 and 16): `mac-host` browser contributor at stage 0, `amd-host` native contributor at stage 1, `intel-host` native contributor at stage 2. A requester browser chooses the model and sends; Reploid selects the route. Physical runs 1 and 2 are recorded in `run-1/` and `run-2/` (start with `run-2/harness-results.json`). The run-2 fixes described below were verified by unit tests only; no browser, server, GPU, contributor or SSH session was started for them.

## Results: Launch 1 journey and Launch 2 contribution pass automated acceptance (runs 5 and 6)

Candidate: signed delivery `final-5` (Reploid `95641fe7`, browser bundle `3c1fab71...`, native descriptor `1fecc004...` installed on `amd-host` and `intel-host`), Doppler 0.6.28 candidate archive `2df37d88...`, Capsule `-c` release sequence 2 `923ac7e6...` signed by the **test** authority. Same route in every run: `mac-host` browser stage 0, `amd-host` native stage 1, `intel-host` native stage 2.

| Harness | Run | Automated checks | Evidence |
|---|---|---|---|
| Requester journey (Launch 1) | 5 | 13/13: open, model choice, recipient approval, selective acquisition (0 weight requests), streaming, completion, follow-up, copy, reload, two concurrent requesters, isolated cancellation, explicit retry, timing | `run-5/harness-results.json` |
| Contributor loss (Launch 1) | 6 | 7/7: SIGKILL of the stage-1 native while streaming; the person sees "A computer disconnected. Retry this answer." (`CONNECTION_LOST`) 15.7 s later; the lost stage stays unknown in the coordinator's `unknownAttempts`; capacity returns 1.9 s after the restore call returns (about 6 s after the restored native starts); the explicit Retry completes the count with natural EOS | `run-6/harness-results.json` |
| Contribution (Launch 2) | 5 | 7/7: sharing a 4.93 MB verified subset within a 5 MiB allowance while chatting; another computer acquiring 32 of those pieces from the sharer; cached-only and reload with 0 requests and an unchanged ledger; competing tabs refused with exact charges; interrupted resume with exact charges; stop settling an in-flight transfer without cancelling the conversation | `run-5/harness-results.json` |

Runs 1 to 6 predate the contributor permission (below): their `recipientApproval` passes checked Send authorization (`source: 'send'`), which the current check rejects. The permission-based harness has unit tests only; no physical run has used it.

Run 4 found the contributor-loss defects that `95641fe7` fixes (loss reported as `CLEANUP_FAILED`; capacity never returned). Run 5's loss checks failed only on a harness defect, fixed in `e82bbe8f`. Every run settled cleanly; public contributors were never touched; run files contain aliases only.

**Measured limits on this route (published for Launch 1):**
- Devices: one Mac browser stage, one AMD Linux native stage, one Intel Linux native stage.
- Concurrency: 2 simultaneous independent requesters.
- Longest completed answer: 171 decode steps, in 608 s.
- Decode time per step: Intel stage 2.65 to 3.56 s; Mac and AMD stages 0.44 to 0.66 s each. About 3.5 s per generated token end to end. The Intel stage is the bottleneck. The one follow-up answer, which includes prefill of the earlier exchange, averaged 4.3 / 1.9 / 18.2 s per step over 12 steps.
- Context: only short conversations are established (a follow-up after one exchange). Runs 1 to 6 recorded neither prompt token counts nor prefill separately from decode, so no prompt-length bound is measured. DR-5's long workload has 1,588 prompt tokens; its earlier two-stage Qwen 2B control generated 1,627 tokens. An earlier version of this section estimated about 95 minutes per answer from 1,627 generated tokens at 3.5 s each. That figure ignored prefill and borrowed another model's output length, so it is not a measured context limit. From Reploid `b0cb3b83` the timing record carries prompt tokens, prefill and decode per stage.

**Not established by these runs:**
- Answer usefulness. `manualReview` is open, and two answers state wrong example outputs: `[2,4,6,8]` for `[4,8]`, and `[-6,12,18]` for `[-4,12]`. [Answer-cause comparison](../answer-cause-20261014/README.md): distribution, template and settings are not the cause; a single-machine Doppler run and an independent CPU implementation reproduce both answers token for token. Turn 1 comes from the deployed Q4_K body weights (the source bf16 checkpoint answers `[4, 8]` on the identical prompt); turn 2 is wrong on the source checkpoint too. Both stay failed in manual review. The 55-prefix pass checks Doppler's arithmetic against the quantized model, not the quantized model against the source checkpoint.
- Production signing and public promotion. Only the test authority signed this candidate; the public pin stays Doppler 0.6.27.

Component: acceptance tooling. Intent: preserved, with one recorded contract decision (below). Acceptance evidence: `node --test` over this folder ([unit-tests.txt](unit-tests.txt)). Boundary effects: `server/native-participant.js` gained `--room-token-file` (see "Native contributor launch"); no other application source and no `run-1/` or `run-2/` evidence was modified. After run 6 the application added a one-time contributor permission ("Remote contributor permission", below); `send()` records and allows it once per fresh profile.

---

## Contract decision: one connected tab per browser profile

Decided after run 2. On the product route a browser profile connects from one tab at a time. This is the intended contract: one peer identity must not be connected twice, and the single owner is also what keeps a profile's allowance from being double spent.

| Code | What it does |
|------|--------------|
| `self/host/work-swarm.js:165` | `connectOnce` calls `peerOffers.acquire()` before it builds the consumer, custody and partition owners |
| `self/host/work-peer-offers.js:16-21` | `acquire` reads the one stored peer id for the room and requests Web Lock `reploid:tool-peer:<id>` with `ifAvailable`; a second tab is rejected with `Another tab owns this peer connection` |
| `self/kernel/boot.js:160` | The only assignment of a per-tab instance (`REPLOID_INSTANCE_ID`). The product route never runs it, so storage is unscoped and `getCurrentReploidInstanceId()` is null (`self/instance.js:156-160`) |

Run-2 observation: `run-2/bringup/probe-second-tab.json` (second tab: no consumer peer, no custody owner, that exact error).

Consequences for this harness:

- REP-7 and REP-4 concurrency (bounded concurrent requests, isolated cancellation) is accepted through independent requesters: separate browser profiles, each a new user data directory with its own peer identity, running at the same time against the same route. Every earlier strictness stays: each conversation's own answer, history and cleanup; one cancelled while the others complete unaffected.
- `concurrency` no longer reads a per-tab instance id (always null on the product route, formerly `observe.mjs:72`). It requires distinct profiles and profile directories, distinct requester peer identities, and distinct `identity.requesterId` on the concurrent attempts.
- `competingTabs` opens two tabs of ONE profile. The second must be refused with exactly `Another tab owns this peer connection` and must never show a consumer identity or custody owner. The profile ledger must stay within its allowance, charge exactly the observed transfers, and complete no transfer twice. A second tab that connects, or any overspend, fails.
- The explicit-retry tab is its own profile, because a new tab of the already connected requester profile is refused.
- `cachedOnly` and `reloadPreserved` use the sharer profile one tab at a time. The sharer tab is closed first; the next tab of that profile must connect normally (lock released, never refused) and becomes the profile's only tab for cached-only mode and then for the reload. A step that opens a second concurrent tab of the sharer profile fails.

---

## Changes after run 2

| Run-2 defect | Change |
|--------------|--------|
| H1: `chooseOrderedModel` selected in the hidden model select | `harness.mjs` opens the closed thread rail through the application's "Choose model" control (`[data-open-model]`, `conversation-workspace.js:21,103-104`) and fails with a named message if that control is absent or ambiguous, or the select stays hidden |
| H2: same-profile tabs treated as independent requesters | Contract decision above; `openRequesterProfile` in `harness.mjs` launches each requester with its own user data directory; `config.mjs` requires `browsers.requester.connect.kind` `launch` |
| H3: reload after the 64- and 512-byte pieces had already finished | The reload is issued from the request event of the first weight piece of at least 1 MiB (`MIN_INTERRUPTED_PIECE_BYTES`), with no observation round trip in between. `interruptedResume` requires that piece to be aborted or unsettled by the reload, and the ledger to charge exactly the observed transfers |
| F1: room token on the native command line | `--room-token-file` (see "Native contributor launch") |

`cachedOnly` (decided after run 2, same contract): run 2's step opened a second tab of the connected sharer profile and was refused ("Custody owner deadline"). The step now closes the sharer tab, records its verified inventory, ledger and peer identity, opens one new tab of the same profile, waits until it connects with a custody owner and no refusal, and only then selects cached-only mode in it. It requires zero model-file requests over that tab's whole lifetime through a frozen quiet window after the outcome (`contribution.json` `cachedOnlyObservationMs`), and an inventory made only of, and restoring every one of, the pieces verified before the sharer tab closed. Same-profile evidence is the ledger: the new tab must read the closed sharer tab's ledger unchanged. Peer identities are recorded, not asserted.

## Changes after run 3

| Run-3 defect | Change |
|--------------|--------|
| H4: `interruptedResume` contaminated by the competing-tabs owner, which still offered its subset and served the metadata and small pieces before the reload, unobserved | Origin is the step's only intended supplier. `closeOtherTabs` (`harness.mjs`) closes every open tab of every context this run created and records each one's sharing state; the step stops if any stays open. From the interrupt tab, `observeSupplierOffers` (`observe.mjs`) samples which connected peers offer files for `contribution.json` `supplierObservationMs` before acquisition and again after the resume. Every model-file request of the interrupt context counts, including requests without a page. `interruptedResume` fails if a tab was left open, if a peer offered files, if any custody receipt appears, or if the supplier observation is missing. The no-double-charge and no-undercharge comparison is unchanged |

---

## Files

| File | Job |
|------|-----|
| `config.mjs` | Loads the one JSON config, rejects missing/unknown keys, non-loopback URLs, private addresses and unfilled placeholders; validates the room file |
| `config.example.json` | Template with every key; its `REPLACE` values fail validation until filled |
| `harness.mjs` | Browser launch/CDP connection, independent requester profiles, request tracking and watchers, the interruption classifier, waits and every UI action, each tied to a `self/ui` selector |
| `observe.mjs` | Read-only CDP observation of host owners (including whether a tab owns its profile's connection), adapted from the precedent observer; request classifier |
| `checks.mjs` | Requester journey checks, generalized from the precedent `checks.mjs` to N ordered stages |
| `loss-checks.mjs` | Contributor-loss checks |
| `contribution-checks.mjs` | Launch 2 storage checks (a) to (f), each a separate result |
| `timing.mjs` | Per-answer timing record and its validator |
| `run-requester.mjs`, `run-contributor-loss.mjs`, `run-contribution.mjs` | The three physical runners (runs 1 and 2 recorded; not run since the run-2 fixes) |
| `journey.json`, `contributor-loss.json`, `contribution.json` | Frozen prompts, observation windows and review criteria |
| `test-fixtures.mjs`, `*.test.mjs` | Fixtures in the ordered shape and unit tests; `harness.test.mjs` drives model choice through a fake page and the interruption classifier through tracker-shaped rows |

---

## What each harness does

### Requester journey (`run-requester.mjs`)

1. **Open.** Verifies the served `bundleHash` equals the frozen browser bundle, opens the loopback origin with the private room, and records the app's own `getOrderedParticipation` result for this instance (must be ordered mode with `stage: null`). "Install" is the operator's installation of the signed export; the product route has no in-app install control (`self/index.html:125-147` releases service workers).
2. **Model choice.** Opens the thread rail with the application's "Choose model" control, selects the frozen ordered selection `<modelId>/partition/<planId>` in the model control and waits for the ready activity. An absent control fails with a named message.
3. **Recipient approval.** The first remote request of each fresh requester profile shows the one-time contributor permission (`self/ui/pool-home/remote-permission.js`): what is sent and who receives it. Nothing is created or sent before Allow (`conversation-workspace.js:336`; the workspace also holds any uncovered request, `packages/reploid/src/chat/workspace.js:233-252`). `send()` (`harness.mjs`) records what the screen showed and the permission the application stored (`report.permissions`), then clicks Allow. Later requests, follow-ups and retries are sent without asking. Each attempt's stored `authorization` must be `kind`/`source` `'permission'` and cite a recorded permission (`permissionId`). That permission's stored scope must cover the ordered disclosure, the attempt's sharing scope and the frozen model, and its screen must say that the conversation, earlier messages and context prompt are sent to this network, that the first computer receives the text, and that the others receive it as model tokens (which read back as text) and intermediate results. `authorization.recipients` must equal the frozen route and the route the attempt was dispatched to; the authorization must disclose `ordered-partition-activations-and-tokens` and equal the executed route.
4. **Two turns.** Streams the first answer (visible incomplete prefix required), copies it with the real Copy control, sends the history-aware follow-up in the same thread (actual first answer verbatim in the second request).
5. **Reload.** Saves an unsent draft, reloads, selects the thread, and observes for the fixture window that history, draft and running attempts are unchanged.
6. **Concurrent independent requesters.** Launches `concurrency.tabs` separate browser profiles (each a new user data directory, so its own storage and peer identity; see "Contract decision"), sends in all at the same time against the same route, requires a sample where all execute simultaneously, then presses Stop in one. The stopped attempt must be a requester cancellation with its partial text, settled on every stage by the coordinator; every neighbour must complete its exact count with EOS and settled cleanup.
7. **Explicit retry after a failure.** In its own profile, reloads the tab mid-answer (the workspace marks it interrupted, `packages/reploid/src/chat/workspace.js:45-49`), observes no redispatch, clicks Retry (no permission screen is expected: the profile is already permitted), and requires exactly one new attempt with `retryOf`, an authorization citing the profile's recorded permission and naming its dispatched route, completion, and unchanged earlier messages.
8. **Selective acquisition.** Every requester profile is tracked context-wide: zero weight HTTP requests and empty custody before, after, after reload, in every concurrent requester and in the retry requester. Profile directories are removed when the run closes.

### Contributor loss (`run-contributor-loss.mjs`)

Streams a long count, then calls the configured `stop` export for `contributorControl.lossTarget` (a native stage). It never cancels on its own. It records terminal and post-failure samples, the rendered failure status and technical details, and the stage 0 coordinator receipt for the attempt. It then calls `restore`, waits for the ready model and an enabled Retry, clicks Retry and follows the new attempt. Checks: `lossInjected`, `lossReported`, `ownershipExplicit`, `noSilentContinuation`, `explicitRetry`, `selectiveAcquisition`, `timing`.

### Launch 2 contribution (`run-contribution.mjs`)

| Step | Result | What is observed |
|------|--------|------------------|
| (a) | `sharedWhileChatting` | Bounded acquisition started while the participant's own ordered answer streams; offered verified pieces within the allowance; overlap; the answer completes |
| (b) | `peerAcquisition` | Acquirer on another machine waits for the sharer's offer, acquires; receipts show accepted chunks from the sharer's custody identity, zero acquirer weight HTTP requests, sharer supply accounting covers the bytes |
| (e) | `cachedOnly` | Sharer tab closed first; the next tab of the same profile must connect normally (no single-owner refusal, custody owner present) and is the profile's only open tab; cached-only mode in it: zero model-file requests over the tab's whole lifetime and the frozen quiet window, no new receipts, the sharer's ledger unchanged, nothing pending, inventory only from (and restoring all of) the sharer's verified pieces |
| (c) | `reloadPreserved` | Reload of the sharer profile's only tab (the cached-only tab from (e)), cached-only restart: offered pieces are a superset of the pre-reload inventory; ledger cap equal, consumption not reset; zero requests; no other tab of the profile open |
| (f) | `stopSettles` | Fresh context: answer streaming, bounded acquisition in flight, Stop sharing; files settle (not sharing/preparing/stopping, nothing pending), charges retained, no later requests, answer completes uncancelled |
| (d) | `competingTabs` | Fresh context, two tabs of one profile press the file control at once: the second is refused by the single-owner lock (exact text recorded, never a consumer identity or custody owner, no transfer); the profile ledger keeps one cap, never exceeds it, charges exactly the observed transfers and completes none twice |
| (d) | `interruptedResume` | Every earlier tab of the run closed; no connected peer offers files for the frozen window before acquisition or after the resume, and no custody receipt appears (origin is the only intended supplier). Fresh context: reload issued from the request event of the first weight piece of at least 1 MiB; that piece must be aborted or unsettled by the reload; resume never re-downloads completed transfers; the interrupted transfer is re-acquired or excluded by the remaining allowance; the ledger charges exactly the observed transfers (no double charge) |

Offers from this run are withdrawn before (f), and every earlier tab is closed before `interruptedResume`, so their transfers are observable over HTTP. Peer transfers are also counted from custody receipts. A peer transfer before the interruption's reload ends with the page and is not observable, so that step requires no offering peer and treats any receipt as a failure.

### Launch 2 full-model seeding (`run-seeding.mjs`)

Explicit full-model seeding (REP-5 `requirements.md:322`) keeps its own acceptance, separate from the bounded sharing above. The expected file set is the served catalog entry plus its manifest's weight shards (`work-model-files.js:198-213`), fetched by the harness from the origin, outside any page, so it adds no tracked transfer. Allowances: `storage.seedingAllowanceMiB` must cover the whole model (Qwen 3.5 0.8B Q4K: 1,146,048,704 weight bytes plus metadata), `storage.seedingRefusalAllowanceMiB` must not; `timeouts.seedingMs` bounds a whole-model acquisition.

| Step | Result | What is observed |
|------|--------|------------------|
| (r) | `refusedWithoutAllowance` | Fresh context, full-model start with the refusal allowance: refused with the preflight's exact text, nothing offered, no weight request, ledger cap unchanged and not overspent |
| (v) | `scopeVisibleBeforeApproval` | Full-model mode and the allowance chosen, switch not yet pressed: the file controls must state the whole-model download and storage size (within 1 % or 0.01 GiB of the expected set). The final-5 controls showed only the storage and send limits. The controls now state the size, computed from signed catalog metadata (`work-model-files.js` `fullModelSeedingBytes`), so this applies from the next candidate |
| (s) | `seededWhole` | Seeding while the participant's own ordered answer streams: every expected file offered, weights retained as whole verified files, ledger cap equal to the allowance and charges equal to the observed transfers, overlap with the active answer, which completes uncancelled |
| (b) | `peerAcquiresWholeModel` | Acquirer on another machine, full-model mode: holds every expected file, zero origin weight requests, every weight shard arrives through finished custody receipts, the seeder's supplied bytes cover the weights |
| (c) | `reloadRebuildsWhole` | Seeder reload, cached-only restart: the whole inventory is rebuilt from verified cached bytes, zero model-file requests, ledger unchanged |
| (n) | `boundedDoesNotImplySeeding` | Fresh bounded grant: offers pieces only; a later full-model start under the same ledger is refused, offers no whole weights, downloads none, and the cap is not renewed |
| (f) | `stopSettlesSeeding` | Fresh context: answer streaming, whole-file acquisition in flight, Stop sharing; files settle, no later requests, charges retained and not refunded, answer completes uncancelled |

### Timing record (`timing.mjs`)

One record per attempt (schema `reploid.signed-completion-answer-timing/v2`; runs 1 to 6 wrote v1); completed answers must be complete. Each measured value keeps its clock and source; unexposed boundaries are `not-observable` with a reason and source, never estimated. Only the boundaries listed below may be `not-observable`; any other absent boundary is `missing` and fails.

| Boundary | Status | Clock / source |
|----------|--------|----------------|
| `requester.attemptMs` | measured | requester app, `workspace.js:125` and `:260`; the permission screen appears before the attempt exists, so its time is not included (`report.permissions` `shownAt`, `allowedAt`) |
| `requester.firstVisibleTextMs` | measured | harness poll, resolution `observation.pollMs` |
| `coordinator.stages[].stepMsTotal`, `stepCount`, `generatedTokens` | measured | coordinator, `partition-route-execution.js:167-175`, aggregated by `partition-summary.js`; includes remote transport for stages 1 and 2. Every route step samples one token, so `generatedTokens` counts the token sampled after prefill too (v1 called it `decodeSteps`) |
| `coordinator.promptTokens` | measured from candidates whose summary carries phases; otherwise not-observable | step 0 `inputTokenCount`, `partition-summary.js` `summarizeOrderedPhases` |
| `coordinator.phases.prompt.stages[]`, `coordinator.phases.decode.stages[]` | recorded values | per stage: step 0 (prompt prefill plus the first sampled token) separately from steps 1 onward (one-token decode); coordinator elapsed plus each contributor's Doppler metrics (`executionMs`, `encodeMs`, `submitWaitMs`, `inputUploadMs`, `activationReadbackMs`, `logitsMs`, `gpuKernelsMs`, `logitsReadbackMs`, `samplingMs`; null or count 0 when unreported) |
| `coordinator.activationBytes` | measured | `partition-route-execution.js:209` |
| `runtime.executionMs` (all stages), `logitsReadbackMs`, `samplingMs` (final stage) | measured from candidates whose summary carries phases; otherwise not-observable | sums of contributor Doppler metrics over prompt and decode; missing if any stage omitted a step |
| `scheduler.queuedMs`, `loadMs`, `executionMs` | not-observable | ordered route bypasses the scheduler, `self/host/chat-execution.js:48-51`; observations discarded at `:29` |
| `transport` | not-observable | the ordered summary carries no transport split; stage elapsed minus contributor `executionMs` bounds it from above |
| `persistence` | not-observable | ordered steps commit through the requester transaction owner (`partition-ordered-chat.js:136`) and ordinary history saves in `workspace.js` `persist()`; neither is timed |

---

## Running

```sh
# Unit tests (the only thing run for this artifact)
node --test artifacts/signed-completion-journey-20261013/*.test.mjs

# Physical runs, each with one explicit absolute config path
node artifacts/signed-completion-journey-20261013/run-requester.mjs /abs/journey-config.json
node artifacts/signed-completion-journey-20261013/run-contributor-loss.mjs /abs/journey-config.json
node artifacts/signed-completion-journey-20261013/run-contribution.mjs /abs/journey-config.json
node artifacts/signed-completion-journey-20261013/run-seeding.mjs /abs/journey-config.json
```

Prerequisites the harness does not create: the installed signed export served at each loopback origin; the operator's stage assignment (stage 0 in the Mac browser instance's `reploid.ordered-stage.v1`, natives with `--ordered-config`); natives launched with `--room-token-file` (below); a running stage 0 browser reachable over a loopback CDP endpoint; remote browsers forwarded to loopback ports; native file sharing off during (d) and (f).

### Native contributor launch

The room token reaches each native contributor through `--room-token-file`, never through process arguments or the service journal. On each native host, write the token from the private room file into an owner-only file, then pass its absolute path:

```sh
umask 077   # the token file is created with mode 0600
node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).token)' \
  /abs/private-room.json > /abs/room-token
node server/native-participant.js --contribute --share-files \
  --model qwen-3-5-0-8b-q4k-ehaf16 --model-directory /abs/model --cache-directory /abs/state/cache \
  --identity-file /abs/state/identity.json --rtc-module @roamhq/wrtc --ws-module ws --gpu-module webgpu \
  --origin http://127.0.0.1:<port> --signaling-url ws://127.0.0.1:<port>/swarm \
  --room <roomId from the room file> --room-token-file /abs/room-token --ordered-config /abs/stage.json
```

The file must be a regular file owned by the contributor's user with mode 0600; otherwise startup stops before identity, module or network side effects. `--room-token` still works but prints a warning, and the two options cannot be combined. The run-1 and run-2 launch scripts under `run-*/tools/` are evidence of how those runs were launched and are not updated. Each run writes a new timestamped report in `reportDirectory` (`wx`, never overwritten); the room token and private addresses are redacted before every write. `report.ok` is true only when the run finished and every automated check passed. `manualReview.answerUsefulness` stays `null` for independent review.

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
| `browsers.requester`, `coordinator`, `storageSupplier`, `storageAcquirer` | `{machine, origin, connect}` | `connect` is `{kind:'launch', channel, headless, remoteDebuggingPort}` or `{kind:'cdp', endpoint}`; requester must be `launch` (each independent requester is a new user data directory; only the first uses `remoteDebuggingPort`); coordinator must be `cdp` on the stage 0 machine; acquirer must be another machine than supplier; endpoints distinct |
| `contributorControl` | `{module, stopExport, restoreExport, lossTarget}` | Absolute module; `lossTarget` is a native route machine |
| `timeouts` | `readyMs, answerMs, lossReportMs, capacityReturnMs, transferMs, settlementMs, seedingMs` | Positive ms; `answerMs` replaces the precedent's fixed 180000 (`run.mjs:58`) |
| `observation.pollMs` | int 1..1000 | Sampling interval |
| `concurrency.tabs` | int 2..8 | Number of concurrent independent requester profiles; also checked against the served `limits.maxConcurrentAttempts` |
| `modelFiles.pathPatterns` | path-only regex list | Adds model-file classes; the precedent weight regex always applies |
| `storage.sharingAllowanceMiB`, `stopAllowanceMiB`, `contentionAllowanceMiB`, `interruptionAllowanceMiB` | int MiB | Ledgers are immutable per origin (`work-model-files.js:355`). Interruption must fit the metadata and small pieces before the first piece of at least 1 MiB plus that piece twice (charged when interrupted and again when resumed) to show a completed resume. Run 2's 0.8B index: 326,877 bytes before a 5,253,248-byte piece, 10,833,373 bytes in total, within 13 MiB |
| `storage.seedingAllowanceMiB`, `seedingRefusalAllowanceMiB`; `timeouts.seedingMs` | int MiB; ms | Seeding must cover the whole expected file set within the 4 GiB maximum (`self/config/chat-files.json:24`); refusal must not. Example: 1200 MiB, 64 MiB, 1,800,000 ms |

Control module contract: `stop(stage)` and `restore(stage)` receive `{machine, stage, participantId, orderedConfig, nativeArtifact}` and resolve `{method, stoppedAt|restoredAt, detail?}`. The harness records the method; it never contacts a machine itself.

---

## Selectors and application hooks

| Use | Selector or hook | Source |
|-----|------------------|--------|
| Composer, Send | `[data-composer-input]`, `[data-composer-send]` | `self/ui/pool-home/conversation-workspace.js:51,54,324-355` |
| One-time contributor permission | `[data-remote-permission]` (its `data-need`), `[data-remote-permission-title]`, `-what`, `-who`, `-scope`, `[data-remote-permission-allow]`, `[data-remote-permission-local]` | `self/ui/pool-home/remote-permission.js:16-29`; asked at `conversation-workspace.js:336,371` and for a held request at `:247`; stored by `self/host/chat-session.js:293` |
| Stored permissions | `getState().remotePermissions` (read by `observeChat`) | `chat-session.js:31,104`; revoked in Settings, `remote-permission.js:60-70`, `network-inspector.js:38,92,112` |
| Stop (selected thread) | `[data-composer-stop]` | `conversation-workspace.js:55,359` |
| Choose model (opens the thread rail) | `[data-open-model]` | `conversation-workspace.js:22,105` |
| Model choice and readiness | `[data-active-model-select]`, `[data-model-control][data-activity="ready"]` | `conversation-workspace.js:18-28,226,289` |
| Thread rail and items | `[data-toggle-thread-rail]`, `[data-thread-item-id]` | `shell-view.js:41`, `conversation-list.js:12`, `conversation-workspace.js:323` |
| Message body, Copy, Retry, failure status | `.chat-message-content`, `[data-copy-message]`, `[data-retry-attempt]`, `.chat-message-actions [role=status]` / `details pre` | `message-list.js:10,36-38,63-66`; `conversation-workspace.js:361-372` |
| Device pane | `[data-toggle-inspector]`, `[data-contextual-inspector]`, `[data-inspector-section="device"]` | `network-inspector.js:12-18,95` |
| File controls | `[data-contribution-model]`, `[data-file-mode]`, `[data-file-download]`, `[data-toggle-file-contribution]` | `network-controls.js:15,26-33,172-180` |
| Host session | listener on `[data-toggle-contribution]` closes over `session` | `network-controls.js:163` |
| Chat state, drafts | `session.getState()`, `getDraft()` | `self/host/chat-session.js`, `getState` and `getDraft` |
| Network, contribution, coordinator receipts | `getState().network.contribution.attempts` | `chat-session.js:125`, `work-swarm.js:193`, `automatic-ordered-partitions.js:39` |
| Profile connection owner, refusal | `getState().network.consumer.peerId`, `network.error`, custody owner presence | `work-swarm.js:162-165,210`, `work-peer-offers.js:16-21` |
| Custody state, receipts | `swarm` then `modelFiles.getState()/getReceipts()` | `work-swarm.js:317`, `work-model-files.js:70-76,447` |
| Offered inventory, custody identity | closure `offered`, `identity` of the exchange | `packages/reploid/src/artifacts/custody/exchange.js:2,22` |
| Ordered participation | `getOrderedParticipation(getCurrentReploidStorage())` | `self/host/product-context.js:11-22`, `self/instance.js:268` |
| Acquisition ledger | `openBrowserAcquisitionBudget({existingOnly:true})` | `self/infrastructure/custody-supply-budget.js:4-49` |

The precedent controllers' `[data-approval-consent]`/`[data-approval-send]` no longer exist in `self/ui`, and there is no per-request review. `[data-remote-permission-allow]` is the only consent control, shown once per profile.

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
- Unsigned harnesses: the capacity-failover single-tab, localStorage, public-site flow is replaced by host-owner observation of independent loopback requester profiles; the live-conversation hard-coded ports are replaced by config endpoints. Consent is the one-time permission screen, with what it displayed recorded.

---

## Application gaps

These are source readings, not run observations. Each affected check fails closed.

1. **Contributor loss is not reported to the requester when the lost stage's cleanup is unconfirmed** (`lossReported` fails). After an abrupt loss, the coordinator cannot confirm the lost stage: `partition-ordered-peer.js:248` rethrows on a closed channel without a retirement receipt. The runner then replaces the original `CONNECTION_LOST` or `REQUEST_TIMEOUT` with a new `CLEANUP_FAILED` AggregateError in its `finally` (`packages/reploid/src/mesh/partitions/partition-route-execution.js:248-251`). One code crosses the wire (`packages/reploid/src/transport/partition-data-channel.js:40,160,215`); the requester stores only the message (`packages/reploid/src/chat/workspace.js:244`); the UI label matches only disconnect wording (`self/ui/pool-home/message-list.js:10`), so the person sees "This answer could not finish." For a graceful SIGTERM retirement the code depends on ordering (`EXECUTION_FAILED` or `CONNECTION_LOST`). `ownershipExplicit` still passes for `CLEANUP_FAILED`, because that message does report unconfirmed ownership.
2. **Failed and cancelled settlement never reaches the requester.** On failure the requester keeps only `{placement, identity, stepSummary}` (`automatic-ordered-partitions.js:268`; `workspace.js:168-178,243-245`). Cleanup rows exist only in the coordinator receipt (`partition-route-execution.js:57-77`), reached through `automatic-ordered-partitions.js:39` and `work-swarm.js:193`. The harness reads them from the stage 0 browser by CDP; a native coordinator would leave `isolatedCancellation`, `explicitRetry` and `ownershipExplicit` unobservable, so the config requires a browser stage 0.
3. **No public accessor for offered inventory or custody identity.** `work-model-files.js:70-76` exposes neither; the harness reads exchange closure variables (`exchange.js:2,22`). A changed closure layout makes `sharedWhileChatting`, `peerAcquisition`, `reloadPreserved` and `interruptedResume` fail closed.
4. **Doppler per-stage metrics, scheduler, transport and persistence timings are not exposed** for ordered routes (table above). They are recorded `not-observable`.

## Remote contributor permission (after run 6)

Runs 1 to 6 used Send as the authorization, with nothing shown before admission. The application now asks once, before the first request that would leave the device, and never per request:

- The screen says what is sent (the conversation: the message, earlier messages in the thread and the context prompt when it is on) and who receives it (contributors' computers on this network; the first computer gets the text, the others get the same content as model tokens, which read back as text, plus intermediate results). It offers Allow or Keep answers local (`self/ui/pool-home/remote-permission.js:7-29`). Keep answers local sends nothing and keeps the draft.
- Allow stores a permission (`reploid.remote-permission/v1`) in the profile's storage, so it survives reload (`self/host/chat-session.js:31,293`). Its scope is the sharing scope, the disclosure kind, and the model identities (and adapters) of the verified catalog plus the requested model (`packages/reploid/src/chat/remote-permission.js:32`).
- A request is inside a permission exactly when the permission is unrevoked, has the same sharing scope and disclosure kind, lists the request's model identity, and lists every adapter identity the request applies (`remote-permission.js:24`). Anything else is outside: no permission, a revoked one, or a different scope, kind, model or adapter.
- Inside: the workspace records `authorization` `{ kind: 'permission', permissionId, recipients, route, ... }` and dispatches with no approval step (`workspace.js:25-28,233-252`). Outside: the request is held (`approval.permissionNeed`) and nothing is sent until a covering permission exists (`resumePermitted`, `workspace.js:405`) or the person keeps answers local. Only verified recipients are ever covered.
- Settings shows each active permission's scope with Turn off (`network-inspector.js:38,92,112`). Revocation stops new disclosures; answers already admitted continue unless stopped (`workspace.js:327`).
- A route change before dispatch still fails the attempt with nothing sent (`automatic-ordered-partitions.js:270-271`); a Retry is a new attempt whose record names its own route.
- What leaves before a covered dispatch, or while a request is held: the requester opens the coordinator's input channel and sends one `describe` request. Periodic discovery continues regardless. No message, token context, activation, reservation or grant is sent (`tests/unit/ordered-remote-permission.test.js`).

`manualReview.recipientDisclosureContract` stays `null`: whether the recorded permission wording reads as informed consent is a person's judgement.

## Predicted risks (source-inferred, unverified)

- After an abrupt loss, the coordinator's route owner cannot close: `reconcile` retries `closeOwner(owner.chat)` (`automatic-ordered-partitions.js:141-146`), and runner close rethrows the unknown cleanup (`partition-route-execution.js:264-273`). No replacement route may form until the stage 0 contributor itself is restarted. In that case, restoring only the native contributor would make `explicitRetry` fail with "Capacity did not return". The `restore` callback decides what is restarted.
- A reload during an answer can persist either `interrupted` (on next load, `workspace.js:45-49`) or `cancelled` with "Workspace closed" (page hide, `self/ui/pool-home/index.js:145-155`). Both count as a failure for `explicitRetry`; a user stop does not.

## What this harness cannot establish

Answer usefulness or correctness beyond the frozen counts; numerical accuracy; signed Capsule opening and selective acquisition on the contributors; both browser/native placements of each stage; the 1,588-token long-prompt workload and the 1,420,000,000-byte allocation gate (DR-5 `requirements.md:190`); useful combined capacity (DR-6); embedding and scoring (DR-2); full-model seeding until `run-seeding.mjs` runs on an installed candidate; arbitrary NAT or cable loss; cleanup of GPU memory beyond the reported receipts; first-use or phone behaviour; served-asset integrity beyond the descriptor hash (the bundle verifier owns that); installed native artifact identities on the remote machines (recorded from config, not verified).

## Verification performed

- `node --test` over the test files: see [unit-tests.txt](unit-tests.txt).
- Remote contributor permission: application unit tests (Vitest, `--config tests/vitest.config.js`): `remote-permission.test.js`, `ordered-remote-permission.test.js`, `conversation-remote-permission.test.js`, `product-session-requester-identity.test.js`, `ordered-requester-history.test.js`, `partition-api.test.js`, `automatic-ordered-partitions.test.js`, `chat-session.test.js`. Playwright `tests/e2e/chat-rails.spec.js` "direct chat" on a local server. No runner, contributor or physical route.
- `node --check` on every module.
- `--room-token-file`: `tests/unit/native-room-token-file.test.js` (Vitest, `--config tests/vitest.config.js`).
- Not run: any runner, browser, server, GPU, contributor, SSH, or the Verification Worker on these files. The run-2 fixes are unproven on a physical run.

*Last updated: October 2026*
