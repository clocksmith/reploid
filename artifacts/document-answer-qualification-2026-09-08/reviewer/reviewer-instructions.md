# Frozen independent agent evaluator instructions

Evaluator identity: `/root/blind_qualification`, an independent agent evaluator.
This is agent review of a held-out synthetic corpus. It is not human review,
independent-operator qualification, browser qualification, or deployment approval.

## Freeze and blinding

The evaluator authors the corpus and this rubric before seeing generated answers.
The evaluator has read the development corpus's schema and acceptance contract,
but must not inspect model identity, prompts, sampling settings, candidate patches,
configuration labels, or retained generated answers outside the blinded packet.
The parent receives only artifact paths, digests, case counts, and readiness until
generation ends. Case text, expected facts, and individual outcomes stay withheld
until the review is frozen.

The parent supplies one packet containing the unchanged corpus digest and every
case's exact answer under opaque answer and condition identifiers. It must omit
configuration identities, performance metrics, prior judgments, and expected
outcomes. Answers may contain passage references using passage identifiers or
one-based indices in the supplied passage order. The mapping from opaque
conditions to configurations remains outside the evaluator's inputs until review
completion. A missing answer is recorded as missing and fails coverage. A blank
answer or generation failure is not an abstention.

Verify the corpus and rubric byte digests before reviewing. Never edit their
frozen bytes based on an answer. If the corpus is defective, report the defect
and retain the case and original result; no silent repair or exclusion is allowed.
Evaluate each answer from the question and passages independently, with no
comparison to another condition until individual judgments are complete.

## Support and coverage contract

The corpus acceptance object remains identical to the development corpus. Its
requirements govern every condition and every case without averaging away a
failure. Correct citation syntax never establishes semantic support.

1. Identify every requested part in the question before judging the answer.
   Match it to the review facts, required unknowns, and conflict obligations.
   Equivalent wording passes; exact lexical matches are unnecessary.
2. Segment the entire answer into sentences and substantive list items. Preserve
   exact answer spans with zero-based start and exclusive end offsets. Inspect
   every factual assertion, including incidental examples, implications, numbers,
   qualifications, attributions, comparisons, and claims in conclusions.
3. For every factual assertion, record the cited passage or passages and the exact
   supporting text. A citation must be attached closely enough to identify the
   supported claim unambiguously. A trailing citation supports all factual clauses
   in its sentence only if the cited passages support every clause. Uncited facts,
   irrelevant citations, invented citations, citation-only decorations, and
   partially supported compound claims fail factual support. Inherited citations
   across separate sentences are insufficient unless an explicit block attribution
   clearly covers those sentences. Citations can reference only this case.
4. Judge entailment using supplied passages only. Do not import real-world
   knowledge, assume a causal relationship from an observation, transfer facts
   between named entities, or infer source authority from passage order. Preserve
   conditions, units, direction, exclusivity, scope, and uncertainty. An answer
   cannot upgrade a necessary condition into a sufficient one or add exclusivity.
5. A claim that the passages omit a requested fact is a factual metaclaim. Verify
   it against all passages. An explicit source-relative unknown or abstention
   needs no decorative citation because no passage alone proves absence. Any
   accompanying positive factual assertion still needs supporting citations.
   Do not accept an unsupported claim of real-world impossibility or nonexistence
   in place of a source-relative unknown.
6. Every answerable requested part must be present with correct support. A
   response containing one correct cited fact while omitting another required
   part fails completeness. A general summary, relevance, fluency, or brevity
   does not compensate. Necessary qualifiers in supported facts count toward
   completeness. Added facts are allowed only when correctly supported and cited.
7. Partially answerable cases require every supported requested fact and an
   explicit source-relative unknown for each listed missing fact. An answer that
   supplies known facts but silently omits an unknown fails. A hedged guess still
   fails. The complete-abstention exception below remains permitted.
8. Contradictory cases require both incompatible claims to be described accurately,
   each with its supporting citation, and an explicit statement that the supplied
   material does not resolve the conflict. Answer every uncontested requested
   part with support. Do not select a winner, average values, invent a contextual
   distinction, or treat agreement on another point as resolving the conflict.
   The complete-abstention exception below remains permitted.
9. Unanswerable cases require an explicit source-relative abstention covering
   every requested part. No substantive answer to the requested unknowns is
   permitted. Supported incidental context does not excuse missing abstention.
   Empty output, a repeated question, or an instruction to consult another source
   without stating the evidence gap does not satisfy this requirement.

