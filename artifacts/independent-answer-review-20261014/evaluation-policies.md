# Whole-answer evaluation policies

Version: reploid-whole-answer-policies 1.0.0, frozen 2026-10-14.

These rules grade complete answers from Reploid's Launch 1 model. There is one policy per task type, and each packet item names the policy that applies to it.

| Policy | Task type | State |
|---|---|---|
| Q | Everyday questions and explanations, including code with a stated output, arithmetic and unit conversion, format tasks, and follow-up turns about them | Frozen, in use |
| S | Summaries and rewrites of text supplied in the prompt | Frozen, in use |
| R | Search-backed (retrieval-backed) answers | Frozen, pending REP-8. No retrieval exists yet, so no packet contains R items. |

---

## 1. Freezing and authority

- This file is frozen when its sha256 is recorded in the packet README. Every grading file names the version and sha256 it used.
- A change makes a new version with a new hash. Grades made under one version are never regraded or reinterpreted under another. No criterion changes after answers or grades have been seen.
- Grades are evidence. They set no pass threshold, make no release decision, and do not adjudicate refunds or disputes.
- A reviewer must be independent of the item set and its checks, of tuning or selecting the model under review, and of any provider reward interest. Each reviewer declares this and their method (section 7). The author of the items or checks cannot serve as a reviewer; self-review does not count.

## 2. Units of grading

- **Answer.** The exact text the model delivered for one turn. Grade the text as written, including Markdown and LaTeX markup, and never repair it. Raw markup is not an error unless an instruction forbids it.
- **Turn-2 context.** A turn-2 answer is read in its context: the turn-1 prompt and the same side's own turn-1 answer, as the application sent them.
  - References in a turn-2 prompt ("that function", "it", "its perimeter") refer to what that context establishes.
  - A stated result about something produced in turn 1 is graded against what that thing actually does or says, not against what a correct turn-1 answer would have done.
  - Errors in turn 1 are graded in turn 1. A turn-2 answer is not charged for them unless it repeats or asserts them.
- **Element.** One independently checkable unit of an answer. Enumerate every element before deciding the answer status.
  - A sentence with two checkable claims is two elements.
  - A claim repeated within one answer is graded once; the basis notes the repeat.
  - A table is graded by row, a list by item.
  - Greetings, offers of further help, headings and restatements of the question are not elements, unless they assert something checkable or break an instruction (such as any text when only an answer was requested).
  - Opinion or taste that cannot be true or false is not an element. When the prompt asks for a quality (polite, short, a haiku), the instruction element covers it.
  - An ambiguous claim is graded on its most natural reading in context, stated in the basis. If the readings differ in truth and none is clearly most natural, the grade is unverified.
- **Addition.** An element that goes beyond what the prompt asked for: background facts, history, side remarks, advice, extra examples. Mark it `addition: true`. An addition is graded like any other element. An incorrect addition is a **false addition**. A correct addition is not penalized, except where a policy or an instruction forbids it (policy S added claims; "only" instructions).

## 3. Grades and statuses (all policies)

Each element gets exactly one grade:

| Grade | Meaning |
|---|---|
| correct | The recorded evidence establishes the claim as true, or the requirement as met. |
| incorrect | The recorded evidence establishes the claim as false, or the requirement as violated. One executed counterexample, contradicting source, failed computation, or contradiction with the prompt or supplied text is enough. |
| unverified | The reviewer could not establish either. The basis says what was tried and why it did not settle the element. |

Each answer gets exactly one status, derived from its element grades:

| Status | Rule |
|---|---|
| whole-answer correct | At least one element, and every element is correct. |
| has an incorrect element | At least one element is incorrect. |
| unverified only | No element is incorrect, and at least one is unverified. |

