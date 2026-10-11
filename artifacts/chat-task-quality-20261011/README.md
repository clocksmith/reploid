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

## Formatting instruction and existing larger model

A separate six-task holdout was frozen in `bc0c0959` before testing a general
formatting instruction, with sampling unchanged at repetition penalty 1.1. Both
variants fail the ascending-list and duplicate-layout requirements; the proposed
instruction is rejected. `instruction-linux.json.gz` retains exact results.

The already-integrated 2B model was then tested on six additional fresh tasks,
frozen in `9639f225`. `model-2b-linux.json.gz` passes every exact-text and EOS check
using the existing application generation policy. No application setting or model
catalog entry changed. This supports further application testing of the existing
2B model; it does not establish complete answers to every request or close
distributed lifecycle, numerical, capacity or deployment acceptance.

Both additional runs use the existing fixture runner with a second argument
selecting `chat-task-quality-instruction.json` or `chat-task-quality-2b.json`.
The model directory must match the suite's catalog identity.

## Retained counting request: larger model still fails

After the fresh-task pass, the unchanged count-to-200 request was replayed
through the existing 2B model with the application settings. It emits 1 through
120 and then EOS (372 tokens), omitting 121 through 200.
`counting-2b-linux.json.gz` preserves this failure. The larger model therefore
does not yet close the original task-quality requirement.

The existing two-host cancellation test checked only EOS for the surviving
count-to-200 conversation. It now also checks that every requested number is
present in order. The task oracle accepts digits or ordinary written numbers
and rejects omissions, duplicates, reordering, extra values, summaries and
comma-separated lists. Four focused tests and JavaScript syntax checks pass.
The currently running physical attempt predates this stronger assertion; any
result from it must be assessed against the retained answer as well as EOS.

## Separate 2B neutral-penalty holdout

Frozen suite `ab79b8a3` tests six additional fresh tasks on the existing 2B
model. Both the unchanged 1.1 policy and candidate 1.0 policy pass all exact-text
and model-EOS checks. `neutral-2b-linux.json.gz` retains outputs and identities.
This does not reverse the rejected 0.8B candidate. The original count-to-200
request will now be replayed against the 2B candidate without changing the
protected request, expected output or production profile.

The neutral 2B candidate also emits only 1 through 120 and EOS on the original
counting request. `counting-neutral-2b-linux.json.gz` preserves its rejection.
Passing short fresh tasks did not establish completion of this longer request.
Production generation remains unchanged.
