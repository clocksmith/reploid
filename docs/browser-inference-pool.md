# Poolday Browser Inference

Poolday is the docs/internal name for the receipt-backed browser inference pool.
The public UI for this surface uses the Reploid name. Do not expose Poolday as user-facing product copy unless that naming decision changes.

Reploid supplies the governed browser substrate underneath the pool surface.

The product claim is narrow:

```text
receipt-backed, audit-backed, reputation-backed, policy-controlled browser inference
```

Do not describe this as trustless compute, hardware-attested inference, or guaranteed honest GPU execution. A browser provider can sign an assignment-bound artifact, but normal browser execution cannot prove that the tab was not tampered with.

---

## Product routes

| Route | Purpose |
|-------|---------|
| `/` | Public Reploid model-serving home. Docs/internal surface name: Poolday |
| `/ask` | Requester prompt flow and local acceptance |
| `/compute` | Browser worker peer listener with manual hosted diagnostics |
| `/history` | Job history, hash lookup, and local artifact verification |
| `/network` | Peers, scores, room state, pool metrics, and deployment check |
| `/zero` | Zero research Reploid surface |
| `/x` | X mature Reploid agent surface |

---

## Launch model contract

```json
{
  "modelId": "gemma-3-270m-it-q4k-ehf16-af32",
  "modelHash": "sha256:6e9c0037ca1508855c441a4da1a0916a347f0901779549d6a70381bc5089a4b9",
  "manifestHash": "sha256:cdc1d7a596fd2314c32da553c908a1aa6183abe056bc272c249b0a084c127a16",
  "runtime": "doppler",
  "backend": "browser-webgpu",
  "dopplerLoadRef": "gemma3-270m"
}
```

`dopplerLoadRef` is the public Doppler registry alias used by the browser runtime. It is not the receipt identity. Receipts bind the full model id, model hash, manifest hash, runtime, and backend.

## Offloaded model artifacts

Model bytes should not be served from Firebase Hosting or the Cloud Run coordinator. The launch path is offloaded, content-addressed artifact hosting:

| Artifact | Path shape |
|----------|------------|
| Manifest | `<modelId>/<manifestHash>/manifest.json` |
| Tokenizer | `<modelId>/<manifestHash>/tokenizer.json` |
| Shards | `<modelId>/<manifestHash>/shards/*` |

Browser providers derive artifact URLs from `window.REPLOID_POOL_MODEL_BASE_URL` through `self/pool/model-contract.js`. The storage backend can be object storage, a model hub, IPFS, or another CDN. The receipt identity does not include the storage URL; it includes the exact model id, model hash, manifest hash, runtime, and backend. Providers cache fetched model artifacts in OPFS after first load.

Current hosted implementation order:

1. Cloud control plane for assignment, verification, points, and reputation.
2. Offloaded model artifacts with manifest hash checks.
3. P2P prompt, output, and full receipt payloads.
4. P2P ring traffic for quorum policies.

Target migration order:

1. Signed peer-message envelopes.
2. WebRTC peer discovery and job-intent gossip.
3. Deterministic peer-side assignment and ring formation.
4. WebRTC commit/reveal, receipt, and acceptance exchange.
5. Replicated receipt, points, and reputation event log.

---

## Deterministic generation contract

```json
{
  "mode": "greedy",
  "temperature": 0,
  "topK": 1,
  "topP": 1,
  "maxOutputTokens": 128,
  "seed": "0000000000000000"
}
```

The server rejects job requests that do not exactly match this generation config.
The signed receipt binds this exact object. At execution time only, `self/pool/doppler-runtime.js` translates `maxOutputTokens` to Doppler's public `maxTokens` option and passes greedy sampling as `temperature: 0`, `topK: 1`, and `topP: 1`. The translated Doppler options are not the receipt hash input.

---

## Policies

| Policy | Trust tier | Routing behavior |
|--------|------------|------------------|
| `fastest_receipt` | `T1_signed_receipt` | One eligible browser provider returns a signed assignment-bound receipt |
| `canary_audited` | `T2_canary_audited` | One eligible browser provider with passing canary history returns a signed receipt |
| `redundant_agreement` | `T3_redundant_agreement` | Multiple independent browser providers must return matching output and token hashes |
| `ring_quorum_receipt` | `adaptive_T1_to_T4_ring_quorum_receipt` | One to twelve exact-model browser providers run the same deterministic assignment in a deterministic ring; majority matching token/output hashes form the accepted result |

## Ring quorum policy

`ring_quorum_receipt` is the scalable trust policy. It uses a Paxos-like quorum rule over a deterministic provider ring, capped at twelve providers.

Ring behavior:

