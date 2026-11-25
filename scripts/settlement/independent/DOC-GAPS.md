# Gaps found in `docs/settlement-replay.md` while writing `replay.js`

Source read: `docs/settlement-replay.md` only, as of commit 4ee9dd6b2 (377 lines). Line numbers refer to that version.
Items 1-44 were written against commit 20121ae60, before the verifier was compared with anything. Their numbering is kept; their line numbers and "Chosen" text were brought up to 4ee9dd6b2, and each ends with a status line. Items 45-58 are new at 4ee9dd6b2. The author has still not read the reference code, the other files beside this one, or any comparison result.
Each item gives the question, the reading `replay.js` implements ("Chosen"), and the other plausible reading(s) ("Other").
Items 1-37 and 45-54 are places where the text does not determine behaviour. Items 38-44 and 55-58 are places where the text looks self-contradictory or wrong.

Status at 4ee9dd6b2 of the 44 old items: 4 settled (19, 23, 29, 39), 7 partly settled (18, 22, 27, 30, 34, 37, 38), 33 still stand.

## Encoding (lines 31-68)

1. **L33-38. Non-JSON values in a record handed over as an object.** "Records contain only finite JSON values" does not say what a verifier does with an `undefined` member, `NaN`, a class instance, a sparse array, a symbol key or a getter.
   Chosen: the whole record is rejected. `-0` is accepted and written `0`.
   Other: serialise as `JSON.stringify` would (drop `undefined` members, write `NaN` as `null`) and then check the signature.
   Status: still stands (text unchanged).

2. **L41-44, L48-50. Key coordinates are constrained only by a pattern.** Two base64url strings that differ only in unused trailing bits decode to the same key (checked: Node imports both and the signature verifies under both), but the participant ID hashes the text, so one key has 4 valid IDs (Ed25519) or 16 (P-256). Lengths other than 43 pass the pattern too.
   Chosen: accept whatever Node's JWK import accepts; an unusable coordinate fails at the signature check.
   Other: require the canonical encoding and exact length, rejecting the aliases at the key check.
   Status: still stands. It matters more now: rows are keyed by requester ID (L118-119), so one requester key can open several rows under one reservation.

3. **L45-47. Signature strictness.** No pattern is given for the alphabet; non-canonical base64url is not addressed; the Ed25519 verification variant (small-order keys, non-canonical encodings) and high-S ECDSA are not addressed.
   Chosen: `^[A-Za-z0-9_-]{1,256}$`, lenient decode, must decode to exactly 64 bytes for both algorithms, OpenSSL behaviour through `node:crypto`, high-S accepted.
   Other: strict canonical base64url; RFC 8032 strict or ZIP-215 style Ed25519.
   Status: still stands.

4. **L48-49. Case of the 24 hex digits of a participant ID.** Digests say lowercase (L52); the ID rule does not.
   Chosen: lowercase.
   Status: still stands.

5. **L52-53 with L72-74. "digest" is used as a field type but is not defined in "Record fields".**
   Chosen: a string matching `^sha256:[0-9a-f]{64}$`.
   Other: any text; uppercase hex allowed.
   Status: still stands.

6. **L67-68. "Strings ... that `Date.parse` accepts" depends on the engine and the time zone.** In Node 22, `"x 1"` and `"2026"` parse, and `"2026-11-25T10:00:00"` (no zone) parses as local time, so the same signed record can be in time on one machine and late on another. A verifier in another language cannot reproduce it.
   Chosen: Node's `Date.parse`, anything that is not `NaN`, at most 40 UTF-16 code units.
   Other: accept only the exact `toISOString` form (round trip).
   Status: still stands.

7. **L73. Unit of "maximum length".**
   Chosen: UTF-16 code units (`string.length`).
   Other: code points or UTF-8 bytes.
   Status: still stands.

## Record fields (lines 70-108)

8. **L76-102. No type is given for `attemptId`, `requesterId`, `participantId` (including `shares[].participantId`) or `schema`.**
   Chosen: the IDs are text 256; signer fields must also equal the carried key's ID; `schema` is the schema string of the kind.
   Other: `attemptId` text 160 like `reservationId`; `shares[].participantId` must match `peer:` plus 24 hex (then terms naming a malformed stage are rejected instead of being merely unsatisfiable).
   Status: still stands.

9. **L78-79. `maximum` has no type, and the product can exceed 2^53.**
   Chosen: a safe integer equal to the exact (BigInt) product, so terms whose product is not a safe integer are rejected.
   Other: double arithmetic, `maximum === maxOutputTokens * creditsPerOutputToken`.
   Status: still stands.

