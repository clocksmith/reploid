# Gaps found in `docs/settlement-replay.md` while writing `replay.js`

Source read: `docs/settlement-replay.md` only, as of commit f1b3f0754 (the commit is the one the coordinator named; the author may not run git and checked only the text: 638 lines, sha256 `c31c873c0dd53666723e9c0c459a3e763d03b9dba82ad6136ccc40fc5c6326ac`, the same at the start and the end of the work). Line numbers refer to that text.
Items 1-44 were written against commit 20121ae60, before the verifier was compared with anything; items 45-58 were added at 4ee9dd6b2, items 59-69 at c29bc5d44, items 70-74 at a25242bc3, items 75-76 at 955bd5f7a, and item 77 is new at f1b3f0754. The numbering is kept. The author has still not read the reference code, the other files beside this one, or any comparison result.
The f1b3f0754 text differs from 955bd5f7a only from line 465 on (the Stage 1 paragraph, the ledger paragraph, the "Known difference" section and the "Checking it" section). Lines 1-464, which hold every rule of the replay and its result, are unchanged, so `replay.js` was not changed for f1b3f0754 (its header comment still names 955bd5f7a), and every item's status line and line numbers stand as written at 955bd5f7a, except items 58, 72, 75 and 76, which were brought up to f1b3f0754.
Each open item gives the question, the reading `replay.js` implements ("Chosen"), and the other plausible reading(s) ("Other"). A settled item keeps its question and says what settled it.
Items 1-37, 45-54, 59-66 and 70-72 are places where the text does not determine behaviour. Items 38-44, 55-58, 67-69 and 73-77 are places where the text looks self-contradictory or wrong.

Status at f1b3f0754 of items 1-76: 47 settled (2, 6, 12, 17, 19, 22, 23, 24, 27, 28, 29, 30, 32, 34, 35, 37-48, 50-59, 61, 62, 67-70, 73-76), 10 partly settled (3, 13, 14, 15, 18, 26, 36, 49, 63, 72), 19 still stand (1, 4, 5, 7, 8, 9, 10, 11, 16, 20, 21, 25, 31, 33, 60, 64, 65, 66, 71). Two of the settled ones were settled by this text: 75 and 76. New at f1b3f0754: 1 (77), which is about the Stage 1 harness and does not touch the replay.

Update for the decided unfinished-answer rule (owner decision of 2026-11-25). Source read: `docs/settlement-replay.md` only, 694 lines; the author was given no commit hash for it and may not run git or compute a hash, so this text is named by its content. The "Known difference, pending owner decision" section is gone; step 9 (L279-305), the Outcomes section (L318-340), the Rows `schema` (L344-347) and the new "Unfinished answers" (L519-571) and "Older rules" (L573-598) sections carry the decision. `replay.js` changed: the result's `schema` is now `reploid.settlement-replay/v2`, step 9 names the decided `unfinishedTerms` value and says in its reason which rule applied, and the header comment names this text. The amounts `replay.js` computes did not change: it already charged the acknowledged prefix under every `unfinishedTerms` value but the provider-loss-free one, which is the rule this text states. Line numbers in items 78 and later, and in the status lines added below, refer to this text; older line numbers stand as written. Items 1-75 were not re-checked line by line against this text beyond the rules `replay.js` implements, which read as before; status lines were added to 58, 76 and 77, which this text settles or makes moot. Of items 1-77: 48 settled (77 added), 10 partly settled, 19 still stand. New: 2 (78, 79).

Update for terms signed before terms carried `K`. Source read: `docs/settlement-replay.md` only, 713 lines; again the author was given no commit hash and may not run git or compute a hash, so this text is named by its content. The author was told the text was amended in three places and re-read them: the Terms entry of "Record fields" (L104-117: one older shape, without `maxUnacknowledgedOutputs`, is also accepted), step 3 (L192-202: such terms pass the `K` check only against a policy that has no `maxUnacknowledgedOutputs` either) and the last paragraph of "Older rules" (L613-618). `replay.js` changed: `admit` accepts terms without the member when their `unfinishedTerms` is `null` or the provider-loss-free value and rejects them otherwise; step 3 (`policyFault`) answers `invalid` for such terms under a policy that publishes `K` and passes them under one that does not; and `decide` takes `K` for them from the `maxUnacknowledgedOutputs` input and uses it in step 9's "withheld" test. Nothing changes for terms that sign `K`. By line count the text also differs from the 694-line text in a fourth place, which was not named: the opening paragraph of "Unfinished answers" is five lines longer (L533-538, from "A stage accepts only terms that name the unfinished-answer terms it settles under" to "The replay itself decides by the signed value and needs no date"). The author cannot tell when that was added; it changes nothing in `replay.js` and settles item 79. Line numbers in items 80 and later, and in the status line added to 79, refer to this text; older line numbers stand as written (by the author's count a line of the 694-line text is 8 lower here from step 4 on, and 13 lower after its L525). Items 1-78 were not re-checked line by line. Of items 1-79: 49 settled (79 added), 10 partly settled, 20 still stand (78 added). New: 3 (80, 81, 82).

Update for signed accounts. Source read: `docs/settlement-replay.md` only, 744 lines; again the author was given no commit hash and may not run git or compute a hash, so this text is named by its content. The author was told the text was amended in seven places and re-read them: the Terms and Acceptance entries of "Record fields" (L117-119: terms that sign `K` may carry `debitAccount`; L122-124: an acceptance may carry `payoutAccount`), step 4 (L212-214), step 8, now "Acceptances and accounts" (L291-302), "Split arithmetic" (L341-346), "Rows" (L383-385 and the table's last row, L405), "Conflict entries" (the table's last row, L423) and the item about who owns a participant key in "What it does and does not establish" (L470-475). `replay.js` changed: `admit` accepts the two new members under their rules and rejects `debitAccount` on terms without `maxUnacknowledgedOutputs`; in `decide`, when the agreed terms carry `debitAccount`, step 4 does not keep an acceptance without `payoutAccount`, the row gets `accounts` once step 3 has passed, step 8 answers `conflict` with one `payout-account` entry per participant that named more than one account before it looks for a stage without a counting acceptance, and the split and the postings to `balances` use the signed accounts without calling `accountOf`. Nothing changes for an attempt whose agreed terms do not carry `debitAccount`: an acceptance's `payoutAccount` is then never read, and the row has no `accounts` member. By the line numbers recorded below for the 713-line text, this text is 4 lines longer after the record entries, 16 at step 9's "withheld" bullet, 22 at the Outcomes section and 31 from "Known limits" on. One difference lies in a place that was not named: step 9's "withheld" bullet now compares with "`K` as step 3 fixed it" (L313-315), where item 82 quotes other words. It changes nothing in `replay.js` and settles item 82. The author has no copy of the 713-line text and cannot tell from line counts whether anything else between the Outcomes section and "Known limits" differs beyond the named places. Line numbers in items 83 and later, and in the status lines added to 10 and 82, refer to this text; older line numbers stand as written. Items 1-82 were not re-checked line by line. Of items 1-82: 51 settled (10 and 82 added), 10 partly settled, 21 still stand (80 and 81 added). New: 7 (83-89).

