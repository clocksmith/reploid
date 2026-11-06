# CATSCAN: Hosted Services

Parent: [Reploid](../CATSCAN.md)

## Target
Bounded authentication, discovery, relay, proxy and native participation without authority over browser claims.

## Authority
- Owns server validation, signaling, relay, external adapters, native composition, accounts, credit accounting, purchase reconciliation, Community Access, contribution rewards and durable scheduling.
- Excludes browser execution claims, exactly-once delivery, scientific validity and Research Room decisions.

## Scope
Directory and unchartered descendants.

## Contracts
Inputs: [proxy.js](proxy.js), [reploid-signaling.js](reploid-signaling.js), [public-inference-guard.js](public-inference-guard.js).
Outputs: authenticated, bounded responses and delivery records.

## Invariants
- Relay acknowledgement proves receipt, not acceptance; auth/transport never prove model/scientific validity; failures stay explicit.
- HTTP inference requires auth, exact disclosure and a production accounting owner (unbilled is test-only). Trial admission caps exposure without pricing/issuance and retains unsettled reservations across restarts.
- Recovery queries bind account/device, input digest and signing identities without replacement inference. Native journals retain bounded results/fences without prompt text; missing evidence stays unresolved; signed cleanup without meters settles only fixed terminal formulas.
- Native hosts reuse participant contracts: Doppler computes; adapters own provider lifetime, authorized files and settlement; receipts retain opening/runtime/provider identities.
- File supply needs separate consent; signed custody/Doppler verification acquire requested pieces only, caching verified files, quarantining corruption and restarting partials.
- `/swarm` is bounded discovery only (hosted/loopback origins, namespace/destination admission, heartbeat/expiry; no relay/virtual peers; origin is not auth).

## Acceptance
Evidence: [native](../tests/unit/native-participant.test.js), [custody](../tests/unit/native-model-files.test.js), [requester](../tests/unit/whole-model-requester.test.js), [HTTP](../tests/integration/text-api.test.js), [trial](../tests/unit/trial-admission.test.js), [accounting](../tests/integration/text-accounting.test.js), [receipts](../tests/unit/whole-model-mesh-receipt.test.js), [recovery](../tests/unit/generation-recovery.test.js), [discovery](../tests/integration/public-swarm-server.test.js), [signaling](../tests/integration/signaling-server.test.js), [admission](../tests/integration/public-inference-admission.test.js). Live providers/GPUs qualify separately.

## Non-goals
Trustless compute marketplaces or centralized browser evidence authority.

## Freedom
Preserve boundaries; pass acceptance.
