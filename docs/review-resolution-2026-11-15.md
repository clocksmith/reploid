# Review disposition, 2026-11-15

This tracks all 92 IDs in the review of `fc48ae18eb6603cb75999fb781fcfa102070356b`.
Implementation was performed on the later working tree, with existing cross-tree
callers and signed protocols preserved. **Fixed** means a concrete implementation
or enforcement change; **corrected** means the finding's premise did not survive
inspection; **retained** means a deliberate contract or tradeoff remains, with the
reason and owning implementation identified below. Retained does not mean a
complete audit, production qualification, or a claim that further improvement is
impossible. The original audit's unread files and lost reports do not become
reviewed evidence through this disposition.

Source history contains the individual implementation commits. Focused checks
are recorded with those changes; the current CI workflow checks declarations,
source boundaries, lint, generated contracts and selected regression tests.
The test suite is repository-owned: absence of tests inside an application or
published package does not mean its behavior has no tests.

## Critical

| ID | Disposition and evidence |
| --- | --- |
| C1 | **Fixed.** Removed 7,150 historical outputs, 1,210,393,618 bytes, from the current tree. `docs/evidence-catalog/` records exact Git objects, SHA-256, size, mode and pushed source revision. `scripts/restore-evidence.js` restores without overwriting divergent files. Five required frozen test inputs remain. `.gitignore`, `scripts/artifact-policy.json` and `check-artifact-additions.js` prevent renewed growth. Existing history is preserved; full historical clones still include it. |
| C2 | **Fixed; premise corrected.** Package-local test/lint/type commands delegate to the existing root harness. Both type checks run in CI. `verify-declaration-exports.js` compares value exports through the compiler resolver for all 120 library and 21 application declaration/implementation pairs. Consumer contracts and core execution modules are type checked. This is not a claim that every JavaScript body is fully typed. |
| C3 | **Fixed without a wire break.** Pool callers now say `sha256Digest`; the old export remains compatible. The protocol uses tagged digests. Changing existing receipt hashes to bare hex would invalidate them. `tests/unit/pool-hash-compatibility.test.js` checks the browser/server boundary. |
| C4 | **Fixed.** Real `bin/reploid-config` and `server/proxy-config.js`; explicit missing/invalid config fails before startup. Environment interpolation is validated. Importing the proxy no longer starts it. |
| C5 | **Fixed.** `self/tool-authorization.js` requires host authorization for privileged operations. Default bounded goal/file operations retain their path checks; module loading and activation do not acquire permission by default. `self-authorization.test.js`. |
| C6 | **Fixed.** Forecast prepack builds the declared distribution from the live source graph. LICENSE is included. Generated distribution is ignored and package contents are tested. A source checkout need not commit publish output. |
| C7 | **Fixed.** Dangling Poolday declarations point at actual contract owners; missing library selector/activation declarations and default APIs were added. Compiler checks and value-export parity now enforce the layout. Dependency-generated declaration headers retain their upstream provenance. |
| C8 | **Fixed.** Deleted the separately maintained forecast source snapshot. The builder resolves live inputs and records their hashes; it no longer requires a second source tree to be synchronized. |
| C9 | **Fixed.** Real text prompts come from `apps/poolday/config/chat-prompts.json`; both text and sequence lanes have exercised placeholder lists. |
| C10 | **Fixed.** Removed the nonexistent generation override spread. Limits in partition policy retain their distinct admission role. |
| C11 | **Fixed.** Historical runtime archives are recovered by exact identity through the evidence catalog. Only the current 0.7.4 runtime archive remains in the current tree, under an 8 MiB budget. `sync-doppler.js` advances its ignore exception with the pin. Recovery also verifies the original package integrity. |

## High

