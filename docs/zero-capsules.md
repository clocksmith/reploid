# Compact Zero capsules

Fresh `/zero` instances use `self/zero/`, not the legacy lab/DI graph. X, Poolday,
returning legacy instances and historical image formats keep their existing paths.

## Assembly and persistence

1. The cold host opens the existing instance-scoped IndexedDB namespace.
2. An empty database receives exactly the source descriptor and its hash/byte-checked
   files in one transaction. A concurrent or nonempty database is never overwritten.
3. `/zero/config.json` names `main`, UI and agent source. The service worker acknowledges
   the instance binding before versioned runtime imports resolve through its VFS.
4. `main` composes the two capsules and narrow provider, tool and storage ports.
   The agent uses the existing shared execution engine, not a second agent loop.
5. Conversation messages persist separately in `/state/zero.json`. Reload restores
   them without running a goal. Model context may omit oldest complete exchanges;
   stored history is not truncated.

A saved compact instance stays on its owned source. A nonempty older VFS without
the compact descriptor returns to the legacy bootstrap, without compact reseeding,
overwriting saved work, pruning, changing route identity or transferring upgrade preferences. A fresh named instance
is the opt-in boundary; this is not a migration of existing saved work.

## Mandatory tool boundary

The shared CreateTool implementation, writer, static verification worker, Acorn,
schema checks, promotion policy and loader remain real dependencies. Missing or
skipped verification rejects installation. Approvals bind exact source hashes;
activation checks and a fresh-import fixture replay must also pass. Restore checks
installed bytes again and re-verifies exported tool source before loading it.

Generated tools receive capability-filtered ports, not the writer/verifier/registry.
Mutation, event, logger and nested execution ports revoke on cancellation, disposal
and call settlement. A later call cannot revive an earlier call's ports. Failed
creation rolls back independently of the cancelled call's mutation signal.

Static preflight is **not a JavaScript sandbox**. Author-supplied fixtures and replay
are **not independent quality evaluation** or an L1/L2/L3 result. Required human or
security policies that this compact host cannot satisfy fail closed.

## Providers and prerequisites

- On loopback, the declared local provider is Connected agent. It needs the existing
  enabled mailbox host and controller. The 80-line browser adapter does not replace
  that host or supply a model.
- Public origins retain the existing managed Gemini port, fixed endpoint, Firebase
  Auth and App Check. Host configuration, three Firebase SDK modules, the deployed
  function and model remain external prerequisites. Checked-in App Check configuration
  has no usable site key; no credentials are created or checks bypassed by this seed.
- The compact path does not bundle the legacy provider picker or Doppler runtime.
  Existing saved instances and X keep those interfaces. Source export never packages
  provider tokens, API keys or authentication state.

## Source-only reproduction

Inspect → **Export self-source** emits `reploid.zero.image/v1`: the declared source,
its descriptor and activated installed tool sources. `materializeZeroImage` in
`self/zero/image.js` validates it and produces a static host file map. Serve that map
on a new HTTPS or loopback origin with its explicit provider prerequisites. No
repository fallback, copied IndexedDB, run recording or approval receipt is needed.

The source-path policy rejects state, artifacts, recordings, receipts, settings,
private data paths, unknown JSON and undeclared files even if hashes are supplied.
Inspect intentionally authored tool source before sharing it: path allowlisting is
not a general secret detector for arbitrary strings embedded in source code.
Legacy `self/image/` export/restore contracts are separate and unchanged.

## Measured readable source

Bound to descriptor SHA-256
`e0830ee5d23da74fa2c3c2e27d8908b17ac447259dd532117051738d8e2c77fe`:

| Disjoint browser payload | Physical lines |
| --- | ---: |
| Boot, config, VFS store, entry HTML and main | 232 |
| Agent capsule | 196 |
| UI capsule and CSS | 118 |
| Tool host, provider and image export | 623 |
| Remaining shared execution, verification, parser and platform support | 12,567 |
| **44-file payload** | **13,736** |

