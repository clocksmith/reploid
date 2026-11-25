# A second settlement verifier, written from the document alone

[docs/settlement-replay.md](../../../docs/settlement-replay.md) says it is meant to be enough to write a second
verifier. This directory tests that sentence.

| File | What it is |
| --- | --- |
| [replay.js](replay.js) | A settlement verifier written from the document alone. Node built-ins only. |
| [DOC-GAPS.md](DOC-GAPS.md) | Every place the document did not decide the behaviour, listed by the verifier's author before any comparison. |
| [differential.js](differential.js) | Runs this verifier and the service's (`server/fleet/settlement-replay.js`) on the same signed record sets and reports every difference. |
| [receipts/differential.json](receipts/differential.json) | The committed output of that run. |
| [ledger-differential.js](ledger-differential.js) | Drives the live ledger (`server/fleet/credits.js`) through the same attempts and compares what it posts with what the service's replay computes. |
| [receipts/ledger-differential.json](receipts/ledger-differential.json) | The committed output of that run. |

```sh
node scripts/settlement/independent/differential.js --out scripts/settlement/independent/receipts/differential.json
node scripts/settlement/independent/differential.js --verbose   # every disagreement
node scripts/settlement/independent/differential.js --lists     # same verdict, different late, foreign or rejected lists
node scripts/settlement/independent/ledger-differential.js --out scripts/settlement/independent/receipts/ledger-differential.json
```

Plain Node, about 10 seconds, no model, no GPU, no network.

## What this is and is not

- **Who wrote it.** A second agent session working for the same operator as the service's verifier. It is not an
  independent party, and this is not a third-party replay.
- **What the author read.** Only `docs/settlement-replay.md`, first at commit 20121ae60 and again in full at
  4ee9dd6b2, c29bc5d44, a25242bc3 and 955bd5f7a when the document changed. For the owner's decided
  unfinished-answer rule (61cea0a88) a fresh session read only the document, `replay.js` and `DOC-GAPS.md`, with no
  git and no code search. It was told not to open the service's verifier, the signers, the tests, the
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

The document with the owner's decided unfinished-answer rule and both verifiers at 61cea0a88. 22 base attempts
(two added for the older provider-loss-free terms), 25 mutation families, Ed25519 and P-256 keys, seven clock values
around the deadline, the release window and the instant an attempt is decided. The document reports one row per
reservation and requester, and the comparison is keyed the same way.

| | Count |
| --- | --- |
| Record sets | 1,448 |
| Judgments (one row at one clock value) | 2,052 |
| Same outcome, same debit, same credit for every stage | 2,052 |
| Every documented member of the row the same | 2,052 |
| Same records rejected, same `counts` and same balances per account | 2,008 of 2,008 runs |
| Disagreements | 0 |

Read this as: on these record sets, a verifier written from the document's text alone returns what the service's
verifier returns, member for member. It is not a proof that the two agree on all records.

Every documented row member except the sentence in `reason` is compared: `attemptId`, `status`, `debit`,
`credits`, `outputs`, `chargedOutputs`, `unacknowledgedOutputs`, `beyondCeiling`, `closedAtLastStep`, `conflicts`,
`late`, `foreign` and `unmatched`. List entries are compared without regard to order, which the document does not
fix; two rows differ only in the order of their entries.

The last mutation family covers the rules the document gained since c29bc5d44. Both verifiers reject ten other
forms of a time, reject a signature or key coordinate whose last character is changed without changing its bytes,
reject the second form of a P-256 signature, count a closing receipt signed up to the end of the release window
plus the clock allowance and list a later one as late, and keep a row `open` up to and including the instant the
deadline, the release window and the clock allowance have passed.

This verifier implements the replay, under the decided terms and under the older ones the document keeps. The
ledger's interim rules of 2026-11-25 (the document's "Older rules") are a ledger rule and are not implemented here.

### How the comparison got here

| Document at | Second verifier | Full agreement | What differed |
| --- | --- | --- | --- |
| 83b534fdf | first version, 28 facts taken from code | 808 of 1,146 | four defects in the service's verifier, among them a finished answer made free by withholding the last acknowledgment |
| 20121ae60 | rewritten by a fresh author from the text alone | 1,704 of 1,731 | a padded signature accepted; a run with no policy refused |
| 4ee9dd6b2 | updated from the text | 1,749 of 1,774 | the same two |
| c29bc5d44 | updated from the text | 1,774 of 1,774, then 1,904 of 1,904 with the added family | nothing |
| a25242bc3 | updated from the text; the result shape now follows the document's member list | 1,904 of 1,904 | no verdict or amount; three small differences in other row members (an own-account stage in `credits`, conflict entry details, `closedAtLastStep`) |
| 955bd5f7a | updated from the text | 1,936 of 1,936, every row member included | nothing |
| 61cea0a88 | updated from the text with the decided unfinished-answer rule; result `schema` v2 | 2,052 of 2,052, every row member included | nothing; the amounts `replay.js` computes did not change, because it already charged the prefix under every value but the provider-loss-free one |