- `N = 1`: `T1_ring_baseline`; one provider returns a normal signed receipt with ring metadata. This is a baseline receipt, not distributed trust.
- `N = 2`: `T2_paired_ring_receipt`; two providers must agree. This improves tamper detection but remains weak against collusion.
- `N = 3`: `T3_majority_ring_receipt`; any two matching receipts form quorum. This is the best default trust/latency balance.
- `N = 4`: `T4_max_ring_quorum_receipt`; any three matching receipts form quorum.
- `N = 12`: `T4_max_ring_quorum_receipt`; any seven matching receipts form quorum. This is the maximum launch browser-room ring size.

In hosted compatibility mode, the coordinator selects up to twelve fresh, available, exact-model providers from a compatible runtime profile bucket, derives a deterministic ring order from the job and provider set, and writes the same ring commitment into each assignment. In the browser-room peer path, the requester collects signed provider adverts, derives the same deterministic assignment plan locally, opens one WebRTC session per selected provider, and accepts only a receipt set that reaches the configured hash quorum. Each provider still runs full-model Doppler inference locally through the public browser runtime. Reploid does not claim distributed KV sharding or ring-reduced attention until Doppler exposes those public execution surfaces.

Ring agreement checks:

- same assignment, prompt hash, model identity, runtime identity, runtime profile bucket, and generation config;
- current assignment attempt only, including `assignmentAttemptId` and `ringAttemptId`, so receipts from failed prior attempts do not count toward a retry;
- provider signature on every receipt;
- ring id, seed, attempt id, layout hash, provider index, predecessor, successor, and provider set;
- commit-reveal evidence before receipt submission, so providers must anchor private output commitments before reveal payloads can be copied;
- quorum over matching `tokenIdsHash` plus `outputHash`;
- per-provider invalid receipt or execution failure accounting while the remaining current assignments can still reach quorum;
- requester acceptance before points and reputation mutation.
- accepted quorum retires non-quorum sibling assignments so leftover providers are released and later timeouts cannot downgrade the verified job.
- assignment expiration is evaluated as a failed member of the current agreement attempt. The job fails only when the remaining current assignments cannot still satisfy quorum.
- impossible quorum advances the assignment attempt and ring attempt when eligible providers remain. Late receipts from the previous attempt are stale and cannot count.

Requester acceptance must bind the economic and agreement object:

- `jobId`
- `policyId`
- primary `receiptHash`
- accepted `receiptHashes`
- compact agreement fields
- `agreementHash`
- provider point split
- total point spend

Honest claim:

> A coordinator-ordered provider ring produced quorum-matching signed receipts for the same deterministic browser-local inference assignment.

Not claimed:

> Collusion is impossible, the browser is hardware-attested, or distributed attention/KV execution happened.

No policy allows fallback models or server providers.

---

## Determinism, admission, and commit-reveal

The ring policy is governed by explicit config lanes:

| Lane | Active id | Purpose |
|------|-----------|---------|
| Determinism | `strict_hash_same_runtime_profile` | Strict token/output hash quorum is valid only inside the same model/runtime/browser/WebGPU/kernel profile bucket. |
| Ring phase | `commit_reveal_v1` | Providers submit `commitmentHash` before reveal. Receipts are rejected until matching reveal evidence exists. |
| Provider admission | `tiered_browser_provider_v1` | New providers are capped, trusted providers earn higher trust, quarantined providers cannot route. |
| State mode | `direct_firestore_projection_v1` | Current production mode stores direct job projections plus isolated receipts, commitments, reveals, ledger, and reputation records. |

Provider registration for ring-capable providers must include `runtimeProfile` and `runtimeProfileHash`. The coordinator recomputes the hash and rejects mismatches. Ring scheduling groups compatible runtime profiles and applies diversity rules so one identity/device/network/runtime cluster cannot satisfy quorum alone.

Commitment hash input:

```json
{
  "schema": "reploid.pool.commitment/v1",
  "jobId": "...",
  "assignmentId": "...",
  "ringAttemptId": "...",
  "providerId": "...",
  "outputHash": "sha256:...",
  "tokenIdsHash": "sha256:...",
  "transcriptHash": "sha256:...",
  "salt": "..."
}
```

The provider submits only `commitmentHash` during the commit phase. After the coordinator opens reveal, the provider submits output/token/transcript hashes plus salt. The server recomputes the commitment and rejects mismatches. A reveal mismatch records a provider penalty, marks the assignment failed for the current attempt, and re-evaluates quorum.

Receipts for ring assignments are accepted only after:

- assignment is current;
- reveal exists;
- reveal matches commitment;
- receipt hashes match reveal hashes;
- `receipt.verification.runtimeProfileHash` matches the assigned provider runtime profile hash.

---

