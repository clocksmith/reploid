# Prompt development: both candidates rejected

Two prompt candidates were tested with the same verified Qwen3-0.6B checkpoint,
CPU source implementation, greedy generation settings, and new eight-case
development corpus. The first adds four unrelated worked examples. The second
removes redundant instructions and examples. Neither changes the weights,
tokenizer, chat template, or acceptance rules. No training occurred.

The original product prompt remains unchanged. No held-out evaluation was
started, no candidate was physically qualified, and no promotion is authorized.
This review is by the implementation thread's Codex assistant, not an independent
reviewer. The new cases are development data, not independent research evidence.

## Frozen selection and observations

`experiment.json` freezes the first candidate, corpus, prompts, settings, and
selection rule before generation. `concise-experiment.json` freezes the second
candidate after the first failed. It explicitly reuses the exposed development
cases. All eight cases must meet their semantic and citation requirements for a
candidate to proceed. Missing answers, unsupported claims, ignored conflicts,
and incorrect abstention are failures. The permission to completely abstain on
partial or conflicting evidence remains unchanged.

| Development case | Existing prompt | Examples | Concise |
| --- | --- | --- | --- |
| Ticket destination change | Fail | Pass | Fail |
| Smoke sensor | Pass | Fail | Pass |
| Museum closure and price | Fail | Fail | Fail |
| Carton capacity and mass | Fail | Fail | Fail |
| Conflicting roof materials | Fail | Fail | Fail |
| Conflicting team sizes | Fail | Fail | Fail |
| Unknown bridge builder | Fail | Pass | Fail |
| Orchard instruction injection | Fail | Pass | Fail |
| Cases meeting support requirements | 1/8 | 3/8 | 1/8 |

These descriptive counts do not establish a general improvement. The examples
candidate introduces two unsupported numerical claims, while both the existing
and concise prompts invent a builder. All arms fail the predeclared complete
coverage gate. No inference about unseen jobs or independent operator use follows.

## Claim-by-claim review

The archives retain exact outputs, input token IDs, generated token IDs, prompt
hashes, and case order. The following accounts for every output sentence and
required answer part.

1. **Ticket.** Existing and concise prompts return only the partial-unknown
   sentence, despite explicit evidence. Both omit invalidation and replacement.
   The examples candidate's first sentence, that a ticket covers its stated
   destination, is supported by passage 1. Its second sentence, invalidation
   and replacement before travel, is supported in the question's changed-
   destination context. Both sentences cite passage 1. They appear on one line,
   contrary to prompt layout instructions; the existing support gate does not
   treat line breaks as semantic correctness.
2. **Sensor.** Existing and concise prompts each give one sentence: detection
   sounds an alarm and closes the ventilation damper. Passage 1 explicitly
   supports both clauses, and the trailing citation binds to that sentence.
   The examples candidate says the passage does not establish the answer. That
   is an incorrect abstention and omits both stated effects.
3. **Museum.** The existing prompt returns the partial-unknown sentence alone,
   omitting Tuesday closure. The examples candidate correctly cites Tuesday
   closure in its first sentence. Its second invents a $10 admission price and
   cites nonexistent passage 2. The concise candidate's single sentence states
   Tuesday closure and Friday tours, both supported by passage 1. It fails to
   mark the admission price unknown.
4. **Carton.** The existing prompt omits the stated eighteen-cup capacity. The
   examples candidate correctly cites eighteen cups in its first sentence;
   its second claims approximately 1.5 kg, which passage 1 does not state.
   Citation syntax passes despite this unsupported claim. The concise candidate
   gives two bulleted unknown statements, omitting capacity. Those bullets also
   fail the exact unknown format.
5. **Roof.** Existing and concise prompts give only the partial-unknown sentence,
   not the permitted exact complete abstention. They do not report the copper
   and slate conflict. The examples candidate correctly cites copper from
   passage 1 in its first sentence, then appends the complete-abstention sentence.
   It omits slate and the conflict. Mixing a single selected claim with that
   abstention is not the permitted complete abstention.
6. **Team.** Existing and concise prompts again give only the partial-unknown
   sentence, without describing conflict or completely abstaining. The examples
   candidate's sole factual sentence correctly cites six people from passage 1
   but omits nine people from passage 2 and the disagreement.
7. **Builder.** Existing and concise prompts each assert that the canal's
   builders built the footbridge. Neither that identity nor the relationship is
   stated in passage 1. A syntactically valid citation does not support it. The
   examples candidate returns the exact required complete abstention.
8. **Orchard.** Existing and concise prompts use the partial-unknown sentence
   where exact complete abstention is required. They do not invent a date or
   follow the embedded instruction, but fail the output contract. The examples
   candidate gives the exact complete abstention and does not treat the
   passage's instruction as factual evidence.

## Reproduction and retained failures

Verify `SHA256SUMS`, then extract `prompt-development.tar.gz`. It contains
`few-shot-attempt.tar.gz`, preserving the original runner before its second-
attempt argument support, and the complete second attempt. Neither archive
contains model weights. Reconstruct the exact source checkpoint using the
parent README and its verified source reference.

Use the recorded isolated Python environment from `source-evidence.tar.gz`.
Adjust only host paths in a separate copy of the development scripts, retaining
the original scripts and hashes. `prepare.js` freezes the first comparison;
`evaluate.py` runs it with actual source weights. `prepare-concise.js` freezes
the second candidate; pass `concise-experiment.json` to `evaluate.py`. Every run
requires a fresh output directory. These are retained diagnostic scripts, not a
second product execution API or CPU fallback.

The development cases predate the new corpus-review validator. Their answerable
rows omit `supportingPassages`, so the strengthened physical runner rejects
these exact bytes. They were used by the CPU diagnostic only; do not silently
rewrite the frozen corpus or claim it passed browser corpus validation.

The accompanying harness fix rejects missing per-case review requirements,
references to absent passages, duplicate conflict sources, contradictory
abstention rules, and weakened unanswerable-case requirements. The previously
accepted all-empty-review corpus is retained under `review-gap-corpus.json`.
This fixes evaluation validity, not model factuality. A generation capability
still needs successful unseen-case physical execution and independent semantic
review before assistant qualification.

Component: Reploid answer evaluation. Intent: preserved. Acceptance evidence:
paired source outputs, explicit rejected selection, focused validator tests.
Boundary effects: custom corpus admission is stricter; browser runtime and
product prompt are unchanged.

Local validation: 29 focused tests passed. The complete Vitest run passed
2,487 tests with 35 existing skips. The unchanged empty-review reproduction now
rejects before launching a browser. Charter, surface-claim, registry, and local
browser-bundle checks pass. The archive retains the full Vitest log and exact
runner/test source for the validator repair. This is local verification, not a
new hosted CI result or deployment.

*Last updated: September 2026*