The payload is 12,409 nonblank lines / 525,465 bytes. Its own `zero/*` code is
11 files / 1,169 lines; the `main` declaration is 24 lines, its whole file 36.
Acorn plus its license accounts for 6,283 lines and is openly included, not hidden
behind the small assembly nucleus. No legacy lab/DI source or repository inventory
is in this fresh closure. These are measured implementation costs, not a lower bound.

The generated descriptor adds 238 lines / 7,754 bytes. A source-only static host
adds a 20-line root entry: 46 files / 13,994 lines / 533,760 bytes before installed
tools. The repository-served route instead adds its shared HTML/favicon, 197 lines:
47 files / 14,171 lines / 541,608 bytes including its browser payload and descriptor.
Public host access configuration adds 9 lines; existing managed function/policy/package
source adds 449. That repository-owned managed envelope totals 51 files / 14,629
lines / 556,360 bytes, plus the external SDK, cloud service and model.

The supplied local mailbox implementation is 328 lines. Its currently supplied full
`server/proxy.js` static local closure is 224 files / 50,190 lines, plus Node and
Express/dotenv/node-fetch/ws and optional services. That broader server is not
intrinsically required by the browser seed, but it is a real demo prerequisite, not
part of a claim that the 232-line nucleus is a complete autonomous system.

## Regeneration and validation

Run `npm run build:zero-source` after changing a declared source dependency and
`npm run verify:zero-source` to check the descriptor. The unit suite also checks
exact descriptor parity. Existing shared catalogs must still be regenerated when
their own dependencies change; the two source-image contracts are not conflated.

Focused coverage includes atomic seed, saved/legacy preservation, cancellation,
real worker verification, hash mismatch and missing-verifier rejection, activation
rollback, installed-tool export/restore, private-path rejection, managed auth
delegation, whole-exchange context bounds, source-only materialization and UI state.
Live managed inference and deployment are not established by fixture tests.

## Qualification (2026-10-22)

The local default Vitest selection passed **5,285 tests**, with 36 explicit skips,
using `CI=1 npx vitest run --config tests/vitest.config.js --maxWorkers=2`.
Lint had no errors; source descriptors, shared manifests and component index passed
freshness checks. The ten selected Playwright smoke cases were discovered locally;
headless Playwright execution remains a hosted-CI check, not a claimed local pass.

The supported cloud browser demonstrated real, non-skipped worker approval,
fixture activation and fresh replay, installed Echo execution, cancellation/retry,
saved-conversation reload without autorun, and the actual source-export download.
The export contains source and the installed tool, not conversation or approval
receipts. Managed inference was fixture-tested through its existing auth port, not
qualified against a live configured deployment. Reduced-motion CSS was checked,
but switching the browser/OS preference was not exercised. These checks establish
bounded tool and source-reproduction behavior, not RSI qualification or deployment.

The actual downloaded release-candidate image was materialized by its own validated exporter
into a separate 47-file static host, including Echo. A new origin's first root-entry
navigation reached idle without reloading, with an empty conversation. Its fresh
verifier ran before Echo was advertised; the existing exported tool then executed
successfully without recreation or imported approval authority. The provider
responses in this bounded browser check were explicit fixtures, not an autonomous
reasoning or improvement evaluation. No runtime source fallback was needed.

The complete browser workflow above was bound to source descriptor
`638ce8d044cc9b2a09e2170cb41b0f205eb2bfd9bf3a80705042fd5c19592d7c`.
Final staging removed exactly one trailing newline from `core/tool-capabilities.js`
and regenerated identities; every other executable byte is unchanged. Those browser
artifacts are therefore not byte-identical to the final descriptor listed above.
A separate final-byte fresh-instance browser boot reached idle with no conversation
or application error, without prompting or reloading. Its dynamic descriptor hash
was not exposed by the documented read-only browser controls; final hash consistency
is established separately by regenerated-source checks and unit tests.
