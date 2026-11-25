# Gaps found in `docs/settlement-replay.md` while writing `replay.js`

Source read: `docs/settlement-replay.md` only, as of commit a25242bc3 (the commit is the one the coordinator named, with 01d9fcb1c; the author may not run git and checked only the text: 551 lines, sha256 `a32297ec0424f6abfe5a34df65e7a662ab782055afb2bbf2972b1ec4a7626c12`, the same at the start and the end of the work). Line numbers refer to that text.
Items 1-44 were written against commit 20121ae60, before the verifier was compared with anything; items 45-58 were added at 4ee9dd6b2, items 59-69 at c29bc5d44, and items 70-74 are new at a25242bc3. The numbering is kept. Every item's line numbers and "Chosen" text were brought up to a25242bc3, and each ends with a status line for that text. The author has still not read the reference code, the other files beside this one, or any comparison result.
Each open item gives the question, the reading `replay.js` implements ("Chosen"), and the other plausible reading(s) ("Other"). A settled item keeps its question and says what settled it.
Items 1-37, 45-54, 59-66 and 70-72 are places where the text does not determine behaviour. Items 38-44, 55-58, 67-69 and 73-74 are places where the text looks self-contradictory or wrong.

Status at a25242bc3 of items 1-69: 39 settled (2, 6, 12, 17, 19, 22, 23, 24, 27, 29, 30, 32, 34, 35, 37-48, 50-53, 55-59, 61, 67, 68, 69), 10 partly settled (3, 13, 14, 15, 18, 26, 28, 36, 49, 54), 20 still stand (1, 4, 5, 7, 8, 9, 10, 11, 16, 20, 21, 25, 31, 33, 60, 62, 63, 64, 65, 66). Ten of the settled ones were settled by this text: 35, 37, 45, 46, 51, 59, 61, 67, 68, 69. New at a25242bc3: 5 (70-74).

## Encoding (lines 39-96)

1. **L41-46. Non-JSON values in a record handed over as an object.** "Records contain only finite JSON values" does not say what a verifier does with an `undefined` member, `NaN`, a class instance, a sparse array, a symbol key or a getter.
   Chosen: the whole record is rejected. `-0` is accepted and written `0`.
   Other: serialise as `JSON.stringify` would (drop `undefined` members, write `NaN` as `null`) and then check the signature.
   Status: still stands (text unchanged).

2. **L49-59. Key coordinates were constrained only by a pattern**, so one key had several texts and several participant IDs.
   Status: Settled at c29bc5d44, and still: canonical base64url of 32 bytes, 43 characters (L49-59). A coordinate that is canonical but not a point fails only at the signature check, which changes the `problem` text and nothing else.

3. **L49-54, L60-69. Signature strictness.**
   Chosen: canonical base64url of exactly 64 bytes; low-S for P-256; OpenSSL behaviour through `node:crypto` for the verification itself.
   Other: RFC 8032 strict or ZIP-215 style Ed25519.
   Status: partly settled. Settled at c29bc5d44: the alphabet, the canonical text and the length. Settled at a25242bc3: a P-256 signature must be low-S (L62-69). Still open: which Ed25519 verification variant (small-order keys, non-canonical point encodings).

4. **L70-71. Case of the 24 hex digits of a participant ID.** Digests say lowercase (L74); the ID rule does not.
   Chosen: lowercase.
   Status: still stands.

5. **L74-75 with L100-102. "digest" is used as a field type but is not defined in "Record fields".**
   Chosen: a string matching `^sha256:[0-9a-f]{64}$`.
   Other: any text; uppercase hex allowed.
   Status: still stands.

6. **L89-96. Time fields were "strings that `Date.parse` accepts".**
   Status: Settled at c29bc5d44, and still: exactly the `toISOString` form, naming a real instant, for every time field.

7. **L101. Unit of "maximum length".**
   Chosen: UTF-16 code units (`string.length`).
   Other: code points or UTF-8 bytes.
   Status: still stands.

## Record fields (lines 98-145)

