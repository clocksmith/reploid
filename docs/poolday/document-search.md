# Local document search

Run a model now includes a Document search workflow alongside the unchanged
protein form. It reads `.txt` and `.md`, splits bounded passages, embeds them,
ranks by cosine similarity, and optionally reranks selected passages through
another signed Pack. Files, questions, vectors, results, and history stay in
memory in the current tab. Clear documents removes them; reloading also clears
them. Recent jobs distinguishes these local searches from peer evidence.

## Selecting models

Open Model Packs, select an application-owned JSON configuration, review its
publisher keys, confirm trust, and choose Use these Packs. This selects models
locally. It does not admit a model to the public catalog, advertise compute,
authorize artifact redistribution, or send documents to peers.

The configuration has schema `reploid.document-models/v1`, an explicit
`queryPrefix` string, an `embedding` model, and either a `reranker` model or
`reranker: null`. Query preprocessing belongs to the application contract;
the prefix may be empty when the qualified embedding workload requires none.

Each model supplies:

- `modelId`, `runtime: "doppler"`, `runtimeVersion`, and `backend: "browser-webgpu"`.
- `executionMode: "complete_pack_browser"`.
- `workload: "embedding"` or `"reranking"`.
- `modelHash` equal to the Pack semantic root; `manifestHash` equal to its envelope digest.
- `executablePack`: exact schema/id/root/envelope/closure, artifact inventory,
  accepted TargetPlan digests, and `requiredOperation: "embed"` or `"rerank"`.
- `packSource`: the Pack's HTTP(S) URL.
- `packOpenOptions`: explicitly trusted signer keys and required lifecycle policy.
- For embedding and reranking, `application`: the exact application identity signed into that Pack's release.

Use identities exported by the publisher; model names or invented hashes are
not substitutes. The Pack Runtime verifies signatures and bytes, selects an
accepted plan, and returns operation receipts. Reploid checks those receipts
against the request before exposing completed results. Cancellation discards
late output; it does not claim physical GPU preemption.

## Current release boundary

The installed/public Doppler 0.5.1 package lacks the required Pack operation
surface. The paired Doppler source repair and browser fixtures are tested, but
this is not a production-ready model offering. No candidate is enabled by this
change. Release the repaired package under a new immutable package identity,
update Reploid's verified pin, and qualify actual embedding and reranker Packs
before public enablement. No production deployment occurred.

## Verification

`npx vitest run tests/unit/pool-document-search.test.js` covers input bounds,
content deduplication, retrieval, exact model admission, receipt consumption,
cancellation, and clear-during-execution. `tests/e2e/document-search.spec.js`
exercises Chrome desktop/mobile UI, explicit publisher trust, private payload
non-transmission, literal rendering, and the actual Verification Worker.
Model outputs in these fixtures are synthetic, not physical GPU evidence.

`DOPPLER_TEST_CHECKOUT=/path/to/doppler npx vitest run
tests/integration/doppler-pack-handoff.test.js` exercises the real Doppler Pack
producer and Reploid consumer with injected model programs. Source production,
model qualification, package release, and external adoption remain separate.

*Last updated: September 2026*
