# Reploid Pool TODO

Reploid is testing whether a proof-carrying Research Room improves adjudication
of disputed family or domain annotations in one named public protein catalog.
The broader protein-evidence network remains a target hypothesis until that
frozen comparison passes. Browser providers, peer transit, receipts,
verification, and reputation are supporting mechanisms rather than product
outcomes. Public-facing product copy should use Reploid.

The first product proof must improve adjudication quality at comparable curator
effort or reduce curator effort without reducing quality. Receipt-backed browser
inference does not establish biological function, mutation fitness,
experimental truth, honest hardware, or product value by itself.

Canonical claim and deployment truth stay in [`pool-config.json`](./pool-config.json). Architecture and production contracts stay in [`../../docs/browser-inference-pool.md`](../../docs/browser-inference-pool.md). Repository mission lives in [`../../GOALS.md`](../../GOALS.md), [product intent](../../docs/poolday/product-intent.md) applies it to Poolday, and the [Discovery Contract](../../docs/poolday/discovery-contract.md) owns its target atomic object and gates.

The current Cloud Run and Firestore path is transitional. The target Reploid control plane is WebRTC peer-to-peer: signed job intents, provider capability adverts, assignment selection, quorum agreement, receipts, acceptance, points, and reputation should move without a required Reploid server.

---

## Current Local Checks

- [x] `npm run verify:pool -- --allow-placeholders` passes locally.
- [x] `npm run verify:browser-bundle:local` binds every Firebase-served `self/`
  file byte except its self-referential descriptor; the deployed verifier matched
  all 558 declared paths on the repository HTTP server and the release gate
  rejected the dirty Git tree.
- [x] The coordinator independently reproduced a 705-file runtime bundle hash
  over its executed source and locked inputs; hosted readiness now requires a
  commit-tagged image and the release verifier compares live and local runtime bytes.
- [x] Unit suite passes: 1,819 passed and 25 skipped.
- [x] Integration suite passes: 364 passed and 9 skipped.
- [ ] Re-run `npm run verify:pool:release -- --url https://replo.id --channel=chrome` after deployment. The August 15 read-only deploy-surface check found stale Poolday component CSS, controls, Research Room view, Pool SDK, and peer-room bytes. Local candidate evidence is not release evidence.
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
- [ ] Re-establish production verification against `https://replo.id` with the current local config version and hash. The August 15 read-only check found deployed config `2026-08-01.sequence-model-contracts.v1.doppler-0.5.1` / `sha256:fc0ba849664ed5494c8225f410b0a5178858ce3c6036cbcdf6b2313df1b10fd9`, no source revision, no commit-tagged image binding, no coordinator runtime identity, and no Cloud Run platform revision. A historical readiness result for an earlier release is not current browser or promotion evidence.
- [x] Run public smoke against `https://reploid.web.app` and cover `/`, `/ask`, `/compute`, `/records`, `/history`, `/network`, and `/zero` plus the synthetic peer flow.
- [x] Prove the primary WebRTC loop on the hosted surface: requester intent, provider model load and advert, deterministic assignment, real Doppler generation, signed receipt agreement, verifier decision, requester acceptance, points event, and reputation event.
- [x] Prove the separate optional hosted diagnostic loop through provider
  registration, assignment claim, commit, reveal, and expired-assignment
  recovery. The canonical local episode admits only a signed public-sequence
  assignment shell, keeps raw sequence bytes in the requester-to-provider input
  payload, expires two claimed providers, advances the ring attempt, opens
  pre-compute signaling, reaches two-receipt quorum, and records requester
  acceptance, points, and reputation. Evidence:
  `tests/unit/pool-hosted-diagnostic.test.js`. This is local route-and-client
  proof, not deployed cross-host WebRTC evidence.

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
  one exact release-bound receipt. On 2026-08-15 the strict Chromium lane fetched
  the pinned GCS artifacts from `http://localhost:8000`, executed ESM-2 on WebGPU,
  produced a signed peer result, and restored the verified OPFS cache after reload.
  The production verifier now probes deployed CORS for every governed origin.
  A two-provider WebGPU quorum also produced matching output with distinct
  provider identities and provider-bound receipt hashes.
  A 1,000-residue actual request also survived requester reload as an explicit,
  non-automatic retry/discard decision with no late result published in the new page.
  The persisted interruption observation proves that the provider had entered
  `Computing` before reload and records the discard path. A second actual-browser
  probe records the explicit retry path: retry creates a distinct assignment,
  stays queued while the abandoned execution retains the provider's single-job
  slot, and produces a newly accepted receipt only after the old runtime promise
  settles. The actual Chromium probe now covers the full 1,024-residue public
  limit with separate bounded queue and post-start receipt deadlines. Queue and
  start messages are assignment-bound transport evidence, not signed receipts;
  the probe does not establish automatic resume, exactly-once execution, or the
  ordinary production deadline on that browser backend.
  A separate after-start cancellation requested the execution's abort signal,
  invalidated late output, closed the provider session, and published no receipt;
  the current Doppler sequence handle exposes no session-level abort method, so
  that observation does not prove when already-submitted GPU work stopped.
  A separate strict-preflight probe rejected mutated manifest bytes carrying a
  forged self-declared configured hash before shard fetch or provider advertisement;
  a second actual Chromium probe then mutated a same-size manifest-declared OPFS
  shard through Doppler's public storage surface. Poolday hashed both shards and
  the tokenizer before load, invalidated the exact-model cache on the BLAKE3
  mismatch, fetched both immutable shards again, and reproduced the baseline
  output under a distinct accepted receipt.
  A separate actual ESM-2 probe held a completed backend result at a
  qualification-only release barrier, invalidated its work epoch, and observed
  `StaleResultError` before receipt construction.
  Those dirty-worktree smoke runs are not a clean-release qualification receipt;
  the release runner now derives a clean commit/tree identity, verifies every
  deployed browser-bundle byte, and injects both identities into each lane, but
  that mechanism has not yet run against a matching clean deployment. It also
  requires the Cloud Run commit-tagged image, platform revision, and 705-file
  coordinator runtime hash to match the same checkout. It then copies and hashes
  all nine Playwright lane reports before the shared reporter
  path is overwritten, requires every lane attachment to repeat the same release
  identity, and writes one non-promotable release-evidence index;
  the interruption, cancellation, corruption, recovery, and stale-result observations are
  not bound to the primary output, and two independently operated browser
  identities remain unproven in the Poolday qualification record.
