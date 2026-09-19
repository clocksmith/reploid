# Reploid browser library

Browser-native ESM extracted from the Reploid application. Installed imports,
types, inert browser loading and a separate deterministic consumer pass at root,
nested and cross-origin locations. Model qualification remains separate from
these software contract checks.

## Public entries

| Entry | Owns |
| --- | --- |
| reploid | Compatibility root, including the legacy export |
| reploid/agent | Minimal task agent entry and shared execution lifecycle |
| reploid/legacy | Lab strategy compatibility adapter |
| reploid/jobs | Complete-job contracts, requester, provider, verification and durable journal |
| reploid/custody | Authorized artifact transfer and reconstruction |
| reploid/config | Immutable configuration resolution and provenance |
| reploid/webrtc | Assignment signaling/WebRTC and separate legacy swarm transport |
| reploid/mesh | Placement policy and legacy generation coordination |
| reploid/browser | Explicit IndexedDB, memory stores and VFS adapters |
| reploid/doppler | Optional public Doppler Capsule-session integration |
| reploid/improve | Existing signed improvement episode ledger and promotion-readiness checks |

The package contains no Express, Firebase Admin, application catalog, routes or
server deployment tooling. It does not register a service worker. Importing is
inert; execution and networking require explicit calls.

## Execution ownership

Task and lab strategies use the same attempt lifecycle, turn scheduler, tool
authorization and provider recovery primitives. They retain different context,
planning and result presentation policies. The legacy entry preserves the
application factory API; the minimal entry has no dependency on that adapter.
A host resolves immutable settings before an attempt. Changes apply to the next
attempt, including its provider and authority profile.

The complete-job and custody factories accept explicit host policy, operation
and execution ports. Their application wrappers retain catalogs, credentials,
consent and domain workflows. Existing journal keys, wire identities and
recovery semantics remain compatible. Legacy swarm deduplication remains separate.

Construction is inert. Call store/VFS `init()` to establish readiness; failed or
blocked database opens reject. VFS closes a store only with `ownsStore: true`.
Closing rejects subsequent operations. Cancellation waits for owned activity to
settle; it does not claim to terminate borrowed GPU or JavaScript execution.

## Configuration and ports

Precedence: schema defaults -> configuration chain -> selected profile ->
application overrides -> allowlisted request overrides. Arrays replace arrays.
Unknown fields and non-JSON values fail. Null deliberately disables nullable
fields; undefined is invalid in supplied configuration.

resolveConfig() returns frozen value, provenance and full canonical identity.
hashConfiguration() provides its SHA-256 identity for evidence. Config carries
identifiers and policy, not credentials, callbacks or resource handles.
Constructors accept resolved configuration, not mutable patches.

```js
import { createReploid } from 'reploid/agent';
import { resolveConfig } from 'reploid/config';
import { createMemoryStore } from 'reploid/browser';

const store = createMemoryStore();
const config = resolveConfig({
  overrides: { models: { providerId: 'my-model' }, memory: { storeId: 'memory' }, tools: { allowed: ['Observe'] } }
});
const agent = createReploid({
  config,
  ports: {
    instanceId: 'workshop-1',
    stores: { memory: store },
    providers: { 'my-model': myModelPort },
    tools: { Observe: myObservationTool },
    authorize: hostAuthorization,
    owned: [store]
  }
});
await agent.execute({ goal: 'Inspect the workshop and report a repair hypothesis.' });
agent.cancel();
const checkpoint = await agent.checkpoint();
await agent.close();
```

Model/tool ports must honor AbortSignal. Cancellation suppresses late results;
it cannot forcibly terminate arbitrary borrowed JavaScript or GPU work.
Owned resources implement close(); borrowed resources remain caller-owned.
Checkpoints preserve agent state, not hidden model weights, application VFS,
tool implementations or an automatically approved generation. Acquire declared
dependencies separately. Hashes do not reconstruct absent bytes.

## Doppler generation and streaming

`createDopplerProvider` borrows or owns an already verified public Capsule
session. `openDopplerProvider` opens that same engine through `openCapsule()`;
the host still supplies its descriptor, trusted signers and runtime ports.
The immutable `models.contract` pins `modelId`, `capsuleId`, `semanticRoot`
and `selectedTargetPlanDigest`; `runtimeVersion` can additionally pin the
adopted runtime. Importing the adapter does not import or initialize Doppler.

For operation streaming, supply `toOperationRequest(messages, contract)`.
Return the complete public Doppler request: explicit stream `schema`,
`operation: { name: 'generate', version: 1 }`, input, generation options,
assignment (or null) and input/output/deadline limits. Generation settings and
tokenizer rules stay owned by Doppler. No sampling defaults are added here.
`generate(messages, onUpdate, { signal, adapterArtifactStore })` forwards the
request's `adapterSet` and its host artifact store through `executeOperation()`.

| Request format | Display callback | Completion |
| --- | --- | --- |
| v1, including published Doppler 0.6.1 | Verified final text once; cumulative partial decoding can revise Unicode | Event chain, request, output and receipt verified |
| Explicitly adopted v2 runtime | Stable additions as they arrive, using Doppler's public accumulator | Reconstructed output and complete final receipt verified |