## Coordinator endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/pool/policies` | List policy contracts and launch model |
| `GET` | `/pool/status` | Return safe product status, policy, storage, auth, and trust-language facts |
| `GET` | `/pool/metrics` | Return provider, job, assignment, receipt, audit, and reputation counters for coordinator-authorized callers |
| `GET` | `/pool/deployment/check` | Return deployment readiness facts, trust language, and redacted public metrics |
| `POST` | `/pool/providers/register` | Register provider model, device, availability, and public key |
| `POST` | `/pool/providers/heartbeat` | Refresh provider session state |
| `GET` | `/pool/providers/assignments/next` | Poll next assignment for a provider |
| `POST` | `/pool/jobs` | Submit requester or agent job |
| `GET` | `/pool/jobs/:jobId` | Poll job state |
| `POST` | `/pool/assignments/:assignmentId/commit` | Submit ring assignment commitment hash |
| `POST` | `/pool/assignments/:assignmentId/reveal` | Reveal ring assignment hashes and salt after the commit barrier opens |
| `POST` | `/pool/assignments/:assignmentId/receipt` | Submit provider output plus signed receipt |
| `POST` | `/pool/assignments/:assignmentId/failure` | Report provider execution failure and make the job retryable |
| `POST` | `/pool/receipts/:receiptHash/accept` | Submit requester countersignature and accept or reject result |
| `GET` | `/pool/receipts/:receiptHash` | Fetch receipt artifact for inspection |
| `POST` | `/pool/signaling/sessions` | Create assignment-bound WebRTC signaling session |
| `GET` | `/pool/signaling/sessions/:sessionId` | Fetch signaling session metadata |
| `POST` | `/pool/signaling/sessions/:sessionId/messages` | Publish SDP/ICE signaling metadata |
| `GET` | `/pool/signaling/sessions/:sessionId/messages` | Poll SDP/ICE signaling metadata |
| `POST` | `/pool/audits/canary` | Create hidden deterministic canary assignment for a provider |
| `GET` | `/pool/audits/:auditId` | Inspect canary audit state |
| `GET` | `/pool/points/:userId` | Fetch points ledger events |
| `GET` | `/pool/reputation/:providerId` | Fetch provider reputation state |

---

## Current hosted and peer-room modes

The current hosted mode is `hybrid_p2p_anchor`. In this mode, WebRTC is the primary transit for inference payloads and the browser-ring agreement path. The cloud coordinator is still the bootstrap, policy, receipt, and ledger anchor for hosted diagnostic and API flows. Treat this as a transitional deployment shape, not the final Reploid control plane.

The primary browser-room path used by `/ask` and `/compute` does not create hosted jobs or poll hosted assignments. It uses signed peer intents, signed provider adverts, deterministic local assignment, WebRTC DataChannel prompt delivery, provider receipts, local receipt agreement, requester countersignature, and signed points/network events. Local rooms use same-origin `BroadcastChannel`. Remote rooms can use the optional `/pool/peer/rooms/:roomId/messages` metadata relay for signed room envelopes and WebRTC signaling. The relay does not create jobs, assign providers, decide quorum, mutate reputation, or carry prompt/output/full receipt/model payloads.

| Layer | Owner |
|-------|-------|
| Job id, assignment hash, policy, model identity | Browser-room requester locally, cloud coordinator for hosted compatibility |
| SDP/ICE rendezvous metadata | BroadcastChannel locally, optional peer-room metadata relay remotely |
| Prompt payload | WebRTC DataChannel |
| Output payload | WebRTC DataChannel |
| Full receipt payload | WebRTC DataChannel or content-addressed off-cloud storage |
| Provider-to-provider ring payloads | WebRTC DataChannel |
| Quorum agreement transcript | Browser ring over WebRTC; hosted flow can anchor hashes in cloud |
| Receipt hash, agreement hash, requester acceptance, ledger mutation | Browser-room signed events; cloud coordinator for hosted compatibility |
| Points and reputation | Deterministic browser-room reducer; cloud coordinator for hosted compatibility |

Cloud signaling and peer-room relay messages are metadata only. Prompts, outputs, token streams, full receipts, model shards, and ring payloads should not be sent through signaling or relay endpoints. Direct peer connection uses STUN where possible. TURN is a fallback for restrictive NATs and should be treated as paid bandwidth risk.

Browser modules:

```javascript
import { createPoolSdkSignalingAdapter, createSignalingChannel } from './pool/p2p-signaling.js';
import { createAssignmentP2PPayloadChannel, createP2PRequesterTransport, createP2PProviderTransport } from './pool/p2p-transport.js';
import { createPromptPayload, createExecutionResultPayload, createReceiptPayload } from './pool/p2p-payload.js';
import { createPeerControlPlane, buildPeerAssignmentPlan } from './pool/peer-control-plane.js';
import { createPeerProviderNode, runPeerJob } from './pool/peer-room.js';
import { createPeerRoomBusFactory } from './pool/peer-rendezvous.js';
```

