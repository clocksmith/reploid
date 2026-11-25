# Settlement replay for split answers

A split answer is computed by several computers that may belong to different
people. Settlement replay lets anyone recompute what the requester owes and what
each stage earns from the participants' own signed records, without reading the
operator's journal or balance.

This page is meant to be enough to write a second verifier. The reference
implementation is `server/fleet/settlement-replay.js`; the signers are
`server/fleet/settlement-terms.js` and
`packages/reploid/src/mesh/partitions/partition-attempt-evidence.js`.

## Records

| Record | Signed by | When | Binds |
| --- | --- | --- | --- |
| Settlement terms (`reploid.settlement-terms/v1`) | requester | before any input leaves its device | reservation, attempt, route hash, policy digest, price, output ceiling, each stage's weight, `K`, deadline, release window |
| Settlement acceptance (`reploid.settlement-acceptance/v1`) | each stage | before it reserves | the digest of those exact terms and its own stage index |
| Stage receipt (`reploid.stage-receipt/v1`) | each stage | after every step and at close | steps, tokens, timing, closing status; the final stage also commits a hash chain over its outputs |
| Output acknowledgment (`reploid.output-acknowledgment/v1`) | requester | for each output it received | the output count and chain value |
| Settlement stop (`reploid.settlement-stop/v1`) | requester | when it ends an answer early | the reservation, attempt and its acknowledged count |

Participant IDs derive from public keys, so a signature names its signer without an
enrollment table. A stage does not compute step `s` (counting from 0) without the
requester's acknowledgment of at least `s - K` outputs. `K` is
`maxUnacknowledgedOutputs`: the stages enforce their receiver policy's value
(`partition-receiver-policy.json`, currently 2), the requester signs it into the
terms, and a stage accepts only terms that name the value it enforces. A requester
that stops acknowledging therefore receives at most `K + 1` unpaid outputs.

### Encoding

- **Record shape.** A record is its signed body plus exactly two unsigned
  members, `publicJwk` and `signature`. The body is the record without those two.
- **Canonical JSON.** Object keys are sorted by UTF-16 code unit (the default
  order of `Array.prototype.sort`), with no whitespace. Strings, numbers, booleans
  and `null` are written as `JSON.stringify` writes them. Arrays keep their order.
  Records contain only finite JSON values.
- **Signed bytes.** The UTF-8 bytes of the canonical JSON of
  `{ "signatureDomain": <the record's schema>, "payload": <body> }`.
- **Keys.** `publicJwk` must be exactly `{ kty: "OKP", crv: "Ed25519", x }` or
  `{ kty: "EC", crv: "P-256", x, y }`, with no other member (no `alg`, no `d`).
  Each coordinate matches `^[A-Za-z0-9_-]{16,128}$`. A record whose key carries
  anything else is rejected, whatever its kind.
- **Signatures.** Ed25519, or ECDSA P-256 with SHA-256 whose signature is the raw
  `r || s` form WebCrypto produces. The signature is base64url without padding,
  1 to 256 characters.
- **Participant ID.** `peer:` followed by the first 24 hex digits of SHA-256 over
  the canonical JSON of `{ kty, crv, x, y, n, e }`, where any member the key does
  not have is written as `null`. The signer field of each record (below) must
  equal the ID of the carried key.
- **Digests.** `sha256:` followed by the 64 lowercase hex digits of SHA-256 over
  the UTF-8 canonical JSON of the value.
  - policy digest: the whole public policy object, as published;
  - terms digest: the terms body (the record without `publicJwk` and `signature`);
  - route hash: the canonical route attempt binding
    `{ schema, threadId, attemptId, requesterId, placementGeneration, route }`.
    A verifier never needs to recompute it, but because it covers `requesterId`,
    another requester's binding of the same route has a different hash.
- **Output chain.** The value before any output is the digest of
  `{ schema: "reploid.output-chain/v1", reservationId, routeHash }`. Each step
  `step` (from 0) with text `delta` extends it to the digest of
  `{ previous, step, delta }`. A verifier has no output text, so it compares chain
  values between records but cannot recompute them.
- **Charge binding.** The requester's acknowledgment with `count: 0` and the
  starting chain value. Every stage receives it before the first step.
- **Times.** Strings of at most 40 characters that `Date.parse` accepts. Signers
  write `Date.prototype.toISOString` output.

### Record fields

