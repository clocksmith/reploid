# Settlement replay for split answers

A split answer is computed by several computers that may belong to different
people. Settlement replay lets anyone recompute what the requester owes and what
each stage earns from the participants' own signed records, without reading the
operator's journal or balance.

## Records

| Record | Signed by | When | Binds |
| --- | --- | --- | --- |
| Settlement terms (`reploid.settlement-terms/v1`) | requester | before any input leaves its device | reservation, attempt, route hash, policy digest, price, output ceiling, each stage's weight, deadline, release window |
| Settlement acceptance (`reploid.settlement-acceptance/v1`) | each stage | before it reserves | the digest of those exact terms and its own stage index |
| Stage receipt (`reploid.stage-receipt/v1`) | each stage | after every step and at close | steps, tokens, timing, closing status; the final stage also commits a hash chain over its outputs |
| Output acknowledgment (`reploid.output-acknowledgment/v1`) | requester | for each output it received | the output count and chain value |
| Settlement stop (`reploid.settlement-stop/v1`) | requester | when it ends an answer early | the reservation, attempt and its acknowledged count |

Participant IDs derive from public keys, so a signature names its signer without an
enrollment table. A stage does not compute step `s` without the requester's
acknowledgment of at least `s - K` outputs (`K` is
`maxUnacknowledgedOutputs`, currently 2). A requester that stops acknowledging
therefore receives at most `K + 1` unpaid outputs.

## Outcomes

`server/fleet/settlement-replay.js` takes the public policies and any set of these
records and reports each reservation as exactly one of the following.

- **settled:** every stage closed before the deadline. The requester is debited
  for the outputs it acknowledged in time, up to the signed output ceiling, and
  the debit is split by the signed weights using the ledger's own arithmetic
  (`credit-shares.js`).

  Under provider-loss-free terms an unfinished answer is owed only if the
  requester ended it. That means either a signed stop, or acknowledgments
  withheld until a stage refused to continue (more than `K` outputs
  unacknowledged). A stage that closes early on its own, even with a `failed`
  receipt, earns nothing and costs the requester nothing.
- **expired:** the release window passed without every stage closing and without
  a delivered answer. Nobody is charged or paid.
- **open:** the release window has not passed yet.
- **conflict:** a participant signed incompatible statements. Examples are two sets
  of terms, two output chains for one count, or a receipt sequence that goes
  backwards.
- **unknown:** the records cannot decide. Examples are a delivered answer with a
  stage's closing receipt missing, or missing terms or acceptance.
- **invalid:** the terms do not match the named policy.

Records signed after the deadline are listed as late and never raise a charge.
Edited records fail their signatures and are listed as rejected.

## What it does and does not establish

It establishes who signed what, and the amounts those signatures imply under a
public policy. Operator-held state is not needed for any of it.

It does not establish:
- that any computation was correct;
- that a participant did not withhold a record. Withholding can only produce
  `unknown`, `expired` or a smaller acknowledged count.
- who owns a participant key.

A requester and a stage acting together can make an answer free by having that
stage withhold its closing receipt. The other stage is then unpaid.

In the Stage 1 harness (`scripts/stage1/`) these records are collected by the
harness, not by live code: the requester signs its terms inside its own
disclosure approval, before the reservation and dispatch, and each stage signs
its acceptance with its own key during or after the attempt, because live code
does not yet carry terms to a stage before it reserves. Every Stage 1 receipt
replays the split, stopped and dropped attempts from those records and the
participants' own stage receipts and acknowledgments, labels the result
`termsCollectedBy: 'stage1-harness'`, and fails unless the replay matches the
ledger and the terms name the ledger's exact policy digest.

## Checking it

```sh
npx vitest run --config tests/vitest.config.js tests/unit/settlement-replay.test.js
node scripts/settlement/attack-matrix.js --out /absolute/path/matrix.json
```

The attack matrix judges the same attempts three ways with real signatures: the
replay; an operator-signed usage log; and a usage log that the requester and every
credited stage countersign after the attempt. Its rows are operator goals
(overcharge, shift or drop a stage's credit, fabricate a request, charge an
abandoned attempt, settle twice) and participant cases (a requester that stops
paying, equivocation, a withheld closing receipt, late evidence).

Two differences from the countersigned log come from this design:
- The countersigned log lets an operator move or drop a stage's share when the
  requester and one stage agree. The replay fixes shares in terms signed before
  dispatch.
- The countersigned log puts no limit on unpaid delivery. The replay's
  acknowledgment bound does.

These are differences in how the parts are combined, not a new cryptographic
primitive. Signed accountability logs (PeerReview), requester-accepted
incremental billing (Golem debit notes), expiring holds (HTLCs) and signed
split-serving receipts (mesh-llm) each cover part of it.

The committed matrix output is [scripts/settlement/receipts/attack-matrix.json](../scripts/settlement/receipts/attack-matrix.json). It was generated by `node scripts/settlement/attack-matrix.js --out scripts/settlement/receipts/attack-matrix.json`, with fresh keys on each run; the counts are deterministic. All parties in this matrix are simulated identities on one machine, so it is not evidence of separate operators or of an independent third-party replay.
