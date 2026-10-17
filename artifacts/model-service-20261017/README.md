# Exact whole-model service journey, 2026-10-17

The isolated Qwen3.5 2B service passed the complete tested conversation lifecycle: explicit recipient authorization, answer, contextual follow-up, reload, two outstanding conversations, isolated cancellation, reuse, provider death, reconnection, explicit retry and preserved unrelated history. **Quality acceptance and repository CI remain open.** No new networking subsystem or telemetry was added.

## Exact application and runtime

The browser application is Reploid `ca228707`; the native contributor includes `721cd862`. The installed Doppler candidate is `8b211c3f`, archive SHA-256 `6b057b0e526a7a18afcefd655cb2fc4acb96e958962eee5a67b3caee231be1f9`. This is a locally packed candidate, not a replacement of the published package with the same version label. [Campaign](campaign.json) records native-host file hashes. [Doppler package and physical evidence](https://github.com/clocksmith/doppler/tree/main/reports/qwen-service-qualification-20261017) retain the exact archive.

Model: `qwen-3-5-2b-q4k-ehaf16`, manifest `83e5a01a21e234d238ea3ed5b0b234cc52781ddfce51861abd0fdf0ae3199028`; Q4_K weights/output head, f16 embeddings/KV, f32 computation. Chrome 155.0.8059.80 requesters and the Node 22.20.0 whole-model contributor ran on Apple M3, 24 GiB unified memory. The campaign used its own room, capability, identity and contributor processes. Existing public contributors were not restarted. This is a real local application run, not deployment of these source changes or independent customer adoption.

## Journey and measured outcomes

[Full receipt](journey.json) preserves prompts, responses, attempts, permission records, observed states, histories and transport identifiers. The two fresh requesters downloaded no model shards/tokenizer and had no page errors. Both approved remote answering. The same authorized participant reconnected with a different transport ID; retry was explicit and the failed partial answer remained in history. This does not prove migration to a different authorized participant or recovery of inference state.

| Request | First visible output ms | Completion/terminal ms | Outcome |
|---|---:|---:|---|
| 17 + 25 | 1286 | 3895 | 42 |
| Follow-up: subtract 2 | 1763 | 3985 | 40 |
| Count; cancel while another request is outstanding | 2111 | 2439 | Cancelled |
| Independent 9 × 7 | 3790 | 6312 | 63; cancellation isolated |
| Reuse after cancellation | 2091 | 4502 | 42 |
| Count; contributor killed | 2534 | 18576 | Failed with partial output preserved |
| Explicit retry after reconnect | 2194 | 26339 | Completed; new attempt linked to failed attempt |

These are single application observations, including transport, UI polling and permission handling where applicable. They are not kernel decode benchmarks. `firstExecutionMs` and state transitions in the receipt describe observed placement/waiting boundaries, not an exact scheduler queue-duration measurement. Both conversations were outstanding before cancellation; fair progress beyond this bounded two-request case remains unqualified.

The first overlap run exposed a real host bug: executing a request made reusable prepared capacity disappear from discovery. Commit `721cd862` keeps prepared readiness visible while recording execution as separate activity; owner withdrawal still removes readiness. The focused native-host/participant/thread suites passed 42 tests. The final physical journey passed after that fix. Earlier failed journey receipts are retained in [raw journey attempts](raw-journey-attempts.tar.gz), including the initial harness attempt-binding failure and the readiness failure.

## Frozen quality results

All fourteen [tasks](../../tests/fixtures/qwen-service-tasks.json) retained their original expected answers. Exact output is required; fenced JSON and copied brackets fail when the instruction forbids them. These are bounded engineering checks, not human preference scores.

| Service/control | Correct | Remaining failures |
|---|---:|---|
| Reploid 2B, repetition penalty 1.1 | 9/14 | Paid-unit sum, device constraint, code trace, exact Unicode copy, even-number count |
| Isolated Reploid 2B counterfactual, penalty 1.0 | 11/14 | Code trace, exact Unicode copy, even-number count |
| Transformers.js 4.2.0, 2B q4f16, penalty 1.0 | 9/14 | Paid-unit sum, JSON-only output, code trace, exact Unicode copy, even-number count |
| Deployed Reploid 27B Q4_K | 13/14 | Code trace: 22 rather than 26 |

Receipts: [2B 1.1](quality-2b-penalty1_1.json), [2B 1.0](quality-2b-penalty1_0.json), [27B](quality-27b.json), [independent browser control](https://github.com/clocksmith/doppler/blob/main/reports/qwen-service-qualification-20261017/tjs-2b-service-control.json). The 1.0 change was made only in the isolated contributor catalog; no public model policy was changed. Correction after tracing the shared provider: `openWorkProvider` merges the catalog generation override over the work profile for both browser and native execution. The previously stated browser-policy gap was incorrect; no runtime repair is needed for that precedence.

The independent control uses the identical rendered system/user prompt, greedy generation and no thinking. Its output cap is 64; Reploid's is 4096. No task hit either cap. Different quantization formats and execution/application boundaries prohibit treating this as an equal-tensor speed comparison or diagnosing every discrepancy as a runtime bug. Its provisioning hashes match the pinned comparator. All three 2B lanes passed the supplied fictional-movie constraint task; that single result does not qualify a movie-selection product.

The 27B observation used the existing public whole-model provider and its previously retained installed runtime, not the new candidate archive. Model identity is unchanged. The expanded suite still reproduces the wrong code answer. The matching independent CPU F16 control now gives the correct self-consistent greedy path, `2`, `6`, stop; Q4 gives `2`, `2`, stop. [Control evidence](https://github.com/clocksmith/doppler/blob/main/reports/qwen-service-qualification-20261017/f16-code-comparison.json) isolates quantization on this prompt, not general correctness. **27B Q4 remains unaccepted; 256-token prefill chunking remains mandatory.** Packed residency and the unchunked long-prefill failure remain in the [prior capacity evidence](../qwen38-27b-q4k-whole-service-20261016/README.md).

## Reproduce and close the remaining gates

Provision the exact archive and model, reconstruct the application/native source above, and adapt the non-secret paths in `campaign.json` to an isolated application server. Create a private room capability in `stateDirectory/room-token` with mode 0600. The test creates/reuses its own identity and owns only the contributor it starts; never point it at an operator's existing state directory.

```sh
REPLOID_SERVICE_CAMPAIGN=/absolute/path/to/campaign.json \
REPLOID_E2E_BASE_URL=http://localhost:8127 REPLOID_E2E_SKIP_LOCAL_SERVER=1 \
REPLOID_E2E_CHROMIUM_CHANNEL=chrome npx playwright test \
  --config tests/playwright.config.js tests/e2e/chat-model-service-journey.spec.js \
  --project chromium

# With an explicitly prepared contributor for the exact selected model:
REPLOID_NATIVE_CHAT_URL=https://replo.id \
REPLOID_NATIVE_CHAT_MODEL=qwen3-8-27b-text-q4k-ehaf16 \
REPLOID_CHAT_TASK_SUITE=tests/fixtures/qwen-service-tasks.json \
REPLOID_E2E_BASE_URL=https://replo.id REPLOID_E2E_SKIP_LOCAL_SERVER=1 \
REPLOID_E2E_CHROMIUM_CHANNEL=chrome npx playwright test \
  --config tests/playwright.config.js tests/e2e/chat-native-whole-model-tasks.spec.js \
  --project chromium
```

Test syntax and focused ESLint checks pass. Hosted CI remains failed with downstream checks skipped; see the [open CI evidence](../connection-journey-20261017/README.md#ci-failures-remain-open). This lifecycle pass does not close live retrieval/search, model quality, fair scheduling under sustained demand, different-participant replacement, complete cost comparison, or independent application retention. The subsequent [frozen movie workload and expanded shared-service journey](../movie-service-20261017/README.md) are now recorded: both overlapping requests completed, but movie quality failed at 5/12 exact answers. Recruiting five target users remains blocked on that acceptance; no contacts were supplied or contacted.

Component: whole-model host readiness and verification evidence. Intent: preserved. Acceptance: focused host tests and the exact physical journey above; quality failures and skipped CI remain open. Boundary effects: no new infrastructure; Doppler owns execution, Reploid owns permissions, placement and history.
