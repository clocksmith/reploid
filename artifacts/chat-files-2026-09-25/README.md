# Chat adapters and peer file acquisition

Baseline: `f45d1c16`. Local working-tree changes on September 25, 2026.
Nothing committed or pushed by this work. Implementation initially remained local;
the subsequent [Hosting deployment](deployment.md) is recorded separately. The existing conversation
workspace and pinned `doppler-gpu@0.6.2` package remain in place.

[Source overlay](source-overlay.tar.gz) preserves the 49 changed/new source,
test and generated files against baseline
`f45d1c1632127c3961adfb45c1b0d2c2250c6100`.
Archive SHA-256: `ebd42faebb4da8886c6a8c9010477008a69b7af2269257aff3d9f7b37241f54a`.
Evidence remains alongside the archive, not recursively included in it.

## Implemented

- The shared catalog pins both chat manifests and tokenizer bytes, and one
  compatible Qwen 0.8B NER JSON adapter. The existing model control selects the
  specialist; thread approvals/grants bind its exact adapter identity.
- Contribution prepares one resident model. Doppler applies/removes the adapter
  within the same device lease as generation and conversation reset. Failed
  cleanup retires the resident. Base conversations retain no adapter state.
- Doppler 0.6.2's scoped session has no `activeLoRAIdentity` getter. Readiness uses
  a configured one-token qualification, and adapted chat uses actual generation
  evidence with incremental token decoding. Requested identity is never copied
  into execution evidence. The vendor package is unchanged.
- Explicit file contribution is separate from compute and input disclosure.
  Files remain in the existing collapsed Network inspector. Its policy bounds
  storage, supply bytes, inventory size, concurrent transfers and channel buffers.
- The library composes existing signed custody, checkpoint and byte-channel
  mechanisms on the actual swarm connection. It validates inventories, reserves
  per-file grants, rechecks final hashes, resumes verified pieces, revokes supply,
  settles shutdown and avoids auxiliary-channel glare during mutual acquisition.
- The host selects pinned sources, verifies SHA-256 metadata/adapter files and
  manifest-declared BLAKE3 weight shards, and supplies Doppler's artifact-storage
  callbacks. Available peer files precede origin acquisition. A failed selected
  peer transfer does not silently retry that operation against the origin.
- Starting/stopping contribution during connection setup cannot create late
  model loads. Automatic discovery still grants no compute, files or disclosure.

## Evidence

### Real GPU, ordinary workspace: passed

[Native run report](adapter/e2e-results.json) includes the `real-chat-evidence`
attachment and actual console output. Two isolated Chrome contexts on this Mac
used normal startup and UI contribution/approval controls, real WebRTC and real
WebGPU. No provider response or artifact fetch was intercepted.

- Adapted response: `{"people":["Alice","Bob"],"cities":["Paris"]}`.
- Subsequent base response: `Hello! How can I assist you today?`.
- Both executed on the same identified peer. The requester made zero model
  download requests. History survived refresh unchanged.
- Base identity: `sha256:edeb69dd65cbb26971abf773a95bf6dc219a82942c0951d65e1893d442b607c9`.
- Adapter identity: `sha256:dc0248f45553e69defd8a1846619443f1ac5902a118548c70a7254c21f66f64b`;
  base response adapter identities were empty.

This earlier run used origin-acquired executor files. Subsequent changes hardened
file-exchange lifecycle and bounded download loops. It does not qualify the final
three-tab peer-weight path or general adapter quality.

### Three-tab real model journey: blocked, not passed

[Failure report/screenshots](storage-failure/e2e-results.json). Three isolated
Chrome contexts opened the normal workspace, automatically connected, and C
explicitly prepared and offered the model/adapter files without compute consent.
B attempted preparation through peer custody, but Doppler preflight failed at
`shard_00016.bin`: Chrome rejected the cache write for exceeding storage quota.
The Mac had only 631 MiB free when diagnosed, later 417 MiB. No user data or old
model caches were deleted. The full journey has not reached generation.

The user authorized local Chrome tabs instead of additional physical devices.
Separate contexts are intentional: same-origin tabs sharing OPFS must not pass
by reading the supplier's disk cache instead of exercising peer transfer.
Free at least 4 GiB or provide a writable test volume before rerunning:

```sh
POOL_ALLOW_UNAUTHENTICATED_LOCAL=true REPLOID_SKIP_CLOUD_ACCESS_BUILD=true npm start
REPLOID_E2E_ACTUAL_INFERENCE=1 REPLOID_E2E_SKIP_LOCAL_SERVER=1 REPLOID_E2E_CHROMIUM_CHANNEL=chrome npx playwright test tests/e2e/chat-real-adapter.spec.js --project=chromium --workers=1
```

### Regression and boundary checks

- 144 focused unit tests in 14 files passed; [machine-readable report](unit.json).
- [Browser report](browser/e2e-results.json): 19 passed, including actual WebRTC
  bidirectional custody with synthetic bytes, persisted/revoked recipient grants,
  cancellation/context isolation with injected execution, durable checkpoint
  restart, and Verification Worker acceptance of changed modules.
- Light/dark desktop/mobile empty/active/approval/completed screenshots are in
  `browser/`. The layout and main conversation controls are preserved.
- Layer/loader checks, library TypeScript checks, CATSCAN graph, targeted ESLint,
  and whitespace checks passed. Existing immutable-bootstrap worker rejection
  remains enforced; no verifier or security policy was relaxed.
- Registry: zero unresolved references. Six generated files were byte-identical
  on a second generator run. Eighteen existing missing individual blueprints are
  informational, not unresolved imports.
- Local browser bundle: `sha256:c46b08204868c3747c176c8a9843aaa1757bb8e067bd4d231141c14e5ebeef36`,
  2,688 served files. This is not a deployed build claim.

## Still open

The disk-blocked full three-tab real model/adapter journey must pass before
calling peer model acquisition end-to-end qualified. Existing complete-job Pack
integration, cross-device generation and Doppler-defined physical layer splitting
remain distinct work/qualification boundaries; legacy signed chat records are not
signed complete-job qualification. No learned-placement gains are claimed.

## Material-change handoff

- Component: chat host/providers, artifact custody, peer transport, runtime catalog
  and conversation inspector.
- Intent: preserved. File custody, compute, thread disclosure and adoption remain
  separately authorized; computational semantics remain Doppler-owned.
- Acceptance evidence: reports and commands above. Full model journey blocked
  by host storage capacity, not recorded as passed.
- Boundary effects: host composes catalog/storage grants and Doppler file ports;
  library supplies bounded custody/auxiliary transport; UI requests consent.
  No backend, pinned Doppler package, agent loop or deployment changes.
