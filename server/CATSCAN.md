# CATSCAN: Hosted Services

Parent: [Reploid](../CATSCAN.md)

## Target

Bounded authentication, discovery, relay, proxy and native participation without authority over browser claims.

## Authority
- Owns server validation, signaling, relay, external adapters, native composition, accounts, credit accounting, purchase reconciliation, Community Access and contribution rewards.
- Excludes browser execution claims, exactly-once delivery, scientific validity and Research Room decisions.

## Scope

- This directory and unchartered descendants.

## Contracts

Inputs:
- Requests accepted through [proxy.js](proxy.js) and [reploid-signaling.js](reploid-signaling.js).
- Public inference gates from [public-inference-guard.js](public-inference-guard.js).

Outputs:
- Authenticated, bounded server responses and delivery records.

## Invariants
- Relay acknowledgement proves receipt, not acceptance.
- Authentication and transport do not establish model/scientific validity.
- Hosted failures remain explicit.
- Native hosts reuse participant contracts. Doppler owns computation; adapters own provider lifetime, authorized files and settlement.
- File supply needs separate consent. Signed custody and Doppler verification acquire requested pieces only. Bounded caches retain verified complete files; quarantine corruption; restart partial pieces.
- Receipts retain opening/runtime/provider identities; native support qualifies separately.
- `/swarm` is bounded discovery only: exact hosted origins or explicitly allowed HTTP(S) loopback origins on any port, namespace admission, destination membership, heartbeat and unjoined expiry. No application relay or virtual inference peers; origin is not authentication.

## Acceptance
- Preserve admission boundaries.
- Evidence: native lifecycle: [host tests](../tests/unit/native-participant.test.js).
- Native custody: [native file tests](../tests/unit/native-model-files.test.js).
- [public discovery tests](../tests/integration/public-swarm-server.test.js).
- [signaling integration](../tests/integration/signaling-server.test.js) and [public inference admission](../tests/integration/public-inference-admission.test.js) tests.

## Non-goals
- Trustless compute marketplaces or centralized browser evidence authority.

## Freedom
Preserve boundaries and pass acceptance.
