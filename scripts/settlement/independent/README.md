# A second settlement verifier, written from the document alone

[docs/settlement-replay.md](../../../docs/settlement-replay.md) says it is meant to be enough to write a second
verifier. This directory tests that sentence.

| File | What it is |
| --- | --- |
| [replay.js](replay.js) | A settlement verifier written from the document alone. Node built-ins only. |
| [DOC-GAPS.md](DOC-GAPS.md) | Every place the document did not decide the behaviour, listed by the verifier's author before any comparison. |
| [differential.js](differential.js) | Runs this verifier and the service's (`server/fleet/settlement-replay.js`) on the same signed record sets and reports every difference. |
| [receipts/differential.json](receipts/differential.json) | The committed output of that run. |

```sh
node scripts/settlement/independent/differential.js --out scripts/settlement/independent/receipts/differential.json
node scripts/settlement/independent/differential.js --verbose   # every disagreement
node scripts/settlement/independent/differential.js --lists     # same verdict, different late, foreign or rejected lists
```

Plain Node, about 10 seconds, no model, no GPU, no network.

## What this is and is not

- **Who wrote it.** A second agent session working for the same operator as the service's verifier. It is not an
  independent party, and this is not a third-party replay.
- **What the author read.** Only `docs/settlement-replay.md` at commit 20121ae60. It was told not to open the
  service's verifier, the signers, the tests, the scenario builder, the attack matrix or the earlier verifier in this
  directory, and it reported opening none of them. That boundary is self-reported.
- **What the author could not test.** It had no signer, so before the comparison it could only check the verifier
  against records it signed itself.
- **Who wrote the comparison.** Another session, which did read the service's code. `differential.js` builds its base
  attempts with the production signers through `scripts/settlement/scenario.js`.
- **The parties.** Every requester, stage and stranger is a simulated identity on one machine.

`replay.js` is kept as its author delivered it. A later fix must say whether the document or the service's code
prompted it.

## Result on main

20 base attempts, 24 mutation families, Ed25519 and P-256 keys.

| | Count |
| --- | --- |
| Record sets | 1,246 |
| Judgments (one reservation at one clock value) | 1,731 |
| Same outcome, same debit, same credit for every stage | 1,704 |
| Disagreements | 27 |
| Same outcome and amounts, but a late, foreign or rejected list differs | 22 |

The 27 disagreements have two causes. In both, the document and the service's verifier say different things, and
one of them should change.

1. **A signature with base64 padding (21 judgments, 17 with different amounts).** The document says a signature is
   base64url without padding. The service's verifier accepts a signature with `=` appended, on all five record
   kinds. This verifier rejects the record. The signature member is unsigned, so anyone relaying a record can
   produce a second accepted form of it.
2. **No policy supplied (6 judgments).** The document says terms are `invalid` unless their digest names a supplied
   policy. The service's verifier refuses to run when it is given no policy at all.

The 22 list differences:

- **A late stop (12).** The document says a stop signed outside the window is listed as late. The service's verifier
  ignores it without listing it.
- **A second requester's terms with its own charge binding (6).** By step 1 of the document these terms count, and
  the acceptance rule then drops them. The service's verifier lists them as `foreign`.
- **Padding again (4).** The same cause as above, where the padded record did not change the outcome.

Conflict entries are compared only by whether each verifier lists one, because the document names one conflict
kind (`terms-equivocation`) and no others. On that measure the two agree on all 1,731 judgments.

## Agreement that still deserves a reader

The two verifiers agree on the following, because the document says so. Each is a property of the rules, not a
difference between implementations. [../baseline-matrix.js](../baseline-matrix.js) scores the first three against a
simpler rule.

- **A requester voids its own charge.** After acknowledging a whole answer, the requester signs a second
  acknowledgment for a count with another chain. Both verifiers answer `conflict`, debit 0. Signers write their own
  `signedAt`, so it can do this afterwards.
- **One stage vetoes every payment.** A stage that withholds its closing receipt after a delivered answer makes the
  reservation `unknown`. Nobody is paid.
- **A stranger makes a reservation undecidable.** A key that took no part signs its own terms, acceptance and charge
  binding under the reservation ID. Both verifiers answer `unknown`.
- **The final stage closes with a null output.** A finished, acknowledged answer then settles at 0.
- **Times without a zone.** The document accepts any string `Date.parse` accepts, and `Date.parse` reads a time
  without a zone as local time. One record set with such an acknowledgment settled at 15 on a verifier whose zone is
  UTC and at 12 on one in another zone. Both verifiers behave this way. Checked by running the same set under two
  `TZ` values; it is not part of the committed receipt.

## What the document still leaves open

[DOC-GAPS.md](DOC-GAPS.md) lists 44 items: 37 where the text did not decide the behaviour and 7 where it looks
self-contradictory or wrong. Almost none of them changed a verdict in this run. Those most likely to matter to
another implementer:

- **Field types.** `attemptId`, `requesterId`, `participantId` and `maximum` have no stated type.
- **`output` on a non-final stage.** The rule needs the terms, so it cannot be a per-record shape check.
- **In-time judgments before terms are agreed.** `inTime` is defined on the agreed terms, and step 2 uses it to
  choose them.
- **Conflict entries.** No kind is named except `terms-equivocation`, and the signer of a step-7 conflict is not
  stated.
- **`accountOf` and `balances`.** The signature, the result's shape and the sign are not given.
- **Key aliases.** Coordinates are constrained only by a pattern, so non-canonical base64url gives one key several
  valid participant IDs.

## The first round

The first verifier in this directory (commit 898b1d809) was written from the document as it stood at 83b534fdf,
which did not specify field names, the signed encoding or the arithmetic; 28 facts had to come from the code. Its
differential (745 record sets, 1,146 judgments, 808 full agreements) found that the service's verifier:

- made a finished 40-output answer free when the requester withheld its last one or two acknowledgments;
- settled on terms and acceptances signed after the deadline;
- rejected an extra key member on one record kind and accepted it on three others;
- reported a stranger's terms as the requester's conflict.

Commit 20121ae60 fixed all four in the service's verifier, signed `K` into the terms and rewrote the document. The
verifier here was then written again from the new document by an author who had seen neither the code nor the first
verifier.

## Limits

- One operator ran everything. Nothing here is evidence of separate operators.
- The record sets come from one scenario builder and its mutations. Agreement on them does not show agreement on
  records from a physical run or from another implementation's signer.
- A mutation that both verifiers judge the same way, wrongly, is counted as agreement.