8. **L104-130. No type is given for `attemptId`, `requesterId`, `participantId` (including `shares[].participantId`) or `schema`.**
   Chosen: the IDs are text 256; signer fields must also equal the carried key's ID; `schema` is the schema string of the kind.
   Other: `attemptId` text 160 like `reservationId`; `shares[].participantId` must match `peer:` plus 24 hex (then terms naming a malformed stage are rejected instead of being merely unsatisfiable).
   Status: still stands.

9. **L106-107. `maximum` has no type, and the product can exceed 2^53.**
   Chosen: a safe integer equal to the exact (BigInt) product, so terms whose product is not a safe integer are rejected.
   Other: double arithmetic, `maximum === maxOutputTokens * creditsPerOutputToken`.
   Status: still stands.

10. **L107-109. May one participant hold two stages?** Nothing forbids it.
    Chosen: allowed.
    Other: rejected as a malformed `shares`.
    Status: still stands.

11. **L120. "`sequence`, an integer `>= 1` that rises by one per receipt".** Is a gap (1, 2, 4), or a first presented receipt that is not 1, a fault? Step 5 (L226) names only a repeated sequence.
    Chosen: any safe integer `>= 1`; gaps are ignored.
    Other: a gap is a conflict, or makes the stage's history incomplete (`unknown`).
    Status: still stands.

12. **L120-124 with L197. `status` against `timing.closedAt`**: what closes a stage, and for which step.
    Status: Settled at c29bc5d44, and still: a closing receipt is `settled` or `failed` with `closedAt` (L197), timed by its `signedAt`.

13. **L124-127, L208-209. "`output` is `null` except on the final stage" cannot be checked per record.** It needs the terms, and L150-151 says shape failures are rejected before grouping.
    Chosen: the shape check accepts `null` or the exact object on any receipt. A non-final stage's `output` is never read. A final-stage receipt with `output: null` stays in play: it commits no chain, and as the latest receipt it is "not done, no count", so it cannot make the answer delivered (step 6) or withheld (step 9), and `unacknowledgedOutputs` is then `null`.
    Other: drop or reject such receipts once the stage position is known; read a null output's count as `steps`.
    Status: partly settled (L208-209 settles that a receipt without an output commits nothing). The rest stands.

14. **L132-145, L184-191. Policy field types, and a missing or unusable field.**
    Chosen: a step-3 comparison against a missing or wrongly typed field fails, so the outcome is `invalid`. `maxClockSkewMs` must be a count. A policy that has a `maxUnacknowledgedOutputs` member decides `K` with whatever value it holds, so a value that is not a count can never equal the terms' and is `invalid`. An unusable `maxUnacknowledgedOutputs` input is read as 2. A supplied policy that is not a JSON object cannot be named by any terms.
    Other: a negative or fractional allowance is used as it stands; a non-count `K` in the policy is treated as absent; an unusable input makes such attempts `invalid`.
    Status: partly settled. Settled at a25242bc3: a policy whose release window is not greater than its allowance is `invalid` (L141-145, L184-185), which covers a missing `maxClockSkewMs`, and a policy without `maxUnacknowledgedOutputs` takes the input's `K` (L137-141). The types are still not given.

## Deciding an outcome (lines 147-285)

15. **L150-151, L325-327. A record with an unknown or missing `schema`; the form of `rejected`.**
    Chosen: rejected with problem `unknown schema`. Entries are `{ index, schema, problem }`; `schema` is the record's own schema text, known or not, and `null` when it has none or the record cannot be read as JSON; the `problem` texts are mine.
    Other: a record of an unknown schema is ignored; `schema` is `null` unless it is one of the five.
    Status: partly settled. Settled at a25242bc3: the entry's members (L325-327). Still open: whether an unknown schema is a rejection, what `schema` shows for it, and the `problem` texts.

16. **L152. "Identical bodies presented twice count once."** Which copy is the record?
    Chosen: the first copy that passes its checks. Later copies are reported nowhere. A copy with a bad signature is rejected while the valid copy counts. The same body under two different valid signatures counts once.
    Status: still stands.

17. **L175-177 with L158-160. "Outside their own window" in step 1.**
    Status: Settled at c29bc5d44, and still.

18. **L167-174. Scope of the route test.**
    (c) Records that step 4 would later call late still count here (chosen).
    (d) Terms that are both contradicted and outside their window are listed as `foreign` only (chosen). Other: both lists.
    Status: partly settled. (a) and (b) were settled at 4ee9dd6b2 and c29bc5d44. (c) and (d) still stand.

