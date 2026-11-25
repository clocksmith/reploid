# Gaps found in `docs/settlement-replay.md` while writing `replay.js`

Source read: `docs/settlement-replay.md` only, as of commit c29bc5d44 (the commit is the one the coordinator named; the author may not run git and checked only the text: 477 lines, sha256 `25546ee8f49d...`). Line numbers refer to that text.
Items 1-44 were written against commit 20121ae60, before the verifier was compared with anything; items 45-58 were added at 4ee9dd6b2; items 59-69 are new at c29bc5d44. The numbering is kept. Every item's line numbers and "Chosen" text were brought up to c29bc5d44, and each ends with a status line for that text. The author has still not read the reference code, the other files beside this one, or any comparison result.
Each open item gives the question, the reading `replay.js` implements ("Chosen"), and the other plausible reading(s) ("Other"). A settled item keeps its question and says what settled it.
Items 1-37, 45-54 and 59-66 are places where the text does not determine behaviour. Items 38-44, 55-58 and 67-69 are places where the text looks self-contradictory or wrong.

Status at c29bc5d44 of items 1-58: 29 settled (2, 6, 12, 17, 19, 22, 23, 24, 27, 29, 30, 32, 34, 38, 39, 40, 41, 42, 43, 44, 47, 48, 50, 52, 53, 55, 56, 57, 58), 7 partly settled (3, 13, 18, 26, 28, 37, 49), 22 still stand (1, 4, 5, 7, 8, 9, 10, 11, 14, 15, 16, 20, 21, 25, 31, 33, 35, 36, 45, 46, 51, 54). New at c29bc5d44: 11 (59-69).

## Encoding (lines 37-87)

1. **L39-44. Non-JSON values in a record handed over as an object.** "Records contain only finite JSON values" does not say what a verifier does with an `undefined` member, `NaN`, a class instance, a sparse array, a symbol key or a getter.
   Chosen: the whole record is rejected. `-0` is accepted and written `0`.
   Other: serialise as `JSON.stringify` would (drop `undefined` members, write `NaN` as `null`) and then check the signature.
   Status: still stands (text unchanged).

2. **L47-57. Key coordinates were constrained only by a pattern**, so one key had several texts and several participant IDs.
   Status: Settled at c29bc5d44: a coordinate is canonical base64url of 32 bytes, 43 characters, and "one key therefore has one text and one participant ID" (L47-57). `replay.js` now rejects every other text at the key check. A coordinate that is canonical but not a point still fails only at the signature check, which changes the reason and nothing else.

3. **L47-52, L58-60. Signature strictness.**
   Chosen: canonical base64url of exactly 64 bytes; OpenSSL behaviour through `node:crypto` for the verification itself; high-S ECDSA accepted.
   Other: RFC 8032 strict or ZIP-215 style Ed25519; low-S only.
   Status: partly settled. Settled at c29bc5d44: the alphabet, no padding, the canonical text and the 64 bytes / 86 characters (L47-52, L58-60). Still open: which Ed25519 verification variant (small-order keys, non-canonical point encodings), and whether a high-S P-256 signature is accepted (item 67).

4. **L61-62. Case of the 24 hex digits of a participant ID.** Digests say lowercase (L65); the ID rule does not.
   Chosen: lowercase.
   Status: still stands.

5. **L65-66 with L91-93. "digest" is used as a field type but is not defined in "Record fields".**
   Chosen: a string matching `^sha256:[0-9a-f]{64}$`.
   Other: any text; uppercase hex allowed.
   Status: still stands.

6. **L80-87. Time fields were "strings that `Date.parse` accepts"**, which depends on the engine and the time zone.
   Status: Settled at c29bc5d44: exactly the `toISOString` form, a fixed pattern, naming a real instant, for every time field (L80-87). `replay.js` now checks the pattern and the round trip; the 40-character rule is gone.

7. **L92. Unit of "maximum length".**
   Chosen: UTF-16 code units (`string.length`).
   Other: code points or UTF-8 bytes.
   Status: still stands.

## Record fields (lines 89-129)

