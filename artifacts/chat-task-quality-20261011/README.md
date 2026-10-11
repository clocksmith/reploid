# Fresh chat task-quality control

Component: `reploid.tests`. Intent: preserved. Boundary effects: none.

The suite was frozen in `3bd8667c` before execution. It tests one proposed
application change: neutral repetition penalty 1 instead of 1.1. All other
generation settings, model bytes and installed Doppler delivery remain unchanged.
Six fresh tasks cover ascending and descending lists, duplicate preservation,
literal amounts, negation and arithmetic. Acceptance requires exact text after
whitespace normalization and natural completion.

Both variants pass three of six cases. Both fail all three list-format cases by
using commas where line-separated output was requested. Both terminate with the
model EOS token. The candidate is rejected; no production setting changes. The
original count-to-200 failure and protected numerical cases remain unchanged.

`linux-eos-verified.json.gz` records the final run, all outputs, actual generation
settings, stop-token identities, model and archive hashes. `linux.json.gz` retains
the preceding run, before EOS membership verification was added to the grader.
The initial harness read the wrong evidence fields and failed before grading;
`initial-harness-failure.json.gz` preserves that exception. The correction reads
`outputText` and `stats.stopReason` from the installed API and verifies the actual
stop token against the pinned manifest's EOS IDs.

This is an unsplit diagnostic with a 6,000,000,000-byte buffer ceiling. It does
not establish distributed capacity, numerical qualification or application
release acceptance. Repository-wide and two-host tests were not rerun for this
test-only comparison. JavaScript syntax and diff checks pass.

```bash
DOPPLER_CHAT_MODEL_DIR=/path/to/qwen-3-5-0-8b-q4k-ehaf16 \
  node tests/fixtures/chat-task-quality-control.js /path/to/report.json
```

*Last updated: October 2026*
