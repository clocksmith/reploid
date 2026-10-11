# Phone conversation guidance and Actions

Component: Reploid Product Interface. Intent: preserved.
Boundary effects: presentation, its browser tests, generated browser identity,
and canonical tracking only. Doppler's accepted archive is unchanged.

## Cause and repair

The unavailable-model message occupied the same non-wrapping flex row as
fixed-width Send and Retry buttons. At 320px the message shrank to 12.375px
inside a 254px composer. The strengthened existing browser check failed before
the repair; [before](before-320.png) preserves the observed failure.

The guidance now occupies its own full-width form row above the toolbar.
Conversation Actions moved into the header, with its menu opening downward;
archive/export handlers and Escape/focus return are preserved. Mobile header
rows keep model choice and Actions reachable. Removed an obsolete mobile rule
that forced Send/Stop onto a separate row even when it fit beside Attach.
At narrow unavailable states, the extra Retry control can wrap without shrinking
the guidance. [After](after-320.png) and [streaming](streaming-390.png) show the
local fixture result.

## Acceptance

- Fifty focused unit tests pass: conversation workspace, execution ribbon and navigation.
- Twelve Chromium tests pass, including the actual Verification Worker.
- Repository suite: 3,082 tests pass; 29 existing skips remain.
- CSS layering, generated browser manifest verification and diff whitespace checks pass.
- Both themes and 320/390/1440px layouts cover empty, unavailable, preparing,
  queued/loading, streaming, permission, interrupted and completed states.
  Existing scenarios exercise drafts, sources, code, long messages, stop,
  Actions dismissal/focus return, phone drawer and simulated keyboard viewports.
- New geometry assertions require full-width guidance above the buttons,
  Attach/Stop on one row, and an onscreen header Actions menu.

The first worker-test harness fetched the repository path rather than the served
URL and received 404. Its [failure log](worker-harness-failure.log) is retained;
correcting the URL and using the existing VERIFY message shape passes. No
application error was hidden or acceptance threshold relaxed.

Commands from the repository root:

```sh
npx vitest run --config tests/vitest.config.js tests/unit/conversation-workspace.test.js tests/unit/execution-ribbon.test.js tests/unit/pool-home-nav.test.js
REPLOID_E2E_BASE_URL=http://localhost:8027 REPLOID_E2E_CHROMIUM_CHANNEL=chrome npx playwright test --config tests/playwright.config.js tests/e2e/chat-material.spec.js --project=chromium --reporter=list
npm test
npm run verify:pool:css
npm run build:browser-bundle
npm run verify:browser-bundle:local
```

[Receipt](receipt.json) binds the generated browser and accepted package identities,
retained logs, and representative screenshots. Playwright's owned local server
and browser closed after the run. No existing remote session was used.

## Limits and next work

These are simulated conversation states and local browser/repository checks,
not physical distributed inference, a real phone keyboard, or unfamiliar-user
observation. Those product checks and release gates stay open in
[REP-7](../../TODO.md#rep-7). No deployment occurred. The numerical-reference and
ordered-message model-quality handoffs are recorded under DOP-6 and DR-5;
the stopped Doppler/Doe owners were not restarted.