19. **"Only those that a stage they name accepted are kept"** (a sentence of 20121ae60).
    Status: Settled at 4ee9dd6b2, and still (L34-37, L152-157).

20. **L178-180 with L158-160. "In-time acceptance" before any terms are agreed.** `inTime` is defined on the agreed terms, and this step is choosing them.
    Chosen: each acceptance is timed against the set it names and that set's policy.
    Other: against every remaining set, or against the widest window.
    Status: still stands.

21. **L178-183. An in-time acceptance that names a digest outside the remaining sets** (foreign, late or never presented terms).
    Chosen: ignored.
    Other: counts as "acceptances name different sets", so `conflict`.
    Status: still stands.

22. **L180-183, L360. What `conflicts` holds in step 2.**
    Status: Settled at c29bc5d44, and still. What `digests` holds is item 60.

23. **`requesterId` when step 2 ends in `conflict`.**
    Status: Settled at 4ee9dd6b2, and still (L34-37, L335).

24. **L178-179. Several sets from one requester with different `attemptId`s.**
    Status: Settled at c29bc5d44, and still.

25. **L192-207. A party's record with the agreed `attemptId` that fails another test** (a receipt or acknowledgment with a different `routeHash`, an acceptance of another digest or for a share that is not its own). It is neither "another `attemptId`" nor "from a non-party".
    Chosen: not kept, and dropped without being listed.
    Other: listed as `late`. The wording invites it: "An acceptance counts only for the agreed terms digest and its own share" (L196-197) uses "counts" where the two sentences before it state keeping conditions, and "a kept record that does not count is late" (L199) would then list an in-time acceptance of another digest as late.
    Status: still stands.

26. **L199-200, L347. `late` when the outcome is decided in steps 1 to 3.**
    Chosen: only late terms are listed; step-4 records are classified only if step 4 is reached, so not on an `invalid` row nor on a step-2 `conflict` or `unknown`. The same holds for `unmatched`.
    Other: classify against the agreed terms whenever terms are agreed and their policy is supplied, `invalid` rows included.
    Status: partly settled, as at c29bc5d44: "whatever the outcome" (L200) does not say whether it covers a row decided at step 3, before any record is "kept". The Rows table calls `late` "the late records (step 4)" while its first entry form is late terms, which step 1 lists (L175-176).

27. **L358-366. Conflict `kind`s.**
    Status: Settled at c29bc5d44, and still.

28. **L226-227 with L197 and L362. Order for "steps that go backwards".**
    Chosen: order by `sequence`.
    Other: order by `signedAt`.
    Status: partly settled, as at c29bc5d44: the order is still not stated, though `sequences` (L362) and "highest-`sequence`" (L236) point to sequence order.

29. **Requester signs two chains for one count: who is listed?**
    Status: Settled at 4ee9dd6b2, and still (L216-220, L231-233, L361, L364).

30. **L208-210, L224-225. Which of the final stage's receipts are compared.**
    Status: Settled at c29bc5d44, and still.

31. **L234-235 with L87-88. A missing charge binding.** The text covers only a wrong chain.
    Chosen: no count-0 acknowledgment is not a contradiction and does not prevent `settled`.
    Other: `unknown` or `conflict` when it is missing.
    Status: still stands.

32. **L236-237. "Latest".**
    Status: Settled at c29bc5d44, and still.

33. **L149-150, L245, L248-249, L324. The verification time.**
    Chosen: the `at` input is a number of milliseconds since the epoch. Nothing relates `at` to record times, so a record dated after `at` counts. When `at` is not a usable number the window has not passed (`open`) and the result's `at` is `null`.
    Other: `at` is an ISO string or a Date; records signed after `at` are ignored; an unusable `at` is an error.
    Status: still stands. The result's `at` is now "an ISO string" (L324); the form of the input is not stated.

34. **L266-267, L366. Signer of the step-7 conflict.**
    Status: Settled at c29bc5d44, and still.

## Split and result (lines 287-370)

35. **L287-294, L340. An own-account stage in the credits.**
    Status: Settled at a25242bc3: the stage is listed "with `amount: 0`" (L340), and the debit is `U` minus its share (L293). `replay.js` already did this.