Every listed member is required and no other is allowed. "Text" is a non-empty
string; the number after it is its maximum length (256 when not given). "Count" is
a safe integer `>= 0`; "positive" is a safe integer `> 0`.

- **Terms** (signer: `requesterId`): `schema`; `reservationId` text 160;
  `attemptId`; `routeHash` digest; `requesterId`; `policyDigest` digest; `unit`
  text 64; `creditsPerOutputToken` positive; `maxOutputTokens` positive; `maximum`,
  equal to `maxOutputTokens * creditsPerOutputToken`; `shares`, 1 to 128 entries
  of exactly `{ partitionIndex, participantId, weight }` with `partitionIndex`
  equal to the entry's position and `weight` positive; `unfinishedTerms`, `null` or
  text 128; `maxUnacknowledgedOutputs` count (this is `K`); `notBefore` and
  `deadline` times with `deadline` after `notBefore`; `releaseWindowMs` positive;
  `signedAt` time.
- **Acceptance** (signer: `participantId`): `schema`; `termsDigest` digest;
  `reservationId` text 160; `attemptId`; `participantId`; `partitionIndex` count;
  `signedAt` time.
- **Stop** (signer: `requesterId`): `schema`; `reservationId` text 160;
  `attemptId`; `requesterId`; `acknowledged` count; `signedAt` time.
- **Stage receipt** (signer: `participantId`): `schema`; `reservationId` text 160;
  `attemptId`; `routeHash` digest; `partitionIndex` count; `participantId`;
  `sequence`, an integer `>= 1` that rises by one per receipt; `status`, one of
  `executing`, `settled` or `failed` (the last two close the stage); `steps` count;
  `tokens`, exactly `{ prompt, processed }` with `prompt` `null` or a count and
  `processed` a count; `timing`, exactly `{ reservedAt, firstStepAt, lastStepAt,
  closedAt }`, each `null` or a time; `output`; `signedAt` time. `output` is `null`
  except on the final stage, where it is exactly `{ count, chain, done, stopReason }`
  with `count` equal to `steps`, `chain` a digest, `done` a boolean (true on the
  last output) and `stopReason` `null` or text 64.
- **Acknowledgment** (signer: `requesterId`): `schema`; `reservationId` text 160;
  `attemptId`; `routeHash` digest; `requesterId`; `count` count; `chain` digest;
  `signedAt` time.

The policy fields the replay reads are `unit`, `creditsPerOutputToken`,
`maxOutputTokens`, `maxRequestMs`, `maxClockSkewMs` and
`partitionUnclaimedReleaseMs`. Terms repeat some of them: `unit` and
`creditsPerOutputToken` under the same names, and
`partitionUnclaimedReleaseMs` as `releaseWindowMs`.

## Deciding an outcome

`server/fleet/settlement-replay.js` takes the public policies, a verification time
`at` and any set of these records. Records that fail their shape, key or
signature checks are listed as `rejected` and play no further part. Identical
bodies presented twice count once. The rest are grouped by `reservationId` and
then by requester: terms, acknowledgments and stops go to the attempt of the
`requesterId` they name, and acceptances and stage receipts, which name no
requester, are offered to every attempt under that reservation. Each
(reservation, requester) attempt is one row of the output, so a stranger that
signs its own terms, acceptance and charge binding under a known reservation ID
makes a separate attempt that can charge only the stranger. Each attempt is
decided in this order. `inTime(t)` means
`notBefore - maxClockSkewMs <= t <= deadline + maxClockSkewMs`, using the agreed
terms and the policy they name.

1. **Which terms.** Terms count only when they sit on the attempt's route. For
   the terms' `attemptId`, at least one acknowledgment, or one stage receipt from
   a participant the terms name at that receipt's `partitionIndex`, must be
   presented. If any such stage receipt is presented, one of them must carry the
   terms' `routeHash`. If any
   acknowledgment is presented, one must carry that `routeHash` with the terms'
   `requesterId`. Other terms are listed as `foreign` and can never cause a
   conflict. Terms whose own `signedAt` is outside their own window are listed as
   `late` and ignored.
2. **One set or several.** With no terms left the outcome is `unknown`. When one
   requester signed several sets, the set that every in-time acceptance names is
   agreed. The requester's equivocation is listed in `conflicts` with
   `kind: "terms-equivocation"`, `blocking: false` and the settled digest. If
   acceptances name different sets, or none, the outcome is `conflict`.
