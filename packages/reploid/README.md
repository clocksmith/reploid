# Reploid browser library

Browser-native ESM extraction from the Reploid application. Implementation is
under migration; installed-package and browser acceptance are not yet recorded.

## Public entries

| Entry | Owns |
| --- | --- |
| reploid | Instance lifecycle, agent engines, tool execution |
| reploid/config | Immutable configuration resolution and provenance |
| reploid/webrtc | Assignment signaling/WebRTC and separate legacy swarm transport |
| reploid/mesh | Placement policy and legacy generation coordination |
| reploid/browser | Explicit IndexedDB, memory stores and VFS adapters |
| reploid/doppler | Optional public Doppler Capsule-session integration |
| reploid/improve | Existing signed improvement episode ledger and promotion-readiness checks |

The package contains no Express, Firebase Admin, application catalog, routes or
server deployment tooling. It does not register a service worker. Importing is
inert; execution and networking require explicit calls.

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
import { createReploid } from 'reploid';
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
for the exact generated storage owner `/vendor/reploid/adapters/browser.js`.
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
Complete signed Pack-job scheduling, custody and recovery remain application
owners pending their extraction. No model is implicitly split across GPUs.

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

These are acceptance requirements, not passing results. Do not publish or deploy
from the presence of this package alone.