`createAssignmentP2PPayloadChannel()` creates or attaches to the cloud signaling session, builds the WebRTC signaling channel, and sends versioned prompt/output/receipt envelopes only through the DataChannel transport. The SDK signaling routes carry only offer, answer, ICE candidate, close, and ping messages. Ring payload sessions can be rejected until the coordinator opens the configured reveal gate; this keeps pre-reveal provider outputs from becoming copyable P2P data.

In the current hosted mode, the cloud remains authoritative for abuse gates, policy admission, receipt anchoring, requester acceptance, points, reputation, and canary policy. It should not carry the main inference payload or decide model-result agreement by itself. WebRTC DataChannel is the main transit. For ring policies, browser providers exchange commit/reveal and receipt payloads over WebRTC, reach agreement on matching output and token hashes, then anchor the resulting receipt and agreement hashes through the coordinator.

## Target decentralized control plane

The target Reploid control plane is also peer-to-peer. The coordinator should disappear from the normal path. Any server should be optional bootstrap, public anchor, or compatibility bridge.

The browser implementation starts in `self/pool/peer-control-plane.js`, `self/pool/peer-room.js`, and `self/pool/peer-rendezvous.js`. The control-plane module defines signed peer messages, prompt payload validation, deterministic peer assignment planning, receipt agreement, signed ledger events, DataChannel-compatible peer buses, and deterministic points/network reducers. The peer room module wires the visible `/ask` and `/compute` paths through signed peer intents, provider adverts, WebRTC signaling, DataChannel prompt delivery, multi-provider receipt return, quorum agreement, requester countersignature, and ledger-event gossip without hosted job creation or hosted assignment polling. The rendezvous module supplies local BroadcastChannel rooms, in-memory test rooms, shareable invite URLs, and optional metadata relay buses.

| Layer | Target owner |
|-------|--------------|
| Peer identity | Local signing keys plus optional external identity attestations |
| Peer discovery | WebRTC peer graph with optional bootstrap rendezvous |
| Provider capability advertisement | Signed peer messages over WebRTC |
| Job intent | Signed requester or agent intent gossiped over WebRTC |
| Assignment selection | Deterministic local protocol from intent hash, provider adverts, policy, model identity, runtime profile, and reputation evidence |
| Prompt payload | WebRTC DataChannel |
| Output payload | WebRTC DataChannel |
| Commit/reveal payloads | WebRTC DataChannel |
| Quorum agreement | Browser ring consensus over WebRTC |
| Receipt acceptance | Requester or agent countersignature over WebRTC |
| Points and reputation | Replicated receipt/event log with deterministic reducers |
| Public anchoring | Optional hash publication, not control-plane authority |

The destination flow is: requester signs an intent, peers route it, eligible providers self-select through the policy protocol, providers exchange commits and reveals, the ring reaches agreement, the requester countersigns the accepted receipt set, and peers gossip the resulting receipt and reputation events. Servers can help peers find each other, but they should not be required to create jobs, assign providers, decide consensus, or mutate reputation.

Requester and provider clients expose the peer lane directly:

```javascript
const intent = await requester.createPeerJobIntent({ prompt, policyId, modelRequirements });
const advert = await provider.createPeerProviderAdvert();
const plan = await buildPeerAssignmentPlan({ jobIntent: intent.intent, providerAdverts: [advert] });
const promptPayload = await requester.createPeerPromptPayload({ assignment: plan.assignment, prompt: intent.prompt });
const result = await provider.executePeerAssignment(plan.assignment, { promptPayload });
```

The visible browser routes use the room wrapper:

```javascript
const providerNode = createPeerProviderNode({ roomId, providerClient });
await providerNode.start({ models });

const result = await runPeerJob({ roomId, requesterClient, prompt, modelRequirements });
```

## SDK calls

```javascript
const sdk = createPoolSdk(); // Sends Firebase bearer tokens automatically when available.

await sdk.policies();
await sdk.status();
await sdk.metrics();
await sdk.deploymentCheck();
await sdk.submitJob(request);
await sdk.pollJob(jobId);
await sdk.getReceipt(receiptHash);
await sdk.acceptReceipt(receiptHash, acceptance);
await sdk.createSignalingSession({ assignmentId });
await sdk.publishSignal(sessionId, signal);
await sdk.listSignals(sessionId, { peerId });
await sdk.createCanaryAudit(payload);
await sdk.reputation(providerId);

const provider = createProviderClient();
await provider.runWorkerStep();
```

Requester and agent clients sign acceptance payloads with browser-generated ECDSA keys. Provider clients sign pool receipts with browser-generated ECDSA keys.

---


## Browser identity