- **Passing.** Only whole-answer correct passes. Neither "has an incorrect element" nor "unverified only" ever counts as passing. An unverified element never counts as correct.
- **Two-turn items.** A side of a two-turn item passes only when both of its turn answers are whole-answer correct. The side's status is the worse of its two answers, in this order from worst: has an incorrect element, unverified only, whole-answer correct.
- **Pairing.** Answer A and Answer B are paired for presentation only. Grade each answer against the policy and its own evidence, never against the other answer. Both may pass, or both may fail.
- **Reference first.** Before reading either answer, record the item reference: each asked part with its correct answer and evidence, and for policy S the required-content list. Use the same reference for both answers. A reviewer who finds the reference wrong while grading corrects it, records the correction, and regrades both answers against the corrected reference.
- **Uncertainty across reviewers.** Each reviewer's grades are reported separately, under that reviewer's identity. When reviewers give one answer different statuses, the answer is reported as **disputed**, with every reviewer's status and elements. A disputed answer does not count as passing. Grades are never averaged, and disagreement is never settled by vote.

## 4. Evidence each element records

| Field | Content |
|---|---|
| `kind` | The element kind from the applicable policy (section 6). |
| `quote` | The exact span of the answer being graded. For `asked-part`, `instruction` and `required-content`, the requirement as the prompt states it, then the answer span that meets or misses it, or `absent`. |
| `claim` | The claim or requirement in the reviewer's words. |
| `addition` | `true` when the element goes beyond what the prompt asked (section 2). |
| `grade` | `correct`, `incorrect` or `unverified`. |
| `basis` | One or two sentences explaining why the evidence gives this grade. For `unverified`, what was tried and why it did not settle the element. |
| `evidence.type` | `reference`, `computation`, `execution`, `text-comparison` or `general-knowledge`. |
| `evidence.source` | For `reference`, a specific citation: title, section, edition or URL. For `text-comparison`, the compared spans, quoted. For `general-knowledge`, the specific fact relied on, stated in full (for example "Jane Austen died in 1817"). |
| `evidence.sourceAccess` | `consulted` when the reviewer opened the source during this review; `recalled` when it is cited from memory; `not-applicable` for computation, execution and text comparison. |
| `evidence.computation` | For `computation`, the arithmetic or derivation written out step by step. |
| `executionIds` | The executions (section 5) the grade relies on. Required for `code-executed` elements and for any grade with `evidence.type` `execution`. |

- A correct grade resting on general knowledge or a recalled source must state the specific fact. If the reviewer is not certain of it, the grade is unverified.
- Reviewers may use any public reference. They must not use the sealed key, any earlier grades of these answers, or any other file in the Reploid repository or its history.

## 5. Code execution