Update for the answers to items 83-89. Source read: `docs/settlement-replay.md` only, 756 lines; again the author was given no commit hash and may not run git or compute a hash, so this text is named by its content. The author was told the text was amended in eight places, in answer to items 83 to 89, and re-read them: the Terms and Acceptance rows of the Records table (L17-18), the paragraph before the steps (L166-170: the stranger sentence holds with signed accounts only where the caller supplies `accountOf`), step 4 (L216-218), step 8 (L296-311: a new outcome, `invalid`, between `conflict` and `unknown`, when the caller supplied `accountOf` and a signed account differs from `accountOf` of its participant; the order of the `payout-account` entries; `accountOf` "used for nothing but the enrollment test"), "Split arithmetic" (L350-356), "Rows" (L393-395 and the `accounts` row, L415), "Conflict entries" (the `payout-account` row, L433) and the item about who owns a participant key (L480-487). The text is 12 lines longer than the 744-line text, and by the line numbers recorded for that text the named places account for all 12 (4 in the paragraph before the steps, 1 in step 4, 4 in step 8, 1 in "Split arithmetic", 2 in the item about keys); the author did not compare the rest word for word. `replay.js` changed in one behaviour: in `decide`, step 8 of an attempt with signed accounts now answers `invalid`, after the `payout-account` test and before the acceptance test, when `accountOf` was supplied and the requester's `debitAccount` or a stage's signed account is not the account `accountOf` gives for that participant. Everything else the new text says is what `replay.js` already did (the readings chosen in items 83-86), so only comments changed for it. Nothing changes for an attempt without signed accounts, nor for one with them when no `accountOf` is supplied. Line numbers in items 90 and later, and in the status lines added to 83-89, refer to this text; older line numbers stand as written. Items 1-82 were not re-checked. Of items 1-89: 56 settled (83, 84, 85, 86 and 89 added), 12 partly settled (87 and 88 added), 21 still stand. New: 4 (90-93).

Update for the failed-stage amendment. Source read: `docs/settlement-replay.md` only, 905 lines; again the author was given no commit hash and may not run git or compute a hash, so this text is named by its content. The author was told, in a summary it was told not to rely on, that the text gained a rule called "failed stages" for attempts whose agreed terms name the `unfinishedTerms` value `reploid.unfinished-answer/acknowledged-prefix-failed-stage-forfeits/v1`, with a new signed record (a stage fault), a new row member, a new `late` entry kind and a new conflict entry kind; the whole text was read again. The places found for the rule: the Records table (L22), "Record fields" (L141-144), the paragraph before the steps (L167-169: faults are offered to every attempt under their `reservationId`), step 4 (L224-230 and L238-240), step 5's charge rule (L250-254), step 6 (L311-336, the rule), step 7 (L337-340), step 9 (L381-386), "Split arithmetic" (L400-404), "Outcomes" (L428-430 and L434-436), "Rows" (L457-458, the `fault` form of a `late` entry at L475 and the `forfeited` row at L478), "Conflict entries" (the `fault-and-close` row, L497), the item about withholding (L543-545), the known limit about a requester and a stage acting together (L582-589) and the new "Failed stages" section (L698-776). Three more places read differently from what items 90, 92 and 93 quote of the 756-line text and do not belong to that rule: step 8's parenthesis about a participant `accountOf` does not place (L353-354), the Outcomes entry for `invalid` (L437-439) and the parenthesis in "Split arithmetic" about `settled` and `expired` rows (L407-409); they settle or partly settle those items and change nothing in `replay.js`. The text is 149 lines longer than the 756-line text. By the line numbers recorded for that text the places above account for about that many lines, but the author has no copy of the 756-line text and did not compare the rest word for word, so other changes of wording may have gone unnoticed; every rule of the steps, the split, the outcomes, the rows and the conflict entries was read against `replay.js` as it stood. `replay.js` changed: `admit` accepts the stage fault under its rules and rejects one that fails its shape check with `fault_malformed`; faults are grouped by `reservationId` like acceptances and stage receipts; and in `decide`, when the agreed terms name the failed-stage value, step 4 keeps faults and lists late ones once per stage, a stage that faulted and closed gets a `fault-and-close` entry before step 5, step 6 follows the failed-stage rule (`open`, the stages treated as closed at their last step, the forfeiting stages, `expired` only with nothing acknowledged), step 7 skips a forfeiting stage, the split credits a forfeiting stage 0 and lowers the debit by its share, and the row has `forfeited` once step 3 has passed. Under every other `unfinishedTerms` value `decide` takes the same path as before and a fault is never read; the one difference for such record sets is at admission, where a well-formed record of the fault schema is no longer rejected as of an unknown schema and a reservation that only faults name now has a row (items 96 and 97). Line numbers in items 94 and later, and in the status lines added to 15, 63, 66, 71, 90, 92 and 93, refer to this text; older line numbers stand as written. Items 1-93 were not otherwise re-checked. Of items 1-93: 58 settled (92 and 93 added), 13 partly settled (90 added), 22 still stand. New: 21 (94-114).

Update for the answers to items 111-114. Source read: `docs/settlement-replay.md` only, 915 lines; again the author was given no commit hash and may not run git or compute a hash, so this text is named by its content. The author was told only that the text was amended in answer to items 111 to 114, not where or how, and read the whole text again. The places found changed, by comparison with the quotations in items 94-114 and with the first reading: the opening of step 6's failed-stage rule (L311-316: the sentence "no attempt is `unknown` or `expired` because one stage withheld something" is replaced), step 9's provider-relief bullet (L379-380: "except the provider-loss-free one below"; no line added), the Outcomes entries for `settled` (L420-421), `expired` (L432-434) and `open` (L436), the first and third bullets of "Failed stages" (L723-726 and L734-736) and the first row of its table (L749: "of an unfinished answer"; no line added). The text is 10 lines longer than the 905-line text, and these places account for all 10 (1 in step 6; 1, 2 and 1 in Outcomes; 3 and 2 in "Failed stages"). The author has no copy of the 905-line text, so a change of wording that added no line, in a sentence no item quotes, may have gone unnoticed; every rule of the steps, the split, the outcomes, the rows and the conflict entries was read again against `replay.js`. `replay.js` did not change, not even in a comment: every amended sentence states what it already did (the readings chosen in items 104, 105, 111, 112 and 114), so its header comment still names the 905-line text. Line numbers in the status lines added to items 94-114, and in items 115 and later, refer to this text. By the author's count a line of the 905-line text is 1 lower here from the bullets of step 6's failed-stage rule to the Outcomes entry for `settled`, 5 lower from the Outcomes entry for `conflict` to the first bullet of "Failed stages", and 10 lower from its fourth bullet on. Older line numbers stand as written. Items 1-93 were not re-checked. Of items 94-114: 6 settled (104, 105, 111, 112, 113 and 114; 113 with its other half carried into items 116 and 117), 15 still open (94-103 and 106-110). Of items 1-114: 64 settled, 13 partly settled, 37 still stand. New: 3 (115-117).

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
    Status at the amendment for signed accounts: settled. Step 8 now names "a participant that runs several stages" (L296-297), so one participant may hold more than one stage, as `replay.js` already allowed.

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
    Status at the failed-stage amendment: still partly settled. The text now gives one `problem` text, `fault_malformed`, for a stage fault that fails its shape check (L143-144). Every other `problem` text is still mine, and what that shape check covers is item 95.

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
    Status at the decided rule: still settled. The difference in status only remains, "that is the one difference between them, a difference of status only" (L511-514); the difference in credits now belongs to the ledger's interim rules only ("This was the one known difference that moved credits", L587-588), and "The replay and the ledger agree on every case under these rules" (L569).

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
    Status at the failed-stage amendment: still partly settled. The new `fault-and-close` entries are "listed from step 4 on" (L318-319); where they stand among the other kinds is item 103.

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
    Status at the failed-stage amendment: still stands under every other `unfinishedTerms` value. Under the failed-stage terms such a stage is not `unknown` but forfeits with cause `no-close` (L325-329, L434-436); that a stage with no receipt that counts covers nothing is still the reading chosen (item 104).

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
    Status at the failed-stage amendment: still stands, with one exception the text now states: "Late faults are listed once per stage, however many that stage signed" (L239-240). Where that one entry stands is item 100.

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
    Status at the decided rule: moot. The "Known difference" section is replaced, and step 9 now states the conditions itself: the provider-loss-free value charges 0 only for "an unattributed disconnect", which "did not finish, was not stopped and was not withheld", and the decided value, "`null` (older terms) or any other value" charge the acknowledged prefix "in every case above" (L289-305). `replay.js` keeps the same amounts.

## New at f1b3f0754: looks self-contradictory or wrong

