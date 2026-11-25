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
  4ee9dd6b2 and at c29bc5d44 when the document changed. It was told not to open the service's verifier, the signers, the tests, the
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

The document and the service's verifier at c29bc5d44 (the document's later commit, 9db60b49d, changes only its
prior-work paragraph). 20 base attempts, 24 mutation families, Ed25519 and P-256 keys. The document reports one row
per reservation and requester, and the comparison is keyed the same way.

| | Count |
| --- | --- |
| Record sets | 1,246 |
| Judgments (one row at one clock value) | 1,774 |
| Same outcome, same debit, same credit for every stage | 1,774 |
| Disagreements | 0 |
| Same outcome and amounts, but a late, foreign or rejected list differs | 0 |

Conflict entries are compared only by whether each verifier lists one. The document now names the conflict kinds,
but the entries' details are among the open items in DOC-GAPS.md, and this comparison does not test them.

Read this as: on these record sets, a verifier written from the document's text alone reaches every verdict the
service's verifier reaches. It is not a proof that the two agree on all records. The mutation families were written
before the document's latest rules (canonical encodings, the exact time form, the check on `K`), so those rules are
exercised only as far as the older mutations happen to reach them.

### How the comparison got here

| Document at | Second verifier | Full agreement | What differed |
| --- | --- | --- | --- |
| 83b534fdf | first version, 28 facts taken from code | 808 of 1,146 | four defects in the service's verifier, among them a finished answer made free by withholding the last acknowledgment |
| 20121ae60 | rewritten by a fresh author from the text alone | 1,704 of 1,731 | a padded signature accepted; a run with no policy refused |
| 4ee9dd6b2 | updated from the text | 1,749 of 1,774 | the same two |
| c29bc5d44 | updated from the text | 1,774 of 1,774 | nothing |

Between those rounds the comparison and [../baseline-matrix.js](../baseline-matrix.js) also showed properties both
verifiers shared because the document said so, and the document and the service's verifier were changed on each: a
requester voiding its own charge with a second acknowledgment, one stage vetoing every payment by withholding its
closing receipt, a stranger making a reservation undecidable, a time without a zone making the charge depend on the
verifier's time zone, and stages being paid for writing an earlier time into late receipts.

## Agreement that still deserves a reader

The two verifiers agree on the following, because the document says so. Each is a property of the rules, not a
difference between implementations.

- **The final stage closes with a null output.** A finished, acknowledged answer then settles at 0.
- **Signers still write their own times.** The rules no longer reward a stage for backdating a late close, but no
  record can show when anything was really signed. The document lists this as a limit.

## What the document still leaves open

[DOC-GAPS.md](DOC-GAPS.md) lists 69 items, numbered across all three versions of the document. Against the current
text 29 are settled, 7 partly settled and 22 still stand; 11 are new, of which 8 are places the text does not decide
and 3 look wrong. Those most likely to matter to another implementer:

- **Conflict entry details:** which sequences a `stage-receipt` entry carries, what `digests` holds, and the order
  of entries.
- **How `K` reaches a verifier.** The text checks the terms against the receiver policy's `K` but names no input
  for it. This verifier takes an optional `receiverPolicy` and otherwise uses 2.
- **Entry shapes and which rows exist:** `unmatched`, `closedAtLastStep`, an own-account stage's credit, and a
  reservation with only acceptances and receipts.
- **P-256 signatures have a second valid form** (`r` with `n - s`), so "one accepted signature text" does not hold
  for that curve. Not yet tested here.
- **Two windows that can cross:** a closing receipt's window ends at the deadline plus the release window with no
  clock allowance, an ordinary record's at the deadline plus the clock allowance.
- **"Late records are ignored"** in one step, while the next uses late receipts in every conflict test.

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
verifier (commit 3bf842816), and updated from the document again at 4ee9dd6b2 and at c29bc5d44.

## Limits

- One operator ran everything. Nothing here is evidence of separate operators.
- The record sets come from one scenario builder and its mutations. Agreement on them does not show agreement on
  records from a physical run or from another implementation's signer.
- A mutation that both verifiers judge the same way, wrongly, is counted as agreement.