| ID | Disposition and evidence |
| --- | --- |
| H1 | **Fixed.** Hosted-service imports have explicit allowed library/product seams in `scripts/verify-layers.js` and ESLint; cross-tree ownership is enforced rather than inferred from folder names. |
| H2 | **Fixed.** CI runs full authored-code lint and registry/CATSCAN/Zero/full-Self/Doppler/ownership/runtime/hosting/module/SDK/browser output checks. The focused regression set remains bounded rather than pretending to be full physical qualification. |
| H3 | **Fixed.** `env.production.json` owns ordinary environment values and service scaling/timeouts. `sync-runtime-config.js` projects both Cloud Run and Cloud Build declarations. Secret references and release identities retain deployment ownership. TURN's provisioned address is configured once; a literal address is not itself a secret or defect. |
| H4 | **Corrected; domain namespaces retained.** `accounts/domain.js` and `ledger/domain.js` own different account schemas. A namespace import does not combine modules or silently replace a binding. Keep their specific Error classes and qualified import paths. `server/CATSCAN.md` now maps ownership of payment, credit, funding and reward events. No global schema-name registry replaces separate domain contracts. |
| H5 | **Fixed.** Native CLI, GPU/RTC adapters, model/partition opening and participant composition have separate modules. Explicit `randomUUID` import and public `getPeerId()` replace reliance on implicit/private behavior. |
| H6 | **Fixed.** `createProxy` is inert; `startProxy` owns startup and cleanup. Config and optional bridge startup failures have explicit boundaries. Import/startup tests exercise this. |
| H7 | **Retained compatibility with a shared engine.** Metadata factories are existing DI/loader entry points; explicit-port factories are the reusable API. `agent/CATSCAN.md` identifies compatibility shims and engine ownership. Both styles delegate execution lifecycle to the engine. Removing metadata constructors would break existing hosts without eliminating a second execution engine. |
| H8 | **Refactored.** Task tools/archive/protocol were extracted; partition wire/disclosure/publication contracts moved out of mesh into contracts; listener handling is shared. Existing workspace/peer/episode stateful owners remain, with their explicit authorization and settlement contracts. File size alone is not an additional correctness defect or permission to change lifecycle ownership. |
| H9 | **Fixed.** One `transport/message-types.js` owns common vocabulary/version. Transport-specific room events remain explicit. Existing protocol handlers and compatibility exports are preserved. |
| H10 | **Corrected.** Raft, federated and goal handlers are embedding-application responsibilities outside the package slice. The transport's `onMessage` contract delivers application messages; it is not an implementation of every application protocol. Deleting accepted types would break those callers. |
| H11 | **Corrected.** All six alleged library orphans have cross-tree consumers: Self tools use retry helpers, hosted/app accounting uses attempt reports, shared model infrastructure uses the context cache, native/product hosts use web access, and pool/account/custody code consumes acceptance/certificates. Slice-local absence is not repository-wide deadness. |
| H12 | **Fixed.** Selector declarations match the runtime; compiler-based export checking also found and fixed three further mismatches. Re-exports are resolved through TypeScript rather than textual export counting. |
| H13 | **Fixed at failure boundaries; domain distinctions retained.** Observer errors are reported consistently; parser diagnostics have a host logger; legacy construction validates required Error ports. Existing configuration, partition, HTTP and domain errors retain their different contracts. Retrieval's internal exception is converted to its public result shape rather than exposed as a new exception API. |
| H14 | **Fixed.** Conversation code imports partition wire/identity/disclosure/publication contracts from `src/contracts/`, not mesh orchestration. The source boundary check forbids chat-to-mesh dependencies. |
| H15 | **Fixed.** Configuration executes the published schema through `config/validate-schema.js`; semantic checks such as known routing IDs remain explicit. The schema is no longer documentation-only. |
| H16 | **Fixed for duplicated primitives; distinct retry policies retained.** Product contribution and peer transport use one `observation-timeout.js`. Task/provider/transport policies retain different retry/admission/settlement semantics. Library retry helpers are used by Self tools and are not orphaned. A generic timeout must not claim borrowed work has stopped. |
| H17 | **Corrected and enforced.** Root `build-browser-bundle-manifest.js` owns the browser artifact and source graph; CI rebuild/check verifies its bytes. The artifact is an intentionally committed delivery projection, reproducible from the root. A package-local script is not required to duplicate the root builder. No source-map/debugging claim is made. |
| H18 | **Fixed.** `peer-model-match.js` owns advert/model matching, including explicit adapter/runtime-profile behavior. Discovery, planning and assignment use it; compatibility tests cover disagreement cases. |
| H19 | **Fixed.** `config/peer-timing.json` owns generic, local-tab and server-relay timing profiles. Host overrides are resolved/frozen once per dispatch. Different relay budgets remain intentional and tested. |
| H20 | **Retained distinct policy scopes; real duplicate wiring fixed.** UI attachment/context limits read configuration; generation's dead merge is gone. Input admission, output accounting, receiver limits and differently owned channel budgets remain distinct even when some numbers match. Equal numbers do not establish one semantic limit. |
| H21 | **Refactored.** Requester, provider, operation and signaling/discovery room lifecycles are separate; claims, planning and receipt agreement are separate control-plane modules. UI model/prompt limits and cancellation handlers have one owner. Public entry points remain compatible; focused room/planning/UI tests exercise them. |
| H22 | **Corrected and enforced.** Manifest paths describe the composed served URL tree (`apps/poolday`, `shared`, `self`), not a directory listing of `apps/poolday`. The root generator and ownership/bundle checks exist and run in CI. |
| H23 | **Fixed.** The unused animation cluster and its tuning data now live under `tests/fixtures/pool-simulation/`, outside served assets. Its 30 regression tests remain; unused product CSS was removed. `prism.js` remains the live visualization adapter. |
| H24 | **Fixed.** Change Passport has a reproducible root-owned build and package-local command. Builder working directory is fixed; CI checks committed distribution against source. |
| H25 | **Retained, machine checked.** Browser delivery requires URL-relative modules outside the npm package layout. `sync-reploid-library.js` is the byte-preserving projection, records canonical source assets, excludes owner charters, and is checked in CI. Consumers use the served or package path appropriate to their host; no independent implementation is maintained. |
| H26 | **Corrected.** The eight frozen qualification bundles contain 184 files but only 22 unique content identities; Git already stores matching blobs once. Their signed references require per-run paths. Preserve those proofs rather than rewriting signed history for cosmetic deduplication. Eight retained-episode regression tests validate them offline. New outputs remain governed by budgets. |
| H27 | **Corrected.** The package adapter executes caller-supplied tools; Self's runner owns protected loading and activation. They are distinct authority boundaries. ResponseParser is already a byte-preserving re-export, not a second parser. Deleting either runner would remove its host contract. |
| H28 | **Fixed.** Historical `reports/local/` outputs moved out of the current tree into hash-pinned recovery. Repeated experiments no longer grow the source tree by default. |
| H29 | **Refactored.** GEPA evaluation/reflection/Pareto factories and rule unification/context helpers were extracted. Bridge file operations have an explicit owner and settle failed OPFS writers. Rule matching also fixes negation and falsy substitutions; Verification Worker rejects computed prototype writes. |
| H30 | **Fixed.** `self/config/route-boot.js` owns route boot configuration; lab profiles re-export compatibility names. Boot contract records VFS-generated seed records. Full Self source closure is regenerated and checked in CI. Shared browser dependencies are the declared served-tree architecture, not an accidental promise of filesystem isolation. |
| H31 | **Fixed.** Removed fake reconstructable secure masks; plain sharing requires explicit consent. Unsupported secure aggregation and differential-privacy configurations fail closed. Optional noise uses cryptographic randomness and makes no unsupported privacy guarantee. |
| H32 | **Fixed.** Goal surface matching is case/word-boundary aware; selected goals are findable through metadata lookup. Pool cardinality derives from named quantities. Seven goal regressions pass. |
| H33 | **Fixed runner defect; structural claims corrected.** Native `node:test` tooling tests are excluded from Vitest and run through `test:scripts`. Bare files include explicit controllers/contracts, not necessarily undiscovered tests. Runner ownership is documented in `docs/TESTING.md`. Same basenames across unit/integration suites are not evidence of duplicated assertions. |
| H34 | **Fixed factual errors; independent owners retained.** Broken index paths and omitted package exports were corrected. Boot/deploy/money ownership is explicit. CATSCAN and journey documents for different components/surfaces are intentionally separate authority contracts, not copies to collapse by basename. Historical evidence timestamps are not rewritten as current status. |
| H35 | **Fixed.** `no-unused-vars` applies by default to authored library, app, Self, shared, server and script code, and CI runs lint. Lint/environment regression tests enforce these scopes. |
| H36 | **Corrected.** `shared/vendor/doppler/CATSCAN.md`, the versioned package's README/package metadata, exact root lock integrity and `vendor-doppler.js` record ownership, pin and update procedure. The runtime is byte-preserving, not an undocumented manual fork. |
| H37 | **Corrected/cleaned.** The diagram is a runnable documentation demo with lint ownership. Historical report controllers are no longer in the current `reports/local` tree. Placement under documentation does not remove the demo's implementation or justify moving its public paths. |