10. **L79-81. May one participant hold two stages?** Nothing forbids it.
    Chosen: allowed.
    Other: rejected as a malformed `shares`.
    Status: still stands.

11. **L92. "`sequence`, an integer `>= 1` that rises by one per receipt".** Is a gap (1, 2, 4), or a first presented receipt that is not 1, a fault? Step 5 (L165) names only a repeated sequence.
    Chosen: any safe integer `>= 1`; gaps are ignored.
    Other: a gap is a conflict, or makes the stage's history incomplete (`unknown`).
    Status: still stands.

12. **L92-96 with L165-166 and L173-174. `status` against `timing.closedAt`.** No field rule relates them.
    Chosen: every combination passes the shape check. A `settled` or `failed` receipt without `closedAt` does not close the stage in step 6, but is "a closing receipt" for step 5. "Closed in time" is judged by `signedAt`, never by `closedAt`.
    Other: reject a closing receipt without `closedAt`, or an `executing` receipt with one.
    Status: still stands.

13. **L96-99. "`output` is `null` except on the final stage" cannot be checked per record.** It needs the terms, and L113-114 says shape failures are rejected before grouping.
    Chosen: the shape check accepts `null` or the exact object on any receipt. Once terms are agreed, a non-final stage's `output` is never read; a final-stage receipt with `output: null` stays in play as "not done, no count, no chain": it commits no chain in step 5, and cannot make the answer delivered (step 6) or withheld (step 9).
    Other: drop or reject such receipts once the stage position is known; read a null output's count as `steps`.
    Status: still stands. Step 5 now leans on it: a final stage that signs `output: null` makes every acknowledgment above 0 `unmatched`.

14. **L104-108, L140-143. Policy field types, and a missing field.**
    Chosen: a step-3 comparison against a missing or wrongly typed field fails, so the outcome is `invalid`. A missing or non-count `maxClockSkewMs`, which step 3 does not mention, is also `invalid`. A supplied policy that is not a JSON object cannot be named by any terms.
    Other: a missing `maxClockSkewMs` means 0.
    Status: still stands.

## Deciding an outcome (lines 110-216)

15. **L113-114. A record with an unknown or missing `schema`; the form of `rejected`.**
    Chosen: rejected with reason `unknown schema`. Entries are `{ index, reason }`; the reason texts are mine.
    Other: silently ignored.
    Status: still stands.

16. **L114-115. "Identical bodies presented twice count once."** Which copy is the record?
    Chosen: the first copy that passes its checks; its index is the one used in `late`, `foreign` and `unmatched`. Later copies are reported nowhere. A copy with a bad signature is rejected while the valid copy counts. The same body under two different valid signatures counts once.
    Status: still stands.

17. **L133-134 with L122-124. "Outside their own window" in step 1.** Does the window include the clock-skew allowance, and which allowance when the named policy is not supplied (the policy is only checked in step 3)?
    Chosen: the terms' own `notBefore` and `deadline`, widened by the named policy's `maxClockSkewMs`, or by 0 when that policy is missing or has no usable value.
    Other: no allowance in step 1; or terms with an unsupplied policy are never late and fall through to `invalid` (my reading can give `unknown` instead).
    Status: still stands.

18. **L126-132. Scope of the route test.**
    (a) "at least one acknowledgment": from any requester?
    (b) "If any acknowledgment is presented": chosen, any for the terms' `attemptId`. Other: any acknowledgment in the row, whatever its `attemptId`.
    (c) Records that step 4 would later call late still count here (chosen).
    (d) Terms that are both off the route and outside their window are listed as `foreign` only (chosen). Other: both lists.
    Status: partly settled. Settled at 4ee9dd6b2: (a), because L115-118 sends an acknowledgment only to the row of the requester it names, so another requester's acknowledgment is never seen. (b), (c) and (d) still stand.

19. **Old L128-130. "only those that a stage they name accepted are kept."** Must that acceptance be in time, and must it carry the terms' `attemptId`?
    Status: Settled at 4ee9dd6b2: the sentence is gone. Each requester has its own row (L115-121), so terms from two requesters never meet.

20. **L136 with L122-124. "In-time acceptance" before any terms are agreed.** `inTime` is defined on the agreed terms, and this step is choosing them.
    Chosen: each acceptance is timed against the set it names and that set's policy.
    Other: against every remaining set, or against the widest window.
    Status: still stands.

21. **L135-139. An in-time acceptance that names a digest outside the remaining sets** (foreign, late or never presented terms).
    Chosen: ignored.
    Other: counts as "acceptances name different sets", so `conflict`.
    Status: still stands.

