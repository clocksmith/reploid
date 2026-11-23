# Governance and Stewardship

Reploid asks participants to contribute compute and storage from their own machines. Before external contributors rely on the project name, the `replo.id` domain, or an operator-run credit ledger, this document states who controls each piece today, what commitments bind that stewardship, how balances are verified without trusting the operator, and what triggers moving the name and domain to a neutral holder.

## 1. Current Stewardship

- **Source code and protocol:** Licensed under the [MIT License](LICENSE), copyright "Reploid contributors", in the public `clocksmith/reploid` repository. Anyone may run their own signaling server, native participant, browser bundle, or fleet coordinator without permission from the maintainer.
- **Project name, domain, package, and hosted services:** Today the `Reploid` name, the `replo.id` domain, the `reploid` package name, the public signaling deployment, and the hosted credit service are operated and held personally by the project maintainer (`clocksmith`).
- **Nature of service credits:** Credits recorded by the fleet service (`noncash-service-credit`) are **non-cash mutual service credits** that meter reciprocal inference work among enrolled computers under an explicit policy (`creditsPerOutputToken`, bounded debt, and conservation across accounts). They are not money, bank deposits, stored monetary value, securities, or redeemable for cash.

## 2. Public Commitments

While control of the hosted infrastructure remains personal, the maintainer commits to the following rules:

1. **The `Reploid` name will not be taken closed.** Core Reploid protocol, participant, and verification code published under the `Reploid` name remains open source under an OSI-approved permissive license (MIT). Proprietary forks, if anyone ever builds one, may not use the `Reploid` name or `replo.id` domain.
2. **The credit ledger will never be sold.** Contributor enrollment records, credit journals, and account balances will never be sold, pledged, or transferred as a commercial asset to a third-party buyer.
3. **Wind-down, notice, and portability.** If the maintainer ever discontinues operating `replo.id` or a hosted credit ledger, contributors will receive advance public notice in this repository, new reservations will pause so in-flight work can settle, earned non-cash service credits may be spent against remaining maintainer-supplied capacity during the wind-down window, and every contributor may export their complete signed-receipt statement so a successor or community-operated coordinator can honor verified balances.

## 3. Verifying Balances Without Trusting the Operator

A contributor does not have to trust the ledger operator's running balance:

- Every settled request in the fleet credit ledger is backed by participant-signed cryptographic artifacts: countersigned whole-model receipts, provider-signed terminal cleanup records, or ordered-partition stage closing receipts paired with the requester's signed output acknowledgment.
- Any enrolled computer can fetch its complete journal statement via the `statementMine` service operation (`client.statement()`, or `{"id":"1","op":"statement"}` on the native fleet host control interface) and recompute its balance offline:
  ```sh
  node server/fleet/credit-statement.js /absolute/path/to/statement.json
  ```
- `verifyCreditStatement` (`server/fleet/credit-statement.js`) independently checks request-binding digests, participant signatures, duplicate-work replay rules, and integer stage shares (`server/fleet/credit-shares.js`), and flags any entry that lacks complete cryptographic proof or disagrees with the stated journal delta. Signatures prove which enrolled keys signed each receipt and acknowledgment; they do not prove hardware attestation or model output quality (see [`docs/fleet-service.md`](docs/fleet-service.md)).

## 4. Trigger for Moving the Name and Domain to a Neutral Holder

Long-term, a shared compute network should not depend on one individual's personal domain registrar or trademark ownership.

- **Commitment:** Stewardship of the `Reploid` name, `replo.id` domain, and canonical `reploid` package name will move to a neutral non-profit holder (an established open-source foundation or non-profit fiscal sponsor) once external participation crosses an explicit threshold, so no single individual or company can capture the project identity.
- **Trigger threshold (pending owner confirmation):** The exact numerical trigger — for example, a set number of independent external contributors who have earned or spent verified service credits over a rolling window, or sustained non-maintainer share of served capacity — is **pending owner confirmation** in [`clocksmith/deco#216`](https://github.com/clocksmith/deco/issues/216) before external contributor onboarding opens. Once confirmed, the exact threshold and target non-profit structure will be recorded here by pull request; changes to reduce or weaken commitments in this file require public notice before taking effect.