## Medium

| ID | Disposition and evidence |
| --- | --- |
| M1 | **Corrected; compatibility checked.** Hosted JSON normalization and signed pool canonicalization have distinct undefined-input contracts. Valid signed inputs agree in compatibility tests. Shims preserve environment-specific hashing ports; merging hash domains would change existing records. |
| M2 | **Retained.** Singular stores and plural backend factories expose different shapes. Their store contracts are explicit; adding naming-only forwarding files would increase import hops without fixing behavior. |
| M3 | **Corrected.** External text composition and evaluation ports may consume server modules; shared modules are also VFS/manifest resources. Static in-slice import analysis cannot establish deadness. Entry-point and source-closure checks cover those non-static delivery paths. |
| M4 | **Fixed.** `deploy/firebase-common.json` owns shared header/rewrite policy. Target templates preserve route order and surface-specific entries; `sync-firebase-config.js --check` runs in CI. |
| M5 | **Corrected.** `cycles: []` is an exception list, not a claim without computation. `verify-layers.js` builds the repository graph and calls `findCycles`; undeclared cycles fail. Dynamic loaders require source, expression, owner, contract and removal condition. Central exception validation is retained. |
| M6 | **Fixed enforcement; output duplication retained.** Installed-package declarations and browser delivery require their own package boundaries. Generation and byte-preserving mirror checks now run in CI. Upstream generator paths in upstream declarations are provenance, not promises that every package contains that generator. |
| M7 | **Retained.** Surface wrappers share `critical-user-journey-contract.js` but preserve independent registries, schemas, CLI entry points and acceptance. Combining surface ownership to remove small wrappers would obscure that distinction. Runtime repository-root discovery does not import build tooling. |
| M8 | **Fixed.** Pool route composition is 195 lines; admission, metadata/status/config and account handlers have separate owners, and relay pagination lives with peer-room routes. Small contract seams remain where they carry an interface. |
| M9 | **Fixed.** `server/CATSCAN.md` maps accounts, payments, ledger, rewards, community funding and scheduling to their actual event owners. HTTP composition does not acquire money-domain authority. |
| M10 | **Retained wire compatibility.** Partition v1/v2/v3 records represent distinct protocol generations and signed replay contracts. Old record support is not removed merely to reduce string counts. New shared partition contracts are outside orchestration. |
| M11 | **Retained distinct semantics.** JSON evidence validation/canonical serialization and general state cloning are different operations. Replacing every clone with sorted JSON would lose non-JSON state or change signed bytes. Callers keep their declared data contracts. |
| M12 | **Fixed.** `src/observation.js` reports sync/async callback failures, preserves observer isolation and continues notification. Agent/workspace offer host error sinks. Queue notifications use the same helper. |
| M13 | **Corrected.** Root lint covers the package and runs in CI. Long lines are a readability preference, not absence of tooling; no repo-wide mechanical formatter pass rewrites frozen/generated evidence. |
| M14 | **Retained public vocabulary.** Async durable/resource opening and in-memory construction are not interchangeable. Existing agent/transport compatibility names remain stable, with shared lifecycle and separated protocol contracts. Renaming public paths is not a correctness fix. |
| M15 | **Retained asset contracts.** Schemas, defaults, rules and policies have different jobs. Public JSON export paths stay compatible; their naming variations do not establish duplicated policy values. |
| M16 | **Refactored coupling seam.** Shared partition wire contracts moved to `src/contracts/`; chat-to-mesh imports are prohibited. Route/execution/publication/admission modules retain existing public paths rather than introducing dozens of compatibility-only forwarding files. |
| M17 | **Fixed.** Default agent parser supports a host logger; default warning/error messages omit model argument payloads. `observer-errors.test.js` exercises a malformed tool call through the actual agent composition. |
| M18 | **Fixed.** Mesh lookup has an explicit `ConfigurationError('mesh.routing', ...)` guard in addition to immutable configuration validation. |
| M19 | **Retained compatibility APIs.** Named exports and default API objects serve different import/loader consumers. Compiler export checks now catch declaration drift. Removing default objects would be an API change rather than deduplicating an implementation. |
| M20 | **Retained.** Work/product compatibility adapters and view barrels are documented import seams; they forward behavior rather than duplicating it. Internal construction and authority stay at the underlying owners. |
| M21 | **Retained host configuration, with authority enforced.** URL room/relay selection is an invite/discovery choice, not consent to disclose or execute. Dispatch freezes timing/generation; exact identity, disclosure and admission checks remain separate. Runtime globals are host integration hooks, not an authorization bus. |
| M22 | **Retained layer contracts.** Expected admission failures may return results; programmer/operation failures may throw. Peer recovery converts those at its boundary. Domain-specific codes are preserved rather than replacing wire-visible failure behavior wholesale. |
| M23 | **Fixed.** Conversation attachments/context options and prompts read owned config; selected-policy generation and protocol admission limits remain at their actual owners. |
| M24 | **Fixed.** Lifecycle UI imports contract enums. Evidence search indexes all signed payload fields, excluding signature/public key material; checkpoint/experiment/value/resolution fields are covered by regression tests. |
| M25 | **Corrected.** Evolution source/test strings are candidate data for governed evaluation, not execution by the config loader. The document-study sample is an explicit fixture. Doppler contract generators exist at repository root and are checked in CI. Small policy files retain their separate authority. |
| M26 | **Corrected/enforced.** `verify-poolday-css-layers.js` already compares both HTML load lists exactly with `layers.json`, including order and unique layer membership. Manual list drift is detectable; replacing synchronous boot with async CSS fetch would change startup behavior. |
| M27 | **Retained qualified policy.** The provider allowlist names currently supported app providers; pluggability does not qualify additional providers. Function generation/scale limits and bounded permission history are distinct application policies, not universal engine defaults. They do not bypass exact active grants. |
| M28 | **Fixed timeout duplication; consent semantics retained.** Contribution shares the bounded observation helper. Explicit participation setup/persisted resume intent are host-owned consent; restoring an approved session is intentional. Discovery and a renderer event do not create a new grant. Lifecycle generation guards continue to reject stale async work. |
| M29 | **Fixed.** Unused bridge token estimator removed, GEPA blueprint citation corrected, goal cardinality derived. Remaining estimators are not interchangeable numerical guarantees. |
| M30 | **Corrected.** Runner support, frozen fixtures, explicit physical controllers and an independent answer/reference harness have different jobs. Their ownership is documented; no independent reference implementation is deleted to cosmetically reduce languages or folders. |
| M31 | **Fixed actual fixture; separate runners retained.** First-visitor browser server uses the composed browser tree. Base/heavy/Worker Vitest environments and distinct browser harnesses are purpose-specific; they are not three identical configurations requiring blind consolidation. |
| M32 | **Corrected.** `docs/status` contains dated historical qualification artifacts, not a current activity feed. Current source claims/inventories are generated separately. Evidence dates remain unchanged. |
| M33 | **Refactored; entry paths retained.** Native and pool composition responsibilities were split into modules. Existing root native/text/browser prefixes remain compatible CLI/import entry points; directory flatness alone is not a remaining runtime defect. |
| M34 | **Fixed wiring; workspace change declined on evidence.** Top-level build composes outputs; proxy import is inert; action runtime matches a supported newer Node runtime. One root dependency lock and independently packaged SDKs do not require npm workspaces. Adding workspaces would change installation semantics. |

