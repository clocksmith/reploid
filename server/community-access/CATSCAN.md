# CATSCAN: Community Access

Parent: [Hosted Services](../CATSCAN.md)

## Target

Donor- and operator-funded service under funded, admitted capacity with fair queues, usage and abuse limits, and visible availability.

## Authority
- Owns funding records, queue entries, usage and rate windows, admission against pool funding and capacity evidence, and the ledger's `community_access` `issuanceAuthority`.
- Excludes balances, settlement, prices, quote terms, capacity production, identity and the guarantee decision.

## Scope

- This directory.

## Contracts

Inputs:
- Explicit policy including `guarantee.mode`, an account port, a funding-authority port and admitted-capacity evidence from execution owners.
- Allocations from [registered](../ledger/funding/CATSCAN.md) funding commitments, which name funder identity and kind.

Outputs:
- Operations in [store-contract.js](store-contract.js): available, queued or unavailable states; pool reservations in the [ledger](../ledger/CATSCAN.md); subsidy reports.

## Invariants
- Authority-approved funding issues `community_access` lots, consuming its allocation, into declared pool accounts only; registration and access issue members nothing.
- No admission without fresh admitted capacity and pool funding.
- Accounts take fair turns; per-account usage, queue, account and device rate limits apply.
- Under `none`, requests queue or need explicit retry; neither position nor balance promises completion.
- `funded_floor` declares allocation, funding, admission limits, reserved slots, coverage evidence and shortfall behavior.
- Consumption is disclosed as subsidy in solvency.

## Acceptance
- Memory and Firestore stores pass identical scenarios.
- Evidence: [Community Access tests](../../tests/unit/community-access.test.js).

## Non-goals
- Deciding the guarantee, funding or limits; producing capacity; trial or promotional credit.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
