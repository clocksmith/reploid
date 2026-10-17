# Reploid clean-checkout CI repair — 2026-10-17

The clean hosted Smoke run for **a11f27dc** completed successfully:
[run 39062768402](https://github.com/clocksmith/reploid/actions/runs/39062768402).
[Exact job steps](ci-a11f27dc.json) and [full hosted log](hosted-a11f27dc.log.gz)
retain source identity and results. This closes the previously unexecuted hosted
smoke steps for this source, without rewriting earlier failed runs.

| Check | Hosted result |
| --- | --- |
| Dependency installation | Passed |
| Lint | Passed |
| Unit/integration | 431 files passed, 5 skipped; 4592 tests passed, 36 skipped |
| Chromium installation | Passed |
| Installed package smoke | Passed |
| Browser boot smoke | 3 passed |

The five skipped files/36 skipped tests remain skipped, not qualified. Heavy,
physical GPU, answer-quality, public service and deployment acceptance are not
established by Smoke. The failure-artifact upload step was skipped because the
job succeeded; this is not an omitted verification check.

## Repairs and local evidence

- Browser/native transport fixtures now implement message registration/removal
  and initialize transport during mesh connection. Product-session fixtures
  include cached-model sharing. Actual authentication, identity mismatch and
  cleanup assertions remain exercised.
- Remote request tests use automatic exact-route authorization under the network
  preference. Explicit network-off rejects before disclosure; disabling it does
  not erase already admitted work, and Stop still waits for settlement.
- Runtime fixtures use public package specifiers, while the real composed-browser
  opener check resolves the actual pinned version. Hosting's synthetic archive
  includes the browser training entrypoint; tampered-byte rejection is unchanged.
- The ordered queue test waits for downstream reservations, rather than assuming
  tokenization means every stage has already reserved capacity.
- Large cached models advertise a bounded subset. A controlled four-file limit
  admits three metadata files and one of two cached pieces, performs no download,
  and preserves the unadvertised piece. The obsolete all-pieces-in-one-message
  catalog assertion was replaced with this consumer behavior check.
- Default-off orchestration tests check absence of optional orchestration state
  and exercise route retention instead of rejecting new readiness fields.

Local failure receipts are retained: the first full run had 34 failed tests and
8 unhandled errors; after fixture repairs, a second had one acknowledgment timing
failure. It incorrectly compared residual queue wait with a deadline that starts
before signing/output work. **70768396** tests elapsed execution against that
deadline and still requires actual waiting, bounded unacknowledged output,
ACKNOWLEDGMENT_OVERDUE, signed settlement and unchanged ledger outcomes. Its
focused 22-test suite passed. The [subsequent hosted run](https://github.com/clocksmith/reploid/actions/runs/39062953272)
also completed successfully at 70768396, reaching every Smoke check; its
[exact job steps](ci-70768396.json) record that source separately.

Compressed local logs in this directory retain each focused repair and both
full-suite outcomes. The successful clean hosted result supersedes the open
smoke status in the earlier [connection journey](../connection-journey-20261017/README.md),
while its physical evidence and limitations remain unchanged.

Next: complete the physical search service journey, retain timeout/usefulness
failures, and verify provider replacement separately from same-identity reconnect.
No telemetry, runtime policy, allowance, acceptance threshold or deployment was
changed by these test repairs.

Component: verification evidence. Intent: preserved. Acceptance evidence:
identified hosted Smoke run plus scoped local tests. Boundary effects: none.
