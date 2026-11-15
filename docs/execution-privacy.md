# Inference privacy contracts

The requester validates a versioned policy and exact route before disclosing inference data. Policies are presets over independent dimensions, not provider rankings. The model details dialog offers provider-visible and restricted-recipient requests. Cryptographic inference and hardware attestation remain visibly unavailable.

## Implemented behavior

- `packages/reploid/src/chat/execution-policy.json` owns the defaults. Existing local settings map to restricted local-only execution; existing mesh settings map to provider-visible plaintext inference. Neither grants publication or reuse.
- Policies bind placement, allowed recipients, collusion assumptions, leakage, protocol, attestation policy, key context, retention, publication/reuse authorization and no-downgrade behavior. Unknown fields and unsupported choices fail closed. A restricted network policy requires named recipients.
- A request snapshots its policy. Grants and requester validation receipts bind policy and route digests, exact model/adapters and all execution recipients. Reusable legacy permissions cannot override a different policy. Retries keep the failed attempt's policy and create a new attempt; changing the conversation's policy affects subsequent Sends.
- Mesh eligibility filters offers before performance ranking. Each provider can advertise independent per-model paths. Signed advertisements identify claims; they do not prove hardware attestation, encryption, correct output or availability. Unsupported offers cannot become ordinary plaintext fallbacks.
- Current whole-model and partition protocols are plaintext inference. Ordered partitions send token context to the stages and activations through their route. Signed partition grants now optionally include the validated privacy binding; signatures cover that binding and receivers revalidate it.
- The paired v2 bridge advertises exact model routes before messages leave the browser. This includes the native requester, which sees ordinary messages, and every downstream stage/provider. Both browser and native host revalidate the route. Changed enrollment or routes require a new attempt. Legacy v1 bridges are unavailable for policy-bound requests and send no `/generate` call. Direct legacy callers without a policy retain their provider-visible delegation behavior, explicitly short of complete-route validation.
- Retained conversation contexts use a namespace derived from model, authenticated tenant, conversation and full privacy policy. Existing adapters still bind adapter identity and isolate generation contexts. Ordinary shared model weights remain reusable.
- Requester privacy receipts contain authorization metadata, with no prompt, output, token IDs, transcript, activation data or plaintext fingerprint. They record requester validation, not proof of provider honesty. Ordinary plaintext execution/recovery evidence remains available under its existing contract.

## Availability and precise limits

No attested backend, attestation verifier, encrypted evaluator or client cryptographic implementation is installed or qualified. Selecting an attestation policy, cryptographic protocol, key context or all-remote-collusion guarantee fails before execution. Advertisements cannot change that. No encrypted demonstrator or cryptographic security claim is made by this change.

The `ephemeral` retention requirement is unavailable: existing recovery journals and state lifetimes do not establish remote erasure. Ordinary execution-and-recovery permits existing operational records, including plaintext-derived accounting/recovery fingerprints; it never authorizes training, publication or reuse. A malicious plaintext recipient can still copy what it receives. Recipient restrictions are requester disclosure enforcement, not a cryptographic restriction on an authorized operator's behavior.

Current plaintext routes disclose input/output content, token context and intermediate activations as required by the path. They also expose model identity, length, timing and data-dependent access patterns. Metadata restrictions are checked independently of the profile name. A local-only request blocks remote execution and remote retrieval. Restricted retrieval with an allowlist is unavailable until the search service and all its downstream recipients have a qualified complete route.

Confidentiality, integrity and availability remain distinct. Existing model, receipt and payload verification still apply; a policy receipt cannot establish correct computation, service availability, or erasure. Cancellation suppresses delivery and settles owned resources under the existing cooperative cancellation contract; it does not promise immediate GPU interruption.

## Extension and qualification boundary

Doppler's `src/inference/execution-backend-contract.js` defines versioned descriptors, exact per-model support and state identities. Its declaration defines separate `prepareClient`, `verifyEvidence`, `sealInput`, `execute`, `finalizeClient` and `dispose` operations for a future implementation. Stronger descriptors are inventory only and unavailable for execution. Ordinary tensor/frame and generation contracts remain plaintext; opaque ciphertext must use a separate backend and transport.

Before any stronger path can become eligible, implement and independently review the actual protocol and client operations. For attestation, validate certificate/endorsement trust, hardware status, measured software, freshness, anti-replay and session/channel binding before plaintext disclosure. For cryptographic computation, bind model/artifacts, protocol/version/parameters, participant identities, client-held secrets, cancellation/retry and exact permitted leakage. Demonstrate the requested collusion model, including all remote operators colluding where required; consider MoE expert-selection/access-pattern leakage. Do not infer qualification from a boolean or successful toy arithmetic.

Qualification must additionally test malicious/corrupt responses separately from privacy, key/tenant/cache separation, stale evidence and wrong sessions, reconnection, provider replacement, cancellation settlement, and absence of plaintext in all provider/coordinator messages, logs and receipts. Measure client work, memory, bandwidth, first-token/decode cost and model quality on the actual implementation before making performance or security claims.

## Focused evidence

`tests/unit/execution-privacy.test.js`, `privacy-controls.test.js`, `peer-generation-threads.test.js`, `chat-thread-grants.test.js`, `conversation-remote-permission.test.js`, `work-resident-provider.test.js`, `ordered-partition-grants.test.js` and `tests/integration/fleet-browser-bridge.test.js` exercise requester enforcement and lifecycle boundaries with controlled providers. These tests do not qualify physical attestation or encrypted inference.
