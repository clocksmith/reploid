# Gaps found in `docs/settlement-replay.md` while writing `replay.js`

Source read: `docs/settlement-replay.md` only, as of commit 20121ae60 (302 lines). Line numbers refer to that version.
The list was written by the author of `replay.js` before the verifier was compared with anything, and is kept as written.
Each item gives the question, the reading `replay.js` implements ("Chosen"), and the other plausible reading(s) ("Other").
Items 1-37 are places where the text did not determine behaviour. Items 38-44 are places where the text looks self-contradictory or wrong.

## Encoding (lines 31-68)

1. **L33-38. Non-JSON values in a record handed over as an object.** "Records contain only finite JSON values" does not say what a verifier does with an `undefined` member, `NaN`, a class instance, a sparse array, a symbol key or a getter.
   Chosen: the whole record is rejected. `-0` is accepted and written `0`.
   Other: serialise as `JSON.stringify` would (drop `undefined` members, write `NaN` as `null`) and then check the signature.

2. **L41-44, L48-50. Key coordinates are constrained only by a pattern.** Two base64url strings that differ only in unused trailing bits decode to the same key (checked: Node imports both and the signature verifies under both), but the participant ID hashes the text, so one key has 4 valid IDs (Ed25519) or 16 (P-256). Lengths other than 43 pass the pattern too.
   Chosen: accept whatever Node's JWK import accepts; an unusable coordinate fails at the signature check.
   Other: require the canonical encoding and exact length, rejecting the aliases at the key check.

3. **L45-47. Signature strictness.** No pattern is given for the alphabet; non-canonical base64url is not addressed; the Ed25519 verification variant (small-order keys, non-canonical encodings) and high-S ECDSA are not addressed.
   Chosen: `^[A-Za-z0-9_-]{1,256}$`, lenient decode, must decode to exactly 64 bytes for both algorithms, OpenSSL behaviour through `node:crypto`, high-S accepted.
   Other: strict canonical base64url; RFC 8032 strict or ZIP-215 style Ed25519.

4. **L48-49. Case of the 24 hex digits of a participant ID.** Digests say lowercase (L52); the ID rule does not.
   Chosen: lowercase.

5. **L52-53 with L72-74. "digest" is used as a field type but is not defined in "Record fields".**
   Chosen: a string matching `^sha256:[0-9a-f]{64}$`.
   Other: any text; uppercase hex allowed.

6. **L67-68. "Strings ... that `Date.parse` accepts" depends on the engine and the time zone.** In Node 22, `"x 1"` and `"2026"` parse, and `"2026-11-25T10:00:00"` (no zone) parses as local time, so the same signed record can be in time on one machine and late on another. A verifier in another language cannot reproduce it.
   Chosen: Node's `Date.parse`, anything that is not `NaN`, at most 40 UTF-16 code units.
   Other: accept only the exact `toISOString` form (round trip).

7. **L73. Unit of "maximum length".**
   Chosen: UTF-16 code units (`string.length`).
   Other: code points or UTF-8 bytes.

## Record fields (lines 70-108)

8. **L76-102. No type is given for `attemptId`, `requesterId`, `participantId` (including `shares[].participantId`) or `schema`.**
   Chosen: the IDs are text 256; signer fields must also equal the carried key's ID; `schema` is the schema string of the kind.
   Other: `attemptId` text 160 like `reservationId`; `shares[].participantId` must match `peer:` plus 24 hex (then terms naming a malformed stage are rejected instead of being merely unsatisfiable).

9. **L78-79. `maximum` has no type, and the product can exceed 2^53.**
   Chosen: a safe integer equal to the exact (BigInt) product, so terms whose product is not a safe integer are rejected.
   Other: double arithmetic, `maximum === maxOutputTokens * creditsPerOutputToken`.

10. **L79-81. May one participant hold two stages?** Nothing forbids it.
    Chosen: allowed.
    Other: rejected as a malformed `shares`.

11. **L92. "`sequence`, an integer `>= 1` that rises by one per receipt".** Is a gap (1, 2, 4), or a first presented receipt that is not 1, a fault? Step 5 (L149) names only a repeated sequence.
    Chosen: any safe integer `>= 1`; gaps are ignored.
    Other: a gap is a conflict, or makes the stage's history incomplete (`unknown`).

12. **L92-96 with L149-150 and L155. `status` against `timing.closedAt`.** No field rule relates them.
    Chosen: every combination passes the shape check. A `settled` or `failed` receipt without `closedAt` does not close the stage in step 6, but is "a closing receipt" for step 5. "Closed in time" is judged by `signedAt`, never by `closedAt`.
    Other: reject a closing receipt without `closedAt`, or an `executing` receipt with one.

