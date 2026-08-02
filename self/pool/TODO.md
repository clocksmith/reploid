# Reploid Pool TODO

Reploid is a proof-carrying protein-model network. Browser providers, peer
transit, receipts, verification, reputation, and requester acceptance are
implementation mechanisms for reproducible protein evidence, not the product
goal in themselves. Public-facing product copy should use Reploid.

The product goal is to reduce the verified cost of resolving bounded public
protein questions: less duplicated computation, earlier disagreement, more
useful model-specific residue evidence, and stronger independent reproduction.
Receipt-backed browser inference is an evidence substrate. It does not establish
biological function, mutation fitness, experimental truth, or honest hardware.

Canonical claim and deployment truth stay in [`pool-config.json`](./pool-config.json). Architecture and production contracts stay in [`../../docs/browser-inference-pool.md`](../../docs/browser-inference-pool.md). The [product intent](../../docs/poolday/product-intent.md) owns the protein-network goal, and the [Discovery Contract](../../docs/poolday/discovery-contract.md) owns its target atomic object and gates.

The current Cloud Run and Firestore path is transitional. The target Reploid control plane is WebRTC peer-to-peer: signed job intents, provider capability adverts, assignment selection, quorum agreement, receipts, acceptance, points, and reputation should move without a required Reploid server.

---

## Current Local Checks

- [x] `npm run verify:pool -- --allow-placeholders` passes locally.
- [x] Unit suite passes: 1,511 passed and 25 skipped.
- [x] Integration suite passes: 359 passed and 9 skipped.
- [ ] Re-run `npm run verify:pool:release -- --url https://replo.id --channel=chrome` after deployment. The current release reports `2026-07-28.doppler-0.5.1.v2` while the governed local contract is `2026-08-01.sequence-model-contracts.v1`; release verification now fails before any browser workload on this mismatch.
- [x] `npm audit` and the production-image `npm ci --omit=dev --include=optional` audit report zero vulnerabilities.
- [x] No literal `TODO`, `FIXME`, `TBD`, or `XXX` markers existed in pool files before this document.

---

## Source Of Truth

| Surface | Path | Purpose |
|---------|------|---------|
| Product config | [`pool-config.json`](./pool-config.json) | Product-owned claim, launch model, trust tiers, policies, routes, transport, and deployment requirements. |
| Product intent | [`../../docs/poolday/product-intent.md`](../../docs/poolday/product-intent.md) | Protein-model-network objective, surface authority, first wedge, and north-star metric. |
| Discovery Contract | [`../../docs/poolday/discovery-contract.md`](../../docs/poolday/discovery-contract.md) | Target question, hypothesis, action-value, outcome, replication, and closure contract. |
| Product doc | [`../../docs/browser-inference-pool.md`](../../docs/browser-inference-pool.md) | Public architecture, API contract, production readiness, and forbidden claims. |
| Product UI | [`../ui/pool-home/index.js`](../ui/pool-home/index.js) | `/`, `/ask`, `/compute`, `/history`, `/network`, and `/zero` browser surface. |
| Peer control plane | [`peer-control-plane.js`](./peer-control-plane.js) | Signed peer messages, deterministic assignment planning, DataChannel bus helpers, and peer reducers. |
| Peer room | [`peer-room.js`](./peer-room.js) | Browser room bootstrap for primary `/ask` and `/compute` flows without hosted job or provider assignment calls. |
| Coordinator | [`../../server/pool/routes.js`](../../server/pool/routes.js) | Cloud Run routes for config, jobs, providers, receipts, reputation, signaling, and deployment check. |
| Verification script | [`../../scripts/verify-pool-production.js`](../../scripts/verify-pool-production.js) | Static, route, config, and hosted readiness verification. |

---

## Launch Proof

- [x] Deploy Reploid public hosting plus the Reploid Cloud Run coordinator with `POOL_BACKEND_ONLY=true`, `POOL_STORE=firestore`, Firebase Auth verification, required rewrites, commit-reveal support, and metadata-only signaling.
- [ ] Re-establish production verification against `https://replo.id` with the current local config version and hash. A historical readiness result for an earlier release is not current browser or promotion evidence.
- [x] Run public smoke against `https://reploid.web.app` and cover `/`, `/ask`, `/compute`, `/records`, `/history`, `/network`, and `/zero` plus the synthetic peer flow.
- [x] Prove the primary WebRTC loop on the hosted surface: requester intent, provider model load and advert, deterministic assignment, real Doppler generation, signed receipt agreement, verifier decision, requester acceptance, points event, and reputation event.
- [ ] Prove the separate optional hosted diagnostic loop through provider registration, assignment claim, commit, reveal, and expired-assignment recovery.