## Low

| ID | Disposition and evidence |
| --- | --- |
| L1 | **Corrected.** Git records CLAUDE.md and GEMINI.md with mode `120000`: both are real symlinks to AGENTS.md. The audit's regular-file premise was false. |
| L2 | **Fixed.** Removed the obsolete commit-specific repair controller from current scripts. `docs/INDEX.md` points to its exact historical source revision for recovery. |
| L3 | **Fixed duplicated deployment ownership; constants retained where meaningful.** Runtime pin/env/service projections are generated. FNV-1a is identified as a non-cryptographic fingerprint. Standard framing/timer constants are not secrets or duplicate policy merely because their literal values recur. |
| L4 | **Fixed.** One lazy `loadDopplerRuntime` helper owns optional runtime loading, preserving injected runtime ownership and inert imports. |
| L5 | **Corrected.** JSDoc self-imports resolve a module's companion declarations; they are type references, not runtime cycles. Compiler checks retain them. Re-exporting a supported convenience entry is intentional compatibility. |
| L6 | **Retained.** Root/runtime/legacy entries are inexpensive stable forwarding APIs. Package version 0.1.0 is not authorization to break installed consumers. |
| L7 | **Retained style; factoring improved.** New peer modules have purpose headers, and original public entries remain. ESM imports are valid before file comments; moving every historical comment does not repair runtime behavior. |
| L8 | **Corrected.** UI presentation, host session and library workspace are separate layers with different jobs. There is one shared workspace implementation. Public route/label vocabulary is preserved. |
| L9 | **Fixed relevant duplication/contracts; unrelated policies retained.** Import-free chat projection uses one local syntax predicate instead of two inline copies; peer timing/observation and UI config have shared owners. Main peer requester/provider entries now have explicit client, timing, transport, activity and result interfaces. Web Locks, origin-less authenticated service calls and bounded model-layout resolution retain their explicit contracts, not inferred authorization bypasses. |
| L10 | **Fixed ignore/log policy; security-count premise corrected.** Removed broad `html/` ignore; coverage/report directories remain scoped. `deploy/README.md` names stdout/stderr and hosted capture as operational logs, distinct from receipts. Authorization/privacy regressions span many suites; counting a dedicated security folder does not measure that coverage. |

## Verification boundaries

- This work uses focused local checks and CI, not a full repository test run or a physical GPU campaign.
- Browser first-visitor checks use software rendering and explicit acquisition fixtures; they do not prove inference.
- Changed Self code was checked by the actual Verification Worker. Runtime and candidate activation authority remains separate.
- Historical recovery was tested against exact bytes and against a compact source archive; no Git history was rewritten.
- The declaration check proves exported value names and resolution, not equality of every runtime behavior and hand-written type.
- The supplied audit's content-level coverage gaps remain coverage gaps. There is no claim that every unread file was independently audited.
