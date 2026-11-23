# Governance and Stewardship

Reploid lets participants contribute compute and storage from their own machines. This document records who controls the project name, the `replo.id` domain, and the hosted credit ledger today; what service credits represent; how any contributor can verify balances offline without trusting the operator; and what participation milestone starts a stewardship review.

## 1. Current Control and Credit Unit

- **Source code and protocol:** Licensed under the [MIT License](LICENSE), copyright "Reploid contributors", in the public `clocksmith/reploid` repository. Anyone may run their own signaling server, native participant, browser bundle, or fleet coordinator without permission from the maintainer.
- **Project name, domain, package, and hosted services:** Today the `Reploid` name, the `replo.id` domain, the `reploid` package name, the public signaling deployment, and the hosted credit service are held and operated personally by the project maintainer (`clocksmith`). Beyond the MIT license on the source code and the cryptographic verification contracts in this repository, no separate public stewardship commitments or transfer obligations have been adopted.
- **Nature of service credits:** Credits recorded by the fleet service (`noncash-service-credit`) are **non-cash mutual service credits** that meter reciprocal inference work among enrolled computers under an explicit policy (`creditsPerOutputToken`, bounded debt, and conservation across accounts). They are not money, bank deposits, stored monetary value, securities, or redeemable for cash.

## 2. Verifying Balances Without Trusting the Operator

A contributor does not have to trust the ledger operator's running balance:

- Every settled request in the fleet credit ledger is backed by participant-signed cryptographic artifacts: countersigned whole-model receipts, provider-signed terminal cleanup records, or ordered-partition stage closing receipts paired with the requester's signed output acknowledgment.
- Any enrolled computer can fetch its complete journal statement via the `statementMine` service operation (`client.statement()`, or `{"id":"1","op":"statement"}` on the native fleet host control interface) and recompute its balance offline:
  ```sh
  node server/fleet/credit-statement.js /absolute/path/to/statement.json
  ```
- `verifyCreditStatement` (`server/fleet/credit-statement.js`) independently checks request-binding digests, participant signatures, duplicate-work replay rules, and integer stage shares (`server/fleet/credit-shares.js`), and flags any entry that lacks complete cryptographic proof or disagrees with the stated journal delta. Signatures prove which enrolled keys signed each receipt and acknowledgment; they do not prove hardware attestation or model output quality (see [`docs/fleet-service.md`](docs/fleet-service.md)).

## 3. Stewardship Review Threshold

- **Threshold:** **25 independent outside participants who both earn and redeem credits on verified jobs within a rolling 90 days, excluding team accounts and self-deals.**
- **Effect:** Crossing this threshold starts a stewardship review of how the `Reploid` name, the `replo.id` domain, and the credit ledger are governed. It does not transfer anything or approve public commitments.