---

## Decentralized Control Plane

- [x] Define signed peer-message envelopes for job intent, provider advert, assignment claim, commit, reveal, execution result, receipt, acceptance, points event, reputation event, and peer heartbeat.
- [x] Add signed provider capability adverts that bind identity, model, manifest, runtime profile, accepted policies, availability, and reputation evidence.
- [x] Add deterministic local assignment selection from intent hash, provider adverts, policy, runtime profile, model identity, and reputation evidence.
- [x] Add a browser peer room that replaces server-created jobs and hosted provider assignment polling for the primary `/ask` and `/compute` flow.
- [x] Add browser-room ring quorum agreement from matching receipt hashes over WebRTC provider sessions.
- [x] Add signed peer ledger events for accepted receipt sets plus deterministic points and reputation reducers.
- [x] Replace server-created jobs with requester signed intents across `/ask`, `/compute`, and quorum policies.
- [x] Replace coordinator signaling dependency for primary routes with peer-discovered WebRTC sessions; optional server relay is bootstrap only, not control-plane authority.
- [x] Gossip accepted receipt sets, points events, and reputation events inside local and relayed peer rooms.
- [ ] Gossip accepted receipt sets, points events, and reputation events across a true serverless wide-area WebRTC peer graph beyond room relay.
- [x] Keep optional public anchors for auditability, but do not require a Reploid server to create jobs, assign providers, decide consensus, or mutate reputation.

---

## Model Artifact Path

- [x] Publish and pin launch model artifacts under the selected model's configured `artifactPolicy.baseUrl`, with `REPLOID_POOL_MODEL_BASE_URL` as an override for alternate artifact roots.
- [x] Add strict artifact manifest preflight for CORS fetch, manifest JSON, manifest hash, model id, and model hash.
- [x] Verify tokenizer and shard identities, independent HTTP range requests, and cold-to-warm OPFS cache reuse against the published artifact host.
- [x] Make strict-preflight artifact failures legible in `/compute`: missing manifest, hash mismatch, CORS denial, and unsupported browser runtime.
- [x] Keep model bytes out of Firebase Hosting and Cloud Run; the production verifier rejects bundled weight formats and requires external content-addressed HTTPS artifact roots.

---

## Doppler Evidence Contract

- [x] Pin npm tooling and the immutable browser runtime to published `doppler-gpu@0.5.1`; verify the exact tarball integrity and npm jsDelivr entry without import-map or bundler assumptions.
- [x] Consume the narrow public Doppler evidence export for token ids, transcript hashes, generation config, runtime profile hash, and backend identity.
- [x] Keep Reploid from deep-importing Doppler internals.
- [x] Show a visible comparison receipt for Doppler output fields versus Reploid receipt fields.
- [x] Use the configured public `generateWithEvidence` export without a token-level warning and assert the full evidence comparison; retain the warning only for unsupported third-party handles.

---

## Provider Supply

- [x] Make `/compute` primary Start load the model, create a signed provider advert, and listen for peer-room WebRTC jobs.
- [x] Keep the hosted manual provider controls coherent: register, heartbeat, poll, execute, commit, reveal, and submit receipt.
- [x] Surface provider health states: WebGPU unavailable, model loading, artifact failure, storage quota, queue state, last receipt, trust tier, and reputation.
- [x] Test multiple same-origin browser-room providers on the same launch model and runtime profile through a ring quorum policy.
- [x] Add browser smoke coverage that opens provider and requester pages, injects a deterministic browser runtime, and proves visible peer receipt flow.
- [ ] Persist clean-release browser qualification for ESM-2: all governed recovery,
  corruption, cancellation, stale-result, and independent-reproduction checks need
  a persisted exact-contract record. The isolated harness currently fails closed
  at GCS artifact CORS for its non-production local origin; this is not a browser
  qualification pass or an OPFS recovery result.
- [x] Add provider hardening for duplicate peer sessions, provider busy rejection, stopped nodes, and completed session cleanup.
- [x] Restore an opted-in peer provider after refresh or tab visibility recovery with the same role identity and warm OPFS model.
- [ ] Recover hosted diagnostic assignments after expiration or a reveal miss.