- [x] Add provider hardening for duplicate peer sessions, provider busy rejection, stopped nodes, and completed session cleanup.
- [x] Restore an opted-in peer provider after refresh or tab visibility recovery with the same role identity and warm OPFS model.
- [x] Recover hosted diagnostic assignments after expiration or a reveal miss.
  Expiration records the exact failed phase, applies its timeout penalty once,
  and drains retryable jobs from requester, provider, commit, reveal, receipt,
  and failure entrypoints. A replacement carries the prior assignment and ring
  attempt, failed assignment IDs, and failure reasons; an eligibility-blocked
  drain remains queued without incrementing the assignment attempt. Evidence:
  `tests/unit/pool-routes.test.js`,
  `tests/unit/pool-coordinator-transitions.test.js`, and
  `tests/unit/pool-firestore-peer-room.test.js`.

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

## First Product Proof

- [x] Make the Research Room the primary researcher workflow and keep Zero and X out of ordinary navigation.
- [x] Separate the complete immutable archive from named-policy decision memory.
- [x] Retrieve exact public-sequence evidence across rooms without inheriting origin acceptance.
- [x] Bind reusable family/domain annotations to source version, declared license, ontology release, exact sequence, and normalized coordinates.
- [x] Require a signed origin/current context comparison and independent current-room relevance determination.
- [x] Collapse duplicate declared source identities into one candidate and one possible memory contribution while retaining every origin record.
- [x] Preserve supersession authority in explicit accepted corrections and authorized revocations rather than version strings or timestamps.
- [x] Define frozen annotation-adjudication experiment and independently authored evaluation records with paired quality-or-effort gates.
- [ ] Name the exact public catalog, curator role, recurring disputed decision, current workflow, adopter, and frozen family-disjoint cohort.
- [ ] Run the prospective comparison and publish accepted evidence showing that one predeclared success path passed.

---

## Proof-Carrying Protein Evidence Network

These gates extend the current public protein evidence path. They do not expand
the supported public claim until the matching implementation, test, surface
claim, and deployment evidence exist.

### Governed Research Room Cycle

- [x] Project the seven-stage question, execution, provenance, disagreement,
  review, accepted-memory, and next-question loop from signed room records.
- [x] Keep replication requests and conflicting reviewer decisions outside
  accepted room memory.
- [x] Restrict scientific next-action basis hashes to accepted memory while
  allowing governance actions to expose provisional evidence gaps.
- [x] Permit agent-authored hypotheses, prior evidence, predictions, and work
  orders without granting agents review, approval, memory, or execution
  authority.
- [x] Require accepted compute agreement and reusable compute memory to bind at
  least two distinct receipt identities and two distinct provider identities.
- [x] Bind task approval to the exact projected rationale, basis, target, and
  ranking policy so stale approval cannot authorize changed work.
- [x] Require cohort predictions, work orders, outcomes, and the cohort itself
  to pass independent acceptance before evaluation consumes them.
