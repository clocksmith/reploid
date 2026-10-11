# Durable independent embedding units

Component: `reploid.mesh.jobs` and requester artifact persistence.
Intent: deliberately extended to aggregate independently valid embedding jobs.
Boundary effects: new requester aggregate journal; existing signed job, provider
journal, requester and wire contracts retain their meaning.

The public `reploid/jobs` coordinator slices only an explicitly approved
`embed.v1` application's text batch, binds original positions and frozen
reference comparisons, and runs existing signed jobs. Native IndexedDB commits
one outcome per unit, rejects superseded attempts and conflicting duplicate
outcomes, and reconstructs progress after browser replacement. Provider
execution can repeat; exactly-once execution is not promised.

Validation:

- Four Chromium scenarios pass against source and against an isolated installed
  package. They exercise browser-process restart, provider replacement, lost
  first response delivery, out-of-order completion, duplicate outcomes,
  superseded writers, cancellation, authorization revocation, collision
  rejection, bounds, expiry, and atomic storage failure.
- The Verification Worker accepts the exact generated storage owner and rejects
  arbitrary vendor IndexedDB access.
- 81 existing signed-job, charter and verification unit checks pass.
- `npm run verify:library-types` passes.
- All 17 installed-package checks pass. The full installed report and exact
  validation archive are retained in `installed-acceptance.tar.gz`.
- `npm test`: 278 files pass, three skipped; 3,001 tests pass, 29 skipped.

Reproduction:

```sh
npm test
npm run verify:library-types
REPLOID_E2E_SKIP_LOCAL_SERVER=1 npx playwright test --config tests/playwright.config.js tests/e2e/independent-units.spec.js --project=chromium
node tests/library-package-acceptance.js
# Optional: repeat browser scenarios with the installed package root from that report.
# Set REPLOID_UNITS_INSTALLED_ROOT to its consumer/node_modules/reploid directory.
```

Retained development failures: dropping only the first event of an operation
correctly rejected the response stream gap; the loss test now drops the complete
initial stream and preserves protocol gap rejection. The first Verification
Worker check rejected the new storage owner until the existing exact-path
exception was extended; the negative arbitrary-path control remains. An initial
installed run named a nonexistent temporary consumer and failed module loading;
the corrected run uses the report's actual isolated installation. The CLI rejects
unsupported `npm test -- --run`; a direct Vitest invocation without repository
configuration lacked legacy aliases. The configured run passes. Updating the
job charter required regenerating the component index.

All vector computation here is synthetic. The tests prove orchestration,
signatures, storage and comparison enforcement, not model mathematics, physical
inference, fresh delegated eligibility, independent operators or deployment.
Application qualification and Doppler's additive batch-semantics declaration are
separate evidence. The standard Doppler 0.6.27 archive is unchanged.

*Last updated: October 2026*