Append additions to a text node (`textNode.appendData(addition)`). A callback
may return a promise: the provider awaits it before requesting another event.
It does not refresh the page, rebuild the output after every token or request
cumulative snapshots. Empty text updates may accompany raw tokens internally.
Text displayed before completion is provisional. Only a resolved generation
result is accepted; `result.evidence` retains the complete operation completion,
including token IDs, resolved settings, stopping reason and execution identity.
Omit the callback to collect the result through the identical operation path.

Cancellation closes the iterator and suppresses late results. A stalled host
formatter or display callback cannot prevent cancellation. Already submitted
GPU work still follows Doppler's cooperative cleanup. Closing a provider aborts
its requests and closes its session only when ownership is `owned`.

The original `toGenerationRequest` formatter remains a completion-only
compatibility path with its original `generateText()` evidence shape. Adopt
`toOperationRequest` explicitly to obtain verified operation receipts; supplying
both formatters fails. An older installed runtime rejects v2 before execution.
The optional peer dependency range alone does not establish stream support.

## Storage readiness

`createVfs().init()` awaits its store's optional `init()` hook. IndexedDB stores
open the configured database before reporting readiness; blocked, failed or
timed-out opens reject, and closed stores cannot be reinitialized. Concurrent
initialization shares one open request without enumerating stored files.
Custom stores without an initialization hook must be ready at construction.
VFS borrows its store; the host closes it. The application VFS adapter owns and
closes its IndexedDB store while preserving its surface/instance database name
and inline `path` key. Mutation results and change events follow transaction
commit, so an aborted write cannot announce a committed file change.
The application's Verification Worker recognizes direct IndexedDB access only
for the exact generated owners `/vendor/reploid/adapters/browser.js` and
`/vendor/reploid/artifacts/job-journal.js`.
This does not grant that file other storage permissions or privilege to adjacent
vendor files, tools or applications. Source verification is separate from
approval or activation of a runtime candidate.

## Network boundary

Network configuration defaults off, with no ICE servers or public room.
Joining is distinct from executing jobs, supplying artifacts or sharing candidates.
The low-level WebRTC APIs implement connections; a host supplies signaling
publication/subscription and private room/TURN credentials through ports.

Closing an assignment transport or reaching its connection deadline settles
pending `connect()` and `ready()` waiters even while browser offer/answer setup
is unresolved. Rejections preserve the `webrtc_connection_failed` code and
connection diagnostics. Cleanup releases each owned connection once; late
browser events and setup results cannot reopen it or publish new signaling.
Already-started browser and signaling operations are not forcibly interrupted.

The swarm-generation adapter retains its legacy messages. Its duplicate cache
is bounded and process-local; it is not the durable Pack-job journal.
Exact model contract matching applies when a contract is configured. A null
contract is compatibility mode, not exact public capability qualification.
Contribution ranking is a heuristic, not independent evaluation.
Complete signed Pack jobs, custody and durable recovery are package mechanisms
with explicit host policy ports. No model is implicitly split across GPUs.

## Improvement boundary

The package owns the existing signed episode ledger, frozen baseline checks,
candidate ancestry, observations, promotion-readiness and rollback records.
The recorder's signature does not prove that an external evaluator endorsed
a payload. The application still supplies protected evaluation, approval,
activation and recovery integrations. A worker alone is not isolation.
Compiler reproduction and causal recursive improvement remain separate proofs;
B's improvement machinery needs an enabled/disabled ablation to support the latter.

## Assets and application migration

src/config/schema.json and src/config/profiles/local.json are public package
assets. Other relative imports resolve within the published src tree. No
repository-relative imports or host-root worker URLs are required.
Dynamic tool loading requires an explicit host loader and path authorization;
it does not take over the embedding site's root or register its service worker.
No generated-candidate worker is supplied or represented as a security boundary.

self/ consumes a generated, byte-preserving copy of this package's source through
public entry modules. Run npm run sync:library from the repository root after
package edits. The copy is not a second implementation. Temporary application
adapters retain instance-storage translation, seed prompts and existing profiles.

## Acceptance before publication

| Boundary | Required evidence |
| --- | --- |
| Packed artifact | Installed imports, exports, declarations and all assets |
| Local-only | Goal/tool execution without signaling or model downloads |
| Isolation | Two instances, independent stores/events, complete shutdown |
| Network | Actual browser jobs, interruption, cancellation, corrupt messages |
| Config | Precedence, provenance, immutable session, authorization ceilings |
| Application | Existing routes, tool flows, protocols and recovery preserved |
| Improvement | Baselines, independent evaluation, approval and rollback remain separate |

These are the complete acceptance requirements. Retained reports identify the
tested subset and exact archives in
[the integration record](https://github.com/clocksmith/reploid/blob/codex/consumer-streaming-closure/artifacts/reusable-products-2026-09-14/README.md).
The current ownership and reproduction commands are in
[architecture stabilization](../../docs/architecture-stabilization.md).
Package existence does not establish publication or deployment readiness.