- **Where.** Run code in a fresh, empty directory outside any repository checkout, without network use, with a timeout of at most 10 seconds and a minimal environment. Run Python with `-I`. Run JavaScript with Node and no project configuration.
- **What.** Run the answer's code verbatim.
  - When a call is needed to exercise it on an input (the prompt's input or a probe), append the call after the code and record the appended lines separately.
  - Never fix, complete or reformat the answer's code.
  - When the code is in the prompt ("What does this code print?"), run the prompt's code to establish the reference output.
- **Record per execution:**
  - an id;
  - language, interpreter and version, and operating system;
  - the command;
  - the exact program text run, with appended lines marked;
  - the inputs;
  - stdout, stderr and exit status;
  - whether it timed out, and the timeout.
- **What an execution proves.** Running code verifies only the behavior it exercised: the inputs actually run and the output actually observed.
  - The answer's stated output for an input is an `example` element, graded against the execution on that input.
  - What the answer's code did on a run input is a `code-executed` element. It is correct when the observed result is what the prompt requires for that input. It is incorrect when the code fails to run, raises, or returns anything else.
  - A general claim about the code is a `code-general` element: comments, docstrings, descriptions, types, complexity, "handles X". It is correct only when it follows directly from cited language semantics for short code, or when the exercised inputs cover it. Otherwise it is unverified. One executed counterexample makes it incorrect.
  - A required behavior in the prompt, such as "ignoring case", is an `instruction` element. Grade it by execution on probe inputs that test it.
- Code that cannot be run in the reviewer's environment leaves the elements that depend on it unverified, unless language semantics alone settle them.

## 6. The policies

### Policy Q: everyday questions and explanations

Applies to factual questions, explanations, code with a stated output, arithmetic and unit conversion, format-following tasks, and follow-up turns about any of these.

| Kind | One element per | Correct when |
|---|---|---|
| `asked-part` | Distinct thing the prompt asks for (completeness) | The answer delivers it. Missing, or replaced by something else, is incorrect. Whether the delivered value is right is a separate element. |
| `instruction` | Explicit requirement on form or behavior: format, count, length, language, names, required methods, required code behavior, "only", "no other text" | The answer meets it. |
| `fact` | Factual statement, including advice and recommendations | It is true. Advice is true when it is accurate for the situation described. |
| `example` | Stated value, result, output or worked step | It equals the established value. |
| `code-executed` | Behavior of the answer's code on one run input | Section 5. |
| `code-general` | General claim about what the code does | Section 5. |

Rules:
- **Factual correctness.** Every fact and example is graded, including additions. A correct asked point does not excuse a false addition.
- **Completeness.** Every asked part is an element. An explanation delivers its asked part when it states the explanation asked for: the cause, the difference or the meaning.
- **Instruction compliance.**
  - "Only", "just", "no other text" and one-word limits are broken by any added word, label or sentence. Surrounding markup (one code fence, backticks, bold or italic markers, quotation marks), surrounding whitespace and one trailing period are not added text.
  - Counted requirements (sentences, bullets, list items, lines, words) are counted, and the count is stated in the basis. Words are split on whitespace. A bullet is a line that starts with `-`, `*`, `+` or `•`.
  - A named form is judged by its conventional definition, which the basis states. An English haiku is three lines of 5, 7 and 5 syllables, counted with a cited dictionary syllabification. A requested JSON object must parse under RFC 8259 after removing one surrounding code fence. A numbered list has each item start with its number.
- **Numbers.**
  - A stated number is correct when it equals the established value, or the established value rounded to the precision written.
  - A number marked as approximate ("about", "around", "roughly", "approximately", "≈", "~") is also correct when it is within one unit of its last nonzero written digit of the established value.
  - Otherwise it is incorrect. A wrong or missing unit makes it incorrect.
  - Each intermediate value in a worked solution is its own `example` element. A correct final value does not excuse a wrong step.
- **Time-dependent facts** (populations, records, office-holders) are correct when they match a reliable published value for a recent date at the precision written. When the reviewer cannot settle the date, or reliable sources conflict at that precision, the grade is unverified.
- **Code.** Section 5 applies. A correct function with a wrong stated output has an incorrect element.
- **Self-contradiction.** When two parts of an answer contradict each other, at least one is incorrect. Grade each against the evidence.

### Policy S: summaries and rewrites of supplied text

Applies when the prompt supplies text and asks for a summary, shortening, correction or rewrite of it.

Before reading either answer, list the required content:
- Anything the prompt says to keep (for example "keep the meeting day, time and room").
- For a correction or tone rewrite: every proposition of the supplied text. A rewrite keeps the whole meaning unless the prompt asks to drop something.
- For a summary or shortening: the main point, which is the central event, change or finding the text reports, as a reader would need it to act correctly; and any action the text asks readers to take. Other details may be dropped.

| Kind | One element per | Correct when | Incorrect when |
|---|---|---|---|
| `asked-part` | The summary or rewrite asked for | It is delivered. | It is missing, or something else is delivered (for example a reply to the message instead of a rewrite of it). |
| `instruction` | Explicit requirement: length, count, format, "only the corrected sentence", requested tone, spelling and grammar for a correction task | It is met. | It is not met. |
| `required-content` | Item on the required-content list | The answer keeps it with its meaning unchanged. | It is omitted, or kept with a changed meaning. |
| `fidelity` | Claim in the summary or rewrite that restates the supplied text | The supplied text states or directly entails it. | It contradicts or distorts the supplied text: changed numbers, times, dates, names, quantities, polarity, certainty, scope or attribution. |
| `added-claim` | Claim in the summary or rewrite that the supplied text does not state or directly entail | Never. | Always, whether or not it is true in the world. A plausible inference is an added claim. |
| `fact` | Claim outside the summary or rewrite body, such as commentary on the changes made | It is true of the supplied text and the answer. | It misdescribes them. |

Rules:
- **Entailed** means a reader of the supplied text alone would accept the claim as stated or necessarily implied.
- **Courtesy formulas** in a rewrite (greeting, "please", thanks, sign-off) are not claims, unless they assert something (for example "as we discussed").
- **Tone rewrites** may change wording, add courtesy and soften phrasing. They must keep what is requested, the deadline and who acts. Making a firm request optional (for example adding "if possible" to a firm deadline) changes its meaning and is a `fidelity` or `required-content` error.
- **Requested tone** is met when the rewrite reads as that tone compared with the supplied text. The basis names the changes that make it so.
- **Corrections.** Each spelling or grammar error left in a corrected text is an incorrect `instruction` element. A correction must not change the meaning.
- **Word limits.** Words are split on whitespace, and the count is stated in the basis. "Under 30 words" means at most 29.
- Section 3 statuses apply. Commentary that a prompt does not forbid is allowed, but its claims are graded as `fact` elements.

### Policy R: search-backed answers (frozen, pending REP-8)

This policy is frozen with this version and is not yet applied. Reploid has no retrieval yet, so no packet contains search-backed answers. When REP-8 retrieval exists, R items are graded under this text unchanged, or under a new version frozen before any search answer is seen.

A search-backed packet item must include, besides the prompt and the answer, the answer's retrieval record:
- each query issued;
- each source retrieved, with provenance: URL or identifier, retrieval time and content hash;
- the source content the model received;
- whether the request was authorized to use that source;
- any retrieval error.

Without a retrieval record, every `claim` and `citation` element is unverified, so the answer cannot pass.

| Kind | One element per | Correct when | Incorrect when |
|---|---|---|---|
| `asked-part`, `instruction` | As in policy Q | As in policy Q. | As in policy Q. |
| `claim` | Material claim: any statement of fact a reader could rely on or act on, including background | A cited source in the retrieval record supports it, and it is true. | It has no citation, its citation does not support it, or it is false. |
| `citation` | Citation or source reference in the answer | It resolves to a source in the retrieval record that the request was authorized to use, with recorded provenance, and the recorded content supports the claim it is attached to. | It names a source absent from the retrieval record (an invented source), does not resolve, or its content does not support or contradicts the attached claim. |
| `retrieval-report` | One per answer | The answer states accurately what retrieval found. When retrieval failed or found no support, the answer says so. | It invents sources or results, presents unsupported claims as sourced, or hides a retrieval failure. |
| `example`, `code-executed`, `code-general` | Calculations and code inside a search answer | As in policy Q. | As in policy Q. |

Rules:
- **Supports** means the source's recorded content states the claim or directly entails it. A source on the same topic that does not state the claim does not support it.
- A material claim that is true in the world but not supported by a cited, retrieved source is incorrect under this policy.
- A value computed from cited values is supported when the computation is shown or reproducible and its inputs are supported.
- `claim` and `citation` elements whose recorded source content the reviewer cannot read are unverified.
- Section 3 statuses apply.

## 7. Reviewer declaration

Each grading file records:
- **Kind:** human or model.
- **Identity.** For a human, a name or a role. For a model, the model name, exact version or identifier, provider, and the date it ran.
- **Independence.** Whether the reviewer wrote the items or checks, tuned or selected the model under review, or has a provider reward interest. Any "yes" is disclosed.
- **Method.** The references and tools used, whether web access was available, and the code execution environment: operating system, Python and Node versions.
- **Isolation.** A statement that the reviewer did not see the sealed key, earlier grades of these answers, or other Reploid repository files.

## 8. Reporting

Results are reported per reviewer, per policy version and per side:
- answer and item counts by status;
- incorrect elements, and false additions (incorrect elements with `addition: true`);
- unverified elements;
- correct grades whose evidence is `general-knowledge` or `recalled` only;
- disputed answers (section 3).

This policy sets no threshold. Pass floors and allowed gaps are the user's decision.

*Last updated: October 2026*