77. **L472-475 against L499-500 and L527-530.** The Stage 1 check passes with the known difference only when "the ledger charged exactly that prefix: its output count equals `outputs` and its charge is that count at the policy rate". But the ledger's interim rule charges the acknowledged prefix "up to `maxOutputTokens`", and the ledger "charges `maxOutputTokens` and records the rest as `beyondCeiling`". For a row whose `outputs` is past the ceiling the ledger's charge is `maxOutputTokens` at the policy rate, not `outputs` at that rate, so the condition as worded cannot hold there.
    Chosen: nothing to implement. This is a rule of the Stage 1 harness, not of the replay; `replay.js` reports `outputs`, `chargedOutputs` and `beyondCeiling` and does not judge the ledger.
    Status at the decided rule: settled. The condition now reads "its output count equals the smaller of `outputs` and the workload's `maxOutputTokens`, and its charge is that count at the policy rate" (L595-598), and it applies only to receipts whose terms name the provider-loss-free value (L489-491, L593-595). Still nothing for `replay.js` to implement.

## New at the decided unfinished-answer rule: not determined by the text

78. **L344-347, L361, L296-297. Which unfinished-answer rule a row was decided under, and the result's `schema` over older terms.** The result's `schema` is one value, `reploid.settlement-replay/v2`, and "rows have the same members", so no member of a row says whether its terms named the decided value, the provider-loss-free one, `null` or another value. The same string is also the ledger's settlement-rules id for the decided rules (L296-297, L521-522), so a result labelled `v2` may hold rows settled under the older provider-loss-free rule, which the ledger calls `reploid.settlement-replay/v1`. Step 9's cases can also overlap (an answer both finished and stopped), which matters only for which case a reader is told.
    Chosen: `schema` is always `reploid.settlement-replay/v2`. Only `reason` ("a sentence for people; not part of the outcome", L361) names the rule: the decided terms, the older provider-loss-free terms, `unfinishedTerms` null, or a value of no named rule; and the case, the first that holds in step 9's order (finished, stopped, withheld, unattributed disconnect).
    Other: `v1` when every row's terms are older; a row member naming the rule or the ledger's settlement-rules id; reason codes matching the ledger's (`unattributed-disconnect-acknowledged-prefix`, `stage-ended-unfinished-answer`, L537-538, L580-582).

79. **L521-525, L575-582 against L295-305. Provider-loss-free terms signed after the decision.** "Every new split reservation takes settlement-rules id `reploid.settlement-replay/v2` ... and the requester signs the matching `unfinishedTerms`", and "Reservations made before the decision keep the rules they were accepted under". Step 9 decides by the signed value alone and names no date. The text does not say what a verifier does with terms that name the provider-loss-free value but whose `notBefore` or `signedAt` is after 2026-11-25, nor whether step 3 compares `unfinishedTerms` with anything in the policy.
    Chosen: the signed value decides, whatever the dates; such terms are replayed under the older rule, and step 3 does not look at `unfinishedTerms`. Times are self-reported (L439-450), so a date test could not tell an old reservation from a backdated one.
    Other: `invalid` (or charged the acknowledged prefix) for provider-loss-free terms dated after the decision; a policy member naming the allowed `unfinishedTerms` values, checked in step 3.
    Status at the amendment for terms before `K`: settled. The text read now says that such terms, "signed after the decision, get no acceptance and are `unknown` (step 8), so they cannot bring back a free walk-away. The replay itself decides by the signed value and needs no date" (L535-538). That is the reading chosen, so `replay.js` did not change for it. The sentence is not one of the three places named as amended (see the update paragraph at the top).

## New at the amendment for terms before `K`: not determined by the text

80. **L112-117, L613-614. "Terms signed before terms carried `K`": no instant is given.** The older shape is described by when its terms were signed ("signed before terms carried `K`", "The first split trades of 2026-11-25"), but the text names no instant at which terms began to carry `K`, and neither the shape rule nor step 3 states a test on `signedAt`, `notBefore` or `deadline`.
    Chosen: the shape is told by the record alone. Terms whose body has no `maxUnacknowledgedOutputs` member are of the older shape: well-formed when `unfinishedTerms` is `null` or `reploid.unfinished-answer/provider-loss-free/v1` and every other member obeys its rule, whatever their dates, and rejected otherwise (with the problem `member missing: maxUnacknowledgedOutputs` when `unfinishedTerms` names another value). A member that is present with a value that is not a count, `null` included, is not the older shape and is rejected as before. The terms digest and the signed bytes are over the body as it stands, without the member. So terms of the older shape signed today are still well-formed; what limits them is step 3 (`invalid` under a policy that publishes `K`) and the stages' acceptance (L533-537). Times are self-reported (L447-458), and the text says of `unfinishedTerms` that the replay "decides by the signed value and needs no date" (L537-538).
    Other: reject, or answer `invalid` for, terms of the older shape whose `signedAt` is after the instant terms began to carry `K`; read a `null` member as an absent one.

81. **L142-146, L198-201, L615-618. Nothing signed fixes `K` for terms of the older shape.** Such terms pass step 3 only against a policy with no `maxUnacknowledgedOutputs`, so neither the terms nor the policy they name carries `K`: it is "the receiver policy's value", which a verifier holds only as its `maxUnacknowledgedOutputs` input (2 by default). Until this text a different input could only make an attempt `invalid`, because every set of terms signed `K`. For terms of the older shape that name the provider-loss-free value it now decides, with no trace in the result, which unfinished answers are "withheld" and so charged (item 82), and two verifiers given different inputs reach different amounts from the same records. The text says the replay "reaches the amounts it reached when they were signed" (L616-617), but not that a verifier must use the receiver policy's value of that time rather than the stages' current one, nor how it would learn it.
    Chosen: the input, as for any policy without `K` (L142-145): 2 by default, and an unusable value read as 2 (item 14). No member of a row says which `K` was used (compare item 78), and `reason` does not say it either. A policy that has the member with any value, a non-count included, "publishes `K`" (item 14), so terms of the older shape are `invalid` against it. It follows from step 3 that the first trades replay as described only when the policy their terms name has no `maxUnacknowledgedOutputs` member and is supplied to the verifier; the author cannot check that it is so.
    Other: a fixed 2 for the older shape, whatever the input; `invalid` for such terms unless the input was given explicitly; a row member, or the `reason`, naming the `K` used.

## New at the amendment for terms before `K`: looks self-contradictory or wrong

82. **L297-298 against L198-201 and L615-616. Step 9's "withheld" names a member that terms of the older shape do not have.** Step 9 was not amended: the requester withheld "when `delivered.count - acknowledged` is greater than the terms' `maxUnacknowledgedOutputs`". Terms of the older shape have no such member. In JavaScript `n > undefined` is false, so a literal transcription would never find such a requester withholding, and under the provider-loss-free value, the only one besides `null` these terms may name, every unfinished answer without a stop would be free however many acknowledgments were withheld.
    Chosen: step 9 compares with `K` as step 3 gives it: "`K` for them is the receiver policy's value" (L200-201), "with `K` from the receiver policy" (L616). The Outcomes section already words the rule with `K` ("no more than `K` acknowledgments withheld", L334-335). For terms that sign `K` nothing changes, because step 3 has already found their value equal to `K`.
    Other: the literal reading, under which terms of the older shape are never withheld.
    Status at the amendment for signed accounts: settled. The text read now says the requester withheld when the difference "is greater than `K` as step 3 fixed it: the terms' `maxUnacknowledgedOutputs`, or for terms of the older shape the receiver policy's value" (L313-315). That is the reading chosen, so `replay.js` did not change for it. The bullet is not one of the seven places named as amended (see the update paragraph at the top).

## New at the amendment for signed accounts: not determined by the text

