# Model-imitation plugin: local development evidence

Component: shared plugin sessions, browser host and first built-in study.
Intent: deliberately adds research/game composition; existing chat and model
execution boundaries are preserved. Boundary effects: `reploid/plugins` and
`/experiments`, using existing whole-request contributor inference.

## Passed

- 36 focused tests across plugin-session, model-imitation-plugin,
  research-plugin-host, research-plugin-ui and pool-home-nav.
- Browser flow with **injected responses**: setup, pending work, cancellation,
  18 sequential calls, blind judging, fixed follow-ups, four judgments and
  restoration without replay. Twenty desktop/mobile, light/dark captures had
  no horizontal overflow or page errors; four representative captures retained.
- Verification Worker: seven runtime files, no errors. Warnings are retained
  in `verification.json`; this is static verification, not execution proof.
- Isolated browser build, library types, CSS layers and generated charter index.

The browser fixture used Chrome with `--disable-gpu` for stable UI captures.
It does not validate WebGPU, physical inference, timing or research findings.
All fixture judgments were `unsure`; they are not human evaluations.

Reproduce from the repository, with a local server running:

```sh
npx vitest run --config tests/vitest.config.js tests/unit/plugin-session.test.js tests/unit/model-imitation-plugin.test.js tests/unit/research-plugin-host.test.js tests/unit/research-plugin-ui.test.js tests/unit/pool-home-nav.test.js
REPLOID_UI_BASE_URL=http://127.0.0.1:8000 node tests/e2e/research-plugin-smoke.js
```

## Live integration remains unconfirmed

The initial real-provider attempt reached its first calibration call's
120-second deadline. That attempt did not retain a complete export, so its
underlying failure is not localized. Subsequent isolated-browser attempts did
not discover both selected providers within 60 and 120 seconds respectively;
`live-discovery-failure.json` preserves the latter failure.

A separate read-only inspection found AMD's 0.8B, 2B and whole-model 27B systemd
services active, while the browser's snapshot contained only a Mac 0.8B provider
and four consumers. A later fresh browser discovered all three models
(`live-setup.json`), confirming that discovery was intermittent in these checks.

The last bounded run completed its first real 0.8B calibration in 4,485 ms,
returning `13 + 28 = 41` through the Mac contributor. The second calibration
reached its 120-second deadline before a disclosure preview was recorded.
`live-partial-study.json` retains the frozen protocol, first response, permission
observations and cancelled second request. It does not distinguish waiting for
capacity from waiting for recipient identity verification, and it contains no
27B response. No retry or replacement answer was inserted.

An active service is not proof of reachability from this browser.
No provider was stopped or restarted for this work. There is no complete
real-model study, performance improvement, public deployment or scientific result
claimed by this evidence.