8. **L95-121. No type is given for `attemptId`, `requesterId`, `participantId` (including `shares[].participantId`) or `schema`.**
   Chosen: the IDs are text 256; signer fields must also equal the carried key's ID; `schema` is the schema string of the kind.
   Other: `attemptId` text 160 like `reservationId`; `shares[].participantId` must match `peer:` plus 24 hex (then terms naming a malformed stage are rejected instead of being merely unsatisfiable).
   Status: still stands.

9. **L97-98. `maximum` has no type, and the product can exceed 2^53.**
   Chosen: a safe integer equal to the exact (BigInt) product, so terms whose product is not a safe integer are rejected.
   Other: double arithmetic, `maximum === maxOutputTokens * creditsPerOutputToken`.
   Status: still stands.

10. **L98-100. May one participant hold two stages?** Nothing forbids it.
    Chosen: allowed.
    Other: rejected as a malformed `shares`.
    Status: still stands.

11. **L111. "`sequence`, an integer `>= 1` that rises by one per receipt".** Is a gap (1, 2, 4), or a first presented receipt that is not 1, a fault? Step 5 (L195) names only a repeated sequence.
    Chosen: any safe integer `>= 1`; gaps are ignored.
    Other: a gap is a conflict, or makes the stage's history incomplete (`unknown`).
    Status: still stands.

12. **L111-115 with L175, L196 and L204-205. `status` against `timing.closedAt`**: what closes a stage, and for which step.
    Status: Settled at c29bc5d44: a closing receipt is `settled` or `failed` with `closedAt` (L175), in steps 4, 5 and 6 alike, and it is timed by its `signedAt` (`closesInTime`). `replay.js` changed: a `settled` or `failed` receipt without `closedAt` is no longer "a closing receipt" in step 5. Every combination of `status` and `closedAt` still passes the shape check, since no field rule relates them.

13. **L115-118, L180-181. "`output` is `null` except on the final stage" cannot be checked per record.** It needs the terms, and L134-135 says shape failures are rejected before grouping.
    Chosen: the shape check accepts `null` or the exact object on any receipt. A non-final stage's `output` is never read. A final-stage receipt with `output: null` stays in play: it commits no chain, and as the latest receipt it is "not done, no count", so it cannot make the answer delivered (step 6) or withheld (step 9).
    Other: drop or reject such receipts once the stage position is known; read a null output's count as `steps`.
    Status: partly settled. L180-181 ("every kept receipt of the final stage with an `output` commits") settles that one without an output commits nothing. The rest stands.

14. **L123-129, L164-169. Policy field types, and a missing field.**
    Chosen: a step-3 comparison against a missing or wrongly typed field fails, so the outcome is `invalid`. A missing or non-count `maxClockSkewMs`, which step 3 does not mention, is also `invalid` (see item 65 for steps 1 and 2). A supplied policy that is not a JSON object cannot be named by any terms.
    Other: a missing `maxClockSkewMs` means 0.
    Status: still stands.

## Deciding an outcome (lines 131-253)

15. **L134-135. A record with an unknown or missing `schema`; the form of `rejected`.**
    Chosen: rejected with reason `unknown schema`. Entries are `{ index, reason }`; the reason texts are mine.
    Other: silently ignored.
    Status: still stands.

16. **L136. "Identical bodies presented twice count once."** Which copy is the record?
    Chosen: the first copy that passes its checks; its index is the one used in `late`, `foreign` and `unmatched`. Later copies are reported nowhere. A copy with a bad signature is rejected while the valid copy counts. The same body under two different valid signatures counts once.
    Status: still stands.

17. **L155-157 with L142-144. "Outside their own window" in step 1**: with or without the skew allowance, and with which allowance when the named policy is not supplied.
    Status: Settled at c29bc5d44: `inTime` with the terms' own `notBefore`, `deadline` and named policy; terms that name an unsupplied policy are not timed and reach step 3 (L155-157). `replay.js` changed (it used an allowance of 0).

