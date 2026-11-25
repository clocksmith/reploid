# Independent settlement replay

`replay.js` is a second settlement verifier. It was written from
[docs/settlement-replay.md](../../../docs/settlement-replay.md) and from the code
that produces and signs records, before its author read
`server/fleet/settlement-replay.js` or its tests. It imports nothing from this
repository: canonical JSON, participant IDs, digests and signature checks are
reimplemented on `node:crypto`.

`differential.js` builds attempts with the production signing code
(`scripts/settlement/scenario.js`), mutates the record sets, and has both
verifiers judge every set. The question it answers: can someone holding only the
public rules and the signed records recompute a settlement?

Short answer: not from the document alone. The encoding rules had to be read
from code, the two verifiers agree on 808 of 1,146 judgments, and four of the
fifteen causes of disagreement are defects in the service's verifier.

## Run it

```sh
node scripts/settlement/independent/differential.js --out scripts/settlement/independent/receipts/differential.json
node scripts/settlement/independent/differential.js --verbose   # every disagreement, grouped by cause
node scripts/settlement/independent/differential.js --all       # one JSON line per judgment
node scripts/settlement/independent/replay.js --policies policies.json --records records.json --now 2026-01-01T00:00:00Z
```

Plain Node 22, no install, no model, no GPU, no network. It takes about seven
seconds. Keys are fresh on each run; the counts do not change.

The first version of `replay.js` is commit `6d1ac8dae`, made before the
comparison. One thing was added afterwards: the `clockSkewMs` option, off by
default, used only to measure how much disagreement one unstated number explains.

## Result

The committed receipt is [receipts/differential.json](receipts/differential.json).

| | Count |
| --- | --- |
| Record sets | 745 |
| Judgments (one reservation, one record set, one clock value) | 1,146 |
| Same outcome and same debit and credits | 808 |
| Same outcome | 879 |
| Same debit and credits | 972 |
| Same outcome and amounts once the clock skew allowance is supplied | 867 |
| Disagreements | 338 |

The 14 base attempts are a complete answer, a requester stop, a dropped stage
(first or final), stages closing early, a requester that stops acknowledging, a
delivered answer one stage never closes, late closes, legacy terms, a low output
ceiling, three stages, a requester that computes the first stage itself, a stop
before any output, and a finished 40-output answer whose last one, two or three
acknowledgments never arrive. Each is judged at six clock values. Mutations
remove each record in turn, repeat and reorder records, edit signed fields,
re-sign with a wrong key, add validly signed records from a non-party, add second
terms, second chains, backward receipt sequences, late and early records,
acknowledgments beyond the ceiling or beyond delivery, terms that break the
policy, withheld records, stop statements and unsigned additions.

Repeating and reordering records never changed either verifier's answer (30 of
30 judgments agree). Removing one record at a time disagreed in 2 of 84
judgments; both are explained below.

## Facts the document does not state

A verifier cannot be written from the document. Each of these was taken from code.

Taken from the record producers before writing `replay.js`:

1. The field names, types and limits of every record: `server/fleet/settlement-terms.js:23-26` and `:39-62`; `packages/reploid/src/mesh/partitions/partition-attempt-evidence.js:41-45` and `:83-100`.
2. A record is its signed body plus two unsigned members, `publicJwk` and `signature`: `partition-attempt-evidence.js:75-79`.
3. The signed bytes are the UTF-8 canonical JSON of `{ signatureDomain: <schema>, payload: <body> }`: `packages/reploid/src/artifacts/participant-proofs.js:52`.
4. Canonical JSON sorts object keys by UTF-16 code unit and writes scalars as `JSON.stringify` does: `packages/reploid/src/artifacts/canonical-json.js:11-43`.
5. Signatures are Ed25519, or ECDSA P-256 with SHA-256 in raw `r||s` form, base64url, at most 256 characters: `participant-proofs.js:38-47` and `:61-69`; `packages/reploid/src/artifacts/identity.js:25-35`.
6. A participant ID is `peer:` plus the first 24 hex digits of SHA-256 over the canonical JSON of `{ kty, crv, x, y, n, e }`, absent members written as `null`: `identity.js:37-48`.
7. A digest is `sha256:` plus lowercase hex: `packages/reploid/src/hashing.js:16-30`.
8. The terms digest covers the terms body without key and signature; the policy digest covers the whole policy object: `settlement-terms.js:35-37`.
9. Which policy fields the terms repeat and under which names, for example the policy's `partitionUnclaimedReleaseMs` becomes `releaseWindowMs`: `settlement-terms.js:102-110`.
10. The release window starts at the deadline: `scripts/settlement/scenario.js:107`.
11. `K` is `maxUnacknowledgedOutputs` in `packages/reploid/src/mesh/partitions/partition-receiver-policy.json`. No signed record and no policy digest carries it, so two verifiers can disagree about `K` with nothing signed to settle it.
12. The chain's starting value is the digest of `{ schema: "reploid.output-chain/v1", reservationId, routeHash }`: `partition-attempt-evidence.js:61`. Extending the chain needs the output text (`:63`), which a verifier does not have, so it can compare chain values but not recompute them.
13. The charge binding is an output acknowledgment with count 0: `partition-attempt-evidence.js:146-153` and `:248`.
14. Receipt statuses are `executing`, `settled` and `failed`, and the last two close a stage: `partition-attempt-evidence.js:30` and `:220-224`.
15. Only the final stage's receipts carry `output`, and `output.done` marks the last output: `partition-attempt-evidence.js:168` and `:190`.
16. The provider-loss-free terms identifier, and that `null` means the older acknowledged-prefix charge: `server/fleet/credit-shares.js:9-15`.
17. The split: floor per stage in order, the last stage takes the remainder, and work the requester's own computer did is neither charged nor credited: `credit-shares.js:22-37`.