Pool browser clients use `self/pool/identity.js`. The browser SDK sends a Firebase bearer token when Firebase Auth is available. The identity module calls `self/pool/firebase-auth.js`, which can bootstrap Firebase Auth from Firebase Hosting `/__/firebase/init.json` or from an injected config.


Browser Firebase configuration options:

```javascript
window.REPLOID_POOL_FIREBASE_CONFIG = { /* Firebase web app config */ };
window.REPLOID_FIREBASE_APP_MODULE_URL = 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
window.REPLOID_FIREBASE_AUTH_MODULE_URL = 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
```

On Firebase Hosting, `/__/firebase/init.json` can provide the config without injecting `REPLOID_POOL_FIREBASE_CONFIG`. Deployments may override module URLs to pin a reviewed Firebase Web SDK version.

Identity resolution order:

1. Firebase anonymous auth, when a compatible Firebase Auth object is present on `window.REPLOID_FIREBASE_AUTH`, `window.REPLOID_POOL_FIREBASE_AUTH`, or the Firebase compat `window.firebase.auth()` surface.
2. Local anonymous identity stored in `localStorage`.

Role ids are derived per mode:

- `requester_<uid>`
- `provider_<uid>`
- `agent_<uid>`

Each role also gets a persisted ECDSA signing keypair in local browser storage. Providers use it to sign receipts. Requesters and agents use it to countersign acceptance or rejection. This is browser-local key persistence, not hardware-backed attestation.

Server auth configuration:

```bash
POOL_VERIFY_FIREBASE_AUTH=true
POOL_REQUIRE_FIREBASE_AUTH=true
```

`POOL_VERIFY_FIREBASE_AUTH=true` verifies bearer tokens when supplied. `POOL_REQUIRE_FIREBASE_AUTH=true` rejects unauthenticated pool requests. Firestore mode also forces Firebase-authenticated access for all non-readiness pool routes even if `POOL_REQUIRE_FIREBASE_AUTH` is missing.

When a Firebase token is verified, the coordinator binds the UID to role ids. A user with UID `abc` can act as `requester_abc`, `agent_abc`, or `provider_abc` only. Provider registration, provider heartbeat, assignment polling, job submission, job polling, receipt submission, receipt acceptance, authenticated receipt lookup, points lookup, and audit lookup enforce this binding.

Canary creation is coordinator-controlled by default. Browser-created canaries require an explicit development flag:

```bash
POOL_ALLOW_BROWSER_CANARY_CREATE=true
```

Production canary creation should use a Firebase custom claim such as `poolCoordinator: true`, `coordinator: true`, or `admin: true`.



## Provider tab lifecycle

The provider tab does not need Node or Bun. Browser providers use `/compute`.

Primary peer provider flow:

1. Load the Doppler model through the browser WebGPU runtime.
2. Build a browser runtime profile from WebGPU adapter data, browser hints, Doppler runtime/backend, model identity, and shader/kernel profile hints.
3. Create a signed provider advert that binds model identity, runtime profile hash, availability, public key, and accepted policies.
4. Listen in a peer room for signed requester intents.
5. Accept a matching session, connect over WebRTC, receive the prompt over DataChannel, verify prompt hash and model identity, execute locally, return a signed receipt over DataChannel, and record local activity.
6. Receive requester acceptance over DataChannel.

The provider client still exposes `runWorkerStep()` for the hosted diagnostic loop. Manual controls under `/compute` can register, heartbeat, poll, execute, inspect points, and inspect reputation against the coordinator. Those controls are compatibility and operations tools, not the primary user path.

## Provider device evidence

Provider registration includes a `runtimeProfile` and `runtimeProfileHash`. The hash is the scheduler-facing grouping key for deterministic/homogeneous routing; the profile remains browser-provided evidence and is not hardware attestation.

Runtime profile fields include:

- `profileVersion`
- browser user agent, platform, brand hints, language, and configured browser hint
- WebGPU adapter vendor, architecture, device, description, features, and selected limits
- Doppler runtime, backend, public API surface, shader profile, kernel profile, and determinism profile hint
- launch model id, model hash, manifest hash, context length, and quantization

Provider registration also includes WebGPU device evidence when the browser exposes it:

- `hasWebGPU`
- `adapterInfo`
- `features`
- `limits`
- `hasF16`
- `hasSubgroups`
- `maxBufferSize`
- `probeStatus`

This evidence is stored in provider registration and the assigned `runtimeProfileHash` is copied into `receipt.verification.runtimeProfileHash`. It describes the claimed browser runtime environment. It is not hardware attestation.

## Browser commit/reveal consumption

Lane B does not define commit/reveal authority. It consumes coordinator routes:

