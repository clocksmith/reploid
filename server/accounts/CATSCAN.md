# CATSCAN: Account Identity

Parent: [Hosted Services](../CATSCAN.md)

## Target

One account per sign-in subject, usable from every registered device; keys count for it only while registered.

## Authority
- Owns accounts, sessions, device registration and revocation, recovery, owner grant records, account links and custody-key attribution.
- Excludes sign-in providers, balances, rewards, payments, disclosure grants and HTTP routes.

## Scope

- This directory; [test-sign-in.js](test-sign-in.js) serves local runs and tests only.

## Contracts

Inputs:
- Provider assertions through [sign-in](sign-in.js); device [proofs](../../packages/reploid/src/artifacts/participant-proofs.js) and [custody certificates](../../packages/reploid/src/artifacts/custody-certificate.js) signed by persistent identities.

Outputs:
- Operations in [store-contract.js](store-contract.js); ledger and reward identity ports and session guards in [compose.js](compose.js).

## Invariants
- Accounts come only from verified provider subjects; each assertion is used once.
- Registration needs an authenticated session and a signed, unexpired, unused challenge; binding that session needs the device's signed binding.
- A key belongs to at most one account; moving it needs revocation first and records a `shared_device` link.
- Revocation refuses every later check, including ledger commits; history keeps provenance.
- Recovery ends sessions and revokes devices; it never moves or mints credit.
- Custody keys count only through an unexpired certificate issued after an active registration.
- Owner grants and links are recorded declarations; a missing link never proves independence.

## Acceptance
- Memory and Firestore stores pass identical account scenarios.
- Evidence: [account tests](../../tests/unit/account-identity.test.js) and [custody and port tests](../../tests/unit/account-custody-ports.test.js).

## Non-goals
- Real sign-in providers, routes, UI, hardware attestation or proving people independent.

## Freedom
Preserve these boundaries and pass acceptance.