---

## Requester And Agent Demand

- [x] Make `/ask` create a signed peer intent, discover multiple provider adverts for ring policies, send prompts over DataChannel, receive receipts, form quorum, countersign acceptance locally, and gossip signed ledger events to providers.
- [x] Make `/ask` state the exact trust tier and receipt status in user language without forbidden claims.
- [x] Capture route and rejection decisions and expose them in receipt history.
- [x] Show requester-visible spend, agreement threshold, verifier decision, model identity, runtime identity, output hash, token hash status, and provider signature.

---

## Security And Abuse

- [x] Lock Firebase Auth role binding on requester, agent, provider, and verifier identities.
- [x] Verify direct Firestore access is denied outside declared server-mediated flows.
- [x] Exercise peer-room relay metadata-only limits, payload caps, TTLs, peer filtering, and rejection of prompt/output/receipt/model payloads.
- [x] Exercise the distributed Firestore rate window against deployed Firebase/Cloud Run and require the expected accepted-versus-limited burst result.
- [ ] Capture deployed expiration and stale-peer cleanup evidence for the optional hosted signaling path.
- [x] Enforce a Firestore-transaction-backed per-client rate limit across hosted pool routes, including job, heartbeat, signaling, and receipt endpoints.
- [x] Add production evidence for Firestore rules, Cloud Run auth handling, and hosted route rewrites.

---

## Strategic Wedge

- [x] Keep the public front-door sentence: `Run browser models together.`
- [x] Treat external artifact storage as interchangeable byte delivery. Reploid owns product execution, receipts, verification, reputation, requester acceptance, and the browser substrate.
- [x] Position Doppler as the browser inference engine. Reploid is the decentralized serving product and governed browser substrate.
- [x] Treat WebRTC as both the target control plane and the default prompt/output/receipt transit.
- [x] Avoid forbidden claims: `trustless`, `hardware-attested`, `guaranteed honest GPU execution`, and `decentralized AI compute marketplace at launch`.
- [x] Optimize for one public proof that a browser can do useful model work, produce an inspectable receipt, earn reputation, and serve an agent or requester.

---

## Proof-Carrying Protein Evidence Network

These gates extend the current public protein evidence path. They do not expand
the supported public claim until the matching implementation, test, surface
claim, and deployment evidence exist.

### Discovery Contract Projection

- [ ] Define a domain-separated signed contract-checkpoint record that binds the
  question, parent revisions, Poolday policy, projection implementation, ordered
  input records, and checkpoint signer.
- [ ] Derive one deterministic contract state from signed question, hypothesis,
  prior-evidence, prediction, result, claim, work-order, work-claim, outcome,
  cohort, evaluation, correction, and revocation records.
- [ ] Reject checkpoints whose inputs are missing, revoked, cross-room,
  signature-invalid, or inconsistent with the declared projection version.
- [ ] Add deterministic reopen behavior when a contradiction, correction,
  revocation, failed replication, or policy-invalidating record arrives.
- [ ] Add unit and browser coverage proving reload recovery, projection replay,
  invalid-input rejection, supersession, revocation, and reopening.

### Uncertainty And Candidate Actions

- [ ] Represent uncertainty source separately for measurement variance, model
  uncertainty, cross-source disagreement, missing alternatives, protocol risk,
  and decision-change uncertainty.
- [ ] Require numeric probabilities to bind a calibration method and frozen
  evaluation cohort. Preserve ordinal or set-valued uncertainty otherwise.
- [ ] Define signed candidate-action records for computation, retrieval, review,
  assay, and replication without granting the proposer allocation authority.
- [ ] Bind each action to affected hypotheses, predicted observations,
  falsifiers, exact protocol or workload, feasibility, independence, safety,
  and consent requirements.
- [ ] Record scientific cost as separate compute, money, labor, instrument,
  sample, and elapsed-time components.
- [ ] Bind every action ranking to its policy, method, version, parameters, input
  hashes, cost assumptions, calibration evidence, and heuristic or calibrated
  status.
- [ ] Expose the admitted candidate set, rejected actions, raw value components,
  selected action, and human approval state in the Poolday UI.

### Protein Uncertainty Campaign

- [ ] Admit version-pinned public sequence, structure, domain, annotation,
  publication, assay, negative-result, and failed-attempt evidence with source,
  transformation, condition, license, and retrieval provenance.