```text
POST /pool/assignments/:assignmentId/commit
POST /pool/assignments/:assignmentId/reveal
POST /pool/assignments/:assignmentId/receipt
```

Provider execution computes the output privately, signs the receipt payload, builds the server-compatible commitment hash over assignment id, job id, ring attempt id, provider id, output hash, token ids hash, transcript hash, and salt, then submits that commitment. The browser commitment envelope also carries policy id, assignment attempt id, and receipt hash metadata for inspection, but those fields are not part of the canonical commitment hash. If the coordinator opens reveal, the browser submits the reveal payload containing the salt, raw output artifact, token ids, transcript, and signed receipt. Receipt submission follows reveal. If a coordinator has not yet implemented commit/reveal and the assignment does not mark it required, the browser records the unsupported phase and continues through the current receipt route for backwards compatibility.

## Receipt verification

The server verifier checks:

- Receipt version and trust tier
- Assignment, job, requester, provider, and policy ids
- Active assignment status before receipt submission
- Exact model id, model hash, manifest hash, runtime, and backend
- Separate receipt runtime/backend identity
- Stored prompt hash and submitted input hash
- Stored generation config hash and submitted generation config hash
- Output text hash
- Token id hash when token ids are supplied
- Transcript hash
- Provider signature
- Requester acceptance signature before points are awarded
- One final requester decision per job before ledger or reputation mutation
- Canary id when an assignment is an audit
- Redundancy group size when a policy requires agreement
- Ring attempt id when a policy uses a ring commitment
- Runtime profile hash when a policy requires homogeneous runtime buckets
- Commitment and reveal evidence when a policy uses commit-reveal

The browser SDK can also verify fetched receipt records locally using the provider public key and submitted output/token/transcript artifact.

---

## Points and reputation

Points are awarded only after:

- Provider receipt passes server verification
- Requester countersigns acceptance
- The selected policy has reached its final state
- The accepted result does not exceed the job's optional `maxPointSpend`

Accepted work creates provider `points_awarded` events and a requester or agent `points_spent` event. For redundant agreement and ring quorum, acceptance is blocked until there is a final matching receipt set. In the browser-room path, `buildPeerReceiptAgreement()` forms the accepted set and `createPeerLedgerEvents()` signs provider credit, requester debit, and reputation events that peers can reduce deterministically. In hosted compatibility mode, the coordinator performs the same acceptance gate and ledger projection. Ring quorum uses `ring_quorum_receipt_accepted` and `ring_quorum_receipt_spend` ledger reasons instead of redundant-agreement reasons.

Reputation records:

- Accepted receipts
- Rejected receipts
- Timeouts
- Canary pass/fail counts
- Routing block state
- Quarantine reason

Identity violations and failed canaries block routing.

Penalty ledger events are recorded with `eventType: "points_penalized"` for:

- `receipt_rejected`
- `assignment_timeout`
- `canary_failed`
- `redundant_agreement_mismatch`
- `ring_quorum_mismatch`

Repeated invalid receipts or attributable assignment timeouts set `routingBlocked` in reputation state. Model, manifest, runtime, or backend identity violations block routing immediately. Canary failure blocks routing with `quarantineReason: "canary_failed"` and can be cleared only by a later passing coordinator-issued canary.

---


## Firebase Hosting routing

Firebase Hosting serves the browser product from `self/`.

Product routes rewrite to `/index.html`:

- `/`
- `/ask`
- `/compute`
- `/history`
- `/network`
- `/zero`
- `/x`

The `/pool` namespace is split:

- Static browser modules such as `/pool/sdk.js` and `/pool/provider-client.js` are served from `self/pool/`.
- API paths such as `/pool/jobs`, `/pool/receipts/**`, and `/pool/providers/**` rewrite to the Cloud Run service `reploid-pool` in `us-central1`.

Do not add a broad `/pool/**` backend rewrite. It would capture the browser module files and break the app shell.

Firestore rules are deny-by-default because browser clients use the coordinator API, not direct Firestore reads or writes. The Firestore index file declares the compound `assignments(providerId, status)` query used by provider polling and heartbeat availability checks.

Cloud Run service requirements for `reploid-pool`:

```bash
PORT=8080
POOL_BACKEND_ONLY=true
POOL_STORE=firestore
POOL_VERIFY_FIREBASE_AUTH=true
POOL_REQUIRE_FIREBASE_AUTH=true
```

The container entrypoint is `node server/proxy.js`. The Dockerfile installs production dependencies with optional dependencies so `firebase-admin` is available when Firestore and Firebase Auth are enabled.

## Firebase store

Local development can use the in-memory store. Production deployment checks require both Firestore storage and Firebase Auth verification. Firebase deployments can select Firestore with:

```bash
POOL_STORE=firestore
```

