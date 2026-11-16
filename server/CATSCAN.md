# CATSCAN: Hosted Services

Parent: [Reploid](../CATSCAN.md)

## Target
Bounded authenticated services and native participation, without browser authority.

## Authority
Owns HTTP, discovery, relay, composition and durable services. Ledger owns credits/settlements; rewards owns issuance; payments owns purchases; Community Access owns funding pools; scheduler owns obligations. Earning composition connects them without changing domain authority.

## Scope
This directory.

## Contracts
Inputs: [proxy.js](proxy.js), [signaling](reploid-signaling.js), [admission](public-inference-guard.js), library public entries and [declared wire/host contracts](../scripts/server-library-imports.json), shared browser contracts and Poolday host/pool/config adapters. Product presentation and substrate execution implementations are forbidden dependencies.
Outputs: bounded responses, accounting and delivery records.

## Invariants
- Auth/transport never prove model/scientific validity. Relay acknowledgement proves receipt, not acceptance.
- Inference requires auth, exact disclosure and accounting; unbilled execution is test-only. Trial reservations survive restarts without issuance.
- Non-cash fleet credits require bounded debt, same-owner consent, signed work and requester acknowledgement. Purchases/payouts remain separate.
- Recovery binds account/device, input digest and signing identities without replacement inference. Journals omit prompts and preserve uncertainty; signed unmetered cleanup permits fixed terminal formulas only.
- Doppler computes; native adapters own lifetime, files and settlement. Receipts retain opening/runtime/provider identities.
- File supply requires separate consent. Verify every piece/file hash; quarantine corruption and restart partials. Only pinned immutable model origins may supply missing bytes; never origin manifests.
- `/swarm` is bounded discovery, without relay/virtual peers. Origin is not authentication.

## Acceptance
Evidence: [native](../tests/unit/native-participant.test.js), [custody](../tests/unit/native-model-files.test.js), [HTTP](../tests/integration/text-api.test.js), [accounting](../tests/integration/text-accounting.test.js), [recovery](../tests/unit/generation-recovery.test.js), [discovery](../tests/integration/public-swarm-server.test.js), [boundaries](../tests/unit/layer-verification.test.js). Live providers/GPUs qualify separately.

## Non-goals
Trustless compute or centralized browser evidence authority.

## Freedom
Preserve boundaries; pass acceptance.