3. **Policy.** `invalid` unless the policy digest names a supplied policy and the
   terms repeat its `unit`, `creditsPerOutputToken` and `releaseWindowMs`, with
   `maxOutputTokens` at most the policy's, and `deadline - notBefore` at most
   `maxRequestMs`.
4. **Records of this attempt.** Acceptances, receipts, acknowledgments and stops
   are kept only when they name the agreed `attemptId`. Receipts must also carry
   the agreed `routeHash` and come from the participant the terms name at their
   `partitionIndex`. Acknowledgments must carry the agreed `routeHash` and
   `requesterId`. An acceptance counts only for the agreed terms digest and its
   own share. Any of these signed outside `inTime` is listed as `late` and
   ignored. Records that name another attempt or come from a non-party are
   dropped without being listed.
5. **Acknowledged count and contradictions.** The final stage's committed chain
   at a count is the chain its receipts give for that `output.count`; at count 0
   it is the starting value, which anyone can compute. A count is *matched* when
   an in-time acknowledgment of it carries the committed chain. The
   **acknowledged** count is the highest matched count (0 if none).
   - Another in-time acknowledgment of a matched count, with a different chain,
     is the requester contradicting itself. It is listed in `conflicts` with
     `kind: "acknowledgment-equivocation"`, `blocking: false`, the requester as
     signer and the matched chain as `settledOn`. It never lowers the charge.
   - An in-time acknowledgment of a count to which no presented final-stage
     receipt commits is listed in `unmatched` and not charged.

   The outcome is `conflict` if any of these hold:
   - a stage's receipts repeat a sequence, have steps that go backwards, or
     continue after a closing receipt (late receipts included);
   - the final stage's receipts give two chains for one count;
   - the requester acknowledged a count in time, but none of its chains for that
     count is the final stage's. The records cannot show which of the two lied,
     so the entry has `signer: null` and `signers` naming both;
   - the charge binding's chain is not the starting value and no other in-time
     binding has it.
6. **Closing.** A stage has closed when its latest in-time receipt is `settled`
   or `failed` and has `closedAt`. The answer was delivered when the final
   stage's latest in-time receipt has `output.done` at count `N > 0` and the
   acknowledged count is `N`.
   - If the answer was delivered and some stage did not close, look at that
     stage's latest in-time receipt. If it has `steps >= N`, the stage signed a
     receipt for every step of the answer: it evidently computed all of it.
     After the release window (`at >= deadline + releaseWindowMs`) it is treated
     as closed at its last signed step, listed in `closedAtLastStep`, and paid
     its share. Before then the outcome is `open`. A stage with no in-time
     receipt covering the answer makes the outcome `unknown`.
   - Otherwise, if not every stage closed, the outcome is `open` while
     `at < deadline + releaseWindowMs`, and `expired` after it. An expired attempt
     charges nobody and pays nobody.

   One stage withholding its closing receipt therefore cannot stop every
   stage's payment for an answer the requester received and acknowledged in
   full. The rule needs the final stage's signed `done` and the requester's
   acknowledgment of that exact count with the final stage's chain. An answer
   that did not finish (a lost provider, a stage ending early) never meets it
   and stays `expired` or provider-loss free, as before. The live ledger
   (`server/fleet/credits.js`) does not apply this rule yet: it still needs
   every stage's closing receipt, so here the replay settles an attempt the
   ledger has not.
7. **Steps.** The outcome is `conflict` if any stage's latest receipt has fewer
   `steps` than the acknowledged count.
8. **Acceptances.** The outcome is `unknown` if any stage has no in-time
   acceptance of the agreed terms.
9. **Settled.** Let `acknowledged` be the acknowledged count from step 5 and
   `delivered` the final stage's latest in-time `output`.
   - The answer **finished** when `delivered.done` is true. The requester then
     owes every output it acknowledged in time, however many acknowledgments it
     withheld at the end.
   - The requester **stopped** when an in-time stop of its own exists. The
     stop's `acknowledged` count is not used.
   - The requester **withheld** when `delivered.count - acknowledged` is greater
     than the terms' `maxUnacknowledgedOutputs`.
   - Under `unfinishedTerms` equal to
     `reploid.unfinished-answer/provider-loss-free/v1`, an answer that did not
     finish, was not stopped and was not withheld was ended by a stage. It charges
     0. With `unfinishedTerms: null` (older terms), or any other value, the
     acknowledged prefix is charged.
   - Otherwise the charge units are
     `min(acknowledged, maxOutputTokens) * creditsPerOutputToken`.

