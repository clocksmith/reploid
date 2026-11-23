# Architecture contract

**Status:** Canonical ownership and lifecycle contract for the Reploid mobile
app, adopted from flutter-starter (revision in `.starter-revision`). The chat
feature runs against a synthetic in-memory network; the adapter for real
computers and any device evidence are not implied by these tests.

## Enforced ownership in this repository

| Boundary | Current path | Allowed responsibility |
|---|---|---|
| Domain | `app/lib/features/*/domain/` | Pure Dart models and repository contracts |
| Application, when needed | `app/lib/features/*/application/` | Business operations over domain contracts, never concrete adapters |
| Infrastructure | `app/lib/features/*/infrastructure/` | API adapters, persistence/device access, repository reconciliation |
| Presentation | `app/lib/features/*/presentation/` | Contract-typed state projections, local drafts, and callbacks into ui components |
| Composition | `app/lib/app/`, `app/lib/main.dart` | Provider overrides, concrete adapter assembly, routes, session gates |
| Design system | `packages/ui/`, `app/lib/design_system/` | Visual components, layout, tokens, interaction and accessibility; app branding |
| Shared domain utilities | `packages/core/` | Pure Dart sessions, failures, diagnostics |
| Localization | `app/lib/l10n/` | Labels and safe failure-to-text mapping |

The root `AGENTS.md` links this component map; leaf directories do not repeat
the same architecture and verification instructions. The chat flow needs no
application use-case class: presentation invokes the repository contract and
infrastructure owns reconciliation. Add orchestration only when a business rule
requires it.

`tool/architecture.json` is the machine-readable dependency policy.
`tool/check_boundaries.dart` parses Dart syntax and checks every import, export,
conditional alternative, and part across the production source roots. It rejects
unclassified paths, missing local dependencies, cross-feature coupling,
cross-package internal access (including relative paths), and dependency cycles.
Workspace manifests must match the checked roots; core and ui runtime
dependencies must match their allowed external packages.
External packages are explicitly allowlisted per owner; new transport or device
plugins require an infrastructure policy entry. Part files must retain their
owner. Source symlinks are rejected rather than silently skipped.

Presentation imports Flutter only with a narrow `show` list of lifecycle types.
Composition has a separate list for navigation and app bootstrap. Visual symbols
and indirect device APIs such as `Clipboard` are checked in parsed code, including
prefixed references. External framework re-exports are rejected. These are
syntactic, deterministic policy checks, not a security sandbox or a proof that
arbitrary business logic belongs in the correct layer. Review still owns business
meaning; behavior tests own observable correctness. Do not add exemptions to
accommodate misplaced code.

The reusable ui package has no core, account, repository, or provider dependency.
`SessionGate` now belongs to `app/lib/app/session_gate.dart`; applications
copy that composition boundary instead of importing it from ui. Chat screens
receive navigation as callbacks. Their `chatRepositoryProvider` exposes
`ChatRepository`, and app composition creates, registers, and closes the
concrete implementation. A session is one device signing identity: the
repository, its network connection and every conversation belong to that
session and end with it.

The requester wire protocol is not defined here. Its single definition is the
contract in `packages/reploid/contracts/requester/` at the repository root;
`app/lib/infrastructure/reploid_api/` implements it and is tested against the
contract's vectors. External packages for cryptography, secure storage and
WebRTC are allowlisted for infrastructure only.

`tool/` owns deterministic architecture enforcement, its negative fixtures and
the validation command. Change `tool/architecture.json` and this guide together
when deliberately moving a boundary; do not exempt violations to make CI green.

Run `bash tool/check.sh` for formatting, analysis, architecture checks and their
negative fixtures, core/UI/example behavior tests, and an independent consumer.
CI additionally compiles the example for web. Account replacement, late results,
draft disposal, keyboard actions, semantics, narrow layouts, and enlarged text
are regression targets. Native-device runs remain a separate acceptance step.

The design rationale behind these rules, the layer-by-layer guidance and the
source notes are in flutter-starter's
[architecture guide](https://github.com/clocksmith/flutter-starter/blob/main/docs/guide.md).
This file is the enforced contract; the guide does not add rules.
