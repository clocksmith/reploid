# Sentence-level citation contract candidate

The product prompt now requests one supported claim per cited sentence, all
supported parts of a question, an explicit statement for missing information,
and separately cited conflicting answers with explicit disagreement. Partial
answers can use the passage that actually supports the claim. The inspector,
acceptance corpus, unknown and abstention strings, raw-generation storage, and
runtime are unchanged. No application formatter or answer-state subsystem was
added.

[Candidate status](candidate-status.json) records the exact source hashes and
observed local checks. The 45 focused tests and browser Verification Worker
pass. These checks exercise contracts and injected outputs; they do not prove
the model follows the repaired prompt. Milestone 1 remains incomplete.

The reported tested pair is Doppler `b47d1f5d` and Reploid `c27298c2`.
The user inspected these revisions, not physical evaluations; this is not
user-certified passing evidence.
The working copy starts from later revisions. The raw 7/8 run and its full
model/adapter, prompt, sampling, and runtime configuration have not been located
locally. Older archived answer runs cannot supply that missing identity. The
installed Doppler package is 0.6.0; its version label alone cannot bind it to
the reported tested source revision. No generation configuration is frozen and
no untouched evaluation has run.

Subsequent [shared generation-contract work](../generation-contract-2026-09-08/README.md)
has its own package and source-byte receipt. It does not update this historical
prompt-only snapshot or certify the reported development answers.

The separate agent reviewer owns `reviewer/`. Its untouched corpus and rubric
must remain outside implementation review until the candidate is frozen.
The evaluator receives question, passages, raw answer, and frozen acceptance
only. Remove prompt, model, runtime, sampling, source revision, case category,
inspector status, and configuration-revealing paths from the blinded packet.
Keep the packet-to-run mapping separately and disclose it after the review is
sealed. Preserve original output bytes and bind the packet to them by digest.
Report every sentence's support, requested-part completeness, conflicts,
unknowns, and permitted complete abstentions; report usefulness separately.
Agent review does not establish human review or independent operator adoption.

After qualification, the [roadmap](../../docs/status/execution-roadmap-2026-09-07.md)
uses the same frozen model and adapter for missing-byte acquisition,
compatibility verification, approved execution, persisted completion,
connection loss or restart, saved-outcome replay, and ownership reversal.
Measure actual Doppler execution calls and transferred base/adapter bytes.
Privacy extends that same setup; four-machine acquisition follows. Adapter
usefulness and startup reliability each retain their own experiment.

Component: Poolday evidence runtime and verification evidence.
Intent: preserved; user-directed execution sequencing updated.
Acceptance evidence: commands and source identities in `candidate-status.json`.
Boundary effects: generation prompt and its generated browser byte inventory;
no runtime, release, deployment, or model qualification claim.

*Last updated: September 2026*