- [x] Cover the governed projection, contextual review, reload recovery,
  question contract, agent authority, and browser evidence journey.

### Discovery Contract Projection

- [x] Define a domain-separated signed contract-checkpoint record that binds the
  question, parent revisions, Poolday policy, versioned projection contract and
  manifest artifact, ordered input records, and checkpoint signer.
- [x] Derive one deterministic contract state from signed question, hypothesis,
  prior-evidence, prediction, result, claim, work-order, work-claim, outcome,
  cohort, evaluation, correction, and revocation records.
- [x] Reject checkpoints whose inputs are missing, whose active inputs are
  revoked or invalidated, or whose records are cross-room, signature-invalid,
  stale, or inconsistent with the declared projection version. Revoked records
  remain in the complete archive input set.
- [x] Add deterministic reopen behavior when a contradiction, correction,
  revocation, failed replication, or policy-invalidating record arrives.
- [x] Add unit and browser coverage proving reload recovery, projection replay,
  invalid-input rejection, supersession, revocation, and reopening.

### Uncertainty And Candidate Actions

- [x] Represent uncertainty source separately for measurement variance, model
  uncertainty, cross-source disagreement, missing alternatives, protocol risk,
  and decision-change uncertainty.
- [x] Require numeric probabilities to bind a calibration method and frozen
  evaluation cohort. Preserve ordinal or set-valued uncertainty otherwise.
- [x] Define signed candidate-action records for computation, retrieval, review,
  assay, and replication without granting the proposer allocation authority.
- [x] Bind each action to affected hypotheses, predicted observations,
  falsifiers, exact protocol or workload, feasibility, independence, safety,
  and consent requirements.
- [x] Record scientific cost as separate compute, money, labor, instrument,
  sample, and elapsed-time components.
- [x] Bind every action ranking to its policy, method, version, parameters, input
  hashes, cost assumptions, calibration evidence, and heuristic or calibrated
  status.
- [x] Expose the admitted candidate set, rejected actions, raw value components,
  selected action, and human approval state in the Poolday UI.

### Protein Uncertainty Campaign

- [x] Admit version-pinned public sequence, structure, domain, annotation,
  publication, assay, negative-result, and failed-attempt evidence with source,
  transformation, condition, license, and retrieval provenance.
- [x] Build a queue that prioritizes proteins where exact-contract embeddings,
  public annotations, reviewers, and experimental evidence disagree.
- [x] Freeze a baseline research policy before using hidden or future outcomes
  to compare action selection.
- [x] Measure information gained per action, contradiction-resolution cost,
  duplicate work avoided, uncertainty calibration, and performance on held-out
  protein families.
- [x] Preserve negative, failed, and ambiguous outcomes in retrieval and action
  selection even when they do not support a conclusion.
- [x] Enforce ESM-2 as the only enabled Poolday protein model until another model
  view passes its own artifact, workload, runtime, receipt, policy, and surface
  admission gates.

### Laboratory And Replication Boundary

- [x] Define capability, institution, protocol-custody, consent, safety, and
  availability records for participating laboratories and instrument operators.
- [x] Require approved work orders to bind controls, conditions, readouts,
  normalization, uncertainty, analysis identity, failure categories, custody,
  and publication scope before allocation.
- [x] Plan replication against declared independence dimensions instead of
  identity-root difference alone.
- [x] Define predeclared provisional acceptance, continued uncertainty,
  rejection, reopening, and closure criteria.
- [x] Keep biological interpretation, medical use, unsafe protocols, private
  samples, and laboratory authority outside Poolday until separately admitted.

### Scientific-Policy Promotion

- [x] Define the Zero candidate schema for hypothesis decomposition, uncertainty
  estimation, contradiction detection, and action-selection policy proposals.
- [x] Freeze historical and prospective Discovery Contract cohorts before X
  evaluates a candidate in Shadow.
- [x] Enforce candidate, evaluator, approver, and Poolday policy-owner separation
  at the promotion gate.
- [x] Compare each candidate with a fixed baseline on cost to the same declared
  conclusion, action count, failure detection, held-out generalization,
  replication, safety, and rollback.
- [x] Require human approval, Poolday-owned configuration, operational proof,
  revocation, and rollback before activation.
- [x] Record realized action value after reviewed outcomes so a contribution is
  rewarded for measured downstream usefulness rather than activity alone.

### North-Star Evidence

- [x] Freeze the baseline policy, cost representation, conclusion criteria,
  independence criteria, and aggregation method before reporting improvement.
- [ ] Report median real-world cost to a predeclared independently replicated
  conclusion relative to that baseline.
- [x] Keep peers, jobs, receipts, records, claims, and total compute as
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
