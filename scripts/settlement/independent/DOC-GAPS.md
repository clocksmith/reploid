# Gaps found in `docs/settlement-replay.md` while writing `replay.js`

Source read: `docs/settlement-replay.md` only, as of commit f1b3f0754 (the commit is the one the coordinator named; the author may not run git and checked only the text: 638 lines, sha256 `c31c873c0dd53666723e9c0c459a3e763d03b9dba82ad6136ccc40fc5c6326ac`, the same at the start and the end of the work). Line numbers refer to that text.
Items 1-44 were written against commit 20121ae60, before the verifier was compared with anything; items 45-58 were added at 4ee9dd6b2, items 59-69 at c29bc5d44, items 70-74 at a25242bc3, items 75-76 at 955bd5f7a, and item 77 is new at f1b3f0754. The numbering is kept. The author has still not read the reference code, the other files beside this one, or any comparison result.
The f1b3f0754 text differs from 955bd5f7a only from line 465 on (the Stage 1 paragraph, the ledger paragraph, the "Known difference" section and the "Checking it" section). Lines 1-464, which hold every rule of the replay and its result, are unchanged, so `replay.js` was not changed for f1b3f0754 (its header comment still names 955bd5f7a), and every item's status line and line numbers stand as written at 955bd5f7a, except items 58, 72, 75 and 76, which were brought up to f1b3f0754.
Each open item gives the question, the reading `replay.js` implements ("Chosen"), and the other plausible reading(s) ("Other"). A settled item keeps its question and says what settled it.
Items 1-37, 45-54, 59-66 and 70-72 are places where the text does not determine behaviour. Items 38-44, 55-58, 67-69 and 73-77 are places where the text looks self-contradictory or wrong.

Status at f1b3f0754 of items 1-76: 47 settled (2, 6, 12, 17, 19, 22, 23, 24, 27, 28, 29, 30, 32, 34, 35, 37-48, 50-59, 61, 62, 67-70, 73-76), 10 partly settled (3, 13, 14, 15, 18, 26, 36, 49, 63, 72), 19 still stand (1, 4, 5, 7, 8, 9, 10, 11, 16, 20, 21, 25, 31, 33, 60, 64, 65, 66, 71). Two of the settled ones were settled by this text: 75 and 76. New at f1b3f0754: 1 (77), which is about the Stage 1 harness and does not touch the replay.

## Encoding (lines 39-96)

1. **L41-46. Non-JSON values in a record handed over as an object.** "Records contain only finite JSON values" does not say what a verifier does with an `undefined` member, `NaN`, a class instance, a sparse array, a symbol key or a getter.
   Chosen: the whole record is rejected. `-0` is accepted and written `0`.
   Other: serialise as `JSON.stringify` would (drop `undefined` members, write `NaN` as `null`) and then check the signature.
   Status: still stands (text unchanged).

2. **L49-59. Key coordinates were constrained only by a pattern**, so one key had several texts and several participant IDs.
   Status: Settled at c29bc5d44, and still: canonical base64url of 32 bytes, 43 characters. A coordinate that is canonical but not a point fails only at the signature check, which changes the `problem` text and nothing else.

3. **L49-54, L60-69. Signature strictness.**
   Chosen: canonical base64url of exactly 64 bytes; low-S for P-256; OpenSSL behaviour through `node:crypto` for the verification itself.
   Other: RFC 8032 strict or ZIP-215 style Ed25519.
   Status: partly settled, as at a25242bc3. Still open: which Ed25519 verification variant (small-order keys, non-canonical point encodings).

4. **L70-71. Case of the 24 hex digits of a participant ID.** Digests say lowercase (L74); the ID rule does not.
   Chosen: lowercase.
   Status: still stands.

5. **L74-75 with L100-102. "digest" is used as a field type but is not defined in "Record fields".**
   Chosen: a string matching `^sha256:[0-9a-f]{64}$`.
   Other: any text; uppercase hex allowed.
   Status: still stands.

