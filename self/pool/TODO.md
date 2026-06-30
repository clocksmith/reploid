# Reploid Pool TODO

Reploid is the market-facing browser inference network and governed browser substrate. Browser providers serve model runs through signed peer intents, WebRTC payload transit, receipts, verification, reputation, and requester acceptance. Public-facing product copy should use Reploid.

Canonical claim and deployment truth stay in [`pool-config.json`](./pool-config.json). Architecture and production contracts stay in [`../../docs/browser-inference-pool.md`](../../docs/browser-inference-pool.md).

The current Cloud Run and Firestore path is transitional. The target Reploid control plane is WebRTC peer-to-peer: signed job intents, provider capability adverts, assignment selection, quorum agreement, receipts, acceptance, points, and reputation should move without a required Reploid server.

---

## Current Local Checks

- [x] `npm run verify:pool -- --allow-placeholders` passes locally.
- [x] Focused pool tests pass: `pool-contract`, `pool-routes`, `pool-doppler-runtime`, `p2p-signaling`, `pool-peer-control-plane`, `pool-peer-room`, `pool-peer-rendezvous`, and `pool-model-artifacts`.
- [x] No literal `TODO`, `FIXME`, `TBD`, or `XXX` markers existed in pool files before this document.

---

## Source Of Truth

| Surface | Path | Purpose |
|---------|------|---------|
| Product config | [`pool-config.json`](./pool-config.json) | Product-owned claim, launch model, trust tiers, policies, routes, transport, and deployment requirements. |
| Product doc | [`../../docs/browser-inference-pool.md`](../../docs/browser-inference-pool.md) | Public architecture, API contract, production readiness, and forbidden claims. |
| Product UI | [`../ui/pool-home/index.js`](../ui/pool-home/index.js) | `/`, `/run`, `/contribute`, `/agents`, `/receipts`, `/reputation`, and `/0` browser surface. |
| Peer control plane | [`peer-control-plane.js`](./peer-control-plane.js) | Signed peer messages, deterministic assignment planning, DataChannel bus helpers, and peer reducers. |
| Peer room | [`peer-room.js`](./peer-room.js) | Browser room bootstrap for primary `/run`, `/contribute`, and `/agents` flows without hosted job or provider assignment calls. |
| Coordinator | [`../../server/pool/routes.js`](../../server/pool/routes.js) | Cloud Run routes for config, jobs, providers, receipts, reputation, signaling, and deployment check. |
| Verification script | [`../../scripts/verify-pool-production.js`](../../scripts/verify-pool-production.js) | Static, route, config, and hosted readiness verification. |

---

## Launch Proof

- [ ] Deploy Reploid public hosting plus the Reploid Cloud Run coordinator with `POOL_BACKEND_ONLY=true`, `POOL_STORE=firestore`, Firebase Auth verification, required rewrites, commit-reveal support, and metadata-only signaling.
- [ ] Run `npm run verify:pool -- --url <hosting-domain>` and record `/pool/deployment/check` with `ok: true`, config version, config hash, store mode, auth requirement, artifact base, and commit-reveal status.
- [ ] Run `REPLOID_POOL_SMOKE_URL=<hosting-domain> npm run smoke:pool` and record route coverage for the public product surface.
- [ ] Prove one full loop with WebRTC as the main transit: requester submit, provider load, provider register, assignment claim, Doppler generation, commit, reveal, receipt submit, verifier decision, requester acceptance, points update, and reputation update.

---

## Decentralized Control Plane

- [x] Define signed peer-message envelopes for job intent, provider advert, assignment claim, commit, reveal, execution result, receipt, acceptance, points event, reputation event, and peer heartbeat.
- [x] Add signed provider capability adverts that bind identity, model, manifest, runtime profile, accepted policies, availability, and reputation evidence.
- [x] Add deterministic local assignment selection from intent hash, provider adverts, policy, runtime profile, model identity, and reputation evidence.
- [x] Add a browser peer room that replaces server-created jobs and hosted provider assignment polling for the primary `/run` and `/contribute` flow.
- [x] Add browser-room ring quorum agreement from matching receipt hashes over WebRTC provider sessions.
- [x] Add signed peer ledger events for accepted receipt sets plus deterministic points and reputation reducers.
- [x] Replace server-created jobs with requester or agent signed intents across `/run`, `/contribute`, `/agents`, and quorum policies.
- [x] Replace coordinator signaling dependency for primary routes with peer-discovered WebRTC sessions; optional server relay is bootstrap only, not control-plane authority.
- [x] Gossip accepted receipt sets, points events, and reputation events inside local and relayed peer rooms.
- [ ] Gossip accepted receipt sets, points events, and reputation events across a true serverless wide-area WebRTC peer graph beyond room relay.
- [x] Keep optional public anchors for auditability, but do not require a Reploid server to create jobs, assign providers, decide consensus, or mutate reputation.

---

## Model Artifact Path

- [ ] Publish launch model artifacts under `REPLOID_POOL_MODEL_BASE_URL` with the configured `<modelId>/<manifestHash>/manifest.json` path shape.
- [x] Add strict artifact manifest preflight for CORS fetch, manifest JSON, manifest hash, model id, and model hash.
- [ ] Verify tokenizer, shard hashes, range or resume behavior, and OPFS cache reuse against the published artifact host.
- [x] Make strict-preflight artifact failures legible in `/contribute`: missing manifest, hash mismatch, CORS denial, and unsupported browser runtime.
- [ ] Keep model bytes out of Firebase Hosting and Cloud Run.

---

## Doppler Evidence Contract

