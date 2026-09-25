# Chat grants, custody, and native execution acceptance

Local work on Suby, September 23, 2026 (final runs September 24 UTC).
No deployment was requested or performed. This report qualifies the working tree,
not a deployed release. Baseline commit: `88877fa6f`.

## Implementation

- Thread grants are opt-in and revocable. They bind the thread, verified recipient,
  exact model and adapter identities, sharing scope, and disclosure class. Each
  attempt records whether it used a one-time approval or a persisted grant.
- Recipient proofs sign a fresh challenge bound to the room, transport IDs, and
  both WebRTC certificate fingerprints. Proofs are rechecked against the current
  channel after asynchronous operations. Recipient replacement needs authorization.
- Grant persistence failure prevents disclosure. Revocation cancels a current
  attempt using that grant. Observer exceptions and reentrant decisions cannot
  bypass the approval lifecycle.
- Adapter registry boundaries copy publications, receipts, and bytes. Revocation
  survives replay of the original publication and races with reads and writes.
  Cached acquisition checks the current assignment's adapter requirements.
- Custody checkpoints and returned buffers are isolated from caller mutation;
  malformed checkpoint bytes are rejected. Supplier closure and cancellation are
  checked again after asynchronous validation.
- Contribution and chat now share `self/config/chat-models.json`. The former
  Qwen 0.8B manifest identity was wrong for the pinned runtime and is corrected
  against both the actual artifact and native execution evidence.
- The earlier resident-session, truthful readiness, FIFO device scheduling,
  remote-only placement, and recovery changes remain in the same working tree.
  See [earlier acceptance](../chat-readiness-2026-09-23/README.md).

## Real chat on one physical device

[Harness](same-device.mjs), [result](same-device.json), [log](same-device.log).

Two isolated Chrome contexts used the ordinary chat UI, real WebRTC, and native
`doppler-gpu@0.6.2` on Intel `gen-12lp` WebGPU. A transparent observation wrapper
counted runtime opens, closes, and streaming calls; it delegated all computation
to the unchanged runtime. Contribution and disclosure were explicitly approved.

Final run: `2026-09-24T03:13:45.263Z` through `03:17:35.549Z`.
Result: `ok: true`, `sourceStable: true`, no recorded errors.

- Qwen 3.5 2B prepared in 169,570 ms; only then did it become available.
- Two overlapping conversations returned exactly `ALPHA` and `BETA` with separate
  histories. They shared the resident model through the device queue.
- A remembered grant survived requester refresh; `DELTA` completed without another
  approval. After revocation, `EPSILON` required fresh approval.
- Cancellation settled the attempt, and `GAMMA` subsequently completed using the
  same resident session.
- Refresh during generation did not redispatch the request. Contributor loss
  settled the affected request.
- Eight actual streaming calls used one runtime open. Explicit contribution stop
  closed it once. The requester made zero model-download requests.
- Executed model identity:
  `sha256:502fbd6d4c9ed6a890931665995c8ebb42a30e5cda23aa2cfd8e680bee7fa5bc`.

This is one GPU with separate browser contexts, not independent-device or
cross-network qualification. Cancellation settlement does not promise immediate
GPU termination, and signatures do not establish honest computation.

## Real file and LoRA transfer, application, and removal

[Harness](real-lora.mjs), [result and signed receipts](real-lora.json),
[log](real-lora.log).

Final run: `2026-09-24T03:12:09.283Z` through `03:13:44.703Z`.
Result: `ok: true`, `sourceStable: true`, no recorded errors.

Two isolated contexts used the production signed custody API, a dedicated real
WebRTC data channel, explicit bounded artifact grants, and IndexedDB checkpoints.
The recipient received a 43,346,432-byte NER LoRA and a 214,138-byte model manifest.
Transfer was interrupted after a 262,144-byte checkpoint, then resumed. After
supplier disconnection, both artifacts were read from verified cache with zero
peer requests (43,560,570 cached bytes).

The recipient used the received manifest through Doppler's inline manifest source
and loaded the received adapter bytes. It made zero adapter-origin requests.
Base-model weight shards still came from the pinned origin. This is not evidence
of peer-delivered model weight shards.

