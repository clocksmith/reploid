# CATSCAN: Hosted Services

Parent: [Reploid](../CATSCAN.md)

## Target
Bounded authentication, discovery, relay, proxy and native participation without authority over browser claims.

## Authority
- Owns validation, signaling/relay, external adapters, native composition, accounts, accounting, purchases, Community Access, rewards and durable scheduling.
- Excludes browser execution claims, exactly-once delivery, scientific validity and Research Room decisions.

## Scope
This directory.

## Contracts
Inputs: [proxy.js](proxy.js), [reploid-signaling.js](reploid-signaling.js), [public-inference-guard.js](public-inference-guard.js).
Outputs: authenticated, bounded responses and delivery records.

## Invariants
- Relay acknowledgement proves receipt, not acceptance; auth/transport never prove model/scientific validity; failures stay explicit.
- HTTP inference requires auth, exact disclosure and accounting (unbilled is test-only). Trial admission retains unsettled reservations across restarts without pricing/issuance.
- Enrolled fleets may exchange non-cash credits: bounded debt, explicit same-owner permission, signed completed work and requester acknowledgment. Purchased balances and payouts remain separate.
- Recovery binds account/device, input digest and signing identities without replacement inference. Journals bound results/fences, omit prompts and preserve uncertainty; unmetered signed cleanup permits only fixed terminal formulas.
- Native hosts reuse participant contracts: Doppler computes; adapters own provider lifetime, authorized files and settlement; receipts retain opening/runtime/provider identities.
- File supply needs separate consent; custody/Doppler verify requested pieces, cache verified files, quarantine corruption and restart partials.
- `/swarm` is bounded discovery only (hosted/loopback origins, namespace/destination admission, heartbeat/expiry; no relay/virtual peers; origin is not auth).

## Acceptance
Evidence: [native](../tests/unit/native-participant.test.js), [custody](../tests/unit/native-model-files.test.js), [requester](../tests/unit/whole-model-requester.test.js), [HTTP](../tests/integration/text-api.test.js), [trial](../tests/unit/trial-admission.test.js), [accounting](../tests/integration/text-accounting.test.js), [receipts](../tests/unit/whole-model-mesh-receipt.test.js), [recovery](../tests/unit/generation-recovery.test.js), [discovery](../tests/integration/public-swarm-server.test.js), [signaling](../tests/integration/signaling-server.test.js), [admission](../tests/integration/public-inference-admission.test.js). Live providers/GPUs qualify separately.

## Non-goals
Trustless compute marketplaces or centralized browser evidence authority.

## Freedom
Preserve boundaries; pass acceptance.