13. **L96-99. "`output` is `null` except on the final stage" cannot be checked per record.** It needs the terms, and L113-114 says shape failures are rejected before grouping.
    Chosen: the shape check accepts `null` or the exact object on any receipt. Once terms are agreed, a non-final stage's `output` is never read; a final-stage receipt with `output: null` stays in play as "not done, no count, no chain", so it cannot make the answer delivered (step 6) or withheld (step 9).
    Other: drop or reject such receipts once the stage position is known; read a null output's count as `steps`.

14. **L104-108, L136-139. Policy field types, and a missing field.**
    Chosen: a step-3 comparison against a missing or wrongly typed field fails, so the outcome is `invalid`. A missing or non-count `maxClockSkewMs`, which step 3 does not mention, is also `invalid`. A supplied policy that is not a JSON object cannot be named by any terms.
    Other: a missing `maxClockSkewMs` means 0.

## Deciding an outcome (lines 110-183)

15. **L113-114. A record with an unknown or missing `schema`; the form of `rejected`.**
    Chosen: rejected with reason `unknown schema`. Entries are `{ index, reason }`; the reason texts are mine.
    Other: silently ignored.

16. **L114-115. "Identical bodies presented twice count once."** Which copy is the record?
    Chosen: the first copy that passes its checks; its index is the one used in `late` and `foreign`. Later copies are reported nowhere. A copy with a bad signature is rejected while the valid copy counts. The same body under two different valid signatures counts once.

17. **L127-128 with L116-118. "Outside their own window" in step 1.** Does the window include the clock-skew allowance, and which allowance when the named policy is not supplied (the policy is only checked in step 3)?
    Chosen: the terms' own `notBefore` and `deadline`, widened by the named policy's `maxClockSkewMs`, or by 0 when that policy is missing or has no usable value.
    Other: no allowance in step 1; or terms with an unsupplied policy are never late and fall through to `invalid` (my reading can give `unknown` instead).

18. **L120-126. Scope of the route test.**
    (a) "at least one acknowledgment": from any requester? Chosen: any acknowledgment in the reservation that carries the terms' `attemptId`.
    (b) "If any acknowledgment is presented": chosen, any for that `attemptId`. Other: any acknowledgment in the reservation, whatever its attempt.
    (c) Records that step 4 would later call late still count here (chosen).
    (d) Terms that are both off the route and outside their window are listed as `foreign` only (chosen). Other: both lists.

19. **L128-130. "only those that a stage they name accepted are kept."** Must that acceptance be in time, and must it carry the terms' `attemptId`?
    Chosen: digest matches, signer is the participant the terms name at the acceptance's `partitionIndex`, same `attemptId`; timing is not required.
    Other: in-time acceptances only.

20. **L132 with L116-118. "In-time acceptance" before any terms are agreed.** `inTime` is defined on the agreed terms, and this step is choosing them.
    Chosen: each acceptance is timed against the set it names and that set's policy.
    Other: against every remaining set, or against the widest window.

21. **L132-135. An in-time acceptance that names a digest outside the remaining sets** (foreign, late or never presented terms).
    Chosen: ignored.
    Other: counts as "acceptances name different sets", so `conflict`.

22. **L133-135. What `conflicts` holds in step 2.** The entry for the `conflict` outcome is not described, and the member that carries "the settled digest" is not named.
    Chosen: `{ signer: requester, kind: 'terms-equivocation', blocking: true }` for the conflict. For the non-blocking entry the digest is not repeated in the entry; it is the reservation's `termsDigest`.

23. **L131-135 with L214-215. `requesterId` when step 2 ends in `conflict`.** One requester remains but no terms are agreed.
    Chosen: `null`, with the requester as the conflict's `signer`.
    Other: the remaining requester.

24. **L132. Several sets from one requester with different `attemptId`s** (a retry under the same reservation ID).
    Chosen: treated exactly like equivocation: needs in-time acceptances of exactly one set, else `conflict`.
    Other: each attempt is decided separately.

25. **L140-147. A party's record of the agreed attempt that fails another test** (a receipt or acknowledgment with a different `routeHash`, an acceptance of another digest). It is neither "another attempt" nor "from a non-party".
    Chosen: dropped without being listed, so a late acceptance of non-agreed terms appears nowhere.
    Other: listed, or treated as a contradiction by its signer.

26. **L145-146. `late` when the outcome is decided in steps 1 to 3.**
    Chosen: only late terms are listed; step-4 records are classified only if step 4 is reached. Entries are `{ index, schema }`.
    Other: classify against the agreed terms whenever terms are agreed (for `invalid`).

27. **L148-154, L208-209. No conflict `kind` is named except `terms-equivocation`.**
    Chosen (invented): `receipt-sequence-repeated`, `receipt-steps-backwards`, `receipt-after-closing`, `acknowledgment-chains-differ`, `output-chain-differs-from-acknowledgment`, `charge-binding-not-starting-chain`, `steps-below-acknowledged`. One entry per signer and kind, every fault found is listed, all `blocking: true`.

