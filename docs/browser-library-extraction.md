# Browser library extraction

## Ownership

packages/reploid is the publishable browser package. The root package is the
private application and development workspace. self/ remains the static host
surface; server/, functions/ and deployment tooling remain outside the library.

JavaScript implementations and declaration files live together in the package.
Schemas, profiles and selectable policies are JSON. Application-only configuration
is self/config/reploid-library.json. Legacy URL, localStorage, credential and
instance translation is confined to application adapters.

## Extracted owners

- Minimal agent runtime and the dependency-injected Zero/X agent loop.
- Response parsing, cycle artifacts and tool execution with explicit loader ports.
- VFS and explicit memory/IndexedDB persistence.
- Assignment WebRTC/signaling and separate swarm WebRTC/BroadcastChannel protocols.
- Legacy generation requests, streaming, receipt exchange and bounded in-memory duplicate handling.
- Contribution heuristics and explicit local/remote placement.
- Identity signature primitives and the signed improvement episode ledger.

Old modules forward to the generated package copy. Application prompts, catalog
selection, provider policy, credentials, startup and routes stay application-owned.
The application consumes createReploid; its legacy createSelfRuntime signature
adapts existing UI callers. Zero/X retain the exported low-level AgentLoop factory
while their broader dependency graph is migrated.

## Deliberately unfinished boundaries

Complete signed Pack-job scheduling, artifact custody, durable replay and result
acceptance still need extraction from their current application owners. The legacy
generation duplicate cache is not a substitute. Multi-model experimental
coordination has not been repackaged or qualified.

The improvement ledger moved without making its recorder an independent evaluator.
Protected execution, external evaluator attestation, approval/activation adapters
and Genesis recovery integration still require migration. Existing guards remain
with their current owners. Package extraction does not prove recursive improvement.

Work / Network / Improve interface changes are paused during this extraction.
Existing routes and public model admission are not intentionally changed.
Simulatte is untouched.

## Asset and loader contract

npm run sync:library copies package source into self/vendor/reploid and records
byte hashes. That generated copy preserves relative package paths. It is not a
hand-maintained fork. Importing the package does not register a service worker or
take ownership of an embedding application's root.

VFS module loading is a host port with explicit path authorization. The existing
application keeps its current VFS/service-worker loader. Generated candidate code
must be evaluated under a host-provided isolation contract, not assumed safe merely
because a worker or blob URL is involved.

## Acceptance status

No tests, browser checks, type checks, packed-package installation or deployment
are recorded for this extraction. The package README defines the acceptance
matrix. examples/library-consumer is an authored separate consumer, not a passing
result. Source generation is not validation or publication permission.