22. **L137-139. What `conflicts` holds in step 2.** The entry for the `conflict` outcome is not described, and the member that carries "the settled digest" is not named.
    Chosen: `{ signer: requester, kind: 'terms-equivocation', blocking: true }` for the conflict. The non-blocking entry carries the agreed terms digest as `settledOn`.
    Other: another member name for the digest (`termsDigest`, `digest`).
    Status: partly settled. L160 names `settledOn` for the acknowledgment entry; step 2 still says only "the settled digest", so `settledOn` there is by analogy. The blocking entry is still not described.

23. **Old L131-135. `requesterId` when step 2 ends in `conflict`.**
    Status: Settled at 4ee9dd6b2: a row is one (reservation, requester) attempt (L118-119), so every row carries its requester whatever the outcome. `replay.js` now always sets it.

24. **L136. Several sets from one requester with different `attemptId`s** (a retry under the same reservation ID).
    Chosen: treated exactly like equivocation: needs in-time acceptances of exactly one set, else `conflict`.
    Other: each `attemptId` is decided separately.
    Status: still stands, and item 55 makes it sharper.

25. **L144-151. A party's record of the agreed attempt that fails another test** (a receipt or acknowledgment with a different `routeHash`, an acceptance of another digest). It is neither "another attempt" nor "from a non-party".
    Chosen: dropped without being listed, so a late acceptance of non-agreed terms appears nowhere.
    Other: listed, or treated as a contradiction by its signer.
    Status: still stands.

26. **L149-150. `late` when the outcome is decided in steps 1 to 3.**
    Chosen: only late terms are listed; step-4 records are classified only if step 4 is reached. Entries are `{ index, schema }`. The same holds for `unmatched`, which is filled only in step 5.
    Other: classify against the agreed terms whenever terms are agreed (for `invalid`).
    Status: still stands.

27. **L164-172, L197-198, L243-244. Conflict `kind`s.** The text names `terms-equivocation` (L138) and `acknowledgment-equivocation` (L159) only.
    Chosen (invented) for the rest: `receipt-sequence-repeated`, `receipt-steps-backwards`, `receipt-after-closing` (L165-166); `output-chain-equivocation` (L167); `disputed-chain` (L168-170); `charge-binding-not-starting-chain` (L171-172); `steps-below-acknowledged` (L197-198). One entry per signer and kind for receipt faults and for the final stage's two chains, one per count for `disputed-chain`, all `blocking: true`.
    Status: partly settled. Settled at 4ee9dd6b2: the requester's second acknowledgment has a named kind. The five blocking cases still have none.

28. **L165-166. Order for "steps that go backwards"; what "a closing receipt" is.**
    Chosen: order by `sequence`. A closing receipt is any `settled` or `failed` receipt, with or without `closedAt`; any receipt with a higher `sequence` continues after it.
    Other: order by `signedAt`; only a receipt with `closedAt` closes.
    Status: still stands.

29. **Old L151-153. Requester signs two chains for one count: who is listed?**
    Status: Settled at 4ee9dd6b2: when one of them is the final stage's chain the count is charged and the other is a non-blocking `acknowledgment-equivocation` against the requester (L157-160, L263-266); when none is, the outcome is `conflict` with `signer: null` and `signers` naming both (L168-170). `replay.js` follows both.

30. **L152-153, L167. Which of the final stage's receipts are compared.**
    Chosen: every in-time receipt of the final stage that carries an `output`.
    Status: partly settled. Settled at 4ee9dd6b2: "its receipts" (L152-153, L167) means all of them, not only the latest. Whether late receipts count is still open: see item 47.

31. **L171-172 with L65-66. A missing charge binding.** The text covers only a wrong chain.
    Chosen: no in-time count-0 acknowledgment is not a contradiction and does not prevent `settled`. A wrong one, with no right one beside it, is listed against the requester.
    Other: `unknown` or `conflict` when it is missing.
    Status: still stands.

32. **L173-175, L178, L197, L202. "Latest".**
    Chosen: the highest `sequence` among in-time receipts (step 5 leaves no ties).
    Other: the greatest `signedAt`.
    Status: still stands.

33. **L180, L184-185. The verification time.**
    Chosen: no skew allowance on `deadline + releaseWindowMs`; `at` equal to it is past the window. Nothing relates `at` to record times, so a record dated after `at` counts. When `at` is not a number the window has not passed (`open`).
    Other: ignore records signed after `at`; `expired` or an error for an unusable `at`.
    Status: still stands. L180 now writes `at >= deadline + releaseWindowMs` out, which agrees with the chosen boundary.