When `POOL_STORE=firestore` is set, the server must initialize Firebase Admin and Firestore successfully. It does not fall back to memory in explicit Firestore mode. The Firestore adapter identifies itself as `firestore` for `/pool/deployment/check`. The check returns `ok: true` only when Firestore and Firebase auth verification are configured. The checked-in Firestore indexes target unprefixed collection names; if `POOL_FIRESTORE_PREFIX` is used, deploy matching prefixed indexes. The adapter uses these collections:

- `providers`
- `provider_sessions`
- `jobs`
- `assignments`
- `receipts`
- `receipt_acceptances`
- `commitment_events`
- `reveal_events`
- `pool_events`
- `signaling_sessions`
- `signaling_messages`
- `points_ledger`
- `reputation_state`
- `audit_challenges`

---

## Doppler boundary

Poolday must not deep-import Doppler internals for the pool product. The browser runtime adapter loads through the public Doppler facade and calls public generation methods on the loaded handle.

Firebase Hosting serves the app as browser ES modules. A hosted deployment must provide Doppler through a browser-resolvable public module URL or an attached public module/handle, and must provide a browser-resolvable Doppler WGSL kernel base URL for runtime shader fetches. Supported globals are `window.REPLOID_DOPPLER_MODULE_URL`, `window.REPLOID_DOPPLER_MODULE_URLS`, `window.REPLOID_DOPPLER_MODULE`, `window.REPLOID_DOPPLER_KERNEL_BASE_URL`, `window.REPLOID_DOPPLER_LOAD_OPTIONS`, and `window.REPLOID_POOL_ATTACH_DOPPLER_HANDLE(handle, model, runtimeInfo)`. Bare package imports are only a fallback for bundled or import-map deployments.

The adapter supports both public Doppler call shapes: `generate(prompt, options)` / `generateText(prompt, options)` and object-style provider calls using `{ prompt, samplingOptions }`. Pool policy names stay product-owned; only the adapter maps them to Doppler `GenerateOptions`.

If the public Doppler handle does not expose token ids, Poolday records the missing evidence as a warning and still binds the available output artifact. Stronger token-level verification needs a narrow public Doppler export.

---

Coordinator claims bypass role-bound record reads for audits, metrics, and operational inspection. Supported claims are `poolCoordinator: true`, `coordinator: true`, or `admin: true`.

---

## Production readiness contract

Cloud Run environment:

```bash
POOL_STORE=firestore
POOL_VERIFY_FIREBASE_AUTH=true
POOL_REQUIRE_FIREBASE_AUTH=true
POOL_BACKEND_ONLY=true
POOL_JSON_LIMIT=512kb
POOL_SIGNAL_SESSION_TTL_MS=600000
POOL_MAX_SIGNAL_PAYLOAD_BYTES=65536
POOL_MAX_SIGNAL_MESSAGES_PER_POLL=100
```

Hosted production requires:

- Cloud Run backend with `POOL_BACKEND_ONLY=true`.
- Firestore store with Firebase Admin credentials.
- Firebase Auth token verification configured.
- Auth required for all non-discovery pool routes.
- Firestore rules denying direct client access to pool collections.
- Firebase Hosting rewrites for every `/pool/*` API route, including `/pool/signaling/**`.
- Commit-reveal store methods for `commitment_events` and `reveal_events`.
- Signaling sessions capped by assignment expiry and `POOL_SIGNAL_SESSION_TTL_MS`.
- Signaling messages restricted to WebRTC metadata types: `offer`, `answer`, `ice-candidate`, `close`, and `ping`.
- Signaling payloads bounded by `POOL_MAX_SIGNAL_PAYLOAD_BYTES`.
- Offloaded model artifact base configured in the browser as `window.REPLOID_POOL_MODEL_BASE_URL`.
- Doppler module and WGSL kernel base configured in the browser as `window.REPLOID_DOPPLER_MODULE_URL` and `window.REPLOID_DOPPLER_KERNEL_BASE_URL`.
- Model artifact URLs content-addressed by model id and manifest hash.

`/pool/deployment/check` must return `ok: true` before public traffic. The readiness check requires Firestore storage, Firebase Auth verification, auth-required pool routes, offloaded model artifact base, Doppler module URL, Doppler WGSL kernel base URL, hybrid P2P signaling, and commit-reveal store support. It also reports the append-only `pool_events` seam for the future event-sourced reducer.

Local production verification:

```bash
npm run verify:pool
```

The verifier checks config validity, Firebase rewrites, Firestore indexes, Cloud Run env, required deployment values, forbidden trust language, and optional deployed readiness when `REPLOID_POOL_DEPLOYMENT_URL` or `--url` is supplied. Use `--allow-placeholders` only for local dry runs before replacing deployment values.

Browser smoke after deployment:

