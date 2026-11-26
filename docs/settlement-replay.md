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
| Settlement terms (`reploid.settlement-terms/v1`) | requester | before any input leaves its device | reservation, `attemptId`, route hash, policy digest, price, output ceiling, each stage's weight, `K`, deadline, release window, and when present the ledger account the requester is charged from (`debitAccount`) |
| Settlement acceptance (`reploid.settlement-acceptance/v1`) | each stage | before it reserves | the digest of those exact terms, its own stage index, and when present the ledger account its share is paid into (`payoutAccount`) |
| Stage receipt (`reploid.stage-receipt/v1`) | each stage | after every step and at close | steps, tokens, timing, closing status; the final stage also commits a hash chain over its outputs |
| Output acknowledgment (`reploid.output-acknowledgment/v1`) | requester | for each output it received | the output count and chain value |
| Settlement stop (`reploid.settlement-stop/v1`) | requester | when it ends an answer early, before its stages are told to stop | the reservation, `attemptId` and its acknowledged count |
| Stage fault (`reploid.settlement-stage-fault/v1`) | a stage | when it has failed and will sign no closing receipt | the reservation, `attemptId`, route hash and its own stage index; read only under the failed-stage terms (step 6) |

Participant IDs derive from public keys, so a signature names its signer without an
enrollment table. A stage does not compute step `s` (counting from 0) without the
requester's acknowledgment of at least `s - K` outputs. `K` is
`maxUnacknowledgedOutputs`: the stages enforce their receiver policy's value
(`partition-receiver-policy.json`, currently 2), the public credit policy
publishes it under the same name (so it is covered by the policy digest the terms
sign), the requester signs it into the terms, a stage accepts only terms that
name the value it enforces, and the replay answers `invalid` for terms that name
another than their policy's (step 3). A requester that stops acknowledging
therefore receives at most `K + 1` unpaid outputs.

An **attempt** here is always one (`reservationId`, `requesterId`) pair: the
requester's attempt to have one answer computed under one reservation. Each
attempt is one row of the replay's output. `attemptId` is a field of the records
and is called `attemptId` wherever it is meant.

### Encoding

- **Record shape.** A record is its signed body plus exactly two unsigned
  members, `publicJwk` and `signature`. The body is the record without those two.
- **Canonical JSON.** Object keys are sorted by UTF-16 code unit (the default
  order of `Array.prototype.sort`), with no whitespace. Strings, numbers, booleans
  and `null` are written as `JSON.stringify` writes them. Arrays keep their order.
  Records contain only finite JSON values.
- **Signed bytes.** The UTF-8 bytes of the canonical JSON of
  `{ "signatureDomain": <the record's schema>, "payload": <body> }`.
- **Base64url.** Every key coordinate and signature is *canonical* base64url:
  the alphabet `A-Z a-z 0-9 - _`, no `=` padding, exactly `ceil(4n / 3)`
  characters for `n` bytes, and unused trailing bits zero, so that decoding and
  encoding again gives the same text. A decoder accepts several texts for one byte
  string; a record accepts only this one, because neither member is signed and a
  relay could otherwise make a second accepted form of a record.
- **Keys.** `publicJwk` must be exactly `{ kty: "OKP", crv: "Ed25519", x }` or
  `{ kty: "EC", crv: "P-256", x, y }`, with no other member (no `alg`, no `d`).
  Each coordinate is 32 bytes, so 43 canonical base64url characters. One key
  therefore has one text and one participant ID. A record whose key carries
  anything else is rejected, whatever its kind.
- **Signatures.** Ed25519, or ECDSA P-256 with SHA-256 whose signature is the raw
  `r || s` form WebCrypto produces. Either is 64 bytes, so 86 canonical base64url
  characters; a padded or otherwise different text is rejected. A P-256 signature
  must also be **low-S**: `s`, read as a big-endian integer, satisfies
  `1 <= s <= n / 2` (rounded down), where `n` is the order of the P-256 group,
  `0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551`. For a
  valid `(r, s)`, `(r, n - s)` also verifies over the same bytes, so without this
  rule a relay could make a second accepted form of any P-256 record. A record
  whose signature has high S is rejected, whatever its kind. WebCrypto does not
  choose low S, so the signers replace a high `s` with `n - s` when they sign.
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
  values between records but cannot recompute any value after the first.
- **Charge binding.** The requester's acknowledgment with `count: 0` and the
  starting chain value. Every stage receives it before the first step.
- **Times.** Exactly the form `Date.prototype.toISOString` writes, in UTC:
  `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`, naming a real instant
  (writing it again with `toISOString` gives the same text). Every signer writes
  this form. Any other form, such as a time without a zone or with `+00:00`, makes
  the record malformed: `Date.parse` reads a zone-less time as the verifier's local
  time, so the same record would be in time on one machine and late on another.
  This holds for every time field: terms `notBefore`, `deadline` and `signedAt`,
  each record's `signedAt`, and each non-null `timing` member of a receipt.

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
  `signedAt` time. One older shape is also accepted: terms signed before terms
  carried `K` have every member above except `maxUnacknowledgedOutputs`, and
  their `unfinishedTerms` must be `null` or
  `reploid.unfinished-answer/provider-loss-free/v1`. Terms without the member
  that name any other `unfinishedTerms` are malformed, so terms under the
  decided rules always sign `K`. A newer shape is accepted as well: terms that
  have every member above, `K` included, may carry one more, `debitAccount`
  text 128, the ledger account the requester is charged from (see step 8).
- **Acceptance** (signer: `participantId`): `schema`; `termsDigest` digest;
  `reservationId` text 160; `attemptId`; `participantId`; `partitionIndex` count;
  `signedAt` time. An acceptance has exactly these members, or these and
  `payoutAccount` text 128, the ledger account this stage's share is paid into
  (see step 8).
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
- **Stage fault** (signer: `participantId`): `schema`; `reservationId` text 160;
  `attemptId`; `routeHash` digest; `partitionIndex` count; `participantId`;
  `signedAt` time. A record with this schema that fails its shape check is
  rejected with problem `fault_malformed`.

The policy fields the replay reads are `unit`, `creditsPerOutputToken`,
`maxOutputTokens`, `maxRequestMs`, `maxClockSkewMs`,
`partitionUnclaimedReleaseMs` and `maxUnacknowledgedOutputs`. Terms repeat some
of them: `unit`, `creditsPerOutputToken` and `maxUnacknowledgedOutputs` under the
same names, and `partitionUnclaimedReleaseMs` as `releaseWindowMs`.
`maxUnacknowledgedOutputs` is `K`. A policy published before it carried `K` has
no such member; for such a policy `K` is the stages' receiver policy's value,
which `replaySettlement` takes as its `maxUnacknowledgedOutputs` input (by
default 2, from `partition-receiver-policy.json`). A policy that names `K` decides
it, whatever that input says. A policy is usable only when
`partitionUnclaimedReleaseMs` is greater than `maxClockSkewMs`: otherwise a record
signed in time could reach the ledger only after the release window closed its
hold. The ledger refuses to run under such a policy, and the replay answers
`invalid` for terms that name one (step 3).

## Deciding an outcome

`server/fleet/settlement-replay.js` takes the public policies (possibly none), a
verification time `at` and any set of these records. Records that fail their
shape, key or signature checks are listed as `rejected` and play no further part.
Identical bodies presented twice count once. The rest are grouped into attempts:
terms, acknowledgments and stops go to the attempt of the `reservationId` and
`requesterId` they name, and acceptances, stage receipts and stage faults, which
name no requester, are offered to every attempt under their `reservationId`. A stranger
that signs its own terms, acceptance and charge binding under a known reservation
ID therefore makes a separate attempt that can charge only the stranger. With
signed accounts (step 8) that holds only where the caller supplies the
enrollment as `accountOf`: an account is then refused unless its signer is
enrolled under it. Without `accountOf` a signed account is only what its signer
asked for, and a stranger's terms can name any account text. Each
attempt is decided in this order. `inTime(t)` means
`notBefore - maxClockSkewMs <= t <= deadline + maxClockSkewMs`, using the agreed
terms and the policy they name. `closesInTime(t)` means
`notBefore - maxClockSkewMs <= t <= deadline + releaseWindowMs + maxClockSkewMs`.
Both windows carry the clock allowance at both ends, and because the policy's
release window is longer than the allowance, the closing window ends at least
`releaseWindowMs` after the ordinary one: a closing receipt is never late at an
instant where the same receipt without `closedAt` would count. The **release
window has passed** at `at > deadline + releaseWindowMs + maxClockSkewMs`, after
the last instant at which `closesInTime` holds: until then a closing receipt
signed in time can still be presented and change the outcome.

1. **Which terms.** Terms count unless another route contradicts them. Look at
   the records with the terms' `attemptId`. If any stage receipt from a
   participant the terms name at that receipt's `partitionIndex` is presented,
   one of them must carry the terms' `routeHash`. If any acknowledgment is
   presented, one must carry that `routeHash` with the terms' `requesterId`.
   Terms that fail either test are listed as `foreign` and can never cause a
   conflict. Terms with no such receipt and no acknowledgment pass: they describe
   an attempt that never started, which step 6 makes `open` and then `expired`.
   Terms whose own `signedAt` is outside their own window (`inTime` with their own
   `notBefore`, `deadline` and named policy) are listed as `late` and ignored;
   terms that name an unsupplied policy are not timed here and reach step 3.