34. **L197-198. Signer of the step-7 conflict; the count with no acknowledgment.**
    Chosen: each stage whose latest receipt has fewer steps.
    Other: the requester (it acknowledged outputs a stage says it did not compute), or both.
    Status: partly settled. Settled at 4ee9dd6b2: the acknowledged count is "0 if none" (L156). The signer is still not stated. Under the new step 5, read as in item 47, only a non-final stage can be behind.

## Split and result (lines 218-251)

35. **L220-225. An own-account stage in the credits.**
    Chosen: its entry is kept with `amount: 0`, and the debit is `U` minus its share, so the listed credits sum to the debit, not to `U`.
    Other: list the raw share and mark it; leave the entry out.
    Status: still stands.

36. **L225-227. `accountOf` and `balances`.** The signature of `accountOf`, whether it is synchronous, what it returns and what an unplaced participant means are not stated ("as the ledger does" points at code I may not read). The place, shape and sign of `balances` are not stated.
    Chosen: `accountOf` is a function (or a Map) from participant ID to an account key, awaited, compared with `===`; a participant it does not place is its own account. `balances` is not produced.
    Status: still stands.

37. **L115-121, L231-251. The result's shape.**
    Chosen: the interface I was given (`reservationId`, `outcome`, `reason`, `requesterId`, `termsDigest`, `units`, `debit`, `credits`, `late`, `foreign`, `conflicts`), one entry per (reservation, requester), plus the two members the text now names, `unmatched` and `closedAtLastStep`.
    Status: partly settled. Settled at 4ee9dd6b2: what a row is (L118-119), and the row members `unmatched` (L162, L250) and `closedAtLastStep` (L181). Still open: the names of the amount members, the entry shapes (items 51 and 54), and which rows exist (item 45).

## Looks self-contradictory or wrong

38. **L62-64 against L153-154.** "A verifier ... cannot recompute them" is said of chain values, but the starting value can and must be recomputed.
    Status: partly settled. Step 5 now says the starting value is one "anyone can compute" (L153-154). The sentence at L62-64 is unchanged and still reads as if no chain value can be recomputed.

39. **Old L224-225 against old step 5.** "A stage that signs two chains ... loses its own payment", but no bullet covered two final-stage receipts with different chains for one count.
    Status: Settled at 4ee9dd6b2: "the final stage's receipts give two chains for one count" is now a conflict (L167). `replay.js` lists it against the final stage.

40. **L210-216.** The last bullet, "Otherwise the charge units are ...", follows a bullet that has already covered both branches.
    Chosen: the units are 0 only under provider-loss-free terms when the answer did not finish, was not stopped and was not withheld; in every other case they are `min(acknowledged, maxOutputTokens) * creditsPerOutputToken`.
    Status: still stands.

41. **L126-132 against L240-242.** Terms with no receipt and no acknowledgment are `foreign`. A row that has terms and acceptances but never started is therefore `unknown` for ever, never `open` or `expired`, although "expired" is described as the state of an attempt whose release window passed without closing.
    Chosen: the literal step 1.
    Status: still stands.

42. **L236-238 against L210-214.** "A stage that closes early on its own, even with a `failed` receipt, earns nothing and costs the requester nothing" reads as unconditional. By step 9 it holds only under provider-loss-free terms, and `failed` against `settled` never changes an amount.
    Chosen: step 9. A `failed` stage is paid its share whenever units are charged.
    Status: still stands.

43. **L310-311 against L122-124.** "Those acceptances count only when signed before the deadline plus the clock skew allowance" gives only the upper bound of `inTime`.
    Chosen: both bounds.
    Status: still stands.

44. **L24-29 against L104-108 and L140-143.** `K` is said to be fixed by the stages' receiver policy, but the replay reads no such value and step 3 does not check `maxUnacknowledgedOutputs`. Terms with a very large `K` can never be "withheld", and the replay cannot tell.
    Chosen: no check.
    Status: still stands.

## New at 4ee9dd6b2: not determined by the text

45. **L115-121. A reservation whose records name no requester.** Acceptances and stage receipts are "offered to every attempt under that reservation"; with no terms, acknowledgment or stop there is no attempt.
    Chosen: no row. Those records are reported nowhere. (A lone acknowledgment or stop does make a row, which is `unknown` at step 2.)
    Other: one row with `requesterId: null` and outcome `unknown`.