83. **L190-195 with L212-214. An acceptance without `payoutAccount` in step 2.** Step 4 drops such an acceptance "when the agreed terms carry `debitAccount`", but step 2, which was not amended, agrees the set "that every in-time acceptance names" before any terms are agreed.
    Chosen: step 2 is unchanged. An acceptance names its set there whether or not it carries `payoutAccount`. It can therefore make a set that carries `debitAccount` the agreed one and then be dropped at step 4, which leaves its stage without a counting acceptance (`unknown` at step 8, if the row gets that far).
    Other: an acceptance without `payoutAccount` does not name a set that carries `debitAccount` in step 2 either, so several such sets with only such acceptances are a `conflict`.
    Status at the answers to items 83-89: settled. Step 4 now says of such an acceptance "(step 2 has still counted it for the set it names)" (L216-218). That is the reading chosen, so `replay.js` did not change for it.

84. **L383-385 and L405 against L291-294. `accounts` on a row decided before step 8.** The row has the member when it "was decided at step 4 or later", but step 4 decides no outcome, and the table calls the member "only with signed accounts (step 8)". The text does not say what `stages` holds on a row that step 5, 6 or 7 decided (`conflict`, `open`, `expired`, `unknown`), where step 8's tests never ran.
    Chosen: the member is added once step 3 has passed, so it is on every row decided at steps 5 to 9 whose agreed terms carry `debitAccount`, and on no row decided at step 2 or 3. `stages` is computed once, from step 4's counting acceptances, and is the same whichever later step decides the row: for each stage the one `payoutAccount` that the counting acceptances at its `partitionIndex` name, or `null` when they name none or more than one. So an `open`, `expired` or step-5 `conflict` row shows the accounts signed in time, not `null`s. The entry is per stage: when one participant's stages name different accounts, or the requester's own stage names an account other than `debitAccount`, each stage still shows the account it named, on any outcome. By item 64 the `payout-account` test runs only when step 8 is reached, so a row decided earlier can show such accounts with no entry in `conflicts`. `accounts` is the row's last member.
    Other: `stages` all `null`, or no member, on a row that did not reach step 8; `null` for every stage of a participant that named more than one account; the `payout-account` test on every row that has the member.
    Status at the answers to items 83-89: settled. The row has the member "when and only when the agreed terms carry `debitAccount` and the attempt passed step 3 (a row decided at step 1, 2 or 3 never has it)" (L393-395), and `stages` holds what the stage's "counting acceptances (step 4) name, or `null` when they name none or more than one; the same on every row that has the member, whatever step decided it" (L415). That is the reading chosen, so `replay.js` did not change for it. That the `payout-account` test runs only when step 8 is reached is still the choice of item 64.

85. **L294-298 with L224-227. Late acceptances in step 8's test.** Step 5 uses late receipts and acknowledgments in every contradiction test because "a late record is still its signer's signed statement". Step 8 says "counting acceptances" in its first case only; the other two say "named different ones" and "whose `payoutAccount`".
    Chosen: only counting acceptances name an account, in all three cases: "a late acceptance or stop counts for nothing" (L224-225), and a stage's account is that "of its in-time acceptances" (L293-294). A late acceptance with another `payoutAccount` is listed in `late` and contradicts nothing.
    Other: a late acceptance's `payoutAccount` also counts as named, for the contradiction test only.
    Status at the answers to items 83-89: settled. A `payout-account` entry's `accounts` are "the distinct accounts it named in counting records" (L433), and a stage's account is still that "of its in-time acceptances" (L298-299), so a late acceptance names nothing. That is the reading chosen, so `replay.js` did not change for it.

86. **L294-300, L423. The `payout-account` entries.** The text gives one entry per participant with "`accounts`: the accounts it named, sorted". It does not say whether the requester's `debitAccount` is among them, what order "sorted" is, or the order of several entries (item 63).
    Chosen: `accounts` holds each account the participant named once, in code unit order: every `payoutAccount` of its counting acceptances over all its stages, and for the requester's own key also the terms' `debitAccount`, which that key signed. A requester's own stage with no counting acceptance named only `debitAccount` and gets no entry. The entries come after the earlier ones in `conflicts`, in the order of each participant's first stage. The two outcomes are tested in the order the text gives ("Otherwise", L299): `conflict` first, so a row is a step-8 `conflict` even when another stage has no counting acceptance, and `unknown` only when no participant named more than one account. That agrees with "a blocking entry makes the outcome `conflict`" (L411-412).
    Other: `accounts` without `debitAccount`; one entry per stage; entries sorted by participant ID.
    Status at the answers to items 83-89: settled. Step 8 gives the entries "in the order of the participants' first stages" (L303-305), and the table gives `accounts` as "the distinct accounts it named in counting records (the `debitAccount` too when it is the requester's own key), sorted by UTF-16 code unit" (L433). That is the reading chosen, so `replay.js` did not change for it. Step 8 now has a third outcome between the two, `invalid` (items 90 and 91); `conflict` is still tested first and `unknown` last.

87. **L341-346, L380-381. Which key of `balances` a row with signed accounts is summed under.** "`balances` sums that row under the signed accounts", and a stage with no signed account "under its participant ID". The text does not say how these keys stand beside the accounts of rows without signed accounts, nor what a stage whose acceptances name two accounts is summed under.
    Chosen: per row. For an attempt with signed accounts the debit is posted under the text of `debitAccount` and each stage's credit under the text of its `payoutAccount`; `accountOf` is not called for that attempt at all, an `expired` row included. A stage whose `accounts.stages` entry is `null` (no counting acceptance, or acceptances that name more than one; among the rows `balances` sums, either is possible only on an `expired` row, at 0) is posted under its participant ID itself, not under what `accountOf` gives for it. Accounts are compared and keyed as exact strings, and `balances` has one set of keys: a signed account whose text equals an `accountOf` account or a participant ID of another row is summed with it. A participant that takes part in one attempt with signed accounts and one without is summed under two keys, and nothing joins them. As in item 36, every account of a `settled` or `expired` row is present, with 0 when nothing moved.
    Other: separate key spaces for signed accounts and participant IDs; the participant ID as well as the signed account; a stage with two signed accounts under each of them; signed accounts passed through `accountOf`; zero sums left out.
    Status at the answers to items 83-89: partly settled. With `accountOf` supplied, step 8 now refuses a signed account that differs from `accountOf` of its participant (L305-308), so on a `settled` row the signed accounts are the accounts `accountOf` gives and the two are one key space, as chosen; and `accountOf` "is used for nothing but the enrollment test" (L309-311), so a stage with no signed account is still under its participant ID itself. `replay.js` changed in one point of this item: `accountOf` is now called for an attempt with signed accounts, in step 8's test only (item 90); the postings still do not use it. Still not stated: the key space when no `accountOf` is supplied, what a stage whose acceptances name two accounts is summed under on an `expired` row, and zero sums. An `expired` row is never tested (item 93).

88. **L17-18 with L117-124. The new members in the record shapes.** The Records table still lists what terms and an acceptance bind without `debitAccount` and `payoutAccount`, and the entries do not say what a `null` member or `debitAccount` on the older shape of terms is.
    Chosen: each is a member of its record's body, so it is covered by the signed bytes, and `debitAccount` by the terms digest an acceptance names (L41-48, L77). Terms of the older shape, without `maxUnacknowledgedOutputs`, may not carry `debitAccount` ("every member above, `K` included") and are rejected with it. A member that is present with a value that is not text 128, `null` included, is rejected. Two acceptances that differ only in `payoutAccount` are two records.
    Other: `debitAccount` allowed on the older shape; a `null` member read as an absent one.
    Status at the answers to items 83-89: partly settled. The Records table now names both members among what terms and an acceptance bind, each "when present" (L17-18). The entries of "Record fields" read as before (L117-124), so a `null` member and `debitAccount` on the older shape stand as chosen.

## New at the amendment for signed accounts: looks self-contradictory or wrong

