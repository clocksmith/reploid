# Conversation usability handoff

The agents are stopped at the user's request. This is a pushed implementation
checkpoint, not final usability, inference, or deployment acceptance.

The UI removes duplicate settings Network access, reduces the execution ribbon
to status with details in the existing inspector, moves archived threads into
conversation Actions, bounds transcript width, and adds empty-state guidance.
Existing model choice, phone thread drawer, drafts and authorization remain.
The initialization binding tolerates removal of the duplicate Network button.

## Validation

- Focused Vitest: 50 tests pass across conversation-workspace, execution-ribbon
  and pool-home-nav.
- `npm run verify:pool:css` passes.
- The initial browser-manifest check failed as stale. Regeneration and
  `npm run verify:browser-bundle:local` pass for 1,904 files, identity
  `sha256:a3ace00ed08d10ed8423d4e102f499095634b1060b965a212abd7cfcffb58703`.
- `REPLOID_E2E_BASE_URL=http://localhost:8017 REPLOID_E2E_CHROMIUM_CHANNEL=chrome npx playwright test --config tests/playwright.config.js tests/e2e/chat-material.spec.js --project=chromium --reporter=list`
  passes all 11 interaction cases. These use presentation fixtures, not model
  inference. Both themes, 320/390/1440 widths, declared states, drafts, source
  navigation, long answers and simulated keyboard viewport changes are covered.
- The actual browser Verification Worker accepts shell-view, conversation-workspace,
  execution-ribbon, message-list and index: five files, zero errors, twelve
  warnings. This is static worker analysis, not execution or security qualification.
- `git diff --check` passes. Full repository tests were not rerun for this checkpoint.

## Remaining

Visual inspection of the retained phone empty-state screenshot finds unavailable
model guidance squeezed into a narrow column beside Send and Retry connection.
Fix that layout before approving the phone experience. Actions remains beside
the composer; reassess its placement against the requested conversation hierarchy.
Complete visual review of every state, real phone keyboard behavior, unfamiliar
user journeys, repository checks and final product acceptance. Screenshots remain
under local `test-results/`; they are interaction evidence only.

The standard Doppler 0.6.27 dependency is unchanged. Numerical reference
disposition, useful answers, signed physical execution, both placements and
release acceptance remain open. No deployment occurred.

Component: Reploid Product Interface. Intent: preserved.
Acceptance evidence: scoped checks above. Boundary effects: presentation and
generated browser identity only; no host, computation or permission changes.

*Last updated: October 2026*
