# ESM-2 through the shared Pack operation interface

The [episode](episode.json) connects real peer-owned Pack bytes to
`openPack().executeOperation()` and Poolday's common receipt validator. It
reconstructs the signed envelope and all 24 dependencies, rejects corrupt
contributions, recovers from supplier departure, and passes all eight frozen
reference checks. Origin and mirror fallbacks are disabled; none is attempted.
The receiver starts with empty IndexedDB and OPFS model caches.

The operation is `{ name: "encodeSequence", version: 1 }`. Its completed receipt
binds the exact Pack, accepted TargetPlan, runtime version, request, assignment,
limits, input, and output. The result reaches the requester only after the
operation stream completes. Sampled pooled/token maximum errors remain
0.000512970571081163 and 0.0008977349577942162, below 0.001. This is sampled
reference agreement, not complete numerical equivalence or biological truth.

This is one physical Intel gen12lp machine with four internally operated browser
contexts, not four independent machines. The model signing authority is the
explicit Doppler development key. JavaScript is installed runtime software;
model weights and shaders come from verified peer custody. Two pinned runtime
device probes are the only shader bootstrap exception.

## Reproduction and provenance

[index.json](index.json) hashes 28 retained files and locates the two unchanged
weight shards at immutable HTTPS URLs. It retains the exact Pack, all smaller
artifacts, source license, reference oracle, and patches against recorded source
commits. The episode additionally hashes 557 served runtime files. It records
dirty working trees; no commit, publication, or deployment is implied.

Use the [earlier episode's reproduction command](../esm2-peer-pack-2026-09-05/README.md#reproduce)
with `retained = resolve('docs/status/esm2-pack-operation-2026-09-05')` and the
source state represented by this episode's patches. All other steps remain the
same. This configuration explicitly sets `operationLimits.maxInputBytes` to
65536 and `maxOutputBytes` to 4194304; its deadline is the fresh authorization
expiry. The older episode retains the legacy method and original source state.
These separate immutable observations preserve API-transition provenance; they
are not competing sources of current runtime policy.

The source observation is also retained locally at
`/tmp/esm2-operation-proof-eTNoNm/episode.json`. Test the archive offline with
`npx vitest run tests/unit/retained-peer-pack-episode.test.js`.

## Scope and remaining work

Four-operation unit and paired-repository tests use injected programs. Only
ESM-2 has physical execution evidence through this interface. The fifth-adapter
test proves the common runner and receipt consumer can extend without network
edits; it does not qualify an audio model.

The enabled public catalog and existing remote provider path remain sequence
specific. Real text Pack qualification, generic remote admission and dispatch,
the local assistant, persistent/resumable/parallel model custody, independently
operated machines, hard remote termination, and learned routing remain work.
Cooperative signals do not establish GPU preemption. No reviewed-history benefit
or 1,000-job evaluation has been observed.

Component: Doppler runtime client/config/tooling and Poolday Evidence Runtime.
Intent: deliberately generalized operation semantics; existing interfaces and
scientific authorities preserved. Boundary effects: one versioned invocation
and completion receipt across operation adapters, consumed by the real peer
Pack proof. Repository goals and component intent now explicitly distinguish
distribution, remote execution, and learned coordination.

Acceptance evidence: Doppler `npm run check:green` exits zero, including the new
operation test and packed-package checks. Poolday's four-operation paired test,
focused unit tests, browser custody/Verification Worker test, component graph,
module-system, and layer checks pass. This does not mean every Reploid test or
the independent-network acceptance gates passed.

The registry-audit skill led to ordered, byte-idempotent generation and a
maintained runtime-blueprint mapping for the new interface. Its current 98
unresolved findings are 82 orphan-file reports and 16 missing-blueprint reports;
validator exit zero is not a clean audit. The prior 99-finding observation remains
historical evidence.

*Last updated: September 2026*