89. **L164-166 against L291-293, L341-346 and L470-473. "Can charge only the stranger."** A stranger's own terms under a known reservation ID make "a separate attempt that can charge only the stranger". With signed accounts the row's debit is posted in `balances` under the `debitAccount` its terms name, and no record ties that account to the key that signed them: the replay establishes only which account the requester "asked to be charged from". A stranger that runs its own stages can therefore produce a `settled` row whose debit stands under any account text it chooses. In the other direction, a stage that names the requester's `debitAccount` as its `payoutAccount` is "the requester's own" and lowers the debit by its share, though the requester's key did not do that work; that costs only the stage.
    Chosen: as the amended text says. `balances` posts the debit under `debitAccount` and makes no check of who may be charged from it; whoever applies the result has to check that.
    Other: such a row is `unknown` or `invalid` unless an input or a record shows that the requester's key may be charged from the account; the debit under the requester's participant ID as well.
    Status at the answers to items 83-89: settled. The sentence is now qualified: "With signed accounts (step 8) that holds only where the caller supplies the enrollment as `accountOf`: an account is then refused unless its signer is enrolled under it. Without `accountOf` a signed account is only what its signer asked for, and a stranger's terms can name any account text" (L166-170), and step 8 has the test (L305-308). `replay.js` changed: with `accountOf` supplied, step 8 answers `invalid` for a signed account that differs from `accountOf` of its participant, which also refuses a stage that names the requester's `debitAccount` without being enrolled under it; without `accountOf` the row is posted under the signed accounts unchecked, as before. What "supplied" and "`accountOf` of that participant" mean is item 90, and the rows the test never reaches are item 93.

## New at the answers to items 83-89: not determined by the text

90. **L305-308 with L166-170 and L348-350. What "supplied" means for `accountOf`, and what "`accountOf` of that participant" is.** The text does not give the form of `accountOf` (item 36), nor say what the enrollment test does with a participant that `accountOf` does not place, with an `accountOf` it cannot read, or with an account that is not a string.
    Chosen: `accountOf` is supplied when the input is anything but `undefined` or `null`. `accountOf` of a participant is what the replay takes as its account everywhere else (item 36): the value a function (awaited) or a `Map` gives for its participant ID, and its own participant ID when that gives nothing or throws. So a participant the enrollment does not place passes only when the account it signed is its own participant ID text, and any other account it signed is refused. That keeps "an account is then refused unless its signer is enrolled under it" (L168-169): a stranger that names its own ID can charge only itself. A supplied `accountOf` that is neither a function nor a `Map` places nobody, so it refuses every signed account but the signer's own ID; it does not count as not supplied, which would skip the test the caller asked for. Accounts are compared with `===`, so one that is not a string never equals a signed account. Each participant is asked once: the requester first, then the stages' participants in the order of their first stages. The first that differs decides, and only it is named, in `reason`.
    Other: supplied only when it is a function or a `Map`; a participant `accountOf` does not place is not tested, or is always refused, its own ID included; accounts compared as text.
    Status at the failed-stage amendment: partly settled. The text read now says "(`accountOf` of a participant it does not place is that participant's own ID)" (L353-354). That is the reading chosen, so `replay.js` did not change for it. Still not stated: what "supplied" means, the form of `accountOf`, and the order in which the participants are tested. The sentence is not part of the summary the author was given of this amendment (see the update paragraph at the top).

91. **L305-308 with L393-415. The members of an `invalid` row from step 8.** The Rows table gives members by outcome and by step, but it was written when `invalid` came only from step 3, and it describes no member for the refusal.
    Chosen: the members the table gives for a row decided at step 8. It has `accounts` (the attempt passed step 3), holding what was signed, the refused account included. `outputs` is the acknowledged count ("for rows decided at step 6 or later"). `closedAtLastStep` is kept ("when step 7 or 8 then decides the row"). `conflicts` keeps its earlier non-blocking entries and gets none for the refusal, which is not a contradiction between signed statements and has no kind in the table. `late`, `foreign` and `unmatched` are as on any row. `debit`, `credits`, `chargedOutputs`, `unacknowledgedOutputs` and `beyondCeiling` are `null`, and nothing is posted to `balances`. No member names the refused participant or account: only `reason` does, and it names the first one found (item 90). `counts.invalid` counts the rows of step 3 and of step 8 together; a step-3 row is told apart by having no `accounts` member and `outputs: null`.
    Other: `outputs: null` and no `accounts`, as on a step-3 row; a member, or an entry like those of `conflicts`, listing every refused participant and account.

## New at the answers to items 83-89: looks self-contradictory or wrong

92. **L377-378 against L305-308. The Outcomes entry for `invalid` names only the policy.** "**invalid:** the terms do not match a supplied policy, or no policy was supplied." Step 8 now also answers `invalid`, for terms that match their policy, when a signed account differs from `accountOf` of its participant.
    Chosen: step 8 is followed, and the Outcomes entry is read as incomplete. Nothing else in `replay.js` depends on it.
    Status at the failed-stage amendment: settled. The entry now reads "the terms do not match a supplied policy, or no policy was supplied (step 3); or, with signed accounts, a party signed an account that the `accountOf` the caller supplied does not place it under (step 8)" (L437-439). `replay.js` did not change for it.

93. **L350-352 against L276-279, L415 and L168-169. Rows decided before step 8 are not tested against `accountOf`.** "Split arithmetic" says an attempt with signed accounts uses them because "step 8 has already refused any that `accountOf` contradicts", and the paragraph before the steps says an account "is then refused unless its signer is enrolled under it". But an `expired` row is decided at step 6 and never reaches step 8, and it is still summed "under the signed accounts"; an `open`, `conflict` or `unknown` row decided earlier shows the same `accounts` "whatever step decided it".
    Chosen: the order of the steps. The enrollment test runs only when step 8 is reached, after the `payout-account` test. An `expired` row is summed under its signed accounts untested, every amount 0, and by item 36 those accounts are keys of `balances` with 0. `accounts` on a row decided before step 8 is what was signed, enrolled or not. No amount other than 0 is posted under an account the test would refuse, because only a `settled` row moves credit and it has passed the test.
    Other: the test on every row that has `accounts`, so that a contradicted account makes the row `invalid` before step 6 can expire it, or is summed under the participant ID; untested accounts left out of `balances`.
    Status at the failed-stage amendment: settled. "Split arithmetic" now says "for a `settled` row step 8 has already refused any that `accountOf` contradicts; an `expired` row is decided earlier and posts only zeros" (L407-409). That is the reading chosen, so `replay.js` did not change for it. Under the failed-stage terms an `expired` row is decided at step 6 as well and is not tested either (item 106).

## New at the failed-stage amendment: not determined by the text

94. **L22, L42-49, L141-144. The stage fault where the text leaves it to the conventions of the other records.** The entry lists the members and the signer field and nothing else. It gives no type for `attemptId` or `participantId` (item 8) and no bound on `partitionIndex` beyond "count", and it does not restate the signed bytes, the key and signature rules or who may sign. Neither of the two signer modules the text names (L9-11) is said to sign a fault, and the author has read none, so nothing here was checked against a signer.
    Chosen: the conventions of the other records, which the Encoding section states for every record. `schema` is exactly `reploid.settlement-stage-fault/v1`; `attemptId` and `participantId` are text 256; `partitionIndex` is any count (a fault that names an index the agreed terms do not have is well-formed, and step 4 does not keep it); there is no member a fault may carry beyond the seven listed. The signed bytes are the UTF-8 canonical JSON of `{ "signatureDomain": "reploid.settlement-stage-fault/v1", "payload": <body> }`, because the domain is "the record's schema" (L48-49). The key, base64url, low-S and time rules apply as to any record, and `participantId` must be the ID of the carried key (L73-74), so only the stage's own key signs its fault; a supervisor "that holds its key" (L299-300) signs with that key and is not told apart. Identical fault bodies presented twice count once (L166).
    Other: another domain string for this record; a fault signed for a stage by another key (an owner's, or a supervisor's own); `partitionIndex` at most 127, the highest stage any terms can have.
    Status at the answers to items 111-114: still open. The Records row, the Encoding section and the fault's entry (L22, L42-49, L141-144) read as before.