2. **One set or several.** With no terms left the outcome is `unknown`. When the
   requester signed several sets (whatever their `attemptId`s), the set that every
   in-time acceptance names is agreed, and the equivocation is listed in
   `conflicts` (below) with `blocking: false` and the agreed digest as
   `settledOn`. If acceptances name different sets, or none, the outcome is
   `conflict`.
3. **Policy.** `invalid` unless the policy digest names a supplied policy whose
   `partitionUnclaimedReleaseMs` is greater than its `maxClockSkewMs`, and the
   terms repeat its `unit`, `creditsPerOutputToken` and `releaseWindowMs`, with
   `maxOutputTokens` at most the policy's, `deadline - notBefore` at most
   `maxRequestMs`, and `maxUnacknowledgedOutputs` equal to `K`: the policy's
   `maxUnacknowledgedOutputs`, or for a policy without one the receiver policy's
   value. Terms of the older shape, with no `maxUnacknowledgedOutputs` member,
   pass this last check only against a policy that has no
   `maxUnacknowledgedOutputs` either, and `K` for them is the receiver policy's
   value; against a policy that publishes `K` they are `invalid`. With no policy
   supplied, every attempt that reaches this step is `invalid`.
4. **Records kept.** Acceptances, receipts, acknowledgments and stops are kept
   only when they name the agreed `attemptId`. Receipts must also carry the agreed
   `routeHash` and come from the participant the terms name at their
   `partitionIndex`. Acknowledgments must carry the agreed `routeHash` and
   `requesterId`. An acceptance counts only for the agreed terms digest and its
   own share. When the agreed terms carry `debitAccount`, an acceptance without
   `payoutAccount` is dropped without being listed (step 2 has still counted it
   for the set it names); when they do not, an acceptance's `payoutAccount` is
   not used. When the agreed terms' `unfinishedTerms` is the failed-stage value
   (step 6), a stage fault is kept on the same tests as a receipt: the agreed
   `attemptId` and `routeHash`, from the participant the terms name at its
   `partitionIndex`. Under any other `unfinishedTerms` every stage fault is
   dropped without being listed. A closing receipt (`settled` or `failed`, with
   `closedAt`) and a stage fault count when signed `closesInTime`; every other
   kept record counts when signed `inTime`. A kept record that does not count is **late**: it is listed in
   `late`, whatever the outcome, and it is ignored for everything that decides an
   amount or an outcome other than `conflict`, with one exception: a late
   final-stage receipt still commits its chain at its count (step 5). A late
   acknowledgment never raises or lowers the acknowledged count; only an in-time
   acknowledgment is matched, and it may be matched against the chain a late
   receipt committed, because the requester's in-time signature, not the
   receipt's time, is what is charged. A late receipt never makes a stage's
   latest receipt, never closes a stage and never delivers an answer, and a late
   acceptance, stop or stage fault counts for nothing. Late faults are listed
   once per stage, however many that stage signed. A late record is still its signer's
   signed statement, so step 5 uses kept receipts and acknowledgments, late or
   not, in every contradiction test.
   Records that name another `attemptId` or come from a non-party are dropped
   without being listed.

   **The requester's own stages.** This definition is used only under the
   failed-stage terms (step 6), where nothing that such a stage signs or
   withholds may reduce what the other stages are paid. A stage is the
   requester's own when its participant ID is the requester's; or, with signed
   accounts (step 8), when some acceptance that counts, of any stage run by
   that participant, names the terms' `debitAccount` as `payoutAccount`; or,
   without signed accounts, when `accountOf` of its participant equals
   `accountOf` of the requester (every participant is its own account when the
   caller supplies none). Every other stage is an *outside* stage.