6. **L89-96. Time fields were "strings that `Date.parse` accepts".**
   Status: Settled at c29bc5d44, and still.

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

11. **L120. "`sequence`, an integer `>= 1` that rises by one per receipt".** Is a gap (1, 2, 4), or a first presented receipt that is not 1, a fault? Step 5 (L234) and the `stage-receipt` rules (L377-385) name only a repeated sequence.
    Chosen: any safe integer `>= 1`; gaps are ignored.
    Other: a gap is a conflict, or makes the stage's history incomplete (`unknown`).
    Status: still stands.

12. **L120-124 with L200. `status` against `timing.closedAt`**: what closes a stage, and for which step.
    Status: Settled at c29bc5d44, and still.

13. **L124-127, L216-217. "`output` is `null` except on the final stage" cannot be checked per record.** It needs the terms, and L150-151 says shape failures are rejected before grouping.
    Chosen: the shape check accepts `null` or the exact object on any receipt. A non-final stage's `output` is never read. A final-stage receipt with `output: null` stays in play: it commits no chain, and as the latest receipt it is "not done, no count", so it cannot make the answer delivered (step 6) or withheld (step 9), and `unacknowledgedOutputs` is then `null`.
    Other: drop or reject such receipts once the stage position is known; read a null output's count as `steps`.
    Status: partly settled (L216-217 settles that a receipt without an output commits nothing). The rest stands.

14. **L132-145, L187-194. Policy field types, and a missing or unusable field.**
    Chosen: a step-3 comparison against a missing or wrongly typed field fails, so the outcome is `invalid`. `maxClockSkewMs` must be a count. A policy that has a `maxUnacknowledgedOutputs` member decides `K` with whatever value it holds, so a value that is not a count can never equal the terms' and is `invalid`. An unusable `maxUnacknowledgedOutputs` input is read as 2. A supplied policy that is not a JSON object cannot be named by any terms.
    Other: a negative or fractional allowance is used as it stands; a non-count `K` in the policy is treated as absent; an unusable input makes such attempts `invalid`.
    Status: partly settled, as at a25242bc3. The types are still not given.

## Deciding an outcome (lines 147-293)