36. **L294-296, L323-328. `accountOf` and `balances`.**
    Chosen: `accountOf` is a function (or a Map) from participant ID to an account key, awaited, compared with `===`; a participant it does not place is its own account. `balances` is an object keyed by account whose value is credits minus debits over `settled` and `expired` rows; every account of such a row is present, with 0 when nothing moved.
    Other: an array of `{ account, amount }`; accounts with a zero sum left out; `accountOf` an object or a synchronous-only function.
    Status: partly settled. Settled at a25242bc3: what `balances` sums and over which rows (L327-328); `replay.js` now returns it. Its container, and everything about `accountOf`, are still not stated.

37. **L321-349. The result's shape.**
    Status: Settled at a25242bc3: the "Rows" section gives the returned object and says "every row has exactly these members". `replay.js` changed to it: the row now has `attemptId`, `status`, `outputs`, `chargedOutputs`, `unacknowledgedOutputs` and `beyondCeiling`, and no longer `outcome`, `termsDigest` or `units`; `debit` and `credits` are `null` unless the row is `settled` or `expired`; `credits` entries are `{ participantId, amount }`; `late`, `foreign` and `unmatched` entries take the documented forms and carry no index; `rejected` entries are `{ index, schema, problem }`; the result has `schema`, `at`, `counts` and `balances`. What is left open is in items 15, 33, 36, 70, 71 and 72.

## Looks self-contradictory or wrong (items of 20121ae60)

38. **L85-86.** Chain values "cannot be recomputed" although the starting value must be.
    Status: Settled at c29bc5d44, and still.

39. **A stage that signs two chains** had no step-5 bullet.
    Status: Settled at 4ee9dd6b2, and still (L228-230, L363).

40. **L283-285.** The last bullet of step 9 began "Otherwise".
    Status: Settled at c29bc5d44, and still.

41. **L173-174, L250-251, L308-310.** An attempt that never started was `unknown` for ever.
    Status: Settled at c29bc5d44, and still.

42. **L302-307.** "A stage that closes early on its own ... earns nothing" read as unconditional.
    Status: Settled at c29bc5d44, and still.

43. **L437-439.** The Stage 1 paragraph gave only the upper bound of `inTime`.
    Status: Settled at c29bc5d44, and still.

44. **L27-31, L132-141, L188-190.** The replay did not check `maxUnacknowledgedOutputs`.
    Status: Settled at c29bc5d44, and still; the value now comes from the named policy itself (item 59).

## Added at 4ee9dd6b2: not determined by the text

45. **L152-155, L335. A reservation whose records name no requester.**
    Status: Settled at a25242bc3: `requesterId` is "`null` when no record names one" (L335), so there is a row. `replay.js` changed: such a reservation gets one row with `requesterId: null`, which has no terms and is `unknown` (L178). It is made only when the reservation has no attempt at all.

46. **L329-330. Order of the rows.**
    Status: Settled at a25242bc3: "ordered by `reservationId` and then `requesterId`" (L329-330). `replay.js` already did this, comparing by UTF-16 code unit.

47. **L208-210, L224-225. Which final-stage receipts commit a chain.**
    Status: Settled at c29bc5d44, and still. Item 73 is about what such a commitment may be used for.

48. **L210-211, L228-230. A final-stage receipt whose count-0 chain is not the starting value.**
    Status: Settled at c29bc5d44, and still.

49. **L231-235, L364-365. The disputed-chain and charge-binding bullets overlap at count 0.** A wrong binding with no right one is literally also "none of its chains for that count is the final stage's".
    Chosen: at count 0 only the `charge-binding` entry. The `output-chain` entry with `signer: null` is used for counts above 0.
    Other: both entries at count 0.
    Status: partly settled, as at c29bc5d44: the overlap is still not addressed.

50. **L216-220, L361. How many `acknowledgment-equivocation` entries.**
    Status: Settled at c29bc5d44, and still: one per count, with `count` and `chains`.

