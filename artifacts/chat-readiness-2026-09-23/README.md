# Resident peer chat acceptance

Completed September 23, 2026 on Suby (September 24 UTC). Deployment was omitted
at the user's direction. These are local source and browser results, not evidence
of a deployed release.

## Changes

- Contributions prepare and validate the actual loaded model before advertising
  readiness. Loading, ready, executing and failed states reflect runtime state.
- One resident provider owns preparation, execution, reset and teardown. Local
  and contributing execution share this implementation and FIFO device admission.
  Weights survive successful requests and clean cancellation; failed sessions retire.
- Mesh requests wait for a compatible ready provider. They do not silently load
  weights on the requester. Execution metadata comes from the loaded runtime;
  receipts must agree with the response's model identity.
- Remote requests have one settlement owner for response, timeout, cancellation,
  shutdown and peer loss. Late responses cannot revive settled requests. Cancelled
  request identities remain in the bounded replay cache. Approval is rechecked
  against current peer availability before disclosure.
- Defensive snapshots isolate caller and peer mutations. Observer failures cannot
  strand preparation or a device queue. Concurrent preparation and teardown share
  their respective promises, including reentrant observers.

## Real browser execution

[`same-device.json`](same-device.json) is the final acceptance record;
[`same-device.log`](same-device.log) contains progress and the passing exit result.
The harness is [`same-device.mjs`](same-device.mjs), run with:

```sh
npm start
node artifacts/chat-readiness-2026-09-23/same-device.mjs
```

Two isolated Chrome browser contexts used normal application controls, actual
WebRTC, and Doppler 0.6.2 inference on one physical Intel `gen-12lp` GPU. The
adapter reported `fallback: false`. Contribution consent and each disclosure
approval were explicitly selected. A transparent runtime-service wrapper counted
opens, closes and streams while delegating all loading and inference unchanged.

| Check | Observed result |
| --- | --- |
| Final harness result | `ok: true`, `sourceStable: true`, no browser page errors |
| Actual model | `qwen-3-5-2b-q4k-ehaf16` |
| Actual manifest hash | `502fbd6d4c9ed6a890931665995c8ebb42a30e5cda23aa2cfd8e680bee7fa5bc` |
| Preparation | 165,149 ms before ready |
| Catalog | 2B ready; unsupplied 0.8B unavailable |
| Overlapping conversations | Separate exact responses `ALPHA` and `BETA` |
| Residency | One open across six streams; one final close |
| Requester model requests | Zero |
| Contributor model requests | 1,842 at preparation and still 1,842 after both completions |
| Cancellation | Cancelled attempt settled; same resident then returned exact `GAMMA` |
| Completed-history refresh | Both histories preserved |
| In-flight refresh | Attempt cancelled, no redispatch |
| Contributor disconnect | Request failed with `Execution peer disconnected; retry requires a new attempt` |

The record includes before/after source hashes for nine execution-path modules.
The matching generated browser bundle identity is
`sha256:fff2079b4582169dfb494a2de44c939055eb70cfcf923f563b27cc5e484b395a`
(2,680 served files).

Earlier records are retained: `initial-same-device.json`, `before-hardening.json`
and `recovery-source-changed.json`. The last of these passed the recovery behavior
checks but failed source stability because edits occurred during execution. It is
not the final acceptance run.

## Automated verification

- 124 unit/integration tests passed across 13 files: [`unit.log`](unit.log).
- 13 Chromium tests passed: [`browser.log`](browser.log). These include
  Verification Worker checks, responsive light/dark layouts, reload, and three-tab
  WebRTC with injected inference and test files. Those fixtures do not establish
  real model execution; the separate physical harness above does.
- Targeted ESLint, `npx tsc -p tsconfig.library.json`,
  `node scripts/verify-layers.js`, `node scripts/verify-catscan.js`, and
  `git diff --check` passed.
- Runtime pin verification passed. Library synchronization and registry generation
  completed. Registry validation reported zero unresolved entries; 18 existing
  modules without individual blueprints remain informational.
- Repeating genesis, inventory, blueprint registry, module registry, VFS and browser
  bundle generation preserved all six generated-file hashes.

```sh
npx vitest run tests/unit/work-resident-provider.test.js tests/unit/remote-generation-requests.test.js tests/unit/chat-scheduler.test.js tests/unit/chat-workspace.test.js tests/unit/work-contracts.test.js tests/unit/work-threads.test.js tests/unit/chat-session.test.js tests/unit/work-swarm-lifecycle.test.js tests/unit/legacy-generation-threads.test.js tests/unit/swarm-rtc-config.test.js tests/unit/webrtc-swarm.test.js tests/unit/self-bridge.test.js tests/integration/public-swarm-server.test.js
npx playwright test tests/e2e/conversation-repair.spec.js tests/e2e/release-boundaries.spec.js tests/e2e/chat-workspace.spec.js tests/e2e/chat-three-tab.spec.js --project=chromium
```

## Qualification limits

This establishes the same-device whole-request peer-chat path and the tested
recovery cases. It does not establish cross-device/network behavior for this new
code, multi-participant fairness under sustained load, durable replay suppression
across process crashes, physical layer splitting, or physical file/LoRA sharing.
Revocable reusable thread grants remain outstanding; disclosure still requires
the existing explicit approval flow. The full MVP is not qualified by this report.

## Component handoff

- Component: resident execution providers, browser chat/contribution hosts, mesh
  generation lifecycle, and availability presentation.
- Intent: preserved.
- Acceptance evidence: commands and artifacts above, including actual browser GPU
  execution and Verification Worker acceptance.
- Boundary effects: host composition and providers consume runtime identity;
  mesh advertisements expose execution readiness and validate result identity;
  UI displays those states. Doppler retains computation authority. Generated vendor
  and registry files follow their canonical sources. No charter boundary changed.