28. **L149-150. Order for "steps that go backwards"; what "a closing receipt" is.**
    Chosen: order by `sequence`. A closing receipt is any `settled` or `failed` receipt, with or without `closedAt`; any receipt with a higher `sequence` continues after it.
    Other: order by `signedAt`; only a receipt with `closedAt` closes.

29. **L151-153 with L228-232. Requester signs two chains for one count.** The final stage's receipt for that count then differs from one of them, so the third bullet holds too.
    Chosen: both are listed, the requester (`acknowledgment-chains-differ`) and the final stage (`output-chain-differs-from-acknowledgment`).
    Other: the requester only ("The record names it in the first case").

30. **L152-153. "The final stage's receipt".**
    Chosen: every in-time receipt of the final stage that carries an `output`. Late receipts are not compared (only the first bullet says "late receipts included").
    Other: the latest receipt only; late receipts too.

31. **L154 with L65-66. A missing charge binding.** The text covers only a wrong chain.
    Chosen: no in-time count-0 acknowledgment is not a contradiction and does not prevent `settled`. A wrong one is listed against the requester.
    Other: `unknown` or `conflict` when it is missing.

32. **L155-156, L164, L169. "Latest".**
    Chosen: the highest `sequence` among in-time receipts (step 5 leaves no ties).
    Other: the greatest `signedAt`.

33. **L161-163. The verification time.**
    Chosen: no skew allowance on `deadline + releaseWindowMs`; `at` equal to it is `expired`. Nothing relates `at` to record times, so a record dated after `at` counts. When `at` is not a number the attempt stays `open`.
    Other: ignore records signed after `at`; `expired` or an error for an unusable `at`.

34. **L164-165. Signer of the step-7 conflict; the count with no acknowledgment.**
    Chosen: each stage whose latest receipt has fewer steps. With no in-time acknowledgment the acknowledged count is 0 (also in step 9, L168).
    Other: the requester (it acknowledged outputs a stage says it did not compute), or both.

## Split and result (lines 185-216)

35. **L187-192. An own-account stage in the credits.**
    Chosen: its entry is kept with `amount: 0`, and the debit is `U` minus its share, so the listed credits sum to the debit, not to `U`.
    Other: list the raw share and mark it; leave the entry out.

36. **L192-194. `accountOf` and `balances`.** The signature of `accountOf`, whether it is synchronous, what it returns and what an unplaced participant means are not stated ("as the ledger does" points at code I may not read). The place, shape and sign of `balances` are not stated.
    Chosen: `accountOf` is a function (or a Map) from participant ID to an account key, awaited, compared with `===`; a participant it does not place is its own account. `balances` is not produced.

37. **L198-216. The result's shape.** The text names `rejected`, `late`, `foreign`, `requesterId` and `conflicts` (signer, kind, blocking) but no other member, and does not say which reservations are reported.
    Chosen: the interface I was given (`outcome`, `reason`, `termsDigest`, `units`, `debit`, `credits`). Every reservation ID with at least one admitted record is reported; one without terms is `unknown`.

## Looks self-contradictory or wrong

38. **L62-64 against L154.** "A verifier ... cannot recompute them" is said of chain values, but step 5 needs the starting value, which a verifier can and must recompute from `reservationId` and `routeHash`.

39. **L224-225 against L148-154.** "A stage that signs two chains ... loses its own payment", but no step-5 bullet covers two final-stage receipts that give different chains for one count when no in-time acknowledgment exists for that count.
    Chosen: not a conflict.

40. **L177-183.** The last bullet, "Otherwise the charge units are ...", follows a bullet that has already covered both branches.
    Chosen: the units are 0 only under provider-loss-free terms when the answer did not finish, was not stopped and was not withheld; in every other case they are `min(acknowledged, maxOutputTokens) * creditsPerOutputToken`.

41. **L120-126 against L205-207.** Terms with no receipt and no acknowledgment are `foreign`. A reservation that has terms and acceptances but never started is therefore `unknown` for ever, never `open` or `expired`, although "expired" is described as the state of an attempt whose release window passed without closing.
    Chosen: the literal step 1.

42. **L201-203 against L177-181.** "A stage that closes early on its own, even with a `failed` receipt, earns nothing and costs the requester nothing" reads as unconditional. By step 9 it holds only under provider-loss-free terms, and `failed` against `settled` never changes an amount.
    Chosen: step 9. A `failed` stage is paid its share whenever units are charged.

43. **L264-265 against L116-118.** "Those acceptances count only when signed before the deadline plus the clock skew allowance" gives only the upper bound of `inTime`.
    Chosen: both bounds.

44. **L24-29 against L104-108 and L136-139.** `K` is said to be fixed by the stages' receiver policy, but the replay reads no such value and step 3 does not check `maxUnacknowledgedOutputs`. Terms with a very large `K` can never be "withheld", and the replay cannot tell.
    Chosen: no check.
