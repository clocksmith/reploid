# Browser Inference Pool

Reploid now owns the product layer for receipt-backed browser-local inference.

The product claim is narrow:

```text
receipt-backed, audit-backed, reputation-backed, policy-controlled browser inference
```

Do not describe this as trustless compute, hardware-attested inference, or guaranteed honest GPU execution. A browser provider can sign an assignment-bound artifact, but normal browser execution cannot prove that the tab was not tampered with.

---

## Product routes

| Route | Purpose |
|-------|---------|
| `/` | Public product home |
| `/run` | Requester prompt submission and receipt acceptance |
| `/contribute` | Browser provider registration and assignment execution |
| `/agents` | Agent SDK, policy-routed job submission, polling, and receipt acceptance surface |
| `/receipts` | Receipt lookup and local artifact verification |
| `/reputation` | Provider reputation, pool metrics, deployment check |
| `/0` | Reploid substrate diagnostics |
| `/x` | Reploid lab route |

---

## Launch model contract

```json
{
  "modelId": "gemma-3-270m-it-q4k-ehf16-af32",
  "modelHash": "sha256:b55fde5809dbc198f880b08af21e40e3175a6d2f9f88a9fad59fa0afd7190dc9",
  "manifestHash": "sha256:abac153d8cee1b6cc4fd2743defa84b91f67b3d030af028bbd5ed8ba8cabee6b",
  "runtime": "doppler",
  "backend": "browser-webgpu",
  "dopplerLoadRef": "gemma3-270m"
}
```

`dopplerLoadRef` is the public Doppler registry alias used by the browser runtime. It is not the receipt identity. Receipts bind the full model id, model hash, manifest hash, runtime, and backend.

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
| `ring_quorum_receipt` | `T4_ring_quorum_receipt` | One to four exact-model browser providers run the same deterministic assignment in a coordinator-ordered ring; majority matching token/output hashes form the accepted result |

## Ring quorum policy

`ring_quorum_receipt` is the scalable trust policy. It uses a Paxos-like quorum rule over a deterministic provider ring, capped at four providers.

Ring behavior:

- `N = 1`: `T1_ring_baseline`; one provider returns a normal signed receipt with ring metadata. This is a baseline receipt, not distributed trust.
- `N = 2`: `T2_paired_ring_receipt`; two providers must agree. This improves tamper detection but remains weak against collusion.
- `N = 3`: `T3_majority_ring_receipt`; any two matching receipts form quorum. This is the best default trust/latency balance.
- `N = 4`: `T4_max_ring_quorum_receipt`; any three matching receipts form quorum. This is the maximum launch ring size before coordination overhead dominates.

The coordinator selects up to four fresh, available, exact-model providers, derives a deterministic ring order from the job and provider set, and writes the same ring commitment into each assignment. Each provider still runs full-model Doppler inference locally through the public browser runtime. Reploid does not claim distributed KV sharding or ring-reduced attention until Doppler exposes those public execution surfaces.

Ring agreement checks:

- same assignment, prompt hash, model identity, runtime identity, and generation config;
- current assignment attempt only, including `assignmentAttemptId` and `ringAttemptId`, so receipts from failed prior attempts do not count toward a retry;
- provider signature on every receipt;
- ring id, seed, attempt id, layout hash, provider index, predecessor, successor, and provider set;
- quorum over matching `tokenIdsHash` plus `outputHash`;
- per-provider invalid receipt or execution failure accounting while the remaining current assignments can still reach quorum;
- requester acceptance before points and reputation mutation.

Honest claim:

> A coordinator-ordered provider ring produced quorum-matching signed receipts for the same deterministic browser-local inference assignment.

Not claimed:

> Collusion is impossible, the browser is hardware-attested, or distributed attention/KV execution happened.

No policy allows fallback models or server providers.

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
| `POST` | `/pool/assignments/:assignmentId/receipt` | Submit provider output plus signed receipt |
| `POST` | `/pool/assignments/:assignmentId/failure` | Report provider execution failure and make the job retryable |
| `POST` | `/pool/receipts/:receiptHash/accept` | Submit requester countersignature and accept or reject result |
| `GET` | `/pool/receipts/:receiptHash` | Fetch receipt artifact for inspection |
| `POST` | `/pool/audits/canary` | Create hidden deterministic canary assignment for a provider |
| `GET` | `/pool/audits/:auditId` | Inspect canary audit state |
| `GET` | `/pool/points/:userId` | Fetch points ledger events |
| `GET` | `/pool/reputation/:providerId` | Fetch provider reputation state |