46. **L118-119. Order of the rows.**
    Chosen: by `reservationId`, then `requesterId`, both in UTF-16 code unit order.
    Other: order of first appearance in the input.

47. **L152-153, L161-162, L167. Which final-stage receipts commit a chain.** Step 4 says late records are ignored and only the first conflict bullet says "late receipts included", but L161 says "no presented final-stage receipt".
    Chosen: in-time receipts only, for the committed chain, for `unmatched` and for "two chains for one count". An acknowledgment of a count that only a late receipt commits to is `unmatched`.
    Other: late receipts commit too (then that acknowledgment is matched, or at least not `unmatched`, and a late second chain is a conflict).

48. **L153-154, L167. A final-stage receipt whose count-0 chain is not the starting value.**
    Chosen: the committed chain at count 0 is the starting value whatever a receipt says; one such receipt alone is not a conflict; two receipts with different count-0 chains are.
    Other: the starting value counts as the first chain at count 0, so a receipt that gives another is "two chains for one count" against the final stage.

49. **L168-172. The third and fourth conflict bullets overlap at count 0; signer of a wrong charge binding.** A wrong binding with no right one is literally also "none of its chains for that count is the final stage's".
    Chosen: count 0 is judged by the charge-binding bullet only, with one entry against the requester (the starting value is computable, so the record does show who is wrong). The `signer: null` entry is used for counts above 0.
    Other: the `signer: null` entry at count 0 too, or both entries.

50. **L157-160. How many `acknowledgment-equivocation` entries.** The entry has no count and no record index, so two extra acknowledgments of one count give identical entries.
    Chosen: one entry per extra acknowledgment, in count order.
    Other: one per count; or the entry carries the count or the record index.

51. **L161-162, L249-250. Shape of an `unmatched` entry.**
    Chosen: `{ index, count }`.
    Other: `{ index }` or `{ index, schema }` like `late`.

52. **L168-170. Order of `signers`; which entries carry `signers` and `settledOn`.**
    Chosen: `[requester, final stage]`. `signers` appears only on that entry and `settledOn` only on the two equivocation entries; no other entry has those members. The order of entries inside `conflicts` is step 2, receipt faults in stage order, the final stage's two chains, then per count ascending.
    Other: final stage first, or sorted; every entry carries all members with `null`.

53. **L177-183. `open` against `unknown` for a delivered answer before the release window.** "Before then the outcome is `open`" is said of a stage that has a covering receipt; "A stage with no in-time receipt covering the answer makes the outcome `unknown`" has no time condition.
    Chosen: `unknown` at any time when some unclosed stage has no in-time receipt with `steps >= N`; otherwise `open` before the window and settled after it.
    Other: `open` for every delivered, unclosed attempt until the window passes, `unknown` only after it.

54. **L180-182. Shape of a `closedAtLastStep` entry, and whether it survives a later step.**
    Chosen: `{ partitionIndex, participantId }`, one per stage treated as closed. The entries stay on the row if step 7 or step 8 then decides it (`conflict` or `unknown`).
    Other: partition indexes or participant IDs alone; emptied unless the row settles.

## New at 4ee9dd6b2: looks self-contradictory or wrong

55. **L115-121 against L126-151. "Attempt" now has two meanings.** It is the (reservation, requester) row at L116-121, and the `attemptId` at L127, L145 and L150 ("Records that name another attempt"); "the attempt's route" (L126) and "Records of this attempt" (L144) can be read either way. One requester with two `attemptId`s under a reservation is one "attempt" in the first sense and two in the second; the text does not say which governs (item 24).
    Chosen: one row per (reservation, requester); the `attemptId` only filters records inside it.

56. **L203-205, L233-234 and L238-239 against L152-162.** "The requester then owes every output it acknowledged in time" and "debited for the outputs it acknowledged in time", but an in-time acknowledgment that is `unmatched` is not charged, and the charge follows the highest matched count.
    Chosen: step 5.

57. **L243-244 and L256-257 against L137-138, L158-160 and L168-170.** "`conflicts` names the signer and the kind" and "The listed signer is the party that contradicted itself", but the disputed-chain entry has `signer: null`, and `conflicts` also holds non-blocking entries on rows whose outcome is not `conflict`.
    Chosen: the step text.

58. **L193-196 against L311-315 and L325-326.** Step 6 says the replay now settles an attempt the live ledger has not. The Stage 1 rule that a receipt "fails unless the replay matches the ledger", and the claim that the unit tests check the replay's charge and credits equal the ledger's "for the same signed records", are stated without that exception.
    Chosen: nothing to implement; the replay does not read the ledger.
