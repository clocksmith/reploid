# Architecture stabilization

The stabilization reconciles application baseline `7efa8f9ef22817f65149b9246f2e759c28ec0bc7`
with accepted integration `19bc359ef1b7606fde3132ab2f37920f4891e6e5` through a merge.
Application Work composition is retained alongside the accepted Doppler streaming,
transport, installed-package and storage changes. Neither branch replaces the other.

## Execution and authority

`packages/reploid/src/agent/engine.js` owns attempts, provider invocation and
fallback, response interpretation, authorization on every tool attempt, batch
execution, retry timers, operational events and checkpoint readiness. Its
lifecycle tracks borrowed operations through cancellation and settlement.
`task-strategy.js` and `lab-strategy.js` supply context, plans, optional cognition
and presentation. `runtime.js` and `legacy-loop.js` only forward compatible public
exports; the architecture verifier enforces those forwarding and execution-owner
boundaries. The root export remains compatible; `reploid/agent` avoids importing
the lab strategy.

Tool retries reauthorize each attempt. The lab's ToolExecutor formats single
attempts and emits its existing diagnostics; retry scheduling belongs to the
engine. Tool timeouts retain pending raw work, and checkpointing and replacement
execution cannot treat that work as settled. X coordinator calls use the same
provider lifecycle, and cancellation cannot initiate fallback. Native tool calls
and textual tool calls enter the same interpreter on all three surfaces.

The host resolves mutable settings before each lab attempt. Resumption retains
that configuration and authority profile. Tool configuration and host permission
are independent gates. Cancelled provider work must settle before replacement
execution begins, and closing waits for borrowed operations without claiming to
terminate them.

Zero and X resolve from `self/config/surface-intents.js`. Modules, tool surfaces,
resource seeds, mirror rules and UI specifications flow into their lab profiles.
X adds executable capabilities to Zero. Feature absence differs from immutable
authority ceilings and explicit host grants. A route cannot authorize independent
evaluation, candidate self-approval or permission escalation.

## Host, providers and records

Work session composition delegates task validation to `work-task.js`, retention
to `work-repository.js`, projections to `work-view.js`, and provider adaptation to
`self/providers/work-provider.js`. Model IDs do not select providers by spelling.
An absent selection uses the profile default; an unknown explicit ID fails.
Cloud calls require the host's Firebase Auth and App Check headers. Client and
server must both permit fallback, and records distinguish requested from actual
execution identity. Raw local sessions, cloud responses and verified signed
Doppler operations remain separate result categories.

Persistence serializes and validates a candidate, writes it, then advances the
committed revision. Failure retains the previous revision and an explicitly
uncommitted view. Public state is detached and frozen. Task review remains local
user acceptance, not independent evaluation or promotion authority.

Store construction is inert. Initialization establishes database readiness;
blocked/failed opens reject. Mutations notify after commit. VFS closes its store
only when explicitly owned, and subsequent operations reject. Existing database
names, record keys and user files are preserved.

## Peer ownership

The package owns existing complete-job contracts, provider/requester algorithms,
episode verification and the durable job journal under `mesh/jobs` and `artifacts`.
Application wrappers inject operation contracts, catalog admission, signing,
consent and execution ports. Custody owns authorized transfer and reconstruction;
possession does not grant execution or redistribution permission. Document and
protein workflows remain in the application. Legacy swarm's process-local
cache is distinct from the durable complete-job journal. Transport delivery
remains bounded at-least-once. The legacy ring client waits between bounded
coordinator polls and never submits a reveal without an open reveal gate,
including when commit/reveal was selected automatically.

## Continuous acceptance

CI requires JavaScript correctness lint, strict public declaration checks and JavaScript checking of the execution engine, lifecycle, dispatcher and recovery policies,
parsed import/reexport/dynamic-import boundaries, declared dynamic loaders,
cycle detection and byte-identical generated library delivery. The dependency
check rejects mandatory X capabilities in Zero. Browser and installed-package
checks are mandatory; generated registry validation must report zero unresolved
issues.

Reproduction commands:

```sh
npm test
npm run lint
npm run verify:library-types
npm run verify:catscan
npm run verify:layers
npm run verify:module-system
npm run verify:registry
npm run verify:runtime-config
npm run verify:browser-bundle:local
npx playwright test tests/e2e/vfs-storage-contract.spec.js tests/e2e/boot.spec.js tests/e2e/peer-pack-jobs.spec.js --project=chromium --workers=2
node tests/library-package-acceptance.js
```

The focused regressions cover unknown models, credential omission, allowed and
forbidden substitution, failed writes and retry, nested-state mutation, native
IndexedDB readiness and shutdown, protected tool authorization, borrowed-work
settlement, exact disclosure consent and durable peer recovery. Browser
Verification Worker checks include the changed execution and storage owners.
The installed consumer exercises actual Work composition with deterministic
provider fixtures, including accepted/denied peer help and retained history.
These checks do not establish physical GPU results, honest remote hardware,
scientific correctness, a deployed release, or a complete autonomous improvement
process. Existing integration GPU artifacts retain their original provenance.

Retained stabilization evidence: [report](../artifacts/architecture-stabilization-2026-09-19/report.json).

Execution convergence evidence additionally runs
`tests/integration/agent-surface-contract.test.js` against the Zero and X host
adapters and the Work library entry, and `tests/unit/execution-engine.test.js`
against retry authorization, borrowed-work settlement, bounded follow-ups and
checkpoint readiness. Surface strategies deliberately retain different terminal
semantics: lab DONE completes its goal; Work IDLE parks for review. Dynamic tool
growth and provider fixtures are deterministic contract evidence; browser boot,
Verification Worker, IndexedDB and installed Work journeys are separate checks.

Retained execution-convergence evidence: [report](../artifacts/architecture-convergence-2026-09-19/report.json).

The peer replay regression checks bounded redelivery of the identical signed job,
including loss of both a request and a completion. It asserts one executor call
and verifies the accepted episode; wall-clock signing latency cannot make an
exact transport delivery count part of the execution contract.