- [ ] Build a queue that prioritizes proteins where exact-contract embeddings,
  public annotations, reviewers, and experimental evidence disagree.
- [ ] Freeze a baseline research policy before using hidden or future outcomes
  to compare action selection.
- [ ] Measure information gained per action, contradiction-resolution cost,
  duplicate work avoided, uncertainty calibration, and performance on held-out
  protein families.
- [ ] Preserve negative, failed, and ambiguous outcomes in retrieval and action
  selection even when they do not support a conclusion.
- [ ] Keep ESM-2 as the only enabled Poolday protein model until another model
  view passes its own artifact, workload, runtime, receipt, policy, and surface
  admission gates.

### Laboratory And Replication Boundary

- [ ] Define capability, institution, protocol-custody, consent, safety, and
  availability records for participating laboratories and instrument operators.
- [ ] Require approved work orders to bind controls, conditions, readouts,
  normalization, uncertainty, analysis identity, failure categories, custody,
  and publication scope before allocation.
- [ ] Plan replication against declared independence dimensions instead of
  identity-root difference alone.
- [ ] Define predeclared provisional acceptance, continued uncertainty,
  rejection, reopening, and closure criteria.
- [ ] Keep biological interpretation, medical use, unsafe protocols, private
  samples, and laboratory authority outside Poolday until separately admitted.

### Scientific-Policy Promotion

- [ ] Define the Zero candidate schema for hypothesis decomposition, uncertainty
  estimation, contradiction detection, and action-selection policy proposals.
- [ ] Freeze historical and prospective Discovery Contract cohorts before X
  evaluates a candidate in Shadow.
- [ ] Enforce candidate, evaluator, approver, and Poolday policy-owner separation
  at the promotion gate.
- [ ] Compare each candidate with a fixed baseline on cost to the same declared
  conclusion, action count, failure detection, held-out generalization,
  replication, safety, and rollback.
- [ ] Require human approval, Poolday-owned configuration, operational proof,
  revocation, and rollback before activation.
- [ ] Record realized action value after reviewed outcomes so a contribution is
  rewarded for measured downstream usefulness rather than activity alone.

### North-Star Evidence

- [ ] Freeze the baseline policy, cost representation, conclusion criteria,
  independence criteria, and aggregation method before reporting improvement.
- [ ] Report median real-world cost to a predeclared independently replicated
  conclusion relative to that baseline.
- [ ] Keep peers, jobs, receipts, records, claims, and total compute as
  operational metrics, not success metrics.

---

## Explicit Non-Goals

- [ ] Do not launch paid settlement or payouts before accepted receipts and reputation work publicly.
- [ ] Do not claim hardware attestation.
- [ ] Do not make broad `/pool/**` Firebase backend rewrites.
- [x] Do not deep-import Doppler internals.
- [ ] Do not let UI copy exceed `pool-config.json` claims.
- [x] Present Reploid as the public product brand and substrate identity.
- [ ] Do not treat Cloud Run or Firestore as the permanent Reploid authority.

---

## Done Definition

- [x] Deployed `/pool/deployment/check` returns `ok: true`.
- [x] Public smoke passes against the hosted surface.
- [x] The browser-room code path can run `/compute` providers and `/ask` requester logic without coordinator job creation, collect accepted receipts, and reduce signed points plus reputation events locally.
- [x] A browser smoke can open `/compute` and `/ask`, receive an accepted receipt, and expose local points plus reputation projection in the visible UI.
- [x] A user can do the same against published model artifacts on the hosted surface.
- [x] Prompt, output, and full receipt payloads move over WebRTC DataChannel by default, with coordinator signaling restricted to WebRTC metadata.
- [x] Browser-room ring policy agreement happens through WebRTC provider sessions and produces accepted receipt sets plus agreement hashes.
- [x] Same-origin browser-room target path works without required Reploid server control-plane calls: peers discover local adverts, route signed intents, elect providers, reach quorum, countersign acceptance, and produce signed reputation events.
- [x] Wider room path works with optional metadata relay and without required Reploid server job, assignment, quorum, acceptance, points, or reputation authority.
- [ ] Wider peer graph path works without any Reploid server relay across remote browsers.
- [x] The receipt binds model hash, manifest hash, runtime, backend, generation config, output hash, token ids hash or documented warning, provider signature, verifier decision, and requester acceptance.
- [x] Docs, config, UI copy, and verifier claims match.

---

*Last updated: August 2026*