Found only in `server/fleet/settlement-replay.js`, after the comparison:

18. "In time" means `notBefore - maxClockSkewMs <= signedAt <= deadline + maxClockSkewMs` (`:81-82`). The document says "signed after the deadline".
19. Lateness is applied to stage receipts, acknowledgments and stops only (`:108-109`, `:133-134`, `:165`), not to terms or acceptances (`:66-90`).
20. The order in which outcomes are decided (`:66-157`).
21. A "delivered answer" needs the requester's in-time acknowledgment of the final count (`:137`), and so does a "finished" one (`:161`).
22. An acknowledgment above any stage's step count is a conflict (`:149-152`).
23. A chain value that differs between an acknowledgment and the final stage's receipt is a conflict (`:123-127`).
24. The count in a stop is not used (`:165`).
25. The window has passed when `at >= deadline + releaseWindowMs` (`:145`).
26. Receipts and acknowledgments must carry exactly the key's coordinates (`partition-attempt-evidence.js:108`); terms, acceptances and stops may carry extra key members (`settlement-terms.js:69-70`).
27. Validly signed records that name another attempt or come from a non-party are dropped without being listed (`:84`, `:96`, `:114-115`).
28. The ceiling and request-length checks that make terms `invalid` (`:76-78`). `replay.js` guessed these two correctly.

## Disagreements by cause

Each of the 338 disagreements has one cause. `(a)` is a reading of a sentence the
document leaves open, `(b)` a defect in the service's verifier, `(c)` a defect in
`replay.js`. Counts are judgments; the second number is how many differ in debit
or credits. Record sets are named by base attempt and mutation as the receipt and
`--verbose` print them.

### (b) Defects in the service's verifier: 103 judgments

**A finished answer is free when its last acknowledgments are withheld or late (39, amounts differ in 33).**
Record set: `runAttempt(parties, { outputs: <40 outputs>, stopAckingAfter: 39 })`,
every record, any clock. No mutation is needed. Both stages close `settled` and
the final stage signs `done: true`. The requester acknowledged 39 outputs in time.

| Last acknowledgments withheld | `replay.js` debit | Service debit |
| --- | --- | --- |
| 1 | 117 | 0 |
| 2 | 114 | 0 |
| 3 | 111 | 111 |

The service treats an answer as finished only when the requester acknowledged its
final count (`settlement-replay.js:161`). With no stop and at most `K`
outputs unacknowledged, it then reads the gap as "a stage ended the answer before
it finished" and charges nothing (`:166-168`), although the stage's own closing
receipt says the answer finished. A requester that withholds only its last one or
two acknowledgments receives every output and pays for none. That contradicts
three sentences of the document: "The requester is debited for the outputs it
acknowledged in time", "A requester that stops acknowledging therefore receives
at most `K + 1` unpaid outputs", and "Withholding can only produce `unknown`,
`expired` or a smaller acknowledged count". The existing test of an edited final
acknowledgment asserts only `debit <= 15` (`tests/unit/settlement-replay.test.js:94-101`),
so a debit of 0 passes, and the attack matrix stops acknowledging after 10 of 40
outputs (`scripts/settlement/attack-matrix.js:167`), which is past the gap.

