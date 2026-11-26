# Status records

Dated records in this folder are retained observations. They are not rewritten;
a later record or document says what changed. Current claim status lives in the
undated registries: [surface-claim-index.json](surface-claim-index.json),
[zero-critical-user-journeys.json](zero-critical-user-journeys.json) and
[x-critical-user-journeys.json](x-critical-user-journeys.json). The ESM-2 and
coordinator records below belong to the coordinator lane whose journeys were
[retired on 2026-11-26](../critical-user-journeys.md#archived-poolday-coordinator-lanes).
[model-manifests/](model-manifests/) holds undated, content-addressed model manifests.

| Date | Record | What it records | Later or superseding record |
| --- | --- | --- | --- |
| 2026-08-02 | [esm2-35m-browser-protein-observation](esm2-35m-browser-protein-observation-2026-08-02.json) | One browser run of a frozen protein-sequence fixture | None |
| 2026-08-15 | [esm2-35m-poolday-browser-smoke](esm2-35m-poolday-browser-smoke-2026-08-15.json) | Dirty-worktree Chromium smoke run of the ESM-2 lane | None; not a clean-release qualification |
| 2026-08-15 | [esm2-35m-poolday-cached-shard-recovery-smoke](esm2-35m-poolday-cached-shard-recovery-smoke-2026-08-15.json) | Detection and refetch of a mutated cached shard | None |
| 2026-08-15 | [esm2-35m-poolday-cancellation-smoke](esm2-35m-poolday-cancellation-smoke-2026-08-15.json) | Cancellation discarding late output and publishing no receipt | None |
| 2026-08-15 | [esm2-35m-poolday-corruption-smoke](esm2-35m-poolday-corruption-smoke-2026-08-15.json) | Rejection of mutated manifest bytes before model load | None |
| 2026-08-15 | [esm2-35m-poolday-interruption-recovery-smoke](esm2-35m-poolday-interruption-recovery-smoke-2026-08-15.json) | Requester reload requiring an explicit retry or discard decision | None |
| 2026-08-15 | [esm2-35m-poolday-interruption-retry-smoke](esm2-35m-poolday-interruption-retry-smoke-2026-08-15.json) | Explicit retry after reload creating a distinct assignment | None |
| 2026-08-15 | [esm2-35m-poolday-stale-result-smoke](esm2-35m-poolday-stale-result-smoke-2026-08-15.json) | Rejection of a superseded result before receipt construction | None |
| 2026-08-23 | [poolday-clean-dual-host-release](poolday-clean-dual-host-release-2026-08-23.json) | Matching release identities on both hosting paths | None |
| 2026-08-23 | [change-passport-github-installation](change-passport-github-installation-2026-08-23.json) | Change Passport GitHub App installation on one repository | None |
| 2026-08-23 | [change-passport-github-least-privilege](change-passport-github-least-privilege-2026-08-23.json) | The App's least-privilege permission boundary | None |
| 2026-08-23 | [change-passport-github-authority-boundary](change-passport-github-authority-boundary-2026-08-23.json) | What the App may and may not decide | None |
| 2026-08-23 | [change-passport-github-external-installability](change-passport-github-external-installability-2026-08-23.json) | Why an outside adopter could not yet install the App | None |
| 2026-08-23 | [change-passport-live-github-dogfood](change-passport-live-github-dogfood-2026-08-23/) | One internal App-bound check through blocked, eligible and reopened states | None |
| 2026-08-23 | [rsi/visual-policy-rollback-identity](rsi/visual-policy-rollback-identity-2026-08-23/) | One internal improvement episode with rollback evidence | None |
| 2026-09-05 | [registry-audit](registry-audit-2026-09-05.json) | A failed module registry audit (99 issues) | [repository-repair](repository-repair-2026-09-05.json) the same day (0 unresolved) |
| 2026-09-05 | [repository-repair](repository-repair-2026-09-05.json) | Repository repair, audit, tests and remaining gaps | None |
| 2026-09-05 | [esm2-peer-pack](esm2-peer-pack-2026-09-05/README.md) | ESM-2 Pack rebuilt from complementary peers on one machine | None |
| 2026-09-05 | [esm2-pack-operation](esm2-pack-operation-2026-09-05/README.md) | Peer-owned Pack bytes through the shared operation interface | None |
| 2026-09-06 | [esm2-durable-peer](esm2-durable-peer-2026-09-06/README.md) | Durable parallel peer acquisition of ESM-2 | None |
| 2026-09-06 | [esm2-process-restart](esm2-process-restart-2026-09-06/README.md) | Model transfer recovered after a full browser restart | None |
| 2026-09-06 | [esm2-remote-operation](esm2-remote-operation-2026-09-06/README.md) | ESM-2 run on another browser over the common peer-job interface (job v1) | Later job versions below; current job schema is `peerJobs.schemas.job` in [`pool-config.json`](../../shared/pool/pool-config.json) |
| 2026-09-06 | [esm2-durable-job](esm2-durable-job-2026-09-06/README.md) | Remote job result recovered after provider replacement (job v1) | Later job versions below |
| 2026-09-06 | [esm2-attempt-v2](esm2-attempt-v2-2026-09-06/README.md) | Numbered durable attempts (job v2) | [esm2-capability-plan](esm2-capability-plan-2026-09-06/README.md) (job v3) |
| 2026-09-06 | [esm2-capability-plan](esm2-capability-plan-2026-09-06/README.md) | Capability-planned job (job v3) | Current job schema is newer (v4 in `pool-config.json`) |
| 2026-09-06 | [remote-adapter](remote-adapter-2026-09-06/README.md) | Remote adapter integration and its limits | [qwen-adapter](qwen-adapter-2026-09-06/README.md) repaired the bugs it exposed |
| 2026-09-06 | [qwen-adapter](qwen-adapter-2026-09-06/README.md) | Qwen adapter source comparison and signed execution | None |
| 2026-09-06 | [document-search](document-search-2026-09-06/README.md) | Physical document search, 18 searches | Followed by [document-assistant](document-assistant-2026-09-06/README.md) |
| 2026-09-06 | [document-assistant](document-assistant-2026-09-06/README.md) | Search plus referenced answers, 24 searches and six answers | None |
| 2026-09-06 | [ui-review](ui-review-2026-09-06/) | UI review: raw model review (`agy-review.md`) and checked result (`vetted-review.md`) | `vetted-review.md` rejects the raw review's contrast and reduced-motion findings |
| 2026-09-07 | [product-closure](product-closure-2026-09-07/README.md) | Document assistant closure checks and startup probe | Publication gates resolved by [doppler-060-release](doppler-060-release-2026-09-07/README.md) |
| 2026-09-07 | [doppler-060-release](doppler-060-release-2026-09-07/README.md) | Doppler 0.6.0 published and pinned | Current pin: [`shared/config/doppler-package.json`](../../shared/config/doppler-package.json) |
| 2026-09-07 | [product-closure-handoff](product-closure-handoff-2026-09-07.md) | Handoff checkpoint for product closure | Continued by [product-closure-linux](product-closure-linux-2026-09-07/README.md) and [closure-handoff-2026-09-08](closure-handoff-2026-09-08.md) |
| 2026-09-07 | [product-closure-linux](product-closure-linux-2026-09-07/README.md) | Linux continuation of the closure handoff | None |
| 2026-09-07 | [document-answer-evidence](document-answer-evidence-2026-09-07/README.md) | Original physical answer runs, transferred from a temporary folder | None |
| 2026-09-07 | [document-answer-linux](document-answer-linux-2026-09-07/README.md) | Signed answer Capsule reproduced on Linux; prompt review | None |
| 2026-09-07 | [document-answer-model-screens](document-answer-model-screens-2026-09-07/README.md) | Generation-model selection diagnostics | None |
| 2026-09-07 | [document-answer-prompt-structure](document-answer-prompt-structure-2026-09-07.md) | Rejected prompt-structure candidate (archive alongside) | None |
| 2026-09-07 | [local-fallback-ui](local-fallback-ui-2026-09-07/README.md) | Local execution fallback and centered Run interface | None |
| 2026-09-07 | [zero-boot-boundaries](zero-boot-boundaries-2026-09-07/README.md) | Zero boot boundary repair | None |
| 2026-09-08 | [closure-handoff](closure-handoff-2026-09-08.md) | Closure checkpoint, including other products' deployments | None |

`ui-review-2026-09-06/agy-review.md` is listed with its SHA-256 in that record's
`index.json`, so it carries no banner. Read it only with `vetted-review.md`.
