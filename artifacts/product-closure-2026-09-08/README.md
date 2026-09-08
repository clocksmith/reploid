# Product closure observations, September 8

Verify `SHA256SUMS` before extracting `evidence.tar.gz` into a new directory. The archive preserves Apple answer runs 04–06, the incoming prompt experiment, the rejected shorter prompt, and the deployed release run including its failed quorum lane. It includes raw outputs, token IDs, configuration, signed Capsule identity, captured runtime sources, and original receipts. It contains no model weights. The original signed Capsule can be restored using the earlier [restoration evidence](../../docs/status/document-answer-evidence-2026-09-07/README.md).

The local generation candidate is **not** the npm-published 0.6.0 artifact, despite retaining that source version label. Its package digest is in `doppler-generation-consumer-bytes.json`; all 1,783 installed files matched. Publication requires a new immutable version. Do not substitute this archive for registry qualification.

## Development answer review

This review is by the implementation assistant. These eight cases are exposed development data, not a holdout. The separate reviewer corpus was not opened. Support, requested-part completeness, conflicts, and permitted complete abstention retain the existing acceptance rules. A syntactically cited sentence can still fail.

| Case | Retained answers-06 | Incoming prompt | Shorter prompt |
| --- | --- | --- | --- |
| Replay | Fail: says a repeated request stores the result; omits returning the stored result without execution. | Fail: no recomputation is supported but uncited; both subsequent lack-of-evidence assertions conflict with the supplied evidence; returning the saved result is omitted. | Fail: uncited no-recomputation claim, followed by the meaningless example text “A supported fact.” |
| Consent | Pass: invalidation and renewed preview/approval are supported and cited. | Pass: invalidation and renewed preview/approval are supported and cited. | Fail: missing-information response despite explicit evidence. |
| Deadline | Fail: deadline is cited; cancellation sentence is supported but uncited; unknown throughput is omitted. | Fail: deadline and cancellation sentences are uncited; full-abstention wording follows factual claims instead of marking the missing throughput part. | Fail: example text cites nonexistent passage 2; deadline is uncited; unknown statement cannot repair those failures. |
| Storage | Fail: cache checking is supported and cited, but storage location is omitted. | Fail: unknown statement plus complete-abstention wording omits supported storage location and is not a permitted standalone complete abstention. | Fail: unknown-only output omits known location. |
| Port conflict | Fail: chooses 8000 and ignores the second passage. | Fail: both numerical alternatives are individually supported and cited, but disagreement is not explicitly identified as required. | Fail: example text answers nothing. |
| Retention conflict | Pass under permitted complete abstention; no useful resolution claimed. | Fail: chooses thirty days and ignores seven days. | Fail: unknown-only wording is not the required complete abstention or a conflict answer. |
| Unknown author | Pass: exact complete abstention. | Fail: irrelevant identification/signature facts precede abstention and lack citations. | Fail: irrelevant protocol facts; first sentence lacks its citation. |
| Unknown adapter quality | Pass: exact complete abstention. | Fail: irrelevant size/execution facts lack citations and precede two absence-of-evidence statements. | Fail: partial-unknown wording alone is not complete abstention. |

The retained “7/8” observation therefore means seven syntax acceptances, with **4/8** meeting this development review. The incoming prompt meets **1/8** and the shorter prompt **0/8**. Neither newer experiment is promoted. These counts are not production failure-rate estimates.

## Deployment and rendering evidence

Reploid source `d1ba8ddc` is live. Eight of nine physical release lanes passed. The final quorum lane failed fetching a GCS shard with Chromium `ERR_QUIC_PROTOCOL_ERROR.QUIC_TOO_MANY_RTOS`. `release-failure/release-evidence.json` is the untouched original; `release-evidence-complete-failure.json` additionally captures the failed lane after repairing the recorder. Both remain failed and promotion-ineligible. No automatic retry concealed the failure.

Simulatte source `67406eb2` is live on World and Create. The GPU readback probe proves a three-dimensional box casts shadows onto opposite ground samples as sun direction reverses, and disables them below the horizon. Mobile preview initially missed the frame-stall threshold during concurrent work; an isolated rerun passed unchanged thresholds. The live desktop journey passed. These are modeled rendering observations, not human-review evidence.

Mandate source `adc44efe`, executable 0.20.2, is live. Both viewport journeys started games; all thirteen links returned 200, and private lore paths returned 404. This is browser evidence, not human playtesting.

Component: release verification, answer qualification, and deployed drawing.
Intent: preserved.
Acceptance evidence: hashed archive and adjacent reports.
Boundary effects: runtime cancellation UI, evidence capture, Sun Walker rendering, package validation, and hosting; independent operation and semantic qualification remain unproven.

Doppler source `a44933e0` passed the full `ci:check`, including all 797 unit-test files. `doppler-ci.log.gz` retains the complete run; `doppler-ci.json` states its scope. Npm publisher identity still returned HTTP 401 afterward.