18. **L147-154. Scope of the route test.**
    (a) Whose acknowledgments count. (b) Which acknowledgments "any acknowledgment" means.
    (c) Records that step 4 would later call late still count here (chosen).
    (d) Terms that are both contradicted and outside their window are listed as `foreign` only (chosen). Other: both lists.
    Status: partly settled. (a) was settled at 4ee9dd6b2 (an acknowledgment goes only to its requester's attempt, L136-139). Settled at c29bc5d44: (b), "look at the records with the terms' `attemptId`" (L147-148). (c) and (d) still stand.

19. **"Only those that a stage they name accepted are kept"** (a sentence of 20121ae60).
    Status: Settled at 4ee9dd6b2, and still: the sentence is gone and each requester has its own attempt (L32-35, L136-141).

20. **L158-160 with L142-144. "In-time acceptance" before any terms are agreed.** `inTime` is defined on the agreed terms, and this step is choosing them.
    Chosen: each acceptance is timed against the set it names and that set's policy.
    Other: against every remaining set, or against the widest window.
    Status: still stands.

21. **L158-163. An in-time acceptance that names a digest outside the remaining sets** (foreign, late or never presented terms).
    Chosen: ignored.
    Other: counts as "acceptances name different sets", so `conflict`.
    Status: still stands.

22. **L160-163, L300. What `conflicts` holds in step 2.**
    Status: Settled at c29bc5d44: the agreed digest is `settledOn` (L161-162), and the table gives both forms of the entry, non-blocking with `settledOn` and blocking without, each with `digests` and the requester as `signer` (L300). `replay.js` follows it. What `digests` holds is item 60.

23. **`requesterId` when step 2 ends in `conflict`.**
    Status: Settled at 4ee9dd6b2, and stated outright now: an attempt is one (`reservationId`, `requesterId`) pair and one row (L32-35).

24. **L158-159. Several sets from one requester with different `attemptId`s.**
    Status: Settled at c29bc5d44: "several sets (whatever their `attemptId`s)" are one equivocation (L158-159). `replay.js` already did this; a second set under an `attemptId` with no records now passes step 1 (item 41), so it takes part.

25. **L170-179. A party's record with the agreed `attemptId` that fails another test** (a receipt or acknowledgment with a different `routeHash`, an acceptance of another digest or for a share that is not its own). It is neither "another `attemptId`" nor "from a non-party".
    Chosen: not kept, and dropped without being listed.
    Other: listed as `late`. The new wording invites it: "An acceptance counts only for the agreed terms digest and its own share" uses "counts" where the two sentences before it state keeping conditions, and "a kept record that does not count is listed as `late`" would then list an in-time acceptance of another digest as late.
    Status: still stands, and is sharper.

26. **L177-178. `late` when the outcome is decided in steps 1 to 3.**
    Chosen: only late terms are listed; step-4 records are classified only if step 4 is reached, so not on an `invalid` row nor on a step-2 `conflict` or `unknown`. The same holds for `unmatched`. Entries are `{ index, schema }`.
    Other: classify against the agreed terms whenever terms are agreed and their policy is supplied, `invalid` rows included.
    Status: partly settled. "Whatever the outcome" (L177-178) settles that the listing does not depend on what a later step decides. It does not say whether it also covers a row decided at step 3, before any record is "kept".

27. **L291-306. Conflict `kind`s.**
    Status: Settled at c29bc5d44: the table names every kind (`terms-equivocation`, `acknowledgment-equivocation`, `stage-receipt`, `output-chain`, `charge-binding`, `steps`) with its signer and members. `replay.js` uses them and no longer invents any.

28. **L195-196 with L175 and L302. Order for "steps that go backwards"; what "a closing receipt" is.**
    Chosen: order by `sequence`.
    Other: order by `signedAt`.
    Status: partly settled. Settled at c29bc5d44: a closing receipt (L175). The order is still not stated, though `sequences` (L302) and "highest-`sequence`" (L204) point to sequence order.

29. **Requester signs two chains for one count: who is listed?**
    Status: Settled at 4ee9dd6b2, and still: non-blocking `acknowledgment-equivocation` when one of them is the final stage's chain (L188-190, L301), an `output-chain` entry with `signer: null` when none is (L200-201, L304, L308-310).

30. **L180-182, L194. Which of the final stage's receipts are compared.**
    Status: Settled at c29bc5d44: "every kept receipt of the final stage with an `output` ..., whenever it was signed" (L180-182), and the conflict tests hold "late receipts included" (L194).

31. **L202-203 with L78-79. A missing charge binding.** The text covers only a wrong chain.
    Chosen: no in-time count-0 acknowledgment is not a contradiction and does not prevent `settled`.
    Other: `unknown` or `conflict` when it is missing.
    Status: still stands.

32. **L204-205. "Latest".**
    Status: Settled at c29bc5d44: "its highest-`sequence` receipt that counts (step 4)".

33. **L213, L216-217. The verification time.**
    Chosen: nothing relates `at` to record times, so a record dated after `at` counts. When `at` is not a number the window has not passed (`open`).
    Other: ignore records signed after `at`; `expired` or an error for an unusable `at`.
    Status: still stands. The boundary itself is written out (`at < deadline + releaseWindowMs` is before the window).

34. **L234-235, L306. Signer of the step-7 conflict; the count with no acknowledgment.**
    Status: Settled at c29bc5d44: the entry is `steps`, against that stage, with `partitionIndex` (L306); the count was settled at 4ee9dd6b2 ("0 if none", L185).

## Split and result (lines 255-310)

35. **L257-262. An own-account stage in the credits.**
    Chosen: its entry is kept with `amount: 0`, and the debit is `U` minus its share, so the listed credits sum to the debit, not to `U`.
    Other: list the raw share and mark it; leave the entry out.
    Status: still stands.

36. **L262-264. `accountOf` and `balances`.** The signature of `accountOf`, whether it is synchronous, what it returns and what an unplaced participant means are not stated ("as the ledger does" points at code I may not read). The place, shape and sign of `balances` are not stated.
    Chosen: `accountOf` is a function (or a Map) from participant ID to an account key, awaited, compared with `===`; a participant it does not place is its own account. `balances` is not produced.
    Status: still stands.

37. **L32-35, L287-306. The result's shape.**
    Chosen: the interface I was given (`reservationId`, `outcome`, `reason`, `requesterId`, `termsDigest`, `units`, `debit`, `credits`, `late`, `foreign`, `conflicts`), one entry per attempt, plus `unmatched` and `closedAtLastStep`.
    Status: partly settled. Settled: what a row is (L32-35), and at c29bc5d44 the members of every `conflicts` entry (L291-306). Still open: the names of the amount members, the entry shapes of `late`, `foreign`, `unmatched` (item 51) and `closedAtLastStep` (item 54), and which rows exist (item 45). L287-289 lists a row's members without `closedAtLastStep` or `conflicts`.

## Looks self-contradictory or wrong (items of 20121ae60)

38. **L76-77.** "Cannot recompute them" was said of chain values although the starting value must be recomputed.
    Status: Settled at c29bc5d44: "cannot recompute any value after the first" (L76-77).

39. **A stage that signs two chains** had no step-5 bullet.
    Status: Settled at 4ee9dd6b2, and still (L197-199, L303).

40. **L247-253.** The last bullet of step 9 began "Otherwise" after a bullet that had covered both branches.
    Status: Settled at c29bc5d44: "In every other case, including `unfinishedTerms: null` (older terms) or any other value, the charge units are ..." (L251-253).

41. **L153-154, L218-219, L276-278.** Terms with no receipt and no acknowledgment were `foreign`, so an attempt that never started was `unknown` for ever.
    Status: Settled at c29bc5d44: such terms pass step 1 and the attempt is `open`, then `expired` (L153-154, L218-219, L276-278). `replay.js` changed.

42. **L270-275.** "A stage that closes early on its own, even with a `failed` receipt, earns nothing" read as unconditional.
    Status: Settled at c29bc5d44: it is now tied to provider-loss-free terms, and "`failed` and `settled` closes are paid alike" otherwise (L270-275).

43. **L377-379.** The Stage 1 paragraph gave only the upper bound of `inTime`.
    Status: Settled at c29bc5d44: "signed `inTime`, between `notBefore` and the deadline, each widened by the clock skew allowance".

44. **L28-29, L127-129, L166-168.** The replay did not check `maxUnacknowledgedOutputs`.
    Status: Settled at c29bc5d44: step 3 is `invalid` unless it equals the receiver policy's `K`. `replay.js` changed. How a verifier is given `K` is item 59.

## Added at 4ee9dd6b2: not determined by the text

45. **L136-139. A reservation whose records name no requester.** Acceptances and stage receipts are "offered to every attempt under their `reservationId`"; with no terms, acknowledgment or stop there is no attempt.
    Chosen: no row. Those records are reported nowhere. (A lone acknowledgment or stop does make a row, which is `unknown` at step 2.)
    Other: one row with `requesterId: null` and outcome `unknown`.
    Status: still stands.

46. **L32-34. Order of the rows.**
    Chosen: by `reservationId`, then `requesterId`, both in UTF-16 code unit order.
    Other: order of first appearance in the input.
    Status: still stands.

47. **L180-182, L191-194. Which final-stage receipts commit a chain**: in-time ones only, or late ones too.
    Status: Settled at c29bc5d44: every kept receipt, "whenever it was signed", and the conflict tests include late receipts. `replay.js` changed (it used in-time receipts only).

48. **L182-183, L197-199. A final-stage receipt whose count-0 chain is not the starting value.**
    Status: Settled at c29bc5d44: it is "two chains for one count", a conflict against the final stage, acknowledged or not. `replay.js` changed (it was not a conflict).

49. **L200-203, L304-305. The disputed-chain and charge-binding bullets overlap at count 0.** A wrong binding with no right one is literally also "none of its chains for that count is the final stage's".
    Chosen: at count 0 only the `charge-binding` entry. The `output-chain` entry with `signer: null` is used for counts above 0.
    Other: both entries at count 0.
    Status: partly settled. Settled at c29bc5d44: the entry for a wrong binding is `charge-binding`, against the requester, with `count: 0` (L305). The overlap is still not addressed.

50. **L188-190, L301. How many `acknowledgment-equivocation` entries.**
    Status: Settled at c29bc5d44: the entry carries `count` and `chains` (the other chains), so there is one per count (L301). `replay.js` changed (it listed one per extra acknowledgment). The unmatched case is item 61.

51. **L191-192, L287-288. Shape of an `unmatched` entry.**
    Chosen: `{ index, count }`.
    Other: `{ index }` or `{ index, schema }` like `late`.
    Status: still stands.

52. **L298-306. Order of `signers`; which entries carry which members.**
    Status: Settled at c29bc5d44: "`signers`: the final stage and the requester" (L304), and the table gives each kind's members. `replay.js` changed the order to final stage, then requester. The order of entries inside `conflicts` is item 63.

53. **L208-213. `open` against `unknown` for a delivered answer before the release window.**
    Status: Settled at c29bc5d44: "the outcome is `unknown`, whatever the time" (L209-210). `replay.js` already did this.

54. **L213-215. Shape of a `closedAtLastStep` entry, and whether it survives a later step.**
    Chosen: `{ partitionIndex, participantId }`, one per stage treated as closed. The entries stay on the row if step 7 or step 8 then decides it (`conflict` or `unknown`).
    Other: partition indexes or participant IDs alone; emptied unless the row settles.
    Status: still stands.

## Added at 4ee9dd6b2: looked self-contradictory or wrong

55. **"Attempt" had two meanings.**
    Status: Settled at c29bc5d44: an attempt is always one (`reservationId`, `requesterId`) pair, and the field is always called `attemptId` (L32-35).

56. **"Owes every output it acknowledged in time"** against the matched count.
    Status: Settled at c29bc5d44: "the one charge rule" is the acknowledged count of step 5 (L185-187), and steps 9 and "settled" now refer to it (L240-242, L270).

57. **"`conflicts` names the signer"** against the entry with `signer: null` and the non-blocking entries.
    Status: Settled at c29bc5d44 (L280-281, L293-296, L315-317).

58. **Replay against ledger.**
    Status: Settled at c29bc5d44: the ledger applies the step-6 rule at window expiry (L226-228), and L385-393 says where the two agree and where they differ.

## New at c29bc5d44: not determined by the text

59. **L127-129, L166-168. How a verifier is given `K`.** The replay "reads" it from the stages' receiver policy, which is not one of the public policies, and "a verifier may be given another value for stages that publish one"; no input is named, and "for stages" may mean one value or one per stage.
    Chosen: an optional input `receiverPolicy`, an object with `maxUnacknowledgedOutputs`. Without a usable one `K` is 2, the value the text gives. One value serves every stage.
    Other: a bare number under another name; a value per stage; `invalid` when none is given.

60. **L160-162, L300. What `digests` holds.**
    Chosen: the digest of every set left after step 1 (so not foreign or late sets), sorted in code unit order.
    Other: every set the requester signed; presentation order; the agreed digest first.

61. **L188-190, L301. `acknowledgment-equivocation` on a count that is not matched.** Step 5 lists the entry only for a matched count; the table gives `settledOn` "when the count is matched", which implies entries where it is not, and "`chains` (the other chains)" has no meaning without a matched chain.
    Chosen: one entry for every count that has two or more different in-time acknowledged chains. When the count is matched, `chains` holds the chains other than `settledOn`; when it is not (an `unmatched` count, a disputed chain, or two wrong charge bindings), `chains` holds all of them and there is no `settledOn`. `chains` is sorted.
    Other: entries for matched counts only.

62. **L195-196, L302. `stage-receipt` entries.** One kind covers three faults, and "`sequences` (the two that conflict)" does not say which two when the fault is against an earlier, not adjacent, receipt, nor how many entries a stage gets.
    Chosen: per stage, one entry per distinct pair: `[s, s]` for a repeated sequence; `[the earliest earlier receipt with the most steps, s]` when the steps at `s` are below it; `[the first closing receipt, s]` for every receipt after it.
    Other: adjacent receipts only; one entry per stage; the first fault only.

63. **L293-306. Order of the entries in `conflicts`.**
    Chosen: step order: `terms-equivocation`; `stage-receipt` by stage, then sequence; the final stage's `output-chain` by count; then per acknowledged count ascending, the `charge-binding` or `signer: null` entry followed by `acknowledgment-equivocation`; `steps` by stage.
    Other: any other order; sorted by kind.

64. **L293. "Every contradiction found, on any outcome."** Are contradictions looked for in steps a row never reaches?
    Chosen: no. A row decided at step 2 or 3 has no step-5 entries, and a row that step 5 makes `conflict` has no `steps` entry.
    Other: every test runs whenever terms are agreed.

65. **L155-160. Timing against a policy that cannot give an allowance.** Step 1 says terms that name an unsupplied policy "are not timed here". It does not say the same of a supplied policy with no usable `maxClockSkewMs`, nor of step 2's "in-time acceptance" for a set whose policy is unsupplied.
    Chosen: none of them is timed: such terms are never `late`, acceptances of them count as in time in step 2, and the attempt is `invalid` if it reaches step 3 with them.
    Other: an allowance of 0; such acceptances never count.

66. **L208-210. An unclosed stage with no receipt that counts, in a delivered answer.** "If any such stage has `steps < N`" presumes a latest receipt.
    Chosen: a stage with no latest receipt has none that covers the answer, so `unknown` (as L282-283 puts it). In JavaScript `undefined < N` is false, so a literal transcription would treat that stage as covered and pay it.

## New at c29bc5d44: looks self-contradictory or wrong

67. **L47-52 against L58-60.** "A record accepts only this one [text], because neither member is signed and a relay could otherwise make a second accepted form of a record." For P-256 a relay still can: for a valid `r || s`, `r || (n - s)` also verifies over the same body and is canonical base64url of 64 bytes. Nothing requires low-S. The outcome is unaffected, because identical bodies count once (L136).
    Chosen: both forms are accepted.

68. **L142-145.** `inTime` ends at `deadline + maxClockSkewMs`, inclusive; `closesInTime` ends at `deadline + releaseWindowMs`, exclusive and with no skew allowance. Nothing requires `partitionUnclaimedReleaseMs` to exceed `maxClockSkewMs`, so under a policy where it does not, a closing receipt has a shorter window than an ordinary one: a `settled` receipt with `closedAt` can be late at an instant where the same receipt without `closedAt` would count.
    Chosen: the two definitions as written.

69. **L177-178 against L180-182 and L194.** Step 4 says a kept record that does not count is "listed as `late` and ignored". Step 5 then uses late receipts to commit chains and in every conflict test, so a late receipt is not ignored.
    Chosen: step 5.