## Permitted complete abstention and usefulness

For partial and contradictory cases with `allowCompleteAbstention: true`, accept
a complete, explicit abstention that communicates the supplied material is
insufficient to answer the whole question, provided it supplies no substantive
answer to any requested part and contains no unsupported factual assertion. A
generic source-relative statement covering the whole question is sufficient for
this exception. This exception waives known-part and conflict-detail completeness
only for that complete-abstention response. It does not waive those requirements
for a response that answers any requested part. Record
`completenessDisposition: "waived-complete-abstention"` explicitly.

Report contract acceptance and usefulness separately. For partial or conflicting
cases, set `usefulness: "complete-supported-response"` only when the answer gives
all supported requested facts plus required unknown or conflict treatment. Set
`usefulness: "permitted-complete-abstention"` for the exception even if it passes
the contract. Answerable cases use `"complete-supported-response"` when complete;
unanswerable cases use `"appropriate-abstention"` when properly abstained. Failures
use `"failed-contract"`. A permitted abstention is never counted as a useful full
answer to a partial or contradictory case.

## Review record and decision

Save one JSON object with `schema: "reploid.independent-agent-answer-review/v1"`,
`evaluatorType: "independent-agent"`, `evaluatorId`, `corpusByteDigest`,
`rubricByteDigest`, `acceptanceDigest`, `blindedPacketByteDigest`,
`configurationIdentityKnown: false`, `caseDefects`, `reviews`, and `summary`.
Digest strings use `sha256:` followed by lowercase hexadecimal. The acceptance
digest hashes UTF-8 JSON with recursively sorted object keys and original array
order. Byte digests hash unchanged file bytes.

Each review contains `answerId`, `conditionId`, `caseId`, `answerByteDigest`,
`answerPresent`, `sentenceReviews`, `requestedPartReviews`, `completeAbstention`,
`completenessDisposition`, `unsupportedClaims`, `missingRequestedParts`,
`unknownHandlingPassed`, `conflictHandlingPassed`, `citationSupportPassed`,
`contractPassed`, `usefulness`, and `rationale`.

Each sentence review contains `start`, `end`, `text`, `kind` (`factual`,
`source-relative-unknown`, or `nonfactual`), `claims`, and `passed`. Every claim
contains `text`, `citedPassageIds`, `supportingQuotes` (objects with `passageId`
and `text`), `supportStatus` (`supported`, `unsupported`, `not-applicable`, or
`verified-evidence-gap`), and `rationale`. Review all factual sentences, including
those after the first failure. Sentence offsets refer to the exact answer string.

Each requested-part review contains `part`, `requirement` (`supported-fact`,
`explicit-unknown`, or `conflict`), `status` (`satisfied`, `missing`, `incorrect`,
or `waived-complete-abstention`), `answerEvidence`, `passageIds`, and `rationale`.
`answerEvidence` contains exact answer substrings, or an empty array for a missing
part. A review cannot pass unless every factual sentence is supported, every
required part is satisfied or explicitly waived by the permitted exception, all
citations identify supporting supplied material, and abstention/conflict rules
pass. Use booleans for applicable checks and `null` for checks irrelevant to a
case. `completenessDisposition` is `complete`, `incomplete`, or
`waived-complete-abstention`.

The summary reports per opaque condition and category: total required cases,
answers present, cases accepted, cases failed, missing outputs, unsupported-claim
count, incomplete-case count, permitted complete abstentions, complete supported
responses, and appropriate unanswerable abstentions. Report corpus-wide acceptance
only when all 16 required cases pass for that condition. Retain individual
failures and do not replace them with aggregate averages. Include a separate
usefulness count for partial and contradictory cases. Do not infer broader
product correctness, operator independence, biological truth, or deployment
eligibility from this review.

After review is complete, hash the review bytes and send the review path and digest
before any unblinding. Only then may the parent join outcomes to configuration
identities. The evaluator must not revise judgments based on unblinding.

Component: Reploid verification evidence. Intent: preserved.
Acceptance evidence: strict corpus validation, frozen corpus and rubric digests,
and the later blinded sentence and requested-part review.
Boundary effects: none; no runtime behavior, inference, external services, or
human/operator qualification is authorized by these artifacts.

*Last updated: September 2026*
