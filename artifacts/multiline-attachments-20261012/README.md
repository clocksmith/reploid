# Complete attached questions in the transcript

Component: conversation presentation and document-source projection.
Intent: preserved. Boundary effects: readable question projection and export;
inference inputs, permissions, model and execution contracts are unchanged.

Attached messages previously rendered only the first line of the question.
The document parser now separates the exact generated instruction suffix from
the complete user question; the renderer escapes and displays every line.
Older saved serialized messages use the same parser. It does not mutate history.

Two focused regressions fail before the repair (`before.log.gz`). Sixteen tests
then pass, including inert HTML and complete multiline export. Both a serialized
ordinary attachment and the existing comparison sample are byte-identical before
and after the refactor; `unchanged-inputs.json` retains their complete bytes and
hashes. This repair cannot explain or cure the retained model-answer failures.

Twelve Chromium conversation/layout checks pass. The existing host/attachment
browser case additionally now asserts every question line before and after reload
(`browser-regression.log.gz`). Execution in these browser fixtures is injected,
not physical inference. The actual Verification Worker passes both changed
modules, with three warnings and no errors (`worker.json`). The generated
1,905-file browser manifest verifies as
`13f20122b9510e27d1aa87847259b8bb7c78e05ff05e3878479162e868ee69c0`.
No deployment or dependency update occurred.

The actual local requester then reloaded this bundle. All 17 saved threads and
drafts were byte-identical across the reload (`actual-requester-return.json`).
This check performed no inference. Hosting preparation copied 1,906 files; fresh
HTTP verification matched every one of the 1,905 manifest entries against the
same bundle identity (`hosting.log`, `served-local.log`). This is localhost
verification, not public deployment.
