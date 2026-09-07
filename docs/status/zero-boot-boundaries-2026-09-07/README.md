# Zero boot boundary repair

Source baseline: `5f36441dbf209da6e34991a50bf71362b6634a92`, with uncommitted
Poolday, answer-evaluation, and Zero changes preserved. Nothing is deployed by
this observation.

## Reproduced and repaired

Zero's Awaken preparation skips full hydration for its managed-proxy seed but
previously requested mirrors from the full manifest. A fresh Chromium browser
with the original `self/ui/zero-home/index.js` reproduced 73 missing-source
warnings. The repaired real-button journey requests only selected seed sources,
emits no missing-source warnings, and verifies identical source/mirror bytes for
`/ui/zero/index.js`. Its runtime handoff is explicitly stubbed; it makes no
provider request. Full-hydration and local-Doppler selections retain their full
mirror scope.

`self/config/zero-inference.js` now reads the same-origin public
`/config/zero-access.json` before initializing Firebase. The loader validates
schema, project/app identity, provider, and a nonempty public key. It retains the
explicit operator global override and rejects missing configuration. Rejected
bootstrap promises can retry; concurrent callers share initialization. Firebase
app reuse must match the configured project/app rather than selecting an
unrelated first app. Auth and App Check headers remain mandatory.
The final configuration fetch uses the existing service-worker VFS-bypass header
so a previously hydrated file cannot conceal a corrected deployed configuration.

## Acceptance evidence

- `npx vitest run tests/unit/zero-access.test.js tests/unit/self-boot-shell.test.js tests/unit/boot-seed.test.js tests/unit/zero-gemini-function.test.js`: 47 passed.
- `npx playwright test tests/e2e/zero-access.spec.js tests/e2e/zero-one-safe-iteration.spec.js --project=chromium`: four passed. The access test uses explicit Firebase SDK fixtures, not real attestation. The existing iteration tests use model fixtures, not actual Gemini inference.
- `npm test`: 2,498 passed, 35 existing skipped before the final VFS-bypass header addition. After that addition, the same 47 focused tests and four browser tests pass again.
- Registry regeneration repeated in dependency order; validator reports 358 source files, 176 declarations, 106 executable owners, zero unresolved issues. Module inventory and browser-bundle checks pass; 29 charters and 14 surface claims pass. `git diff --check` passes.
- Final browser bundle: `sha256:f359221d4318db6c129f889d29d6f42b58d437be80aba8433990eb35ee5a83d1`, 648 served files.

The archive retains source snapshots, tests, original-code reproduction, and
logs. The initial browser test failure is preserved: it incorrectly asserted
that the goal packet was a string. The corrected assertion checks `goal.text`;
it does not weaken the mirror assertion.
`evidence.tar.gz` preserves the initial source and logs;
`final-source.tar.gz` contains the final VFS-bypass delta, generated identities,
and focused rerun logs. Apply the final archive after the initial archive when
restoring the tested source snapshots. These are source snapshots, not a complete
installation or production qualification bundle.

## Deployment boundary remains open

The deployed `reploid.web.app/config/zero-inference.js` still reads only the
site-key global. Its Hosting Firebase configuration identifies project `reploid`
and app `1:506730551098:web:1b9639865cb8501b7c2203`. The new public file retains a
null site key until an operator provides the registered public key. No secret
belongs in that file.

The other machine reports App Check token exchange failed with API-disabled
403. A read-only App Check configuration lookup here returned 401
`CREDENTIALS_MISSING`: this management API requires OAuth, not the public
Firebase API key. That probe does not establish API enablement or registration.
Firebase and gcloud executables are unavailable here. An authorized operator
must enable/configure the project, supply the public key, deploy the matching
source, and verify real Auth/App Check exchange followed by managed inference.
No authentication bypass, production success, or Zero improvement is claimed.

Component: `reploid.browser-runtime.config`, `reploid.browser-runtime.ui`, and
verification evidence. Intent: preserved. Boundary effects: Zero configuration
and selected-seed mirror requests; Poolday execution authority is unchanged.

*Last updated: September 2026*