51. **L221-222, L349. Shape of an `unmatched` entry.**
    Status: Settled at a25242bc3: `{ kind: 'acknowledgment', count }` (L349). `replay.js` changed (it carried the record's index). How many entries one count gets is item 71.

52. **L358-366. Order of `signers`; which entries carry which members.**
    Status: Settled at c29bc5d44, and still.

53. **L240-245. `open` against `unknown` for a delivered answer before the release window.**
    Status: Settled at c29bc5d44, and still.

54. **L245-247, L345. Shape of a `closedAtLastStep` entry, and whether it survives a later step.**
    Chosen: the indexes stay on the row if step 7 or step 8 then decides it (`conflict` or `unknown`).
    Other: emptied unless the row settles.
    Status: partly settled. Settled at a25242bc3: the member holds "the partition indexes" (L345); `replay.js` changed (it held objects). Whether it survives a later step is still open.

## Added at 4ee9dd6b2: looked self-contradictory or wrong

55. **"Attempt" had two meanings.**
    Status: Settled at c29bc5d44, and still (L34-37).

56. **"Owes every output it acknowledged in time"** against the matched count.
    Status: Settled at c29bc5d44, and still (L213-215, L272-274, L302).

57. **"`conflicts` names the signer"** against the entry with `signer: null` and the non-blocking entries.
    Status: Settled at c29bc5d44, and still (L312-313, L353-356, L375-377).

58. **Replay against ledger.**
    Status: Settled at c29bc5d44, and still; L445-467 now also names the one case where the two differ (`unknown` against the ledger's `expired`).

## Added at c29bc5d44: not determined by the text

59. **L132-141, L188-190. How a verifier is given `K`.**
    Status: Settled at a25242bc3: `K` is the named policy's `maxUnacknowledgedOutputs`; for a policy with no such member it is `replaySettlement`'s `maxUnacknowledgedOutputs` input, 2 by default, and "a policy that names `K` decides it, whatever that input says" (L137-141). `replay.js` changed: the `receiverPolicy` input is gone and `maxUnacknowledgedOutputs` replaces it.

60. **L180-182, L360. What `digests` holds.**
    Chosen: the digest of every set left after step 1 (so not foreign or late sets), sorted in code unit order.
    Other: every set the requester signed; presentation order; the agreed digest first.
    Status: still stands.

61. **L216-220, L361. `acknowledgment-equivocation` on a count that is not matched.**
    Status: Settled at a25242bc3: the entry is for "a count for which the requester also signed the final stage's chain", in time or late, "with `settledOn` when that count is matched" (L216-220). `replay.js` changed: there is no entry when none of the requester's chains is the final stage's, nor at a count no receipt commits; there is one, without `settledOn`, when the final stage's chain is only on a late acknowledgment. `chains` is still sorted by my choice.

62. **L226-227, L362. `stage-receipt` entries.** One kind covers three faults, and "`sequences` (the two that conflict)" does not say which two when the fault is against an earlier, not adjacent, receipt, nor how many entries a stage gets.
    Chosen: per stage, one entry per distinct pair: `[s, s]` for a repeated sequence; `[the earliest earlier receipt with the most steps, s]` when the steps at `s` are below it; `[the first closing receipt, s]` for every receipt after it.
    Other: adjacent receipts only; one entry per stage; the first fault only.
    Status: still stands.

63. **L353-366. Order of the entries in `conflicts`.**
    Chosen: step order: `terms-equivocation`; `stage-receipt` by stage, then sequence; the final stage's `output-chain` by count; then per acknowledged count ascending, the `charge-binding`, `signer: null` or `acknowledgment-equivocation` entry; `steps` by stage.
    Other: any other order; sorted by kind.
    Status: still stands.

64. **L353. "Every contradiction found, on any outcome."** Are contradictions looked for in steps a row never reaches?
    Chosen: no. A row decided at step 2 or 3 has no step-5 entries, and a row that step 5 makes `conflict` has no `steps` entry.
    Other: every test runs whenever terms are agreed.
    Status: still stands.

65. **L175-180. Timing against a policy that cannot give an allowance.** Step 1 says terms that name an unsupplied policy "are not timed here". It does not say the same of a supplied policy with no usable `maxClockSkewMs`, nor of step 2's "in-time acceptance" for a set whose policy is unsupplied.
    Chosen: none of them is timed: such terms are never `late`, acceptances of them count as in time in step 2, and the attempt is `invalid` if it reaches step 3 with them. Terms that name a supplied policy with an allowance are timed with it even when that policy is not usable (L141-145).
    Other: an allowance of 0; such acceptances never count.
    Status: still stands.

66. **L240-242. An unclosed stage with no receipt that counts, in a delivered answer.** "If any such stage has `steps < N`" presumes a latest receipt.
    Chosen: a stage with no latest receipt has none that covers the answer, so `unknown` (as L314-315 puts it). In JavaScript `undefined < N` is false, so a literal transcription would treat that stage as covered and pay it.
    Status: still stands.

## Added at c29bc5d44: looked self-contradictory or wrong

67. **L60-69.** A relay could still make a second accepted form of a P-256 record with `r || (n - s)`.
    Status: Settled at a25242bc3: a P-256 signature must be low-S, `1 <= s <= n / 2`, and a high-S one is rejected (L62-69). `replay.js` changed.

68. **L158-165, L141-145.** `closesInTime` had no allowance at its end and could be shorter than `inTime`.
    Status: Settled at a25242bc3: `closesInTime` ends at `deadline + releaseWindowMs + maxClockSkewMs`, inclusive (L160-165), and a policy whose release window is not greater than its allowance is `invalid` (L141-145, L184-185). `replay.js` changed.

69. **L199-205.** Step 4 called a late record "ignored" while step 5 used late receipts.
    Status: Settled at a25242bc3: a late record is ignored for amounts and for every outcome but `conflict`, and step 5 uses kept receipts and acknowledgments, late or not, in every contradiction test (L199-205, L216-220, L224-235). `replay.js` changed: late acknowledgments now take part in the equivocation, disputed-chain and charge-binding tests. One sentence of it contradicts step 5: item 73.

## New at a25242bc3: not determined by the text

70. **L323-325. `counts`.** "The number of rows per outcome" does not say whether an outcome no row has is present.
    Chosen: an object with all six outcomes, 0 where no row has it.
    Other: only the outcomes that occur.

71. **L347-349. How many entries, and in what order, in `late`, `foreign` and `unmatched`.** The entries carry no record index, so two late acknowledgments of one count, or two unmatched ones, are identical entries.
    Chosen: one entry per record, in the order the records were presented.
    Other: one entry per distinct value; sorted by kind or by count.

72. **L341-344. `chargedOutputs`, `unacknowledgedOutputs` and `beyondCeiling` at the edges.**
    Chosen: when a stage ended a provider-loss-free answer and the charge is 0, `chargedOutputs` is 0; `beyondCeiling` is `max(0, acknowledged - maxOutputTokens)` whatever the charge; `unacknowledgedOutputs` is `null` when the final stage's latest receipt has `output: null` (item 13).
    Other: `chargedOutputs` is `min(acknowledged, maxOutputTokens)` even when nothing is charged; `beyondCeiling` is 0 when nothing is charged.

## New at a25242bc3: looks self-contradictory or wrong

73. **L199-203 against L208-213.** Step 4: a late record "is ignored for everything that decides an amount" and "never raises or lowers the acknowledged count". Step 5: every kept receipt of the final stage commits its chain "whenever it was signed", and a count is matched when an in-time acknowledgment carries the committed chain. So when only a late receipt commits a chain at a count and the requester acknowledged that count in time with that chain, step 5 makes the count matched and charged, and the late receipt has raised the acknowledged count. Under step 4 it would be neither matched nor `unmatched` (L221-222 lists only counts at which "no final-stage receipt commits a chain").
    Chosen: step 5. A late receipt's chain can be matched by an in-time acknowledgment.
    Other: only receipts that count commit a chain for matching; late ones commit for the contradiction tests alone.

74. **L245-249 against L160-165, L262-265 and L300.** A closing receipt counts when signed up to `deadline + releaseWindowMs + maxClockSkewMs`, but the release window "passes" for `at` at `deadline + releaseWindowMs`, with no allowance, and the prose still says a stage has closed when it closes "before the release window ends". For `at` between the two instants a row is already `expired`, or settled with a stage "closed at its last step", although a close honestly signed in that interval still counts when presented, and would change the row.
    Chosen: both rules as written.