95. **L143-144 with L42-43 and L165. What "its shape check" covers, so which failures are `fault_malformed`.** A record can fail its "shape, key or signature checks" (L165). The text gives a `problem` text for the first of the three only, and only for this record.
    Chosen: `fault_malformed` when a record whose `schema` is the fault schema lacks `publicJwk` or `signature` ("Record shape", L42-43), has a member the entry does not list, lacks a listed member, or has a member that breaks its rule (text and its length, digest, count, time form). The shape is checked first, so a fault that fails both its shape and its key gets `fault_malformed`. A fault that passes its shape and fails a key or signature check gets the text `replay.js` gives any record: `key shape`, `signature format`, `P-256 signature is not low-S`, `participantId is not the ID of the carried key` or `signature does not verify` (item 15). The entry's `schema` is the fault schema. A value that cannot be read as plain finite JSON (item 1) is rejected before its schema is read, with `schema: null` and that check's own text, even when its `schema` member is the fault schema.
    Other: `fault_malformed` for every failed check of a fault, or for every one but the signature verification; the signer field's equality with the key's ID counted as shape; another text when one of the two unsigned members is missing.
    Status at the answers to items 111-114: still open. L143-144 reads as before, and the text gives no other `problem` text.

96. **L22, L143-144, L165-169, L227-228. A stage fault under other terms, or under none.** A fault is "read only under the failed-stage terms" (L22), and "under any other `unfinishedTerms` every stage fault is dropped without being listed" (L227-228). But records are checked, and listed as `rejected`, before they are grouped, when no terms are agreed yet.
    Chosen: every record with the fault schema is checked when it is admitted, whatever terms its reservation has: a malformed one is rejected with `fault_malformed`, one with a bad key or signature is rejected, and a well-formed one is admitted and is never in `rejected`. Under agreed terms with any other `unfinishedTerms` value, `null` included, it is then in no list of the row and changes nothing in it. The failed-stage value is told by exact equality of the agreed terms' `unfinishedTerms` with the text at L312; any other text, however close, is "any other value". This is the one point where a record set under other terms is answered differently than before the amendment: until now `replay.js` rejected every record of this schema with `unknown schema`.
    Other: a fault stays rejected as of an unknown schema unless some terms of its reservation name the failed-stage value; a well-formed fault under other terms listed in some member of the row.
    Status at the answers to items 111-114: still open. L22, L143-144, L165-169 and L227-228 read as before.

97. **L167-169, L463. A reservation that only stage faults name.**
    Chosen: as item 45. Faults are grouped like acceptances and stage receipts, so the reservation gets one row with `requesterId: null`, which has no terms and is `unknown` at step 2. It has no `forfeited` member, since no terms were agreed. Before the amendment such a record was rejected and its reservation had no row.
    Other: a reservation named by faults alone gets no row.
    Status at the answers to items 111-114: still open. L167-169 and the `requesterId` row of the table (L468) read as before.

98. **L188-198. Stage faults in step 1.** The route test names stage receipts and acknowledgments only.
    Chosen: as written. A fault on another route never makes terms `foreign`, a fault on the terms' route does not save terms that their receipts contradict, and terms with faults but "no such receipt and no acknowledgment" pass as an attempt that never started.
    Other: a fault counts in the route test as a receipt does.
    Status at the answers to items 111-114: still open. Step 1 (L188-198) reads as before and still names only stage receipts and acknowledgments.

99. **L224-228, L243-244. A fault with the agreed `attemptId` that fails another keeping test** (another `routeHash`, a signer that is not the participant the terms name at its `partitionIndex`, or a `partitionIndex` the terms do not have).
    Chosen: not kept, and dropped without being listed, as item 25 chose for a receipt. A fault whose `partitionIndex` is past the terms' stages comes from no named participant.
    Other: listed as `late`; a fault from a named participant under another stage's `partitionIndex` treated as a contradiction.
    Status at the answers to items 111-114: still open. Step 4 (L224-228, L243-244) reads as before.

100. **L229-230, L239-240, L475. Late faults: which stages are listed, and where.** "Late faults are listed once per stage, however many that stage signed." The text does not say whether a stage that also has a fault that counts is listed, nor where the one entry stands among the other `late` entries (item 71).
     Chosen: a kept fault is late when its `signedAt` is not `closesInTime`, at either end of that window. Each stage with at least one late fault gets one `{ kind: 'fault', partitionIndex }` entry, whether or not another fault of that stage counts (the stage has then faulted, and its late fault is still listed). The entry stands where the stage's first late fault was presented, among the other `late` entries in input order (item 71). As for every record of step 4, nothing is listed on a row decided at step 1, 2 or 3 (item 26).
     Other: no `late` entry for a stage that has a counting fault; the fault entries after all the others, or in stage order.
     Status at the answers to items 111-114: still open. L229-230, L239-240 and the `late` row of the table (L480) read as before.

101. **L229, L237-242, L316-319. What a fault contradicts.** Step 5 uses late receipts and acknowledgments in its contradiction tests. For a fault the text names one contradiction, `fault-and-close`.
     Chosen: only that one, and only from records that count: "a late acceptance, stop or stage fault counts for nothing" (L238-239), and a late receipt "never closes a stage" (L237-238). So a late fault beside a close that counts gives no entry and no forfeit, and a counting fault beside a closing receipt that is late gives no entry, the stage forfeiting with cause `fault`. Several counting faults of one stage make it faulted once. Nothing compares a fault's `signedAt` with the times or sequences of the stage's receipts: a fault signed before the close and one signed after it are judged alike, and receipts that go on after a fault without a close contradict nothing. A fault needs no acceptance of its stage to count.
     Other: late faults and late closing receipts used for the `fault-and-close` entry, as late records are used in step 5; a receipt signed after a fault as a contradiction of its own.
     Status at the answers to items 111-114: still open. Steps 4 and 6 read as before on this. The amended text adds only that "a record signed in time and presented later still counts, as it does for any row" (L735-736), which speaks of a record that counts, not of a late one.

102. **L275-276 and L316-317 against L497. "Also closed" in `fault-and-close`.** Step 6 gives the entry to "a stage that faulted and also closed", and a stage has closed when its latest receipt, the highest-`sequence` one that counts, is a closing receipt. The table gives it to "the stage that signed both a counting fault and a closing receipt that counts". The two differ when a closing receipt that counts is followed by a higher-`sequence` receipt that counts and does not close, or when two counting receipts share the highest sequence and only one closes. Either is a blocking `stage-receipt` contradiction, so the row is `conflict` both ways and no amount depends on it, but the entry is listed "whatever later decides the row".
     Chosen: step 6's definition, which the table cites: the stage's latest receipt is a closing receipt (of two counting receipts at the highest sequence the one presented later is the latest, as before). The same definition gives the cause `fault-and-close` in `forfeited`.
     Other: any closing receipt of the stage that counts.
     Status at the answers to items 111-114: still open. Step 6 still says "faulted and also closed" (L317-318) and the table still says "a closing receipt that counts" (L502).

103. **L318-319, L483-498. Where the `fault-and-close` entries stand in `conflicts`, and on which rows.** They are "listed from step 4 on, whatever later decides the row". The order between kinds is otherwise open (item 63).
     Chosen: at step 4's place: after the `terms-equivocation` entry of step 2 and before every entry of step 5, in ascending stage order, one per stage (a participant that runs two such stages gets two entries, each with its `partitionIndex`). They are on every row that passed step 3 under the failed-stage terms, an `open` row and a step-5 `conflict` row included, and on no row decided at step 1, 2 or 3, where no record has been kept (item 64).
     Other: after the step-5 entries, at step 6's place; one entry per participant; entries also on an `invalid` row of step 3.
     Status at the answers to items 111-114: still open. "Listed from step 4 on" (L319-320) and the table of conflict entries (L493-503) read as before.