- [ ] Confirm the configured `doppler-gpu@0.4.6` browser module loads from the public module URL without import-map or bundler assumptions.
- [ ] Add or consume a narrow public Doppler evidence export for token ids, transcript hashes, generation config, runtime profile hash, and backend identity.
- [ ] Keep Reploid from deep-importing Doppler internals.
- [ ] Show a visible comparison receipt for Doppler output fields versus Reploid receipt fields.
- [ ] Remove token-level evidence warning only after the configured public Doppler evidence export exists and tests assert it.

---

## Provider Supply

- [x] Make `/contribute` primary Start load the model, create a signed provider advert, and listen for peer-room WebRTC jobs.
- [x] Keep the hosted manual provider controls coherent: register, heartbeat, poll, execute, commit, reveal, and submit receipt.
- [x] Surface provider health states: WebGPU unavailable, model loading, artifact failure, storage quota, queue state, last receipt, trust tier, and reputation.
- [x] Test multiple same-origin browser-room providers on the same launch model and runtime profile through a ring quorum policy.
- [x] Add browser smoke coverage that opens provider and requester pages, injects a deterministic browser runtime, and proves visible peer receipt flow.
- [ ] Test multiple real browser tabs on the published launch model artifacts and runtime profile through a ring quorum policy.
- [x] Add provider hardening for duplicate peer sessions, provider busy rejection, stopped nodes, and completed session cleanup.
- [ ] Add provider recovery behavior for tab sleep, refresh, expired hosted assignment, and reveal miss.

---

## Requester And Agent Demand

- [x] Make `/run` primary Run create a signed peer intent, discover multiple provider adverts for ring policies, send prompts over DataChannel, receive receipts, form quorum, countersign acceptance locally, and gossip signed ledger events to providers.
- [x] Make `/run` state the exact trust tier and receipt status in user language without forbidden claims.
- [x] Make `/agents` primary Submit use signed peer intents, DataChannel prompt delivery, receipt agreement, countersignature, and ledger-event gossip.
- [x] Make `/agents` copy-pasteable for hosted submit, poll, verify, accept, and reject compatibility flows.
- [ ] Capture reject reasons and expose them in receipt history.
- [x] Show requester-visible spend, agreement threshold, verifier decision, model identity, runtime identity, output hash, token hash status, and provider signature.

---

## Security And Abuse

- [ ] Lock Firebase Auth role binding on requester, agent, provider, and verifier identities.
- [ ] Verify direct Firestore access is denied outside declared server-mediated flows.
- [x] Exercise peer-room relay metadata-only limits, payload caps, TTLs, peer filtering, and rejection of prompt/output/receipt/model payloads.
- [ ] Exercise hosted signaling metadata-only limits, stale peer cleanup, and production rate limits against deployed Firebase/Cloud Run.
- [ ] Enforce quota or rate limits for job submissions, provider heartbeats, signaling offers, and receipt submissions.
- [ ] Add production evidence for Firestore rules, Cloud Run auth handling, and hosted route rewrites.

---

## Strategic Wedge

- [x] Keep the public front-door sentence: `Reploid is receipt-backed browser inference on WebRTC browser runtimes, quorum consensus, and receipts.`
- [x] Treat external artifact storage as interchangeable byte delivery. Reploid owns product execution, receipts, verification, reputation, requester acceptance, and the browser substrate.
- [x] Position Doppler as the browser inference engine. Reploid is the decentralized serving product and governed browser substrate.
- [x] Treat WebRTC as both the target control plane and the default prompt/output/receipt transit.
- [x] Avoid forbidden claims: `trustless`, `hardware-attested`, `guaranteed honest GPU execution`, and `decentralized AI compute marketplace at launch`.
- [ ] Optimize for one public proof that a browser can do useful model work, produce an inspectable receipt, earn reputation, and serve an agent or requester.

---

## Explicit Non-Goals

- [ ] Do not launch paid settlement or payouts before accepted receipts and reputation work publicly.
- [ ] Do not claim hardware attestation.
- [ ] Do not make broad `/pool/**` Firebase backend rewrites.
- [ ] Do not deep-import Doppler internals.
- [ ] Do not let UI copy exceed `pool-config.json` claims.
- [x] Present Reploid as the public product brand and substrate identity.
- [ ] Do not treat Cloud Run or Firestore as the permanent Reploid authority.

---

## Done Definition

- [ ] Deployed `/pool/deployment/check` returns `ok: true`.
- [ ] Public smoke passes against the hosted surface.
- [x] The browser-room code path can run `/contribute` providers and `/run` requester logic without coordinator job creation, collect accepted receipts, and reduce signed points plus reputation events locally.
- [x] A browser smoke can open `/contribute` and `/run`, receive an accepted receipt, and expose local points plus reputation projection in the visible UI.
- [ ] A user can do the same against published model artifacts on the hosted surface.
- [ ] Prompt, output, and full receipt payloads move over WebRTC DataChannel by default, with coordinator signaling restricted to WebRTC metadata.
- [x] Browser-room ring policy agreement happens through WebRTC provider sessions and produces accepted receipt sets plus agreement hashes.
- [x] Same-origin browser-room target path works without required Reploid server control-plane calls: peers discover local adverts, route signed intents, elect providers, reach quorum, countersign acceptance, and produce signed reputation events.
- [x] Wider room path works with optional metadata relay and without required Reploid server job, assignment, quorum, acceptance, points, or reputation authority.
- [ ] Wider peer graph path works without any Reploid server relay across remote browsers.
- [ ] The receipt binds model hash, manifest hash, runtime, backend, generation config, output hash, token ids hash or documented warning, provider signature, verifier decision, and requester acceptance.
- [ ] Docs, config, UI copy, and verifier claims match.

---

*Last updated: June 2026*