Between those rounds the comparison and [../baseline-matrix.js](../baseline-matrix.js) also showed properties both
verifiers shared because the document said so, and the document and the service's verifier were changed on each: a
requester voiding its own charge with a second acknowledgment, one stage vetoing every payment by withholding its
closing receipt, a stranger making a reservation undecidable, a time without a zone making the charge depend on the
verifier's time zone, and stages being paid for writing an earlier time into late receipts.

## The ledger against the replay

The comparison above is between two replays. `ledger-differential.js` asks a different question: does the ledger that
moves the credits post what the replay computes? It opens a fresh ledger for each case and drives it as the live
route does: reserve, dispatch and admit at the start; `collect` with each acknowledgment and the receipt it
acknowledged at the moment that acknowledgment was signed; `collect` again when the last record was signed, with
each stage's latest receipt, the latest acknowledgment and the requester's signed stop if there is one; and
`recover` once the attempt is decided (after the deadline, the release window and the clock allowance). The replay
judges the same records at that time. The policy sets the request limit to the scenario's 30 s, so the ledger's
deadline and the signed one are the same instant.

16 base attempts, each with all its records and with a stage's closing receipt or every receipt withheld, and with
the requester's top acknowledgment or all but its charge binding withheld. Every attempt is signed under the decided
rules, which every new reservation takes.

| | Count |
| --- | --- |
| Cases | 109 |
| Same debit and same credit for every stage | 109 |
| Different amounts | 0 |

Where the amounts agree the words can still differ: when a stage presents no receipt at all for a delivered answer,
the ledger reports the hold expired and the replay reports `unknown` (8 cases). Both move nothing.

### The decided rule

**The stages close an unfinished answer and no requester stop was signed.** This was the one known difference: the
replay charged nothing and the ledger the acknowledged outputs. The owner decided it on 2026-11-25: such an answer is
an unattributed disconnect and both charge the outputs acknowledged in time, capped at the signed ceiling. With 39
of 40 outputs acknowledged, walking away and a signed stop now both cost 117. A verified provider failure, a stage
that never closes, still costs the requester nothing in both. Reservations made under the older rules keep them.

### How it got here

| Commit | What the comparison showed |
| --- | --- |
| 560f7440b (first run, final `collect` only, no stop) | 102 of 109. Three causes: the case above; closes 5 s after the deadline inside the release window (ledger 0, replay 12); an answer past the signed ceiling (ledger refused the receipts, replay charged the ceiling). |
| 4d845320a, fd2ece824 | The ledger was moved to the replay on all three, and the live route began handing over each acknowledgment as signed and the requester's stop: 109 of 109. |
| 955bd5f7a | The first case was moved back in the ledger, once it was clear that the replay's rule makes every partial answer free at the requester's option: 107 of 109, the two walk-away cases. |
| 4016e5281 | The owner's decision: the replay takes the ledger's charge for an unattributed disconnect under new terms, and the ledger keeps provider-failure relief: 109 of 109. |

`--latest-only` runs the comparison with only the final `collect` and no stop: what a route that kept less would
hand over. It shows what the agreement on the other cases depends on.

## Agreement that still deserves a reader

The two verifiers agree on the following, because the document says so. Each is a property of the rules, not a
difference between implementations.

- **A stage that fails and still closes is charged as a disconnect.** A stage receipt names no cause, and a live
  stage also signs `failed` when the requester's abort reaches it, so only a missing close counts as a provider
  failure. Both verifiers agree, because the document says so, and it lists this as a limit.
- **The final stage closes with a null output.** A finished, acknowledged answer then settles at 0.
- **Signers still write their own times.** The rules no longer reward a stage for backdating a late close, but no
  record can show when anything was really signed. The document lists this as a limit.

## What the document still leaves open

[DOC-GAPS.md](DOC-GAPS.md) lists 79 items, numbered across all seven versions of the document. Against the text
with the decided rule its author counts 48 settled, 10 partly settled and 19 still standing of the first 77, and 2
new. None of the open ones changed a result in this run. Those most likely to matter to another implementer:

- **Which rule a row was decided under (78).** No row member names the unfinished-answer terms applied, and the
  result's `schema` is `v2` even over older terms; only `reason` says. A verifier reading a result needs the signed
  terms to know.
- **Older terms signed after the decision (79).** The replay decides by the signed value. Since this gap was
  written the document adds that stages accept only the decided terms, so such terms stay `unknown`; the replay
  still checks no date.
- **Acceptances and late listings:** whether an in-time acceptance of another terms digest is listed as late, and
  whether an `invalid` row lists late records.
- **Conflict list details:** what `digests` holds and in what order, and the order of entries between kinds.
- **Field types.** `attemptId`, `requesterId`, `participantId` and `maximum` have no stated type.

Settled by the text with the decided rule: the Stage 1 pass condition past the ceiling (77), and the scope of the
old known difference (76 is moot).

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
verifier (commit 3bf842816), and updated from the document again at 4ee9dd6b2, c29bc5d44, a25242bc3 and 955bd5f7a.

## Limits

- One operator ran everything. Nothing here is evidence of separate operators.
- The record sets come from one scenario builder and its mutations. Agreement on them does not show agreement on
  records from a physical run or from another implementation's signer.
- A mutation that both verifiers judge the same way, wrongly, is counted as agreement.
