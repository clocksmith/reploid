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
- **What the author read.** Only `docs/settlement-replay.md`, first at commit 20121ae60 and again in full at
  4ee9dd6b2 when the document changed. It was told not to open the service's verifier, the signers, the tests, the
  scenario builder, the attack matrix, this directory's comparison or any diff, and it reported opening none of
  them. That boundary is self-reported.
- **What the author could not test.** It had no signer, so before the comparison it could only check the verifier
  against records it signed itself.
- **Who wrote the comparison.** Another session, which did read the service's code. `differential.js` builds its base
  attempts with the production signers through `scripts/settlement/scenario.js`.
- **The parties.** Every requester, stage and stranger is a simulated identity on one machine.

`replay.js` is kept as its author delivered it for each version of the document. It changes only when the document
does, and only from the document's text. A fix prompted by the service's code would have to say so.

## Result on main

The document and the service's verifier at 4ee9dd6b2. 20 base attempts, 24 mutation families, Ed25519 and P-256
keys. The document reports one row per reservation and requester, and the comparison is keyed the same way.

| | Count |
| --- | --- |
| Record sets | 1,246 |
| Judgments (one row at one clock value) | 1,774 |
| Same outcome, same debit, same credit for every stage | 1,749 |
| Disagreements | 25 |
| Same outcome and amounts, but a late or rejected list differs | 17 |

The 25 disagreements have two causes. In both, the document and the service's verifier say different things, and
one of them should change.

1. **A signature with base64 padding (19 judgments, 15 with different amounts).** The document says a signature is
   base64url without padding. The service's verifier accepts a signature with `=` appended, on all five record
   kinds. This verifier rejects the record. The signature member is unsigned, so anyone relaying a record can
   produce a second accepted form of it.
2. **No policy supplied (6 judgments).** The document says terms are `invalid` unless their digest names a supplied
   policy. The service's verifier refuses to run when it is given no policy at all.

The 17 list differences:

- **A late stop (11).** The document says a stop signed outside the window is listed as late. The service's verifier
  ignores it without listing it.
- **Padding again (6).** The same cause as above, where the padded record did not change the outcome.

Conflict entries are compared only by whether each verifier lists one, because the document names two conflict
kinds (`terms-equivocation` and `acknowledgment-equivocation`) and leaves the blocking cases unnamed. On that measure the two agree on all 1,774 judgments.

### The same comparison one document earlier

At 20121ae60 the first version of this verifier agreed on 1,704 of 1,731 judgments, with the same two causes. That
run also showed three properties both verifiers shared because the document said so: a requester voided its own
charge by signing a second acknowledgment, one stage vetoed every payment by withholding its closing receipt, and a
stranger made a reservation undecidable with three signatures. Commit 4ee9dd6b2 changed the document and the
service's verifier on all three. This verifier, updated from the new text alone, reaches the service's new verdicts
on each: the charge stands, the stage is paid after the release window, and the stranger gets a row of its own.

## Agreement that still deserves a reader

The two verifiers agree on the following, because the document says so. Each is a property of the rules, not a
difference between implementations.

- **Times without a zone.** The document accepts any string `Date.parse` accepts, and `Date.parse` reads a time
  without a zone as local time. One record set with such an acknowledgment settles at 15 on a verifier whose zone is
  UTC and at 12 on one in another zone. Both verifiers behave this way at 4ee9dd6b2. Checked by running the same set
  under two `TZ` values; it is not part of the committed receipt.
- **Signers write their own times.** Stages that sign late receipts with an in-time `signedAt` are paid where
  honest clocks are not. The document lists this as a limit. [../baseline-matrix.js](../baseline-matrix.js) shows
  the amounts and what a third-party witness would change.
- **The final stage closes with a null output.** A finished, acknowledged answer then settles at 0.

## What the document still leaves open

[DOC-GAPS.md](DOC-GAPS.md) lists 58 items. Of the 44 written against 20121ae60, the text at 4ee9dd6b2 settles 4,
partly settles 7 and leaves 33. Fourteen are new: 10 where the new text does not decide the behaviour and 4 where it
looks self-contradictory. Almost none of them changed a verdict in this run. Those most likely to matter to another
implementer:

- **Conflict entries.** Five blocking cases have no named kind, and the shape of an entry varies by case.
- **Which final-stage receipts commit a chain.** One step says "presented", another says late records are ignored.
- **`open` against `unknown`** when a delivered answer has an unclosed stage with no covering receipt.
- **Field types.** `attemptId`, `requesterId`, `participantId` and `maximum` have no stated type.
- **"Attempt" has two meanings:** the row for a reservation and requester, and the `attemptId`.
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
verifier (commit 3bf842816), and updated from the document again at 4ee9dd6b2.

## Limits

- One operator ran everything. Nothing here is evidence of separate operators.
- The record sets come from one scenario builder and its mutations. Agreement on them does not show agreement on
  records from a physical run or from another implementation's signer.
- A mutation that both verifiers judge the same way, wrongly, is counted as agreement.