```bash
REPLOID_POOL_SMOKE_URL=https://<hosting-domain> npm run smoke:pool
```

Local route and peer-flow smoke:

```bash
REPLOID_POOL_SMOKE_ALLOW_LOCAL=1 npm run smoke:pool -- http://127.0.0.1:8000
```

The smoke script opens `/`, `/ask`, `/compute`, `/history`, `/network`, and `/zero`, proves a browser-room worker/requester flow, then checks `/pool/deployment/check` from the browser context. Local mode requires the deployment check route to respond with config identity. Deployed mode requires production readiness.

---

## Config as code invariant

The pool must not claim behavior that is not declared in config.

Canonical config lives in:

| File | Role |
|------|------|
| `self/pool/pool-config.json` | Product-owned source of truth for model identity, policies, trust tiers, transport modes, evidence requirements, ledger reasons, forbidden claims, and deployment readiness requirements. |
| `self/pool/config.js` | Browser helper module that consumes the canonical JSON contract. |
| `server/pool/config.js` | Server helper module that consumes the canonical JSON contract and exposes the config hash. |
| `deploy/env.production.json` | Deployment-owned source of truth for Cloud Run env and browser artifact base requirements. |

Rules:

- If a trust tier is not declared in `pool-config.json`, the UI, verifier, scheduler, and docs must not claim it.
- If a policy is not declared in `pool-config.json`, the coordinator must not route it.
- If a ledger reason is not declared in `pool-config.json`, points and reputation code must not emit it.
- If a transport mode is not declared in `pool-config.json`, the product must not advertise it.
- If a signal type is not declared in the active transport config, the signaling endpoint must reject it.
- If model identity is not declared in `pool-config.json`, providers must not register it as the launch model.
- Receipts and requester acceptances bind `policyConfigVersion` and `policyConfigHash` so disputes can inspect the active policy/evidence contract.

`/pool/config`, `/pool/policies`, `/pool/status`, and `/pool/deployment/check` expose the active config version/hash. Tests assert browser/server config alignment, trust tier declarations, transport limits, ledger reasons, commit-reveal enforcement, runtime profile binding, stale attempt isolation, and launch model identity.

---

## Production retrospective

Lane B now has a browser product shape instead of only protocol notes. The provider tab can load a Doppler runtime through hosted-browser-safe module paths, extract runtime evidence, create signed provider adverts, accept peer-room work, run generation locally, return signed receipts over WebRTC, and consume requester/agent acceptance plus signed ledger events. The hosted diagnostic lane can still register model identity and runtime profile hash, claim coordinator assignments, submit commit/reveal payloads, then submit signed receipts.

The design rule is that browser product code stays subordinate to canonical config, not to coordinator-owned jobs. The browser does not invent trust rules. Peer-first routes consume `pool-config.json`, signed peer messages, deterministic assignment planning, receipt agreement, and deterministic reducers. Hosted compatibility routes consume `/pool/config`, `/pool/policies`, assignment contracts, commit/reveal routes, receipt routes, and signaling routes.

Runtime profile binding is required correctness. The verifier expects `receipt.verification.runtimeProfileHash`, and browser receipts carry it. Without that field, a provider could register one runtime profile but submit receipts that do not bind to it.

Requester and agent acceptance bind the same agreement summary shape as the server: accepted receipt set, policy config version/hash, provider point split, point spend, and agreement hash. That makes requester countersignatures bind the economic effect, not merely one receipt hash.

WebRTC is the intended main transit and browser-ring consensus path. In the current hosted mode, cloud signaling carries only WebRTC metadata. Prompt, output, token, and full receipt envelopes move through DataChannel after the configured gates. For ring jobs, reveal-gated payload sessions protect against copycat peers seeing outputs before they have anchored commitments.

The UI now surfaces product evidence summaries: status, trust tier, agreement state, spend, runtime hash, output hash, token hash, verifier result, local peer ledger projection, and raw JSON for diagnostics.

The current hosted production line is:

1. Keep config as code in `self/pool/pool-config.json`.
2. Keep cloud authority for hosted diagnostic identity, policy, assignments, receipt anchoring, acceptance, points, and reputation.
3. Keep model artifacts offloaded and content-addressed.
4. Keep WebRTC as the primary prompt/output/receipt transit and ring consensus path.
5. Keep browser providers exact-model, runtime-profile-bound, commit-reveal-gated, and reputation-governed.

The target production line is:

1. Keep signed peer messages as the control-plane primitive.
2. Keep WebRTC as both control-plane gossip and data-plane transit.
3. Keep assignment selection deterministic and locally verifiable.
4. Keep receipt, agreement, points, and reputation reducers deterministic across peers.
5. Keep servers optional: metadata relay, bridge, archive, or public anchor only.

---

*Last updated: June 2026*