Identities:

- Qwen 0.8B manifest:
  `sha256:edeb69dd65cbb26971abf773a95bf6dc219a82942c0951d65e1893d442b607c9`.
- Adapter file:
  `sha256:dfed3509fdd54c04e80e362b6b14f98d9c326a8e732f539996a137086dc4f636`.
- Native execution adapter identity, 372 tensors:
  `sha256:dc0248f45553e69defd8a1846619443f1ac5902a118548c70a7254c21f66f64b`.

Native model preparation took 75,432 ms. The adapted output was
`{"people":["Alice","Bob"],"places":["Paris"],"dates":["July 4, 2025"]}`.
Adapted token IDs differed from the base run. Unloading the adapter cleared its
execution identity and restored exactly the original base token IDs. This proves
application and removal for this runtime/model/device and prompt; it is not a
general model-quality evaluation or public adapted-chat UI acceptance.

## Automated acceptance

- [Unit/integration log](unit.log): 167 tests across 19 files passed.
- [Chromium log](browser.log): 18 tests passed, covering actual browser crypto and
  WebRTC recipient proofs, grant reuse/revocation/replacement, thread persistence,
  durable custody resume across reload and process restart, responsive themes,
  and Verification Worker acceptance of changed modules. Browser regression
  inference is injected; the two native harnesses above provide real GPU evidence.
- Targeted ESLint, `npx tsc -p tsconfig.library.json`, `node scripts/verify-layers.js`,
  CATSCAN verification, runtime-pin verification, and `git diff --check` passed.
- [Registry log](registry.log): zero unresolved references. Repeating generators
  preserved all six generated-file hashes. The 18 existing missing individual
  architectural blueprints remain informational findings.
- Browser bundle: `sha256:2d49427718398820ff0d3a07155f24b53984873ef3ddedde6a8a5563e1578c51`
  (2,683 served files). Generated library copies came from `npm run sync:library`.

Run the browser regression suite on the permitted local origin, after native
chat qualification finishes, to avoid mixing fixture suppliers into its room:

```sh
npx playwright test tests/e2e/thread-grants.spec.js tests/e2e/chat-workspace.spec.js tests/e2e/chat-three-tab.spec.js tests/e2e/release-boundaries.spec.js tests/e2e/conversation-repair.spec.js tests/e2e/peer-pack-custody.spec.js --project=chromium
```

The native harnesses require a local server on `localhost:8000` with
`POOL_ALLOW_UNAUTHENTICATED_LOCAL=true`, the installed Chrome GPU environment,
and access to the pinned model origins. Run them sequentially:

```sh
node artifacts/chat-grants-2026-09-23/real-lora.mjs
node artifacts/chat-grants-2026-09-23/same-device.mjs
```

## Preserved failures and remaining boundaries

[Follow-up notes](followup-notes.txt) identify negative regressions reproduced
before repair and preserved qualification failures. The configured adapter mirror
returned HTTP 401; the recorded upstream revision supplied matching bytes.
An incorrect old model identity and an incorrect harness identity-field assertion
were rejected. A browser run on port 8001 was rejected by the existing origin
policy; the final run passed on port 8000 without broadening that policy.

Remaining MVP work includes public-chat adapter selection and execution wiring,
peer model-weight acquisition through that path, signed complete-job integration,
and the full three-participant model/adapter scenario. Independent-device release
verification and physical layer splitting remain separate qualifications.
The networking repair has not been verified as a deployed release here.

## Material-change handoff

- Component: chat workspace, host, and conversation UI.
  Intent: deliberately changed to permit explicit, scoped, revocable thread
  grants; the affected CATSCANs were updated. Contribution remains explicit.
- Component: mesh/transport recipient identity, resident execution, model catalog,
  adapter registry, and artifact custody.
  Intent: preserved; fixes enforce existing identity, isolation, availability,
  cancellation, and authorization boundaries.
- Acceptance evidence: commands and source-bound artifacts above.
- Boundary effects: chat, host, UI, mesh/transport, configuration, provider
  lifecycle, and custody/adapter registry. Doppler still owns computation;
  this change does not establish hardware attestation or exactly-once delivery.