104. **L322-329. Whether a stage treated as closed at its last signed step forfeits.** "A stage that has neither closed nor faulted is treated as closed at its last signed step, and listed in `closedAtLastStep`, when the answer was delivered and its latest receipt has `steps >= N`. Every stage that faulted, and every other stage that has not closed, forfeits." Read word for word, a stage treated as closed "has not closed", and `no-close` is the cause "for one that did neither".
     Chosen: it does not forfeit. A stage treated as closed is listed in `closedAtLastStep` and not in `forfeited`, is tested at step 7 and is paid its share, as under the other terms; were it to forfeit as well, the treatment would change no amount and no outcome. No stage is in both lists. A stage that faulted is never treated as closed, even when its receipts cover a delivered answer: it forfeits with cause `fault`. An unclosed stage with no receipt that counts covers nothing (item 66) and forfeits with `no-close`. Whether the answer was delivered is read as before, from the final stage's latest receipt and the acknowledged count, whether or not the final stage faulted. This choice changes amounts: see item 112 for the passages that read the other way.
     Other: every stage without a close forfeits, and `closedAtLastStep` only names those whose receipts cover the answer, so that such a stage is in both lists and is paid 0.
     Status at the answers to items 111-114: settled by the text now: "One exception stays from before: a stage that signed no fault and whose receipts cover a delivered answer is not failed by its missing close; step 6 treats it as closed at its last signed step and it is paid." (L723-726). That is the reading chosen, so `replay.js` did not change. What "signed no fault" means for a stage whose only fault is late is item 115.

105. **L320-333. `settled` and `expired` before the release window has passed, and the order of the tests.**
     Chosen: the order of the bullets. `open` is tested first and needs both a stage that has neither closed nor faulted and a window that has not passed. Otherwise the row is decided, also before the window has passed: when every stage has closed or faulted, an attempt with acknowledged outputs goes on to step 7 at once, and one with none and a faulted stage that did not close is `expired` at once, although an acknowledgment or a closing receipt signed in time could still be presented (item 111). Without a usable `at` the window has not passed (item 33), so an attempt with a stage that has neither closed nor faulted stays `open`. "Some stage has not closed" (L330) is step 6's "closed": with an acknowledged count of 0 no answer was delivered (`N > 0`), so no stage is treated as closed. An attempt with an acknowledged count of 0 whose stages all closed goes on and can settle at 0, as under the other terms, also when one of them both faulted and closed.
     Other: `expired` only once the window has passed; `open` whenever the window has not passed and some stage has not closed.
     Status at the answers to items 111-114: settled by the text now: "Under those terms `expired` and `settled` do not wait for the release window when every stage has closed or signed a fault." (L432-434), and `open` is "the release window has not passed yet and not every stage has closed (under the failed-stage terms: closed or signed a fault)" (L435-436). That is the reading chosen, so `replay.js` did not change. An unusable `at` is still item 33, and "signed a fault" against "faulted" is item 115.

106. **L326-333, L467-473, L478. The members of an `open` and of an `expired` row under the failed-stage terms.**
     Chosen: on an `open` row `forfeited` holds only the stages with a counting fault, each with the cause it has now (`fault`, or `fault-and-close` when it has also closed); a stage that has neither closed nor faulted is not listed, and `closedAtLastStep` is `[]`. On an `expired` row every stage was decided first, so `forfeited` holds every forfeiting stage, the `no-close` ones included; `debit` is 0, `credits` has one entry per stage with `amount: 0`, `outputs` is 0 and `closedAtLastStep` is `[]`. The row is summed in `balances` as any `expired` row is (items 36 and 87), with signed accounts untested (item 93). On a row that step 5 decided, `forfeited` is `[]` even when `conflicts` has a `fault-and-close` entry (L478: "on a row decided before step 6").
     Other: `forfeited: []` on an `expired` row; the stages without a close listed on an `open` row as well.
     Status at the answers to items 111-114: still open. The Rows table (L472-484) reads as before.

107. **L341-357 with L337-340 and L711-714. Step 8 and a forfeiting stage.** Step 7 says a forfeiting stage "is not tested". Step 8 was not amended and says "any stage".
     Chosen: step 8 as written, for every stage, forfeiting or not. A forfeiting stage with no in-time acceptance of the agreed terms makes the row `unknown` (the rule is "accepted by each stage", L711-713). With signed accounts its `payoutAccount` is in the `payout-account` test and in the enrollment test like any stage's. So a stage that presents neither an acceptance nor a close still makes the row `unknown` when step 8 is reached (item 113).
     Other: a forfeiting stage needs no acceptance, and its account is not tested.
     Status at the answers to items 111-114: still open. Step 8 (L342-358) reads as before and still says "any stage", and the Outcomes entry for `unknown` still gives "missing terms or acceptance" with no exception (L439-441). The new opening of the failed-stage rule (L313-316) bears on this without deciding it: item 116.