**Terms and acceptances signed after the deadline still settle, and are not listed as late (52, amounts differ in 32).**
Record set: complete answer, "terms and acceptances signed 5 s late". Service:
settled, debit 15, empty late list. The document says "Records signed after the
deadline are listed as late and never raise a charge". The same document says the
Stage 1 harness signs acceptances "during or after the attempt", so the repair
may belong in that sentence instead of the code. Late stops are not listed either.

**An unsigned key member changes the outcome for two record kinds and not the other three (7, amounts differ in 6).**
Record set: complete answer, "top acknowledgment key carries an extra member"
(`alg` added to `publicJwk`). The service rejects that acknowledgment, and through
the first defect the debit falls from 15 to 0. The same addition to terms, an
acceptance or a stop is accepted. The key object is not signed, so whoever relays
a record can make this change.

**Terms from an unrelated key are reported as the requester contradicting itself (5).**
Record set: complete answer, "a stranger signs terms for the same reservation".
Service: `conflict`, "the requester signed different terms for one reservation".
No participant signed two sets. `replay.js` answers `unknown`. Under both, anyone
who learns a reservation ID can stop that reservation from settling.

### (c) Defect in `replay.js`: 6 judgments

**An acknowledgment beyond what any stage computed is charged (6, amounts differ in 2).**
Record set: complete answer, "acknowledgment above the signed output ceiling".
`replay.js` settles and charges 192 for 64 outputs when 5 were computed; the
service answers `conflict`. `replay.js` follows "debited for the outputs it
acknowledged in time, up to the signed output ceiling" to the letter. The service
is right. `replay.js` was left as it was because the document does not state the
rule; it should.

### (a) Sentences the document leaves open: 229 judgments

| Cause | Judgments | Amounts differ | `replay.js` reading | Service reading |
| --- | --- | --- | --- | --- |
| Clock skew allowance | 61 | 53 | late means signed after the deadline | one policy `maxClockSkewMs` of slack on each side |
| What a stop's count means | 51 | 40 | the requester's own statement: charge up to it; two different stops, or a stop below its acknowledgments, is a conflict | only the stop's existence matters |
| Delivered answer, closing receipt missing, window not passed | 40 | 0 | `open` | `unknown` at any clock, including before the deadline |
| Missing acceptance while a stage has not closed | 34 | 0 | `unknown` | `open` or `expired`; acceptance is checked only once every stage closed |
| What counts as a delivered answer | 20 | 0 | the final stage's `done` receipt | that receipt and the requester's in-time acknowledgment of it |
| Acknowledged chain differs from the stage's chain | 7 | 2 | `unknown`, since no single signer contradicted itself; a late acknowledgment's chain is ignored | `conflict`, attributed to the stage |
| A stage accepted two sets of terms | 5 | 3 | `conflict` | the second acceptance is ignored |
| No policy supplied | 5 | 0 | `invalid` | throws |
| Unfinished-answer terms it does not recognize | 3 | 3 | `unknown` | charges the acknowledged prefix |
| The instant the release window ends | 3 | 0 | `open` | `expired` |

## Found on the way, in both verifiers

These are not disagreements. Both verifiers behave the same way.

- **A final stage can make its own early close chargeable.** Under
  provider-loss-free terms a stage that closes early earns nothing. Record set:
  "stages close early on their own", mutation "final stage signs three more steps
  after the last acknowledged output, then closes". Both verifiers move from a
  debit of 0 to a debit of 9, reading the gap as the requester withholding
  acknowledgments. The requester has no record that shows it never received those
  outputs.
- **Nothing says who bears a conflict.** A requester that signs second terms after
  receiving an answer turns `settled` into `conflict`, and neither verifier
  reports an amount for a conflict. Under the service's verifier one extra
  acknowledgment with a made-up chain does the same and is attributed to the
  final stage (record set: "requester stops acknowledging", "extra
  acknowledgment of one more output, signed 5 s late").
- **`K` is not agreed in any signed record** (fact 11 above).

## Limits

- All parties are simulated identities on one machine, and one author wrote
  `replay.js` after reading the producer code. This is not a third-party replay
  and not evidence of separate operators.
- The record shape rules in `replay.js` copy the producers' rules, so the two
  verifiers cannot disagree about what a well-formed record is except where the
  producers disagree with each other.
- Only Ed25519 keys were exercised. The ECDSA P-256 path in `replay.js` has not
  been run.
- The late and rejected lists were compared by size only. The late lists match
  in 939 of 1,146 judgments and the rejected lists in 1,100 of 1,145 record sets;
  the differences follow from the causes above and from fact 27.
- Whether the service ledger (`server/fleet/credits.js`) shares the first defect
  was not checked. This comparison covers the replay verifier only.