### Split arithmetic

These are the same integers the ledger posts (`server/fleet/credit-shares.js`).
Let `W` be the sum of the weights and `U` the charge units. Stage `i`, in stage
order, receives `floor(U * weight_i / W)` in exact integer arithmetic, and the last
stage receives what remains, so the credits sum to `U`. Work done by the
requester's own account is neither charged nor credited. The debit is `U` minus
those own-account shares. Without `accountOf`, every participant ID is its own
account. With it, the replay groups participant IDs into owner accounts as the
ledger does, and `balances` sums per account.

## Outcomes

- **settled:** every stage closed in time, or the answer was delivered and the
  stages that did not close are treated as closed under step 6. The requester is
  debited for the
  outputs it acknowledged in time, up to the signed output ceiling. Under
  provider-loss-free terms an unfinished answer is owed only if the requester
  ended it, by a signed stop or by withholding more than `K` acknowledgments. A
  stage that closes early on its own, even with a `failed` receipt, earns nothing
  and costs the requester nothing. A finished answer is owed for every output
  acknowledged in time.
- **expired:** the release window passed without every stage closing and without
  a delivered answer. Nobody is charged or paid.
- **open:** the release window has not passed yet.
- **conflict:** a participant signed incompatible statements. `conflicts` names
  the signer and the kind.
- **unknown:** the records cannot decide. Examples are a delivered answer where
  one stage presented no receipt covering it, or missing terms or acceptance.
- **invalid:** the terms do not match the named policy.

Each row also lists `late` records (ignored), `foreign` terms (ignored),
`unmatched` acknowledgments (not charged) and `requesterId`. Edited records fail their signatures and are listed as
rejected.

### Who bears a conflict

A conflict moves no credit. The requester is not debited and no stage is
credited, so the stages bear the work they did. The listed signer is the party
that contradicted itself. That list is for reputation and exclusion, not for an
amount. It follows that:
- a stage that signs two chains or contradictory receipts loses its own payment
  and its partners'. Its partners can show the conflict names that stage;
- a requester's second terms do not cause a conflict when the stages accepted
  one set. The replay settles on that set and records the equivocation;
- a requester's second acknowledgment for a count, with another chain, does not
  cause a conflict when it also signed the final stage's chain for that count.
  The replay charges that count and lists the extra acknowledgment against the
  requester as `acknowledgment-equivocation`, not blocking;
- a requester can still turn an attempt into a conflict by signing, for some
  count, only acknowledgments whose chain differs from the final stage's. The
  record cannot show which of the two signers lied, so the entry names both.

## What it does and does not establish

It establishes who signed what, and the amounts those signatures imply under a
public policy. Operator-held state is not needed for any of it.

It does not establish:
- that any computation was correct;
- that a participant did not withhold a record. Withholding can only produce
  `unknown`, `expired` or a smaller acknowledged count.
- who owns a participant key.

Known limits:
- **A requester and a stage acting together** can still make an answer free.
  The stage withholds every receipt covering the answer, or withholds its
  closing receipt while the requester withholds its last acknowledgment. The
  other stage is then unpaid. One stage alone can no longer do this (step 6).
- **L3, a faked stall: a stage can sign steps nobody received.** Under
  provider-loss-free terms a final stage that stops early earns nothing. But that
  stage can sign `K + 1` or more further step receipts that it never delivered,
  then close. The gap then reads as the requester withholding acknowledgments,
  and the acknowledged prefix is charged. The requester has no signed record
  showing it never received those outputs, so no verifier can tell this from a
  requester that received them and stopped acknowledging. The final stage alone
  defeats the free-abandoned-answer rule this way. The bound still holds: the
  requester pays only for outputs it acknowledged.
- **L5, backdating.** Every signer writes its own `signedAt`. Stages that sign
  their late receipts with in-time times are paid for an attempt that, by an
  honest clock, ran past its deadline. A requester can likewise sign a second
  acknowledgment afterwards; under step 5 that no longer lowers its charge.
- **A disputed chain is undecidable.** A requester that signs, for the final
  count, only an acknowledgment whose chain differs from the final stage's makes
  the attempt `conflict`, because a verifier without the output text cannot tell
  whether the stage or the requester lied. That count's honest acknowledgment,
  if any party holds it, settles the attempt instead.

