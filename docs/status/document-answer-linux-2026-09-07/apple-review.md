# Review of retained Apple answers

Reviewer: the implementation thread's Codex assistant. This is an attributed
diagnostic review, not an independent evaluator or operator qualification.
Original outputs and source passages remain unchanged in the
[transferred archive](../document-answer-evidence-2026-09-07/README.md).

## Identity and comparison boundary

Both runs use Capsule byte digest
`sha256:9053b0c5177867722c5e45cb14ae50bd5ee8b88cbcf797cd63dd0850660f9ed4`
and corpus digest
`sha256:5e47defdbc6a20ce3e3cf232328eb4f5901ba6d4102a4e77bd61e8652c9c1764`.

Execution report byte digests:

- `answers-02/execution.json`:
  `sha256:a4f86f61257470a71d16c5b6f1ca04399a75dbe55fd800651c559d5bd71b6f73`.
- `answers-03/execution.json`:
  `sha256:5992b11cdcff073f9d90e6bebc916765bb2bde2d5883dff0dca4face9dcab5d5`.

Every case has different prompt bytes between runs. Generation settings are
equal. The prompt module and answer policy also changed between runs. These
observations cannot establish nondeterminism under identical inputs. Current
Reploid prompt and policy hashes match the served sources in `answers-03`:

- `document-answer.js`:
  `sha256:7e240827d71514097279c5b8e1df6e1af1d7bf82eb4df7da4aa4b2e5d3fa507b`.
- `document-search-policy.json`:
  `sha256:7c66edde8fe36c6e573602304ed2d78bab307d1af8514b493550d28ecfe465d3`.

The reviews below distinguish factual support, completeness, and format. A
format failure does not itself prove a false statement. An omission is not a
fabrication. A supported sentence does not make the complete answer adequate.
The corpus permits complete abstention for partial and contradictory cases;
that permission remains intact. No aggregate qualification score is assigned.

## answers-02

| Case | Review of every assertion and remaining gap |
| --- | --- |
| `answerable-replay` | The assertion that the completed attempt does not rerun the model and retrieves the stored result is supported by passage `worker`. The same sentence adds retrieval of the execution receipt: the passage says the receipt is stored, but explicitly promises return only of the stored result. That additional retrieval assertion is not fully established. `[1]` identifies the correct passage. |
| `answerable-consent` | The first sentence requires invalidation and a new preview and approval before transmission. The latter requirement is supported by `consent`, but the pronoun "it" does not clearly identify the old approval as the invalidated object. The separate sentence "This is supported by [1]" identifies the relevant passage without attaching a reference to the first sentence. Preserve the ambiguity and the citation-format defect separately. |
| `partial-deadline` | The 30-second deadline is supported by `limits` and `[1]`. The assertion of 100 requests per second is absent from the passage. Its `[2]` reference names a nonexistent passage. Throughput must remain unknown. This is unsupported factual content, not merely a citation-format defect. |
| `partial-storage` | The first sentence correctly identifies the browser's origin-private file system and cites `cache`. The second sentence repeats the disk-space question and makes no factual assertion. The last sentence explicitly declines to answer for lack of evidence. No disk-capacity guarantee is fabricated; the supplied location is useful. The question echo and mixed answer/full-abstention format remain defects, distinct from factual support. |
| `contradiction-port` | The sole assertion, port 8000, is supported by `guide-a` in isolation. It omits `guide-b`'s port 8080 and presents one answer without the required disagreement. No evidence makes one guide authoritative. |
| `contradiction-retention` | Seven-day retention is supported by `policy-a` in isolation. The following insufficiency statement is not a fabricated fact, but neither reports `policy-b`'s thirty days nor describes the disagreement. This mixed answer is not complete abstention. |
| `unanswerable-author` | Exact complete abstention. No author or other factual claim is invented. The passage supplies no author. |
| `unanswerable-quality` | Exact complete abstention. No accuracy improvement is invented. Adapter size and successful loading do not establish quality. |

## answers-03

| Case | Review of every assertion and remaining gap |
| --- | --- |
| `answerable-replay` | The single no-rerun assertion is supported by `worker` and `[1]`. It omits the other requested behavior: returning the stored result. This is incomplete, not fabricated. |
| `answerable-consent` | New preview and approval before transmission are supported by `consent`. "The task text must be changed" turns a condition in the question into an unconditional requirement absent from the passage. The answer also omits invalidation of the earlier approval. `[1]` cannot support the whole sentence. |
| `partial-deadline` | The first sentence's 30-second deadline is supported and cites `limits`. The second sentence's cancellation behavior is also explicitly supported by that passage, but lacks its own citation. Neither sentence addresses the unknown requests-per-second quantity. Citation coverage and question completeness fail without a fabricated throughput number. |
| `partial-storage` | The answer contains only the partial-unknown phrase. It invents no capacity, but omits the known storage location and does not use the exact complete-abstention sentence allowed by the corpus. It cannot establish a useful complete answer. |
| `contradiction-port` | Port 8000 and port 8080 are each accurately stated with their respective passages. Both claims are supported. The answer does not explicitly identify the disagreement as required by the prompt and corpus. This is a conflict-reporting defect, not unsupported numerical content. |
| `contradiction-retention` | The assertion that `[1]` and `[2]` conflict is supported by their incompatible retention values. The following unknown phrase invents no fact. However, the answer never states either retention duration, so it does not answer the requested "how long" or satisfy the prompt's instruction to state both answers. Do not misclassify the conflict assertion as unsupported. |
| `unanswerable-author` | "The protocol was originally written by [1]" supplies no author and uses a citation as the missing answer. Passage `protocol` does not establish authorship. Required complete abstention is absent. A syntactically present reference is not semantic support. |
| `unanswerable-quality` | The partial-unknown phrase correctly avoids inventing an accuracy gain, but is not the required exact complete-abstention response. This is a response-contract failure, not a false accuracy measurement. |

## Consequence for the next experiment

Neither run establishes assistant qualification. The eight exposed cases are
diagnostic cases, not an untouched holdout. Reproduce the exact Capsule and
current prompt before attributing failures to hardware or model computation.
Any repair still needs an independent source/runtime comparison where numerical
behavior is in question, frozen semantic acceptance, and untouched task cases.
Do not weaken the citation, unknown-value, or contradiction requirements.

Component: document-answer qualification evidence.
Intent: preserved.
Acceptance evidence: byte-bound original reports, all sixteen outputs and their
supplied passages reviewed above, and exact prompt/policy comparison.
Boundary effects: no runtime, model, deployment, or promotion changes; this
diagnostic review cannot self-authorize reusable evidence or qualification.

*Last updated: September 2026*
