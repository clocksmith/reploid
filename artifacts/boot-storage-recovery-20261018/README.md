# Storage-denied boot recovery

Both public entry shells wrote a same-build `reploidBootRetry` URL marker but
read only sessionStorage to decide whether recovery had already run. If storage
access threw and the product bundle failed, each navigation started another
recovery. The user never reached the terminal error.

Both shells now recognize the existing URL marker before consulting optional
storage. Success still clears recovery state. No timeout, model, startup route,
or application initialization policy changed.

The two new browser regressions deny sessionStorage and return 503 for the
product bundle. Both [failed before the fix](before.log). After the fix, they
reach the terminal error after exactly two bundle requests. Together with
existing stalled-import, bounded-initialization, transient-recovery and terminal
failure tests, [eight focused checks passed](after.log). Fourteen existing shell
unit tests also passed. The browser byte manifest was regenerated and checked.

```sh
REPLOID_E2E_CHROMIUM_CHANNEL=chrome npx playwright test --config tests/playwright.config.js tests/e2e/boot.spec.js --project=chromium --grep 'recovery when session storage|opens public-route history|bounds public-route initialization|recovers once from a transient public-route module failure|stops after one public-route recovery' --reporter=line
npx vitest run --config tests/vitest.config.js tests/unit/self-boot-shell.test.js
node scripts/build-browser-bundle-manifest.js --check
```

An additional [Verification Worker attempt](inline-worker-attempt.log) extracted
inline HTML scripts under synthetic `.js` names. It rejected existing direct
storage accesses. That mapping is not the worker's actual-file contract (HTML
is excluded), so the attempted test was removed rather than changing permissions
or disguising these scripts as privileged modules. No worker pass is claimed;
the executable HTML evidence is the browser regression above.

This establishes one concrete recovery defect and its repair. It does not
establish that storage denial caused the retained intermittent live boot timeout.
That timeout remains open. No deployment, full CI, or full conversation-journey
qualification occurred.

Component: browser entry and verification. Intent preserved. Boundary effects:
none; optional-storage failure now respects the existing one-retry policy.