---

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

The provider tab does not need Node or Bun. Browser providers use `/contribute`.

Provider flow:

1. Load the Doppler model through the browser WebGPU runtime.
2. Register exact model identity, device evidence, availability, public key, and accepted policies.
3. Run a provider step.
4. The step sends a heartbeat, claims one assigned job as `running`, verifies the assignment model identity against the loaded Doppler runtime, executes it if present, signs the receipt, submits it, and records local history.
5. Providers can inspect points and reputation from the same page.

The provider client exposes `runWorkerStep()` for this explicit tab loop. `/contribute` includes start/stop worker controls that repeatedly call this method; the loop is UI scheduling, not a separate execution protocol. Heartbeat returns `busy` while a provider has an `assigned` or `running` assignment. Scheduler eligibility requires a fresh heartbeat. Provider registration and assignment polling drain queued and retryable jobs, so requesters do not need to resubmit when the first eligible browser provider appears. Retryable states include assignment expiration, provider execution failure, rejected receipts, redundant-agreement disagreement, and ring-quorum disagreement. Retries exclude providers that already failed, timed out, returned an invalid receipt, or caused agreement failure for that job. Stale `assigned` and `running` assignments expire through the timeout penalty path.

## Provider device evidence

Provider registration includes WebGPU runtime evidence when the browser exposes it:

- `hasWebGPU`
- `adapterInfo`
- `features`
- `limits`
- `hasF16`
- `hasSubgroups`
- `maxBufferSize`
- `probeStatus`

This evidence is included in pool receipts through the registered provider record. It describes the claimed browser runtime environment. It is not hardware attestation.

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

The browser SDK can also verify fetched receipt records locally using the provider public key and submitted output/token/transcript artifact.

---

## Points and reputation

Points are awarded only after:

- Provider receipt passes server verification
- Requester countersigns acceptance
- The selected policy has reached its final state
- The accepted result does not exceed the job's optional `maxPointSpend`

Accepted work creates provider `points_awarded` events and a requester or agent `points_spent` event. For redundant agreement and ring quorum, acceptance is blocked until the coordinator has a final matching receipt set. Accepted providers split the point event across that set, and the requester or agent is charged the resulting total. Ring quorum uses `ring_quorum_receipt_accepted` and `ring_quorum_receipt_spend` ledger reasons instead of redundant-agreement reasons.

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
- `/run`
- `/contribute`
- `/agents`
- `/receipts`
- `/reputation`
- `/0`
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
- `points_ledger`
- `reputation_state`
- `audit_challenges`

---

## Doppler boundary

Reploid must not deep-import Doppler internals for the pool product. The browser runtime adapter loads through the public Doppler facade and calls public generation methods on the loaded handle.

Firebase Hosting serves the app as browser ES modules. A hosted deployment must provide Doppler through a browser-resolvable public module URL or an attached public module/handle. Supported globals are `window.REPLOID_DOPPLER_MODULE_URL`, `window.REPLOID_DOPPLER_MODULE_URLS`, `window.REPLOID_DOPPLER_MODULE`, `window.REPLOID_DOPPLER_LOAD_OPTIONS`, and `window.REPLOID_POOL_ATTACH_DOPPLER_HANDLE(handle, model, runtimeInfo)`. Bare package imports are only a fallback for bundled or import-map deployments.

The adapter supports both public Doppler call shapes: `generate(prompt, options)` / `generateText(prompt, options)` and object-style provider calls using `{ prompt, samplingOptions }`. Pool policy names stay product-owned; only the adapter maps them to Doppler `GenerateOptions`.

If the public Doppler handle does not expose token ids, Reploid records the missing evidence as a warning and still binds the available output artifact. Stronger token-level verification needs a narrow public Doppler export.

---

*Last updated: June 2026*

Coordinator claims bypass role-bound record reads for audits, metrics, and operational inspection. Supported claims are `poolCoordinator: true`, `coordinator: true`, or `admin: true`.