108. **L358-386, L469-472. Step 9's cases and the settled row's counts when stages forfeit.** Step 9 opens with "Every stage has closed (step 6) or is treated as closed at its last step", which does not hold under these terms, and `delivered` is "the final stage's latest receipt's `output`", which a forfeiting final stage may not have.
     Chosen: the cases are found as before (items 13 and 78) and change no amount under these terms. `chargedOutputs` is `min(acknowledged, maxOutputTokens)` whatever is forfeited, also when every charged stage forfeits and `debit` is 0: "the charge units are the same" (L383-384), and a forfeit is taken from the split, not from the outputs. `beyondCeiling` is as before. `unacknowledgedOutputs` is `null` when the final stage has no counting receipt with an `output`; that is possible here on a `settled` row (the final stage's late receipts commit the chains, the stage forfeits, and the acknowledged count is above 0). `reason` names the failed-stage terms and how many stages forfeit; it is not part of the outcome.
     Other: `chargedOutputs: 0` when nothing is debited; `chargedOutputs` lowered in proportion to the forfeited weight.
     Status at the answers to items 111-114: still open. Step 9 still opens with "Every stage has closed (step 6) or is treated as closed at its last step" (L360-361), and the rows for `chargedOutputs` and `unacknowledgedOutputs` (L475-476) read as before.

109. **L396-404, L706-709. The split with forfeiting stages.**
     Chosen: the amounts are first computed for every stage from the whole `U` and every weight, the last stage taking the remainder. A stage on the requester's own account and a forfeiting stage are then both credited 0, and `debit` is the sum of the credits that remain; a stage that is both lowers the debit once. A forfeiting last stage therefore loses the remainder, not `floor(U * weight / W)`. A forfeiting stage keeps its entry in `credits`, with `amount: 0`, and its account is named in `balances` with what the row posts to it, 0 (item 36). With signed accounts a stage is still the requester's own exactly when its `payoutAccount` equals `debitAccount`. Worked by hand for the text's example (weights 1, 3 and 2, `U = 9`, the middle stage forfeiting): credits 1, 0 and 4 and a debit of 5, as L706-709 says. The author did not run it.
     Other: the remainder recomputed among the stages that are paid; a forfeiting stage left out of `credits` or of `balances`.
     Status at the answers to items 111-114: still open. "Split arithmetic" (L397-405) and the example (L710-714) read as before.

110. **L445-447, L454-458, L478-479. The `forfeited` member: where it stands, and the result's `schema`.** The sentence before the table names `accounts` first and `forfeited` second; the table has `forfeited` before `accounts`. The result's `schema` is `v2`, said to have rows with "the same members" as `v1`.
     Chosen: a row has `forfeited` exactly when its agreed terms name the failed-stage value and step 3 passed. It stands after `unmatched`, and before `accounts` when the row has both (the table's order). Its entries are `{ partitionIndex, cause }` in ascending stage order. The result's `schema` stays `reploid.settlement-replay/v2` whatever terms the rows have (item 78).
     Other: `accounts` before `forfeited`; another result `schema` when a row has the new member.
     Status at the answers to items 111-114: still open. L450-452, L459-463 and the last two rows of the table (L483-484) read as before.

## New at the failed-stage amendment: looks self-contradictory or wrong

111. **L425-431, L417-419 and L183-186 against L320-336.** The Outcomes section says `expired` is "the release window passed without every stage closing and without a delivered answer" and `open` is "the release window has not passed yet and not every stage has closed". Under the failed-stage rule an attempt with a faulted stage that did not close is `settled` or `expired` before the window has passed: a fault "decides its own stage at once" (L335-336). L185-186 says that until the window has passed "a closing receipt signed in time can still be presented and change the outcome", and here it still can: a later in-time acknowledgment turns such an `expired` row into a `settled` one that charges. (A close presented later only turns the stage's cause into `fault-and-close`.) The `settled` entry (L417-419) names only stages that closed or are treated as closed.
     Chosen: step 6 as written (item 105).
     Status at the answers to items 111-114: settled by the text now. `settled`: "or, under the failed-stage terms, every stage is decided (step 6) and the attempt is not `expired`" (L420-421). `expired`: "Under those terms `expired` and `settled` do not wait for the release window when every stage has closed or signed a fault." (L432-434). `open`: "(under the failed-stage terms: closed or signed a fault)" (L436). And for L185-186: "A row decided that early is decided for the records presented: a record signed in time and presented later still counts, as it does for any row." (L734-736). `replay.js` already did all of this and did not change: it decides from the records it is given and `at`, and keeps nothing between calls. Two leftovers are new items: "signed a fault" (115) and what the `settled` clause leaves out (116).

112. **L716-720 and L739 against L322-325.** "Failed stages" says "A stage fails by signing a stage fault, or by having no closing receipt that counts once the release window has passed. It is credited 0. Every stage that closed is paid ... and the requester's debit is the sum of those shares", and its table says of a stage that withholds its closing receipt "that stage is paid 0". Step 6 treats a stage without a close as closed at its last signed step when the answer was delivered and its latest receipt covers it, and Outcomes calls such a row `settled` with those stages "treated as closed" (L417-419).
     Chosen: step 6, read as in item 104: such a stage is paid its share, and the summary is read as leaving the case out. If the summary is the rule, item 104's other reading is right and the amounts differ.
     Status at the answers to items 111-114: settled by the text now: "One exception stays from before: a stage that signed no fault and whose receipts cover a delivered answer is not failed by its missing close; step 6 treats it as closed at its last signed step and it is paid. A failed stage is credited 0." (L723-726), and the table's first row now reads "withholds its closing receipt of an unfinished answer" (L749). That is the reading chosen (item 104), so `replay.js` did not change. The sentence after the exception still gives the debit as the sum of the shares of "every stage that closed" (L726-728), without the stage treated as closed; by the exception that stage is paid, so `replay.js` keeps its share in the debit.

113. **L313-315 against L330-333, L354-355 and L760-769.** "No attempt is `unknown` or `expired` because one stage withheld something." By the rule itself a final stage that withholds every receipt leaves the acknowledged count at 0 and the attempt `expired` (the text says so at L760-765), and a stage that withholds its acceptance makes the row `unknown` at step 8, which was not amended (item 107).
     Chosen: the steps as written.
     Status at the answers to items 111-114: settled by the text now for the sentence it named, which is gone. The rule now opens: "A stage that keeps back its closing receipt, or its receipts covering a delivered answer, then changes only its own amount; what a withheld record can still do is listed under [Failed stages]" (L313-316), and that list has the final stage that presents no receipt at all (L770-775). `replay.js` did not change. The other half of this item is wrong in a new way: the list does not have a withheld acceptance, which step 8 still answers with `unknown` (item 116), and the new sentence does not hold for the final stage (item 117).

114. **L375-380 against L381-391.** Step 9's provider-relief bullet covers "`null` (older terms) or any other value except the next one". The next bullet is now the failed-stage one; the provider-loss-free bullet, which those words meant before the amendment, comes after it.
     Chosen: each of the three named values has its own bullet and decides. `null` and every other value charge the acknowledged prefix with no forfeit, as before. No behaviour depends on the wording.
     Status at the answers to items 111-114: settled by the text now: "under `null` (older terms) or any other value except the provider-loss-free one below" (L379-380). The failed-stage value now falls under these words as well as under its own bullet (L382-387); both give the same charge units, and only its own bullet adds the forfeit. `replay.js` did not change.

## New at the answers to items 111-114

115. **L432-436 and L723-725 against L317 and L238-239. "Signed a fault" against "faulted".** The amended sentences say that `expired` and `settled` do not wait "when every stage has closed or signed a fault", that `open` is "not every stage has closed (under the failed-stage terms: closed or signed a fault)", and that the exception is for "a stage that signed no fault". Step 6 says a stage has faulted "when a stage fault of it counts (step 4)", and step 4 says "a late acceptance, stop or stage fault counts for nothing". The two differ for a stage whose kept faults are all late: signed before `notBefore` less the allowance, or dated after the closing window (which a fault can be while `at` is still inside it, since nothing relates `at` to a record's time, item 33). By the new words such a stage "signed a fault"; by step 6 it has not faulted.
     Chosen: steps 4 and 6, as `replay.js` already did: only a fault that counts makes a stage faulted. A stage with only late faults gets its one `late` entry (item 100); if it has not closed, the row stays `open` until the window has passed, and after it the stage is treated as closed at its last signed step and paid when its receipts cover a delivered answer, and forfeits with cause `no-close` otherwise. The new sentences are read as short for "has a fault that counts".
     Other: any kept fault, late or not, decides its stage: the row does not wait for it, and it forfeits with cause `fault` even when its receipts cover a delivered answer. That reading changes an amount in that one case.

116. **L313-316 and L420-421 against L338-341, L355-356, L439-441 and L769-780. What a withheld record can still do, and what follows "every stage is decided".** The rule's new opening says "what a withheld record can still do is listed under [Failed stages]", and the Outcomes entry says a row under these terms is `settled` when "every stage is decided (step 6) and the attempt is not `expired`". The list ("What these terms do not stop", L769-780) names a final stage that presents no receipt at all, a conflict, and self-reported times. It does not name a stage's withheld acceptance. Step 8 was not amended: "the outcome is `unknown` if any stage has no in-time acceptance of the agreed terms that counts" (L355-356), and the Outcomes entry for `unknown` still gives "missing terms or acceptance" with no exception (L439-441). So one stage that keeps back its acceptance still makes the row `unknown` and changes every stage's amount. Nor does the `settled` clause mention that after every stage is decided a row can still be a step-7 `conflict` or a step-8 `conflict`, `invalid` or `unknown`.
     Chosen: the steps as written (item 107). After step 6 a row still passes steps 7 and 8, and a stage with no in-time acceptance that counts makes it `unknown`, a forfeiting stage included. The list is read as incomplete, and the `settled` clause as leaving out steps 7 and 8, as the clause before it always did. `replay.js` did not change.
     Other: under the failed-stage terms a stage that step 6 forfeits needs no acceptance (item 107's other reading), so that its withheld acceptance changes only its own amount. Even then a stage that closed and kept back its acceptance would make the row `unknown`, so the list would still be incomplete.

117. **L313-315 against L245-250, L260-261 and L770-775. The final stage keeping back some of its receipts.** The new opening says a stage that keeps back "its receipts covering a delivered answer ... changes only its own amount". For the final stage that does not follow from the steps. Only its receipts commit a chain (step 5), so when it keeps back its receipts for the last counts, its closing receipt among them, the requester's in-time acknowledgments of those counts are `unmatched`, the acknowledged count is lower, and the debit and every stage's share are lower with it; the final stage itself forfeits with `no-close`. The list names only the extreme of this, "a final stage that presents no receipt at all" (L770-775); the general case is the "smaller acknowledged count" of L548-550.
     Chosen: step 5 as written; `replay.js` did not change. The sentence is read as speaking of a stage other than the final one.
     Other: none that the steps allow: a verifier cannot charge a count for which it has no chain of the final stage.