15. **L150-151, L334-336. A record with an unknown or missing `schema`; the form of `rejected`.**
    Chosen: rejected with problem `unknown schema`. `schema` is the record's own schema text, known or not, and `null` when it has none or the record cannot be read as JSON; the `problem` texts are mine.
    Other: a record of an unknown schema is ignored; `schema` is `null` unless it is one of the five.
    Status: partly settled, as at a25242bc3 (the entry's members are given, L334-336).

16. **L152. "Identical bodies presented twice count once."** Which copy is the record?
    Chosen: the first copy that passes its checks. Later copies are reported nowhere. A copy with a bad signature is rejected while the valid copy counts. The same body under two different valid signatures counts once.
    Status: still stands.

17. **L178-180 with L158-160. "Outside their own window" in step 1.**
    Status: Settled at c29bc5d44, and still.

18. **L170-177. Scope of the route test.**
    (c) Records that step 4 would later call late still count here (chosen).
    (d) Terms that are both contradicted and outside their window are listed as `foreign` only (chosen). Other: both lists.
    Status: partly settled, as before: (c) and (d) still stand.

19. **"Only those that a stage they name accepted are kept"** (a sentence of 20121ae60).
    Status: Settled at 4ee9dd6b2, and still.

20. **L181-183 with L158-160. "In-time acceptance" before any terms are agreed.** `inTime` is defined on the agreed terms, and this step is choosing them.
    Chosen: each acceptance is timed against the set it names and that set's policy.
    Other: against every remaining set, or against the widest window.
    Status: still stands.

21. **L181-186. An in-time acceptance that names a digest outside the remaining sets** (foreign, late or never presented terms).
    Chosen: ignored.
    Other: counts as "acceptances name different sets", so `conflict`.
    Status: still stands.

22. **L183-186, L369. What `conflicts` holds in step 2.**
    Status: Settled at c29bc5d44, and still. What `digests` holds is item 60.

23. **`requesterId` when step 2 ends in `conflict`.**
    Status: Settled at 4ee9dd6b2, and still (L34-37, L344).

24. **L181-182. Several sets from one requester with different `attemptId`s.**
    Status: Settled at c29bc5d44, and still.

25. **L195-215. A party's record with the agreed `attemptId` that fails another test** (a receipt or acknowledgment with a different `routeHash`, an acceptance of another digest or for a share that is not its own). It is neither "another `attemptId`" nor "from a non-party".
    Chosen: not kept, and dropped without being listed.
    Other: listed as `late`. The wording invites it: "An acceptance counts only for the agreed terms digest and its own share" (L199-200) uses "counts" where the two sentences before it state keeping conditions, and "a kept record that does not count is late" (L202) would then list an in-time acceptance of another digest as late.
    Status: still stands.

26. **L202-203, L356. `late` when the outcome is decided in steps 1 to 3.**
    Chosen: only late terms are listed; step-4 records are classified only if step 4 is reached, so not on an `invalid` row nor on a step-2 `conflict` or `unknown`. The same holds for `unmatched`.
    Other: classify against the agreed terms whenever terms are agreed and their policy is supplied, `invalid` rows included.
    Status: partly settled, as before: "whatever the outcome" (L203) does not say whether it covers a row decided at step 3, before any record is "kept". The Rows table calls `late` "the late records (step 4)" while its first entry form is late terms, which step 1 lists (L178-179).

27. **L367-375. Conflict `kind`s.**
    Status: Settled at c29bc5d44, and still.

28. **L234-235, L377-385. Order for "steps that go backwards".**
    Status: Settled at 955bd5f7a: a stage's receipts are "taken in `sequence` order", and the backwards test is stated on sequences (L377-383). `replay.js` already ordered by sequence.

29. **Requester signs two chains for one count: who is listed?**
    Status: Settled at 4ee9dd6b2, and still (L224-228, L239-241, L370, L373).

30. **L216-218, L232-233. Which of the final stage's receipts are compared.**
    Status: Settled at c29bc5d44, and still.

31. **L242-243 with L87-88. A missing charge binding.** The text covers only a wrong chain.
    Chosen: no count-0 acknowledgment is not a contradiction and does not prevent `settled`.
    Other: `unknown` or `conflict` when it is missing.
    Status: still stands.

32. **L244-245. "Latest".**
    Status: Settled at c29bc5d44, and still.

33. **L149-150, L165-168, L332-333. The verification time.**
    Chosen: the `at` input is a number of milliseconds since the epoch. Nothing relates `at` to record times, so a record dated after `at` counts. When `at` is not a usable number the window has not passed (`open`) and the result's `at` is `null`.
    Other: `at` is an ISO string or a Date; records signed after `at` are ignored; an unusable `at` is an error.
    Status: still stands. The instant at which the window has passed is now given (item 74); the form of the input is still not stated.

34. **L274-275, L375. Signer of the step-7 conflict.**
    Status: Settled at c29bc5d44, and still.

## Split and result (lines 295-392)

35. **L295-302, L349. An own-account stage in the credits.**
    Status: Settled at a25242bc3, and still: listed "with `amount: 0`" (L349), and the debit is `U` minus its share (L301).

36. **L302-304, L331-337. `accountOf` and `balances`.**
    Chosen: `accountOf` is a function (or a Map) from participant ID to an account key, awaited, compared with `===`; a participant it does not place is its own account. `balances` is an object keyed by account whose value is credits minus debits over `settled` and `expired` rows; every account of such a row is present, with 0 when nothing moved.
    Other: an array of `{ account, amount }`; accounts with a zero sum left out; `accountOf` an object or a synchronous-only function.
    Status: partly settled, as at a25242bc3. The container of `balances`, and everything about `accountOf`, are still not stated.

37. **L329-358. The result's shape.**
    Status: Settled at a25242bc3, and still. What is left open is in items 15, 33, 36, 71 and 72.

## Looks self-contradictory or wrong (items of 20121ae60)

38. **L85-86.** Chain values "cannot be recomputed" although the starting value must be.
    Status: Settled at c29bc5d44, and still.

39. **A stage that signs two chains** had no step-5 bullet.
    Status: Settled at 4ee9dd6b2, and still (L236-238, L372).

40. **L291-293.** The last bullet of step 9 began "Otherwise".
    Status: Settled at c29bc5d44, and still.

41. **L176-177, L258-259, L316-318.** An attempt that never started was `unknown` for ever.
    Status: Settled at c29bc5d44, and still.

42. **L310-315.** "A stage that closes early on its own ... earns nothing" read as unconditional.
    Status: Settled at c29bc5d44, and still.

43. **L459-461.** The Stage 1 paragraph gave only the upper bound of `inTime`.
    Status: Settled at c29bc5d44, and still.

44. **L27-31, L137-141, L191-193.** The replay did not check `maxUnacknowledgedOutputs`.
    Status: Settled at c29bc5d44, and still.

## Added at 4ee9dd6b2: not determined by the text

45. **L152-155, L344. A reservation whose records name no requester.**
    Status: Settled at a25242bc3, and still: one row with `requesterId: null`, which has no terms and is `unknown`.

46. **L338-339. Order of the rows.**
    Status: Settled at a25242bc3, and still.

47. **L204-209, L216-218. Which final-stage receipts commit a chain.**
    Status: Settled at c29bc5d44, and still.

48. **L218, L236-238. A final-stage receipt whose count-0 chain is not the starting value.**
    Status: Settled at c29bc5d44, and still.

49. **L239-243, L373-374. The disputed-chain and charge-binding bullets overlap at count 0.** A wrong binding with no right one is literally also "none of its chains for that count is the final stage's".
    Chosen: at count 0 only the `charge-binding` entry. The `output-chain` entry with `signer: null` is used for counts above 0.
    Other: both entries at count 0.
    Status: partly settled, as before: the overlap is still not addressed.

50. **L224-228, L370. How many `acknowledgment-equivocation` entries.**
    Status: Settled at c29bc5d44, and still.

51. **L229-230, L358. Shape of an `unmatched` entry.**
    Status: Settled at a25242bc3, and still. How many entries one count gets is item 71.

52. **L367-375. Order of `signers`; which entries carry which members.**
    Status: Settled at c29bc5d44, and still.

53. **L248-254. `open` against `unknown` for a delivered answer before the release window.**
    Status: Settled at c29bc5d44, and still.

54. **L252-255, L354. Shape of a `closedAtLastStep` entry, and whether it survives a later step.**
    Status: Settled at 955bd5f7a: "the partition indexes ..., in ascending order; kept when step 7 or 8 then decides the row" (L354). `replay.js` already did both.

## Added at 4ee9dd6b2: looked self-contradictory or wrong

55. **"Attempt" had two meanings.**
    Status: Settled at c29bc5d44, and still (L34-37).

56. **"Owes every output it acknowledged in time"** against the matched count.
    Status: Settled at c29bc5d44, and still (L221-223, L280-282, L310).

57. **"`conflicts` names the signer"** against the entry with `signer: null` and the non-blocking entries.
    Status: Settled at c29bc5d44, and still (L320-321, L362-365, L397-399).

58. **Replay against ledger.**
    Status: Settled at c29bc5d44, and still: L480-504 says where the two agree, and L506-550 names the one case where they differ in credits and the one where they differ in status only.

## Added at c29bc5d44: not determined by the text

59. **L137-141, L191-193. How a verifier is given `K`.**
    Status: Settled at a25242bc3, and still.

60. **L183-185, L369. What `digests` holds.**
    Chosen: the digest of every set left after step 1 (so not foreign or late sets), sorted in code unit order.
    Other: every set the requester signed; presentation order; the agreed digest first.
    Status: still stands.

61. **L224-228, L370. `acknowledgment-equivocation` on a count that is not matched.**
    Status: Settled at a25242bc3, and still. `chains` is sorted by my choice.

62. **L371, L377-388. `stage-receipt` entries**: which two sequences, and how many entries a stage gets.
    Status: Settled at 955bd5f7a: `[s, s]`, `[h, s]` with `h` "the lowest sequence that has the most `steps` below `s`", and `[c, s]` for every receipt after the first closing receipt; each distinct pair once per stage (L377-388). `replay.js` already produced exactly these pairs. The order of two pairs found at one sequence is in item 63.

63. **L362-388. Order of the entries in `conflicts`.**
    Chosen: step order: `terms-equivocation`; `stage-receipt` by stage, then sequence, and at one sequence `[s, s]`, then `[h, s]`, then `[c, s]`; the final stage's `output-chain` by count; then per acknowledged count ascending, the `charge-binding`, `signer: null` or `acknowledgment-equivocation` entry; `steps` by stage.
    Other: any other order between kinds; another order of the three tests at one sequence.
    Status: partly settled. Settled at 955bd5f7a: a stage's pairs are listed "in the order [each] is first found", taking its receipts in sequence order (L377-379). Still open: the order between kinds and between stages, and the order of the three tests when one sequence gives more than one pair.

64. **L362. "Every contradiction found, on any outcome."** Are contradictions looked for in steps a row never reaches?
    Chosen: no. A row decided at step 2 or 3 has no step-5 entries, and a row that step 5 makes `conflict` has no `steps` entry.
    Other: every test runs whenever terms are agreed.
    Status: still stands.

65. **L178-183. Timing against a policy that cannot give an allowance.** Step 1 says terms that name an unsupplied policy "are not timed here". It does not say the same of a supplied policy with no usable `maxClockSkewMs`, nor of step 2's "in-time acceptance" for a set whose policy is unsupplied.
    Chosen: none of them is timed: such terms are never `late`, acceptances of them count as in time in step 2, and the attempt is `invalid` if it reaches step 3 with them. Terms that name a supplied policy with an allowance are timed with it even when that policy is not usable (L141-145).
    Other: an allowance of 0; such acceptances never count.
    Status: still stands.

66. **L248-250. An unclosed stage with no receipt that counts, in a delivered answer.** "If any such stage has `steps < N`" presumes a latest receipt.
    Chosen: a stage with no latest receipt has none that covers the answer, so `unknown` (as L322-323 puts it). In JavaScript `undefined < N` is false, so a literal transcription would treat that stage as covered and pay it.
    Status: still stands.

## Added at c29bc5d44: looked self-contradictory or wrong

67. **L60-69.** A relay could still make a second accepted form of a P-256 record.
    Status: Settled at a25242bc3, and still (low-S).

68. **L158-165, L141-145.** `closesInTime` had no allowance at its end and could be shorter than `inTime`.
    Status: Settled at a25242bc3, and still.

69. **L202-213.** Step 4 called a late record "ignored" while step 5 used late receipts.
    Status: Settled at a25242bc3, and still; the remaining contradiction (item 73) is settled too.

## Added at a25242bc3: not determined by the text

70. **L332-334. `counts`.**
    Status: Settled at 955bd5f7a: "listing only the outcomes at least one row has (an empty object when there are no rows)". `replay.js` changed (it listed all six with zeros).

71. **L356-358. How many entries, and in what order, in `late`, `foreign` and `unmatched`.** The entries carry no record index, so two late acknowledgments of one count, or two unmatched ones, are identical entries.
    Chosen: one entry per record, in the order the records were presented.
    Other: one entry per distinct value; sorted by kind or by count.
    Status: still stands.

72. **L350-353, L538-539. `chargedOutputs`, `unacknowledgedOutputs` and `beyondCeiling` at the edges.**
    Chosen: `beyondCeiling` is `max(0, acknowledged - maxOutputTokens)` whatever the charge; `unacknowledgedOutputs` is `null` when the final stage's latest receipt has `output: null` (item 13).
    Other: `beyondCeiling` is 0 when nothing is charged.
    Status: partly settled, as at 955bd5f7a: a row whose answer a stage ended is "`settled` with `outputs > 0` and `chargedOutputs: 0`" (L538-539, and L470-471), as `replay.js` had it. The other two edges are still not stated.

## Added at a25242bc3: looked self-contradictory or wrong

73. **L202-213 against L216-223.** Step 4 said a late record never raises the acknowledged count, while step 5 let an in-time acknowledgment match the chain a late receipt committed.
    Status: Settled at 955bd5f7a: step 4 now makes it the one exception: "a late final-stage receipt still commits its chain at its count", and an in-time acknowledgment "may be matched against the chain a late receipt committed" (L204-209). `replay.js` already did this.

74. **L165-168, L252-259, L270-273.** The release window "passed" for `at` before the last instant at which a close could still count.
    Status: Settled at 955bd5f7a: the window has passed at `at > deadline + releaseWindowMs + maxClockSkewMs` (L165-168), and step 6 is `open` up to and including that instant (L252-257). `replay.js` changed (it used `at >= deadline + releaseWindowMs`).

## Added at 955bd5f7a: looked self-contradictory or wrong

75. **L465-475 against L331.** The Stage 1 paragraph said a receipt passes only when "its replay lists the reservation in `knownDifferences`", a member the Rows section does not give `replaySettlement`'s return.
    Status: Settled at f1b3f0754: `knownDifferences` belongs to the Stage 1 receipt, not to the replay. Each attempt's `settlementReplay` there "holds the replay's return as `result` and, next to it, `knownDifferences`", built by the harness with one `{ case, reservationId, requesterId, acknowledgedOutputs }` entry per `result.reservations` row that is `settled` with `outputs > 0` and `chargedOutputs: 0` (L465-472). `replaySettlement` returns the six documented members, as `replay.js` already did; nothing changed.

76. **L506-521 against L287-293 and L480-504.** The known difference and "the replay's rule" were stated without the provider-loss-free condition and without the withheld case, and "the one case" left out the difference of status.
    Status: Settled at f1b3f0754: the case is now "under `unfinishedTerms` equal to `reploid.unfinished-answer/provider-loss-free/v1` ... with no in-time requester stop and no more than `K` acknowledgments withheld", it "does not arise under `unfinishedTerms: null` or any other value, or when more than `K` acknowledgments were withheld" (L511-517), the replay's rule carries the same conditions (L519-521), and the text names "one case that moves credits" and "one difference of status only" (L508-510, L480-481). This is step 9 as `replay.js` already had it; nothing of the ledger's interim rule is implemented.

## New at f1b3f0754: looks self-contradictory or wrong

77. **L472-475 against L499-500 and L527-530.** The Stage 1 check passes with the known difference only when "the ledger charged exactly that prefix: its output count equals `outputs` and its charge is that count at the policy rate". But the ledger's interim rule charges the acknowledged prefix "up to `maxOutputTokens`", and the ledger "charges `maxOutputTokens` and records the rest as `beyondCeiling`". For a row whose `outputs` is past the ceiling the ledger's charge is `maxOutputTokens` at the policy rate, not `outputs` at that rate, so the condition as worded cannot hold there.
    Chosen: nothing to implement. This is a rule of the Stage 1 harness, not of the replay; `replay.js` reports `outputs`, `chargedOutputs` and `beyondCeiling` and does not judge the ledger.