In the Stage 1 harness (`scripts/stage1/`) these records are collected by the
harness, not by live code: the requester signs its terms inside its own
disclosure approval, before the reservation and dispatch, and each stage signs
its acceptance with its own key during or after the attempt, because live code
does not yet carry terms to a stage before it reserves. Those acceptances count
only when signed before the deadline plus the clock skew allowance. Every Stage 1
receipt replays the split, stopped and dropped attempts from those records and
the participants' own stage receipts and acknowledgments, labels the result
`termsCollectedBy: 'stage1-harness'`, and fails unless the replay matches the
ledger and the terms name the ledger's exact policy digest.

## Checking it

```sh
npx vitest run --config tests/vitest.config.js tests/unit/settlement-replay.test.js
node scripts/settlement/attack-matrix.js --out /absolute/path/matrix.json
node scripts/settlement/baseline-matrix.js --out /absolute/path/baseline.json
```

The unit tests include a check that the replay's charge and credits equal the
live ledger's (`server/fleet/credits.js`) for the same signed records.

The attack matrix judges the same attempts three ways with real signatures: the
replay; an operator-signed usage log (B1); and a usage log that the requester and
every credited stage countersign after the attempt (B2). Its rows are operator
goals (overcharge, shift or drop a stage's credit, fabricate a request, charge an
abandoned attempt, settle twice) and participant cases (a requester that stops
paying, one that withholds only its last acknowledgment, equivocation, a withheld
closing receipt, late evidence). B1 lets all six operator goals through and B2
two. Neither log uses what the requester signs before and during the answer, so
they are weak baselines, and the replay's 0 against them overstates its gap to a
simple scheme.

The strongest simple baseline is in `scripts/settlement/baseline-matrix.js`
(B3): the requester-signed terms that every named stage accepted are an
agreement, each requester acknowledgment is an accepted debit note for a
cumulative output count, and the requester owes the highest count it accepted
in time, split by the signed weights. Accepted debit notes let 1 of the 6
operator goals through (charging an abandoned attempt), against 0 for the
replay. The requester-signed terms and cumulative acknowledgments do most of the
work: on every other operator goal, and on the participant cases where the
requester stops paying or withholds its last acknowledgment, B3 and the replay
reach the same amounts. What the stage receipts and the `done` flag add is that
an abandoned answer is free (G5, P6, P7). The final stage alone can defeat that
with a faked stall (L3), and then both schemes charge the acknowledged prefix.

The replay used to lose three participant cases to B3: one stage vetoing every
payment by withholding its closing receipt (L1), a requester voiding its own
charge with a second acknowledgment (L2), and a stranger making a reservation
undecidable under its ID (L4). With the rules above, the replay and B3 reach the
same amounts in all three. The same file also runs the replay over records a
third-party witness timestamped (B4). It lets 0 operator goals through and
changes the replay's verdict only where a signer backdates (L5), at the cost of
a new party that must be online and trusted for time.

Two differences from the countersigned log come from this design:
- The countersigned log lets an operator move or drop a stage's share when the
  requester and one stage agree. The replay fixes shares in terms signed before
  dispatch.
- The countersigned log puts no limit on unpaid delivery. The replay's
  acknowledgment bound does.

These are differences in how the parts are combined, not a new cryptographic
primitive. Signed accountability logs (PeerReview), requester-accepted
incremental billing (Golem debit notes) and expiring holds (HTLCs) each cover
part of it. The mesh-llm pull requests on signed inference receipts (#2851,
closed unmerged on 2026-11-10; #2981, open and last updated on 2026-11-24) audit
which model a peer served and gate payment on those audits. They are
complementary prior art, not a scheme for settlement amounts, and Reploid has
no counterpart to their payment gating.

The committed matrix outputs are [scripts/settlement/receipts/attack-matrix.json](../scripts/settlement/receipts/attack-matrix.json) and [scripts/settlement/receipts/baseline-matrix.json](../scripts/settlement/receipts/baseline-matrix.json). They were generated by `node scripts/settlement/attack-matrix.js --out scripts/settlement/receipts/attack-matrix.json` and `node scripts/settlement/baseline-matrix.js --out scripts/settlement/receipts/baseline-matrix.json`, with fresh keys on each run; the counts are deterministic. All parties in this matrix are simulated identities on one machine, so it is not evidence of separate operators or of an independent third-party replay.
