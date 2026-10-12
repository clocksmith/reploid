# Optional conversation context

Component: conversation workspace, browser host context policy and existing Actions UI.
Intent: preserved. The application owns its optional prompt; Doppler still applies the selected model template and executes generation.

The 16-word base is: “You assist in Reploid. Inference may use authorized peers. Never invent model identity or execution details.” Higher caps add metadata guidance and identity-bound model details only when they fit.

The new setting is off by default. Enabling starts with a 16-word cap; 32 and 64 are also available. The cap covers all generated application context, including model metadata. It never limits reply length or truncates the separate user-authored conversation purpose. The preview shows the exact text and count. Model metadata requires exact model ID and identity in the host catalog; execution mode is omitted because selected capacity alone does not verify actual execution.

The thread stores the policy and resulting text. Sending includes it in the exact ordered messages used for disclosure/execution. Each attempt snapshots the context, and Retry reuses the original request even after the idle thread setting changes. An active or closed thread cannot change context. Failed persistence rolls back the choice. Existing threads remain off, and settings in another conversation do not change their snapshot.

Validation:

- `npx vitest run --config tests/vitest.config.js tests/unit/chat-context.test.js tests/unit/chat-workspace.test.js tests/unit/chat-session.test.js tests/unit/conversation-workspace.test.js --maxWorkers=2`: 58 tests pass. Includes exact approval payload, ordered system/user messages, purpose preservation, persistence, retry, failure rollback and UI control state.
- `REPLOID_E2E_BASE_URL=http://localhost:8426 npx playwright test --config tests/playwright.config.js tests/e2e/chat-context.spec.js --project=chromium-swiftshader --reporter=list --output=artifacts/chat-context-20261013/browser`: desktop 1440px and phone 320px both pass. These are presentation tests, with no model inference. [Phone screenshot](browser/chat-context-optional-context-controls-at-320px-chromium-swiftshader/context-320.png).
- `npm run verify:library-types`, `npm run verify:library-delivery`, `npm run verify:pool:css`, `npm run verify:browser-bundle:local`: pass.
- `node artifacts/chat-context-20261013/verify-worker.mjs`: actual Verification Worker static/AST sandbox, four served modules, no errors and ten warnings. Exact source hashes and warnings are in [receipt](verification-worker.json).

Initial command without the repository Vitest config failed UI tests because no DOM environment was selected. The correctly configured run passed. The first new test also asserted busy controls before asynchronous submit reached execution; it now observes the actual running state and verifies controls are disabled then. Neither issue is hidden as an application pass.

Boundary effects: one optional generic `systemContext` field/setter in the chat library; host policy/preview; exact message assembly. No runtime pin, template, generation budget, contribution permission or deployment change. This is not evidence that the context improves model quality; numerical, factual and complete physical release gates remain open.