5. **Acknowledged count and contradictions.** Every kept receipt of the final
   stage with an `output` commits its `chain` at its `output.count`, whenever it
   was signed, late or not (step 4). The committed chain at count 0 is the starting value, which anyone
   can compute. A count is *matched* when an acknowledgment of it signed `inTime`
   carries the committed chain. The **acknowledged** count is the highest matched
   count (0 if none). This is the one charge rule: the requester owes the
   acknowledged count, up to `maxOutputTokens`, except where step 9, under the
   older provider-loss-free terms, makes an unfinished answer free, and except
   the share of a stage that step 6 forfeits under the failed-stage terms.
   Nothing else raises or lowers it.
   - Another acknowledgment, in time or late, of a count for which the requester
     also signed the final stage's chain, with a different chain, is the
     requester contradicting itself. It is listed as
     `acknowledgment-equivocation`, not blocking, with `settledOn` when that
     count is matched. It never lowers the charge.
   - An in-time acknowledgment of a count at which no final-stage receipt
     commits a chain is listed in `unmatched` and not charged.

   Under the failed-stage terms two things differ:
   - **When the final stage is the requester's own**, the requester signed
     both sides of every match, so its acknowledgments count by themselves:
     every count it acknowledged `inTime` is matched, whatever chain the
     acknowledgment carries and whether or not a receipt commits a chain at
     that count. Nothing is listed in `unmatched`. The chain tests below still
     list their entries (the final stage's two chains for one count, the
     disputed chain, the charge binding), all with `blocking: false`; none of
     them makes the outcome `conflict`.
   - **A disputed chain never blocks**, whoever runs the final stage: when the
     requester acknowledged a count at which the final stage commits a chain
     and none of its chains for that count is the final stage's, the
     `output-chain` entry with `signer: null` is listed with `blocking: false`
     and that count is simply not matched (unless the final stage is the
     requester's own, where the bullet above matches it). The requester then
     owes the counts whose chains agree, as if it had withheld that
     acknowledgment.

   The outcome is `conflict` if any of these hold, late receipts and late
   acknowledgments included (under the failed-stage terms, except as just
   said and except for the receipts of the requester's own stages, below):
   - a stage's receipts repeat a sequence, have steps that go backwards, or
     continue after a closing receipt;
   - the final stage's receipts give two chains for one count, including a
     count-0 chain other than the starting value. This holds whether or not any
     acknowledgment names that count;
   - the requester acknowledged a count, in time or late, at which the final
     stage commits a chain, but none of its chains for that count is the final
     stage's. The records cannot show which of the two lied;
   - the charge binding's chain is not the starting value and no other binding,
     in time or late, has it.

   Under the failed-stage terms a requester's own stage whose receipts
   contradict each other (the first bullet) does not make the outcome
   `conflict`. Its `stage-receipt` entries are listed with `blocking: false`,
   the stage has *contradicted itself*, and from here on it has no latest
   receipt and has not closed. If it is the final stage, what it delivered is
   still read from its highest-`sequence` receipt that counts (step 4), but
   only when no other receipt of that stage has the same `sequence`; otherwise
   no answer was delivered. Its contradiction therefore never takes from an
   outside stage the pay that step 6 gives for a delivered answer. (This step's
   chain tests are not affected: every kept receipt of the final stage still
   commits its chain, and their entries are still listed.) Step 6 forfeits it.
6. **Closing.** A stage's latest receipt is its highest-`sequence` receipt that
   counts (step 4). A stage has closed when that receipt is a closing receipt.
   The answer was delivered when the final stage's latest receipt (for a
   requester's own final stage that contradicted itself, the receipt step 5
   names) has `output.done` at count `N > 0` and the acknowledged count is `N`.
   - If the answer was delivered and some stage did not close, look at that
     stage's latest receipt. If any such stage has `steps < N`, no receipt
     covers the answer and the outcome is `unknown`, whatever the time.
     Otherwise every unclosed stage signed a receipt for every step of the
     answer: it evidently computed all of it. Until the release window has
     passed (`at <= deadline + releaseWindowMs + maxClockSkewMs`) the outcome is
     `open`. After it, each such stage is treated as closed at its last signed
     step, listed in `closedAtLastStep`, and paid its share.
   - Otherwise, if not every stage closed, the outcome is `open` while
     `at <= deadline + releaseWindowMs + maxClockSkewMs`, and `expired` after
     it. An expired attempt charges nobody and pays nobody. Terms with no receipts and no
     acknowledgments, an attempt that never started, end here.

   One stage withholding its closing receipt therefore cannot stop every
   stage's payment for an answer the requester received and acknowledged in
   full. The rule needs the final stage's signed `done` and the requester's
   acknowledgment of that exact count with the final stage's chain. An answer
   that did not finish never meets it: with a stage unclosed it stays `expired`,
   which is the relief for a verified provider failure (step 9). A missing close
   attributes nothing: the records cannot tell a destroyed host from a stage
   that chose not to sign or from a closing receipt that was not presented. A
   stage, or a supervisor that holds its key, therefore signs a closing receipt
   whenever it can, a `failed` one when its process died; that close states how
   far the stage got and lets the acknowledged outputs be charged and paid. The live ledger applies
   the same rule once the release window has passed (see
   [fleet-service.md](fleet-service.md#release-windows)).

   A stage whose closing receipt is signed after the deadline but `closesInTime`,
   by `deadline + releaseWindowMs + maxClockSkewMs`, has closed. The charge is
   still only what the requester acknowledged in time, so a stage that closes
   honestly late is paid what one that backdates its close would be.

   **Failed stages.** When the agreed terms' `unfinishedTerms` is
   `reploid.unfinished-answer/acknowledged-prefix-failed-stage-forfeits/v1`,
   the two bullets above are replaced by this rule. A stage that keeps back its
   closing receipt then changes only its own amount, and so does a stage other
   than the final one that keeps back its receipts covering a delivered answer.
   What a withheld record can still do is listed under
   [Failed stages](#failed-stages):
   - A stage has **faulted** when a stage fault of it counts (step 4). A stage
     that faulted and also closed contradicted itself: it gets one
     `fault-and-close` entry in `conflicts`, not blocking. These entries are
     listed from step 4 on, whatever later decides the row.
   - A requester's own stage that contradicted itself (step 5) is decided at
     once, as a faulted stage is. It gets no `fault-and-close` entry.
   - If some stage has neither closed nor faulted nor contradicted itself and
     the release window has not passed, the outcome is `open`.
   - Otherwise every stage is decided. A stage that has neither closed nor
     faulted nor contradicted itself is treated as closed at its last signed
     step, and listed in `closedAtLastStep`, when the answer was delivered and
     its latest receipt has `steps >= N`. Every stage that faulted or
     contradicted itself, and every other stage that has not closed,
     **forfeits**. The forfeiting stages are listed in `forfeited` with a
     `cause`: `contradiction` for a stage that contradicted itself, whatever
     else it did; otherwise `fault` for a stage that faulted and did not
     close, `fault-and-close` for one that did both, `no-close` for one that
     did neither.
   - If the acknowledged count is 0 and some stage has not closed, the outcome
     is `expired`: nothing was acknowledged, so nobody is charged or paid. Terms
     with no receipts and no acknowledgments end here once the window has
     passed. Otherwise the attempt goes on to step 7 and can be `settled`.

   A fault therefore decides its own stage at once: an attempt whose other
   stages have all closed settles without waiting for the release window.
7. **Steps.** The outcome is `conflict` if any stage's latest receipt has fewer
   `steps` than the acknowledged count. A stage that step 6 forfeits is not
   tested: its share is not paid whatever its receipts say, and it may have
   presented none. Under the failed-stage terms the requester's own stages are
   not tested either, since they are never paid. And when the final stage is
   the requester's own, no stage is tested at all: only the requester vouches
   for the acknowledged count, so a count beyond what an outside stage signed
   for is not that stage's contradiction. Instead the charge stops at the
   *step cap*: the fewest `steps` in the latest receipt of any outside stage
   that does not forfeit (no cap when there is no such stage).
8. **Acceptances and accounts.** When the agreed terms carry `debitAccount`
   the attempt has *signed accounts*: the requester's account is `debitAccount`,
   and a stage's account is the `payoutAccount` of its in-time acceptances of
   the agreed terms (step 4). Each participant has one account. The outcome is
   `conflict` if a participant named more than one: a stage whose counting
   acceptances carry different `payoutAccount`s, a participant that runs
   several stages and named different ones, or a stage run by the requester's
   own key whose `payoutAccount` is not `debitAccount`. Each such participant
   gets one `payout-account` entry, in the order of the participants' first
   stages. Under the failed-stage terms a participant that named more than one
   account does not make the outcome `conflict` when it is the requester's own
   key or one of the accounts it named is `debitAccount`: its entry is listed
   with `blocking: false`, its account is `debitAccount`, and the step goes on
   (such entries may stand before or after the blocking ones). Otherwise, when the caller supplied `accountOf`, it is the enrollment
   the caller trusts, and the outcome is `invalid` if the requester's
   `debitAccount`, or the signed account of any stage that has one, differs from
   `accountOf` of that participant (`accountOf` of a participant it does not
   place is that participant's own ID). Otherwise the outcome is `unknown` if any
   stage has no in-time acceptance of the agreed terms that counts. With signed
   accounts, who is charged and who is paid comes from what the requester and
   each stage signed; `accountOf` is used for nothing but the enrollment test.
9. **Settled.** Let `acknowledged` be the acknowledged count from step 5 and
   `delivered` the `output` of the receipt step 6 reads the answer's end
   from (the final stage's latest receipt, or the one step 5 names), or none
   when there is no such receipt. Every stage has
   closed (step 6) or is treated as closed at its last step. The rule for an
   unfinished answer is the one the requester signed in the terms'
   `unfinishedTerms`:
   - The answer **finished** when `delivered.done` is true. The requester then
     owes the acknowledged count, however many acknowledgments it withheld at
     the end.
   - The requester **stopped** when an in-time stop of its own exists. The
     stop's `acknowledged` count is not used.
   - The requester **withheld** when `delivered.count - acknowledged` is greater
     than `K` as step 3 fixed it: the terms' `maxUnacknowledgedOutputs`, or for
     terms of the older shape the receiver policy's value.
   - An answer that did not finish, was not stopped and was not withheld is an
     **unattributed disconnect**: every stage closed, so no provider failure is
     verified (see [Unfinished answers](#unfinished-answers)), and the records
     cannot show who ended it.
   - Under `unfinishedTerms` equal to
     `reploid.unfinished-answer/acknowledged-prefix-provider-relief/v1` (the
     provider-relief rules, settlement-rules id `reploid.settlement-replay/v2`), and
     under `null` (older terms) or any other value except the
     provider-loss-free one below, the charge units are `min(acknowledged, maxOutputTokens) * creditsPerOutputToken`
     in every case above, an unattributed disconnect included.
   - Under `unfinishedTerms` equal to
     `reploid.unfinished-answer/acknowledged-prefix-failed-stage-forfeits/v1`
     (the failed-stage terms) the charge units are the same,
     `min(acknowledged, maxOutputTokens) * creditsPerOutputToken` in every case
     above, and each stage that step 6 forfeits loses its share of them (see
     Split arithmetic). When the final stage is the requester's own, the
     charged outputs are `min(acknowledged, maxOutputTokens, step cap)`
     (step 7) and the units are that count times `creditsPerOutputToken`.
   - Under `unfinishedTerms` equal to
     `reploid.unfinished-answer/provider-loss-free/v1` (the older rules, kept
     for the reservations made under them), an unattributed disconnect was ended
     by a stage and its charge units are 0. Every other case charges
     `min(acknowledged, maxOutputTokens) * creditsPerOutputToken`.

### Split arithmetic

These are the same integers the ledger posts (`server/fleet/credit-shares.js`).
Let `W` be the sum of the weights and `U` the charge units. Stage `i`, in stage
order, receives `floor(U * weight_i / W)` in exact integer arithmetic, and the last
stage receives what remains, so the credits sum to `U`. Work done by the
requester's own account is neither charged nor credited. The debit is `U` minus
those own-account shares. A stage that step 6 forfeits is then credited 0, and
the debit falls by exactly the amount that stage would have been credited; no
other stage's amount changes, and the forfeited share is not redistributed. A
forfeiting stage on the requester's own account changes nothing, because its
share was never charged. Without `accountOf`, every participant ID is its own
account. With it, the replay groups participant IDs into owner accounts as the
ledger does, and `balances` sums per account. An attempt with signed accounts
(step 8) uses those instead (for a `settled` row step 8 has already refused
any that `accountOf` contradicts; an `expired` row is decided earlier and posts
only zeros): a stage is the
requester's own exactly when its `payoutAccount` equals the terms'
`debitAccount`, and `balances` sums that row under the signed accounts (a stage
with no signed account, possible only on an `expired` row where every amount is
0, under its participant ID).

## Outcomes

- **settled:** every stage closed (step 6), or the answer
  was delivered and the stages that did not close are treated as closed under
  step 6; or, under the failed-stage terms, every stage is decided (step 6) and
  the attempt is not `expired`. In each case steps 7 and 8 must also pass. The requester is debited by the charge rule of step 5: its
  acknowledged-in-time outputs, capped at `maxOutputTokens`, whether the answer
  finished, the requester stopped it, or the stages closed it with no signed
  stop. `failed` and `settled` closes are paid alike. Only under the older
  provider-loss-free terms is an unfinished answer with no stop and no more than
  `K` acknowledgments withheld free (step 9).
- **expired:** the release window passed without every stage closing and without
  a delivered answer, including an attempt that never started. Nobody is charged
  or paid. For an attempt that started, this is the relief for a verified
  provider failure. Under the failed-stage terms an attempt is `expired` only
  when nothing was acknowledged and some stage did not close; one with
  acknowledged outputs is `settled`, with the failed stages forfeiting. Under
  those terms `expired` and `settled` do not wait for the release window when
  every stage has closed or faulted (a fault that counts, step 4; a late fault
  decides nothing).
- **open:** the release window has not passed yet and not every stage has closed
  (under the failed-stage terms: closed or faulted).
- **conflict:** a participant signed incompatible statements, or the records
  cannot show which of two signers did (below).
- **unknown:** the records cannot decide. Examples are a delivered answer where
  one stage presented no receipt covering it (except under the failed-stage
  terms, where that stage forfeits), or missing terms or acceptance.
- **invalid:** the terms do not match a supplied policy, or no policy was
  supplied (step 3); or, with signed accounts, a party signed an account that
  the `accountOf` the caller supplied does not place it under (step 8).

Edited records fail their signatures and are listed as rejected.

### Rows

`replaySettlement` returns `{ schema, at, counts, reservations, rejected, balances }`:
`schema` is `reploid.settlement-replay/v2` (it was `v1` before the decided
rules; rows have the same members), `at` the verification time as an
ISO string, `counts` the number of rows per outcome, listing only the outcomes
at least one row has (an empty object when there are no rows), `rejected` one
`{ index, schema, problem }` per record that failed its checks (`index` its
position in the input, `schema` its schema or `null`), and `balances` the sum of
debits (negative) and credits per account over `settled` and `expired` rows.
`reservations` has one row per attempt, ordered by `reservationId` and then
`requesterId`. Every row has exactly these members, whatever its outcome, and
one more, `accounts`, when and only when the agreed terms carry `debitAccount`
and the attempt passed step 3 (a row decided at step 1, 2 or 3 never has it),
and one more, `forfeited`, when and only when the agreed terms name the
failed-stage terms and the attempt passed step 3:

| Member | Value |
| --- | --- |
| `reservationId` | the reservation |
| `requesterId` | the attempt's requester; `null` when no record names one |
| `attemptId` | the agreed terms' `attemptId`; `null` when no terms were agreed |
| `status` | the outcome |
| `reason` | a sentence for people; not part of the outcome |
| `debit` | the requester's charge, for `settled` and `expired` rows; otherwise `null` |
| `credits` | one `{ participantId, amount }` per stage in stage order (an own-account stage with `amount: 0`), for `settled` and `expired` rows; otherwise `null` |
| `outputs` | the acknowledged count, for rows decided at step 6 or later; otherwise `null` |
| `chargedOutputs` | the outputs charged, for `settled` rows (under the failed-stage terms with the requester's own final stage this can be fewer than `outputs` capped at the ceiling, by the step cap of step 7); otherwise `null` |
| `unacknowledgedOutputs` | `delivered.count - acknowledged`, for `settled` rows with a final-stage receipt; otherwise `null` |
| `beyondCeiling` | acknowledged outputs past `maxOutputTokens` (0 when none), for `settled` rows; otherwise `null` |
| `closedAtLastStep` | the partition indexes treated as closed at their last signed step (step 6), in ascending order; kept when step 7 or 8 then decides the row; `[]` when none |
| `conflicts` | the entries below, on any outcome |
| `late` | the late records (step 4): `{ kind: 'terms', signer, digest }`, `{ kind: 'acceptance', partitionIndex }`, `{ kind: 'stage-receipt', partitionIndex, sequence }`, `{ kind: 'acknowledgment', count }`, `{ kind: 'stop', acknowledged }` or `{ kind: 'fault', partitionIndex }` |
| `foreign` | terms on another route (step 1): `{ kind: 'terms', signer, attemptId, digest }` |
| `unmatched` | in-time acknowledgments of a count no final-stage receipt commits (step 5): `{ kind: 'acknowledgment', count }` |
| `forfeited` | only under the failed-stage terms (step 6): one `{ partitionIndex, cause }` per forfeiting stage in ascending stage order, `cause` being `contradiction`, `fault`, `fault-and-close` or `no-close`; on an `open` row the stages that faulted so far; `[]` when none and on a row decided before step 6; kept when step 7 or 8 then decides the row |
| `accounts` | only with signed accounts (step 8): `{ requester, stages }`, `requester` the terms' `debitAccount` and `stages` one entry per stage in stage order, the `payoutAccount` its counting acceptances (step 4) name, or `null` when they name none or more than one; the same on every row that has the member, whatever step decided it |

### Conflict entries

`conflicts` lists every contradiction found, on any outcome. Each entry has
`kind`, `blocking` and `signer`, the participant ID that signed the incompatible
statements, plus the members of its kind. A blocking entry makes the outcome
`conflict`; a non-blocking one is recorded on a row that settles normally.

| `kind` | Blocking | `signer` | Other members |
| --- | --- | --- | --- |
| `terms-equivocation` | no, when the stages accepted one set; else yes | requester | `digests`; `settledOn` when not blocking |
| `acknowledgment-equivocation` | no | requester | `count`, `chains` (the other chains); `settledOn` when the count is matched |
| `stage-receipt` | yes; no for the requester's own stage under the failed-stage terms | that stage | `partitionIndex`, `sequences`: `[earlier, later]` (below) |
| `output-chain` | yes; no when the final stage is the requester's own under the failed-stage terms | the final stage | `count` |
| `output-chain` | yes; no under the failed-stage terms | `null` | `count`, `signers`: the final stage and the requester |
| `charge-binding` | yes; no when the final stage is the requester's own under the failed-stage terms | requester | `count: 0` |
| `steps` | yes | that stage | `partitionIndex` |
| `fault-and-close` | no | the stage that signed both a counting fault and a closing receipt that counts (step 6) | `partitionIndex` |
| `payout-account` | yes; no for the requester's own participant under the failed-stage terms (step 8) | the participant that named more than one account | `accounts`: the distinct accounts it named in counting records (the `debitAccount` too when it is the requester's own key), sorted by UTF-16 code unit |

A stage's `stage-receipt` entries come from its kept receipts, late ones
included, taken in `sequence` order. Each distinct `[earlier, later]` pair is
listed once per stage, in the order it is first found:
- `[s, s]` when two different receipts carry sequence `s`;
- `[h, s]` when a receipt at sequence `s` has fewer `steps` than some receipt at
  a lower sequence, `h` being the lowest sequence that has the most `steps` below
  `s`;
- `[c, s]` for every receipt at a sequence `s` after the stage's first closing
  receipt, at sequence `c`.

A stage therefore gets one entry per contradicted pair, not one per stage: two
receipts after its close give `[c, c + 1]` and `[c, c + 2]`.

The `output-chain` entry with `signer: null` is the disputed chain of step 5:
the requester's every chain for that count differs from the final stage's, and
the records cannot show which of the two lied, so `signers` names both.

### Who bears a conflict

A conflict moves no credit. The requester is not debited and no stage is
credited, so the stages bear the work they did. An entry's `signer` is the party
that contradicted itself; a disputed chain names both possible parties in
`signers` instead. That list is for reputation and exclusion, not for an amount.
It follows that:
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
  `unknown`, `expired` or a smaller acknowledged count, or, under the
  failed-stage terms, the forfeit of the stage whose close is missing.
- who owns a participant key, or whether a key may speak for a ledger account.
  With signed accounts (step 8) it does establish which account the requester
  asked to be charged from and which account each stage asked to be paid into,
  because each signed its own; whether a key is enrolled under the account it
  names is checked only against the `accountOf` the caller supplies. Without
  signed accounts the whole grouping is that input, supplied by whoever runs the
  replay or publishes the receipt: a stage wrongly grouped with the requester
  would go unpaid and the amounts would still agree.

Known limits:
- **Times are self-reported (L5).** Every signer writes its own `signedAt`, and
  no record shows when it was really signed. Backdating no longer pays: a
  closing receipt signed inside the release window counts (step 4), and the
  charge is what the requester acknowledged in time, so a stage that closes
  honestly late gets what one that backdates its close gets. What remains is
  that a stage can still date a close signed after the window inside it, and a
  requester can date a late acknowledgment in time; the requester can also sign
  a second acknowledgment afterwards, which under step 5 does not lower its
  charge. Only a party that sees the records as they are signed can fix this:
  the witnessed replay (B4 in `scripts/settlement/baseline-matrix.js`) is the
  real fix, at the cost of a third party that must be online and trusted for
  time.
- **A closed stage's failure is not attributed.** A stage receipt names no
  cause, and a live stage signs `failed` both when it breaks and when the
  requester's abort reaches a step in flight. So an honest stage that fails and
  still closes is charged as an unattributed disconnect: the requester pays for
  the outputs it acknowledged, never more. Under the provider-relief terms
  only a stage that does not close at all gives relief; under the failed-stage
  terms nothing does, and such a stage forfeits only its own share. A signed cause in the receipt, or a witness, would be needed
  to tell the two apart.
- **A stage can sign steps nobody received (L3).** A final stage can sign `K + 1`
  or more further step receipts that it never delivered, then close. No
  verifier can tell this from a requester that received them and stopped
  acknowledging. Under the decided rules this changes nothing: the requester
  owes its acknowledged prefix either way, and never pays for an output it did
  not acknowledge. Under the older provider-loss-free terms it let the final
  stage alone turn a free abandoned answer into a charged one.
- **A requester and a stage acting together** can make an answer free under
  the provider-relief terms and the older ones. The stage withholds every
  receipt covering the answer, or withholds its closing receipt, which reads as
  a provider failure. The other stage is then unpaid. A requester that runs a
  stage itself, as with requester-held edge stages, needs no partner for this.
  The failed-stage terms close it: the withholding stage forfeits its own share
  and every stage that closed is paid (see [Failed stages](#failed-stages),
  which also lists what those terms still do not stop).
- **A disputed chain is undecidable.** A requester that signs, for the final
  count, only an acknowledgment whose chain differs from the final stage's makes
  the attempt `conflict`, because a verifier without the output text cannot tell
  whether the stage or the requester lied. That count's honest acknowledgment,
  if any party holds it, settles the attempt instead. Under the failed-stage
  terms it no longer blocks: that count is not charged and the counts whose
  chains agree are (step 5), so the requester gains at most what withholding
  the acknowledgment would have gained it.

In the Stage 1 harness (`scripts/stage1/`) these records are collected by the
harness, not by live code: the requester signs its terms inside its own
disclosure approval, before the reservation and dispatch, and each stage signs
its acceptance with its own key during or after the attempt, because live code
does not yet carry terms to a stage before it reserves. Those acceptances count
only when signed `inTime`, between `notBefore` and the deadline, each widened by
the clock skew allowance. Every Stage 1 receipt replays the split, stopped and
dropped attempts from those records and the participants' own stage receipts and
acknowledgments, labels the result `termsCollectedBy: 'stage1-harness'`, and fails
unless the replay matches the ledger exactly and the terms name the ledger's exact
policy digest. Each attempt's `settlementReplay` in the receipt (built by
`scripts/stage1/split-evidence.js`) holds the replay's return as `result`, the
records it replayed, and the signed terms' `unfinishedTerms`. A receipt whose
terms name the provider-relief or the failed-stage terms has no tolerance at all. Only a receipt whose
requester-signed terms name the older provider-loss-free terms may carry the old
known difference (see [Older rules](#older-rules)) and pass with it.

The replay and the live ledger agree once both are final, not at every moment.
Until the release window has passed (`deadline + releaseWindowMs +
maxClockSkewMs`), an answer with an unclosed stage is `open` in the replay and
pending in the ledger, and after it both settle or expire it under step 6. The
ledger times records against its own request deadline (its creation time plus
`maxRequestMs`), so the two agree on time rules when the terms' deadline is that
one. Like the replay, the ledger charges only an acknowledgment signed by the
deadline plus the skew allowance, ignores a step receipt signed later, and
accepts closing receipts until the window has passed, whatever the step times
they report. It applies step 9 to the records it holds: the final stage's latest
receipt decides `finished` and `withheld`, and the requester's stop decides
`stopped`. The live split route collects the stop: when the person stops a split
answer, the requester signs it and hands it to the ledger before its stages are
told to stop, so the ledger holds it before any stage closes
([fleet-service.md](fleet-service.md#stop)). Under the decided rules a stop and
an unattributed disconnect charge the same prefix, so a stop that reaches the
ledger late changes nothing. The ledger accepts outputs past the ceiling,
charges `maxOutputTokens` and records the rest as `beyondCeiling`, as the replay
does. Under the provider-relief terms a delivered answer that a stage has no
receipt covering is `unknown` in the replay; the ledger, which must release the
hold, records it as `expired` with reason
`unknown-delivered-answer-without-covering-receipt`. Both move nothing: that is
the one difference between them, a difference of status only. A stage owner's
signed interruption claim, which only the ledger receives, settles the answer at
zero there; the replay sees that stage unclosed and expires the attempt, also at
zero. Under the failed-stage terms neither difference arises: that stage
forfeits in both (see [Failed stages](#failed-stages)). What remains is a
difference of status when nothing was acknowledged: a stage owner's claim
decides that stage in the ledger, and the ledger sees a requester's own stage
contradict itself only at its final stage, so the ledger can settle at 0 where
the replay calls the row `expired`. Nobody is charged or paid in either.

## Unfinished answers

The owner decided this case on 2026-11-25. Split reservations made under that
decision took settlement-rules id `reploid.settlement-replay/v2` in the ledger,
and their requesters signed the matching `unfinishedTerms`,
`reploid.unfinished-answer/acknowledged-prefix-provider-relief/v1`, so the replay
applies the same rule from the records alone. The same day the owner replaced
its relief with the failed-stage rule below: every new split reservation now
takes settlement-rules id `reploid.settlement-replay/v3` and the failed-stage
terms, and the provider-relief rule stays for the reservations made under it
([Older rules](#older-rules)). A stage accepts only terms that name the
unfinished-answer terms it settles under, the current ones, as it accepts only
its own `K`: terms that name an earlier value, signed after the change, get no
acceptance and are `unknown` (step 8), so they cannot bring back a free
walk-away or the provider relief. The replay itself decides by the signed value
and needs no date. The unattributed disconnect and the signed stop below are the
same under both rules; only the relief differs.

- **Unattributed disconnect: the requester owes what it acknowledged.** An
  unfinished answer whose stages all closed (`settled` or `failed`), with no
  in-time requester stop, charges the requester's acknowledged-in-time outputs,
  capped at the signed `maxOutputTokens`, split by the signed weights. The
  requester drives every step: a stage computes the next output only after the
  requester asks for it, so a requester that has read what it wants can stop
  asking, and the stages then close. The records look the same as stages that
  gave up. Charging the acknowledged prefix makes walking away cost exactly what
  a signed stop costs (117 credits for 39 of 40 outputs at the test policy), so
  signing a stop is never against the requester's interest, and the requester
  never pays for an output it did not sign for in time. The ledger records the
  outcome's reason as `unattributed-disconnect-acknowledged-prefix`.
- **A signed stop** charges the acknowledged prefix, as before.
- **Verified provider failure: relief, and the requester pays nothing.** A
  provider failure is verified for an attempt when, once the release window has
  passed, some stage named in the agreed terms has no closing receipt that
  counts (step 4) and the answer was not delivered (step 6). The attempt is then
  `expired`: the requester is charged nothing for it, even for outputs it
  acknowledged, and no stage is paid. The ledger reaches the same amount, and
  also accepts a stage owner's signed interruption claim for a stage that did
  not close.

  This is decided from records alone and never from the requester: only that
  stage could sign its close, and nothing the requester does or fails to do
  stops a stage from signing one. A stage closes when the requester stops
  asking, when its acknowledgment bound refuses a step, and when its session
  ends. A requester's silence, its withheld acknowledgments, or any statement of
  its own therefore never counts as a provider failure. Nor does a `failed`
  status on a closing receipt: the receipt names no cause, and a live stage
  also signs `failed` when the requester's abort reaches a step in flight, so
  treating it as a failure would let a requester disconnect mid-step for free.

  Relief is all of the attempt, not the outputs acknowledged before the failure,
  for three reasons. The requester did nothing to end the answer, and an answer
  cut off partway usually has to be asked again in full, so the received prefix
  is worth little to it. "Before the failure" would need the failure's time, and
  the record that would carry it is the one missing, while every other time is
  self-reported. And it is the rule the replay and the ledger already applied to
  a missing close and to an owner's interruption claim, so a provider loss
  settles the same under old and new reservations. Its cost falls on the stages
  that did close, which go unpaid when a partner fails to close, as before.

The ledger settled the reservations made under these rules as the replay does:
`tests/unit/settlement-v2-rules.test.js` repeats every ledger step frozen from
that code (`tests/fixtures/settlement-v2-rules.json`) and gets the same results,
outcomes, journal rows and statements.

### Failed stages

The owner decided this rule on 2026-11-25, after the provider-relief rule above
proved to be a way to take an answer for nothing. Under it any one stage that
kept back its closing receipt made the attempt `expired`: no charge, and no pay
for the stages that did the work. A stage owner's interruption claim did the
same in the ledger. A requester that holds a stage itself, as with
requester-held edge stages, could do it alone. In the test of this rule a
middle stage of three, with weights 1, 3 and 2, keeps back its close after the
requester acknowledged 3 outputs at 3 credits each: under the provider-relief
terms nobody is charged or paid, and under the rule below the two stages that
closed are paid 1 and 4 and the requester pays 5.

The rule is signed by the requester as `unfinishedTerms`
`reploid.unfinished-answer/acknowledged-prefix-failed-stage-forfeits/v1` and
accepted by each stage, so the replay applies it from the records alone
(steps 4, 6, 7 and 9):

- **A failed stage forfeits its own share and nothing else.** A stage fails by
  signing a stage fault that counts (step 4), or by having no closing receipt
  that counts once the release window has passed. One exception stays from
  before: a stage that has not faulted and whose receipts cover a delivered
  answer is not failed by its missing close; step 6 treats it as closed at its last signed step and it
  is paid. A failed stage is credited 0. Every stage that closed is paid
  its share of the outputs the requester acknowledged in time, and the
  requester's debit is the sum of those shares.
- **A stage on the requester's own account never gives relief.** Its share is
  neither charged nor paid in any case, so its fault or its missing close
  changes no amount.
- **Nothing the requester's own stage signs or withholds reduces what the
  outside stages are paid.** The owner extended the rule to this on the same
  day. Receipts of its own that contradict each other fail that stage and
  block nobody. Its steps are not tested. A second payout account does not
  block. When it is the final stage, the requester's acknowledgments count by
  themselves, so keeping back the final stage's receipts no longer leaves
  nothing acknowledged; and since only the requester then vouches for the
  count, the charge stops at what the outside stages signed for. A disputed
  chain no longer blocks under any final stage.
- **A fault is a fast close, not a favour.** It settles the attempt as soon as
  the other stages have closed, without waiting out the release window, and it
  costs its signer its own share. A row decided that early is decided for the
  records presented: a record signed in time and presented later still counts,
  as it does for any row. Nobody can vouch a stage's failure into
  relief for the requester.
- **A stage that signs both a fault and a closing receipt** is credited 0 and
  listed as `fault-and-close`.
- **An unattributed disconnect is unchanged:** every stage closed, no stop was
  signed, and the acknowledged outputs are charged.

What each attack gets, each replayed in
`tests/unit/settlement-failed-stage-forfeits.test.js` under these terms and
under the provider-relief terms:

| Attack | Provider-relief terms | Failed-stage terms |
| --- | --- | --- |
| A stage, alone or with the requester, withholds its closing receipt of an unfinished answer | `expired`: nobody charged, nobody paid | that stage is paid 0; every stage that closed is paid; the requester pays those shares |
| The requester withholds its own edge stage's closing receipt | `expired`: the answer is free | both operators are paid in full |
| A stage signs a fault it did not have | (no such record) | it loses its own share; nobody else's amount changes |
| The requester's own stage signs a fault | (no such record) | no amount changes |
| A stage signs a fault and a closing receipt | (no such record) | it is paid 0 and listed |
| A delivered answer, one stage presenting no receipt that covers it | `unknown`: nothing moves | that stage is paid 0; the others are paid |
| The requester's own final stage presents no receipt at all | nothing acknowledged: `expired` or 0 charged | the requester's acknowledgments are charged; the outside stages are paid |
| The requester's own stage signs two receipts at one sequence, or steps that go backwards | `conflict`: nothing moves | listed, not blocking; the outside stages are paid |
| The requester's own stage signs fewer steps than were acknowledged | `conflict`: nothing moves | not tested; the outside stages are paid |
| The requester acknowledges more than its own final stage's partners signed for | `conflict`: nothing moves | the charge stops at the fewest steps an outside paid stage signed |
| The requester signs only a wrong chain for the last output | `conflict`: nothing moves | that count is not charged; the counts whose chains agree are |
| The requester's own stage names a second payout account | `conflict`: nothing moves | listed, not blocking |

What the rule costs, and who bears it:
- **The requester pays for part of an answer.** When a stage fails partway, the
  requester owes the stages that closed for the outputs it acknowledged, though
  an answer cut off partway usually has to be asked again in full. This is the
  price of a split across operators with no witness: the records cannot tell a
  destroyed host from a stage that chose not to sign, so the only failure that
  can be priced is the failed stage's own share.
- **A stage that closed is paid whether or not its partner failed**, so it has
  no reason to hide a partner's failure, and nothing to gain from it either.
- **An honest stage whose host is destroyed loses its share** unless a
  supervisor that holds its key signs a closing receipt for it inside the
  release window (step 6).

What these terms do not stop:
- **An outside final stage that presents no receipt at all.** No chain is then
  committed, no acknowledgment is matched, and the acknowledged count is 0
  (step 5): nobody is paid, that stage included. Only when the final stage is
  the requester's own do the acknowledgments count without it.
- **A conflict caused by an outside stage.** A blocking conflict moves no
  credit (see [Who bears a conflict](#who-bears-a-conflict)), and an outside
  stage can cause one by signing two receipts at one sequence or two chains for
  one count. It loses its own pay with its partners'. The entry names it.
- **An outside stage that does not close while the requester's own final stage
  hides the end of the answer.** The exception that pays a stage with covering
  receipts but no close needs the final stage's signed `done`. Without it the
  stage forfeits like any other that did not close. A stage that closes is
  not affected.
- **Terms, accounts and enrollment.** A requester that signs two sets of terms
  the stages split over is still a `conflict`, and a party that names an
  account it is not enrolled under still makes the attempt `invalid` where the
  caller supplies the enrollment. Both are signed before any work is done.
- **A withheld acceptance.** Step 8 still answers `unknown` when any stage has
  no acceptance that counts, a forfeiting stage included, and an `unknown` row
  moves nothing. A stage that is owed holds its own acceptance and can present
  it; nobody can present another stage's for it.
- **Self-reported times** (L5 above) apply to faults as to closing receipts.

The live ledger gives every new split reservation settlement-rules id
`reploid.settlement-replay/v3` with these terms, and its stages sign and accept
only them. It posts what the replay computes from the same records:
- A stage with no closing receipt once the release window has passed is
  treated as closed at its last signed step or forfeits, as in step 6, and the
  request settles at the window instead of expiring. With nothing acknowledged
  it still expires.
- A stage owner's interruption claim (`closeStageOwner`, sent by a stage host
  that restarts after its process died) is that stage's fault. The stage host
  signs its stage fault with its own key and sends it with the claim; the ledger
  checks it against the reservation, keeps it with the claim and returns it in
  the request's evidence, so the replay reaches the same result from records
  alone. A fault the replay would call late is refused while the request is
  undecided. A claim from older stage software carries no fault; the ledger
  still forfeits that stage at once, where the replay, which never sees the
  claim, forfeits it as `no-close` at the window, for the same amounts.
- When the final stage is the requester's own, any participant may hand in the
  requester's signed acknowledgment without the final-stage receipt it
  acknowledged, and the charge stops at the step cap (outputs past it are
  recorded as `beyondStageSteps`, never charged).
- The ledger keeps one receipt per stage, and pays the outside stages what the
  replay pays them after failing a requester's own stage that contradicted
  itself. Only the final stage's contradiction can change an amount, by changing
  whether an answer was delivered (step 5), so the ledger keeps that one as
  evidence: a different receipt of the requester's own final stage at the
  `sequence` of one the ledger holds, late or not, and a receipt that
  contradicts that stage's close (the close itself stands). It keeps the
  receipts at the highest such `sequence`, at most two, returns them in the
  request's evidence as `finalStageTwin`, and reads how the answer ended as
  step 5 does: from that stage's highest-`sequence` receipt signed in time, and
  only when no other receipt it holds has that `sequence`. An outside stage
  that did not close then forfeits in both. A stage that closes is not
  affected. The ledger decides from what it was handed and kept: a late receipt
  handed in before the receipt it contradicts is not kept, and a record that
  only the replay is given can still make the two differ.

`tests/unit/settlement-own-stage-ledger.test.js` drives a live ledger through
every attack in the table above and compares each outcome with the replay, and
`scripts/settlement/independent/ledger-differential.js` posts the same amounts
in the ledger and the replay for all 590 of its cases.

### Older rules

Reservations keep the rules they were accepted under, so earlier signed
statements still verify exactly (`tests/unit/settlement-old-rules.test.js` and
`tests/unit/settlement-v2-rules.test.js` replay frozen records, ledger steps and
statements from each):

- `reploid.settlement-replay/v1` (reserved on 2026-11-25): an unattributed
  disconnect under provider-loss-free terms costs nothing, in the ledger as in
  the replay. The ledger's reason is `stage-ended-unfinished-answer`.
- `reploid.settlement-replay/v1+acknowledged-prefix` (the ledger's interim
  rules, 2026-11-25): the ledger charged an unattributed disconnect its
  acknowledged prefix, with reason
  `unfinished-answer-closed-without-requester-stop`, while the replay over the
  same provider-loss-free terms charges 0. This was the one known difference
  that moved credits. A replay row in it is `settled` with `outputs > 0` and
  `chargedOutputs: 0`; no other settled row has that pair. A Stage 1 receipt
  from that time lists it in `settlementReplay.knownDifferences`, one entry
  `{ case: 'unfinished-split-answer-closed-without-stop', reservationId,
  requesterId, acknowledgedOutputs }` per such row, `acknowledgedOutputs` being
  the row's `outputs`. The receipt check tolerates the difference only when the
  receipt's requester-signed terms for that reservation name the provider-loss-free
  terms, an entry names the reservation with the row's acknowledged count, and
  the ledger charged exactly that prefix: its output count equals the smaller of
  `outputs` and the workload's `maxOutputTokens`, and its charge is that count
  at the policy rate.
- `reploid.settlement-replay/v2` (reserved on 2026-11-25, with the
  provider-relief terms): an unattributed disconnect charges the acknowledged
  prefix, and a verified provider failure (a stage with no closing receipt, or a
  stage owner's interruption claim) charges nothing and pays nobody (see
  [Unfinished answers](#unfinished-answers)).

The first split trades of 2026-11-25 were signed before terms carried `K`.
Their terms have no `maxUnacknowledgedOutputs` member and name the
provider-loss-free terms; the replay reads them as the record shapes and step 3
above describe, with `K` from the receiver policy, and reaches the amounts it
reached when they were signed
(`tests/unit/settlement-terms-before-k.test.js`).

## The coordinator's statement

The records above decide the debit and every payout. They cannot show one
thing: what the ledger did with the hold. Before a request is sent, the ledger
places a hold of the signed `maximum` on the requester's account and releases
it when the attempt settles or expires. A hold is ledger state. No requester
and no stage signs it, so no set of participant records can show that it was
released.

The smallest record that makes it checkable without the ledger is a statement
signed by whoever keeps the ledger, the **coordinator**, once an attempt is
final:

| Record | Signed by | When | Binds |
| --- | --- | --- | --- |
| Settlement statement (`reploid.settlement-statement/v1`) | coordinator | when the attempt is settled or expired | the agreed terms' digest, the ledger's settlement-rules id, the outcome, the debit, each credited account's payout, the stages that forfeited, and the hold it placed, released and still holds for the reservation |

It is **not an input of the replay**: `replaySettlement` neither reads nor
needs it, a record with this schema in its input is rejected like any unknown
record, and nothing in "Deciding an outcome" changes. It is checked beside the
replay's result.

- **Fields** (signer: `coordinatorId`; every member required, no other
  allowed; text, count and time as under [Record fields](#record-fields)):
  `schema`; `reservationId` text 160; `attemptId`; `requesterId`; `termsDigest`
  digest, of the agreed terms' body; `coordinatorId`; `settlementRules`
  text 128, the ledger's settlement-rules id for the reservation
  (`reploid.settlement-replay/v1`, `.../v1+acknowledged-prefix`, `.../v2` or
  `.../v3`, see [Older rules](#older-rules)); `status`, `settled` or `expired`;
  `debit` count; `payouts`, at most 128 entries of exactly `{ account, amount }`
  with `account` text 128 and `amount` positive, one per account credited more
  than 0, in ascending order of `account` by UTF-16 code unit; `forfeited`, the
  partition indexes that forfeited, ascending, `[]` when none; `hold`, exactly
  `{ placed, released, remaining }`, each a count in credits, with
  `released + remaining` equal to `placed`; `signedAt` time.
- **Encoding.** As every other record ([Encoding](#encoding)): the body plus
  `publicJwk` and `signature`, the signed bytes carrying this schema as their
  `signatureDomain`, canonical base64url, an exact key, low-S for P-256, and
  `coordinatorId` equal to the participant ID of the carried key.
- **Checks.** Beside a replay row that is `settled` or `expired`, a verifier
  requires: the signature holds; `reservationId`, `attemptId` and `requesterId`
  are the row's; `termsDigest` is the digest of the agreed terms; the
  `settlementRules` is one whose unfinished-answer terms are the agreed terms'
  `unfinishedTerms`; `status` is the row's; `debit` is the row's `debit`;
  `payouts` equal the row's credits summed per account (signed accounts,
  step 8, or the caller's `accountOf`), zero amounts left out; `forfeited`
  lists the row's `forfeited` stages; `hold.placed` is the terms' `maximum`;
  and `hold.remaining` is 0. For a row that carries the one older known
  difference ([Older rules](#older-rules)) the `debit` and `payouts` are the
  acknowledged prefix split by the signed weights instead.

What it establishes: the coordinator committed, under its own key, to having
released the whole hold and to the amounts it posted. A hold that outlives the
statement, or a posting that differs from it, contradicts the coordinator's own
signature, and anyone holding the statement can show that.

What it does not establish:
- **The ledger's actual state.** The statement is the coordinator's word about
  its own database. A verifier without the ledger cannot see whether the hold
  is really gone, only that the coordinator can no longer deny having said so.
- **Whose key it is.** No participant record names the coordinator: terms do
  not carry a coordinator ID, so a verifier learns the key from whoever
  publishes the statement. Binding it would need the requester to sign the
  coordinator's ID into its terms, which is a change to the terms' shape and is
  not made here.
- **Other reservations.** It speaks for one reservation's hold, not for the
  account's total.

`server/fleet/settlement-statement.js` signs and checks the record.

**Who issues it.** The fleet ledger service, through its signed
`settlementStatement` operation, to a participant of the reservation that
presents the signed records it holds (`issueSettlementStatement`). The service
signs only when all of this holds:

- the reservation is final in the ledger and holds nothing (a reservation
  released before dispatch has no terms and gets no statement);
- the presented terms are signed by the reservation's requester for its
  attempt and name the policy, maximum, output limit, price, shares and debit
  account the reservation was held under;
- a replay of the presented records, run by the service at its own time, is
  `settled` or `expired`;
- that replay's debit and per-account payouts are exactly what the ledger's
  journal posted for the reservation.

Otherwise it refuses with a stable code (`not-final`, `never-dispatched`,
`terms-missing`, `terms-differ`, `records-rejected`, `records-not-final`,
`ledger-differs`, `hold-open`, or `no-coordinator-key`). The `debit`,
`payouts` and `hold` are ledger state. `status` and `forfeited` are the
replay's words for the records presented, which is what a verifier compares
them with. Two consequences:

- A whole-model reservation names no settlement rules in the ledger, so its
  statement names the current rule set of the unfinished-answer terms the
  requester signed.
- Presented with fewer records, the same zero-charge reservation can be stated
  `expired` where the full set reads `settled` (a close left out after the
  window). No amount and no hold line can differ between two statements of one
  reservation.

**The coordinator's key.** The service is given one key file
(`coordinatorKeyFile` in a `reploid.fleet-service/v1` or
`reploid.fleet-self-serve-config/v1` configuration, or the
`REPLOID_FLEET_COORDINATOR_KEY` secret for the hosted mount). It never makes
one: `node server/fleet/coordinator-key.js create FILE` makes it once and
refuses to overwrite, a named file that is missing or readable by others stops
the service, and a service with no key runs as before and signs nothing. The
public part (`reploid.coordinator-key/v1`: the coordinator ID and its public
key) is served to anyone at `GET /v1/fleet/coordinator`, and
`verify-records.js --coordinator-key` holds a statement to it. That makes the
key independent of whoever publishes a given trade, not of the ledger: see
[verify-a-trade.md](verify-a-trade.md#the-outsider) for what trust that leaves.

Every trade settled before 2026-11-26 has no statement, and a ledger that runs
without a key issues none. For those the release of the hold is the
publisher's unsigned statement and is not proven by any record.
`scripts/settlement/failure-cases.js` still signs its simulated cases with a
test key in one process.

## Whole-model operations

An ordinary request that one computer answers with the whole model signs the
same records with one stage (`shares` has one entry, `partitionIndex` 0), so
every step above applies unchanged. Source:
[`packages/reploid/src/mesh/operation-envelope.js`](../packages/reploid/src/mesh/operation-envelope.js).

- `attemptId` is the request ID. `routeHash` is the digest of
  `{ schema: "reploid.mesh-operation-attempt/v1", requesterId, requestId, planDigest }`,
  where `planDigest` is the operation envelope's digest of the operation, the
  model, its manifest digest, the plaintext whole-model route and the one
  recipient. A verifier treats it as it treats any route hash: a value the
  records must share.
- The requester signs the terms and the charge binding and sends them with its
  admission question. The provider signs its acceptance before the prompt is
  sent; a requester that gets no valid acceptance sends nothing further.
- The provider signs one stage receipt, at the end, which is its closing
  receipt: `steps` and `output.count` are the output tokens it measured (one
  unit for an operation that is not generation), and the chain value is the
  starting value extended once per unit, with no text for every step but the
  last and the digest of the whole output for the last.
- The requester signs one acknowledgment of that count, after the whole output
  has arrived and matches the provider's execution receipt, and before it
  countersigns that receipt. The countersigned receipt and the acknowledgment
  leave in one frame, so the ledger is never handed a receipt whose
  acknowledgment was not signed.
- The requester holds a record only if the replay would count it: an acceptance
  signed `inTime`, a close or a fault signed `closesInTime` (step 4), and
  its own acknowledgment only while its clock is inside the window. An
  acceptance outside the window is refused before the prompt is sent.
- **A provider that signed the acceptance is charged for only with its close.**
  When its closing receipt is missing, late, `failed`, or commits to another
  count or chain than the output that arrived, the requester acknowledges
  nothing, countersigns nothing and fails the request, whether or not the
  caller required a verifiable charge. Nothing is charged and the hold is
  released as in the table's last row. The same holds for an answer recovered
  after a lost connection: it is acknowledged before it is countersigned, and a
  requester that no longer holds the attempt's terms (it restarted) countersigns
  nothing.

### What an unfinished whole-model answer settles

**There is no acknowledged prefix on this route.** The provider signs its count
once, at the end, and the requester acknowledges once, after the whole answer.
Text the requester already received from an answer that did not finish is never
charged: every outcome below except a completed and acknowledged answer charges
the requester nothing, pays the provider nothing and releases the whole hold.
The terms still carry the policy's `maxUnacknowledgedOutputs`, which the replay
requires of any terms, but a single whole-model stage does not enforce it. It
delivers the whole answer before any acknowledgment and bears that risk, as it
did before these records existed.

| What happened | What is signed | Ledger | Replay |
| --- | --- | --- | --- |
| Completed and acknowledged | provider: closing receipt with `done`; requester: acknowledgment of its count | charges the output tokens on the countersigned execution receipt, at once | `settled`, that charge |
| The person stops mid-answer | requester: stop with `acknowledged` 0; provider, when the cancellation reaches it: a closing receipt with status `failed`, zero steps and the starting chain | settles at zero on the signed stop, at once | `settled` at zero once the provider's close is held; without it `open`, then `expired` |
| The requester goes away mid-answer (page closed) and the provider hears it | provider: the same `failed` close, and its signed cancelled terminal record for the ledger | settles at zero on that terminal record, at once | `settled` at zero |
| The provider fails and says so | provider: a stage fault (`reploid.settlement-stage-fault/v1`), no closing receipt, and its signed failed terminal record for the ledger | settles at zero on that terminal record, at once | `expired` at zero at once; the fault is listed (step 6) |
| Either side goes silent: the provider dies, or the requester's connection is lost and the provider never hears | nothing further | holds until the deadline plus the release window, then releases the hold unclaimed | `open` until then, then `expired` at zero |
| The provider finished but the requester never acknowledged, including when the provider's close was missing or did not commit to the output that arrived | provider: closing receipt with `done`, or none the requester accepts | as the row above: nothing was countersigned | `settled` at zero when a close is held (step 9: only acknowledged outputs are owed), otherwise `open`, then `expired` at zero |

Three things follow, and none is hidden by the records.

- **A silent provider and a silent requester look the same.** A split answer
  has other stages whose receipts show who stopped; a single provider has no
  witness. When neither a close, a fault nor a stop was signed, the records are
  the terms, the charge binding and the acceptance in both cases, and the
  outcome is unattributed. The replay still lists the one stage under
  `forfeited` with cause `no-close`, because that is how step 6 words a stage
  without a close; on this route that entry does not show the provider was at
  fault, and nothing should be built on it. Only a provider's own signed fault
  attributes a failure to the provider.
- **A provider signs a fault only for its own failure.** When the requester
  ended the answer it signs a close that claims nothing instead, so a stop is
  never recorded as the provider failing.
- **A requester can take a finished answer and not acknowledge it.** The
  provider is then paid nothing, as it was under the countersigned receipt
  alone. Its closing receipt and the unanswered acceptance are its evidence for
  reputation, not for payment.

The ledger still settles such a request from the countersigned execution
receipt, the requester's stop, or the provider's signed terminal record. It does
not read the terms, so the records are an outsider's check on the amounts it
posted, not its input. It also has no word for the replay's `settled` and
`expired` when the charge is zero (its own outcomes are `cancelled`, `failed`
and `expired`). When the ledger signs its
[statement](#the-coordinators-statement) it replays the presented records and
states the replay's word with its own amounts and hold. An export without a
statement states the word the held records imply, and the debit, the payout and
the remaining hold from the ledger, unsigned. One timing detail: the terms sign
the policy's `partitionUnclaimedReleaseMs` as their release window, and the
ledger releases a silent whole-model hold after
`wholeModelUnclaimedReleaseMs`. Run a ledger with the two equal; where they
differ, the ledger and the replay reach the same zero outcome at different
times, and a statement is issued only once both have. A provider that runs code from before these records signs none of them;
the request is then served and labelled `no-verifiable-receipt`, or refused
before any hold when the requester requires a verifiable charge. That label is
only ever given to a charge from a provider that signed nothing: a provider
that signed the acceptance is either charged with its close and the
acknowledgment held, or not charged.

Both hosts keep these records on disk
([verify-a-trade.md](verify-a-trade.md#where-the-records-are-kept)): the
requester from the moment its terms are signed, the provider from its
acceptance, each adding the later records as they are signed or arrive.

The drills are separate tests in
[`whole-model-signed-charge.test.js`](../tests/integration/whole-model-signed-charge.test.js):
each ends with no hold, the ledger, both replays and the records-only check
give the same debit and payout, and the ledger's signed statement shows the
whole hold released under the coordinator key the verifier was given.
`scripts/settlement/rehearsal.js` runs the same drills across separate
processes ([verify-a-trade.md](verify-a-trade.md#rehearse-it-on-one-machine)).

## Checking it

```sh
npx vitest run --config tests/vitest.config.js tests/unit/settlement-replay.test.js tests/unit/settlement-old-rules.test.js \
  tests/unit/settlement-v2-rules.test.js tests/unit/settlement-failed-stage-forfeits.test.js tests/unit/settlement-own-stage-ledger.test.js
node scripts/settlement/independent/ledger-differential.js
node scripts/settlement/failure-cases.js
node scripts/settlement/attack-matrix.js --out /absolute/path/matrix.json
node scripts/settlement/baseline-matrix.js --out /absolute/path/baseline.json
```

The unit tests (`tests/unit/settlement-replay.test.js` and
`tests/unit/settlement-replay-encoding.test.js`) include a check that the
replay's charge and credits equal the live ledger's (`server/fleet/credits.js`)
for the same signed records, an unattributed disconnect and a signed stop
included, including an answer settled at window expiry with a
stage closed at its last signed step and an answer whose stages closed after the
deadline with the requester's last acknowledgment late, and that a stage lost
partway forfeits its share in both. They also run one record set under
several `TZ` values and check that it settles the same in each.
`scripts/settlement/failure-cases.js` runs a cancellation, an unattributed
disconnect and a provider failure (with the stage's signed fault, and silent) as
separate trades through a ledger, the replay and the second verifier, and checks
for each that the debit stays within the signed maximum, that the stages that
closed are paid their signed share, and that no hold is left
(`tests/unit/settlement-failure-cases.test.js`). Its parties are simulated on one
machine.
`tests/unit/settlement-old-rules.test.js` replays records, ledger outcomes and
owner statements frozen from the code that ran each of the two older rules
(`tests/fixtures/settlement-old-rules.json`) and expects the same amounts. To
check one published trade without this repository's tests, see
[verify-a-trade.md](verify-a-trade.md); its records-only check
(`scripts/settlement/verify-records.js`) uses only the second verifier and
reads the coordinator's statement.

The attack matrix judges the same attempts three ways with real signatures: the
replay; an operator-signed usage log (B1); and a usage log that the requester and
every credited stage countersign after the attempt (B2). Its rows are operator
goals (overcharge, shift or drop a stage's credit, fabricate a request, charge an
abandoned attempt, settle twice) and participant cases (a requester that stops
paying, one that withholds only its last acknowledgment, equivocation, a withheld
closing receipt, late evidence). B1 lets all six operator goals through, B2 two
and the replay one: charging an attempt a stage abandoned (G5). That one is the
failed-stage rule working as decided, not a hole: the stage that vanished
forfeits its share, and the requester pays the stage that closed for the outputs
it acknowledged. A paid prefix of an unfinished answer is the accepted cost of
that rule (see [Failed stages](#failed-stages)); under the provider-relief terms
the replay let none through. Neither log uses what the requester signs before
and during the answer, so they are weak baselines, and the replay's margin over
them overstates its gap to a simple scheme.

The strongest simple baseline is in `scripts/settlement/baseline-matrix.js`
(B3): the requester-signed terms that every named stage accepted are an
agreement, each requester acknowledgment is an accepted debit note for a
cumulative output count, and the requester owes the highest count it accepted
in time, split by the signed weights. Accepted debit notes let 1 of the 6
operator goals through (charging an abandoned attempt), and so does the replay,
by design: B3 charges the whole accepted prefix, the replay that prefix less the
share of the stage that vanished. The requester-signed terms and cumulative acknowledgments do most of the
work: on every other operator goal, and on the participant cases where the
requester stops paying, withholds its last acknowledgment, or acknowledges and
closes after the deadline (P5), B3 and the replay reach the same amounts, and
since the decided rules so do the stages ending an answer early (P7) and a final
stage faking a stall (L3): both charge the acknowledged prefix. What the stage
receipts add is the failed stage's forfeit (G5, P6): a stage that never closes
is not paid, where B3 pays every stage its share of the accepted prefix. The
matrix lists P6 as the one case the replay "loses" to debit notes; that is the
forfeited share (see [Failed stages](#failed-stages)). Under the provider-relief
terms the same stage made the whole attempt free.

The replay used to lose three participant cases to B3: one stage vetoing every
payment by withholding its closing receipt (L1), a requester voiding its own
charge with a second acknowledgment (L2), and a stranger making a reservation
undecidable under its ID (L4). With the rules above, the replay and B3 reach the
same amounts in all three. The same file also runs the replay over records a
third-party witness timestamped (B4). It lets 0 operator goals through and
changes the replay's verdict only where a signer backdates (L5): there the replay
pays the stages what it pays in P5, so backdating gains them nothing, while the
witness refuses the backdated receipts and the stages are paid nothing. That
costs a new party that must be online and trusted for time.

Two differences from the countersigned log come from this design:
- The countersigned log lets an operator move or drop a stage's share when the
  requester and one stage agree. The replay fixes shares in terms signed before
  dispatch.
- The countersigned log puts no limit on unpaid delivery. The replay's
  acknowledgment bound does.

These are differences in how the parts are combined, not a new cryptographic
primitive, and most of the parts are prior work. A payer that signs a rising
cumulative amount while the provider meters delivery is the payment-channel
voucher: Storj's bandwidth allocations (2018), Filecoin retrieval vouchers with
a payment interval (2020) and, for streamed model output, the session payments
of the Machine Payments Protocol (Tempo and Stripe, announced 2026-03-18), where
the payer signs a voucher with a rising cumulative amount on each stream tick.
The replay's cumulative acknowledgments and its bound on unpaid delivery are
that pattern. Signed accountability logs (PeerReview), requester-accepted
incremental billing (Golem debit notes) and expiring holds (HTLCs) cover other
parts. Those systems settle through a chain, a coordinator or witnesses.

A public search on 2026-11-25 found no earlier system for two narrower
things: one charge divided among sequential stages by weights signed before
dispatch, and recomputing it from the signed records with no chain, coordinator
or witness. The search was short, so a closer system may exist. (It also
counted an abandoned answer being free; the decided rules charge an abandoned
answer its acknowledged prefix, so that is no longer claimed.) The mesh-llm pull requests on signed inference receipts (#2851,
closed unmerged on 2026-11-10; #2981, open and last updated on 2026-11-24) audit
which model a peer served and gate payment on those audits. They are
complementary prior art, not a scheme for settlement amounts, and Reploid has
no counterpart to their payment gating.

The committed matrix outputs are [scripts/settlement/receipts/attack-matrix.json](../scripts/settlement/receipts/attack-matrix.json) and [scripts/settlement/receipts/baseline-matrix.json](../scripts/settlement/receipts/baseline-matrix.json). They were generated by `node scripts/settlement/attack-matrix.js --out scripts/settlement/receipts/attack-matrix.json` and `node scripts/settlement/baseline-matrix.js --out scripts/settlement/receipts/baseline-matrix.json`, with fresh keys on each run; the counts are deterministic. All parties in this matrix are simulated identities on one machine, so it is not evidence of separate operators or of an independent third-party replay.
