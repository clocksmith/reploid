# Local document search

Run a model now includes a Document search workflow alongside the unchanged
protein form. It reads `.txt` and `.md`, splits bounded passages, embeds them,
ranks by cosine similarity, and optionally reranks selected passages through
another signed Pack. An optional generation Pack writes an answer with numbered
references to those passages. Missing and out-of-range references reject the
answer and preserve the failed execution's receipts. Valid references identify
source passages; they do not certify the answer's factual correctness.
Files, questions, vectors, results, and history stay in
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
An optional `generator` model uses `requiredOperation: "generate"` and
`workload: "text-generation"`. Its explicit `generationOptions` follow the
Pack generation contract, including token/context limits and sampling policy.
Selecting Write an answer with references executes it after retrieval and any
requested reranking. The generator receives the question and selected passages
locally; neither enters a peer job.

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
The caller receives cancellation or a deadline error promptly. The executor
retains its occupied slot until the underlying runtime and cleanup settle,
preventing cancelled work from overlapping a replacement operation.

The local executor retains at most one opened model session between successful
operations. It rechecks the exact model, publisher trust, runtime version, and
accepted plan before reuse. Changing models closes the prior session; cancellation
and clearing release it, and failed cleanup prevents further use of that executor.
This avoids repeatedly loading the same model for adjacent local operations.

The corpus index retains up to 16 query embeddings in the current tab under the
document-search policy. Reuse requires the same corpus and complete embedding
configuration, including its application identity and query prefix. Results expose
`embeddingCache` and preserve the original embedding receipt when a query vector
is reused. That receipt is evidence of the earlier computation, not a new GPU run.
Clearing documents, replacing the corpus, or configuring different models discards
these vectors. This local cache does not establish improved network scheduling.

Pack v3 release checkpoints live separately in IndexedDB, keyed by the selected
application and release authority. Doppler verifies the complete signed history
and the browser commits its sequence and digest before execution. Concurrent
writes cannot silently replace a checkpoint with a rollback or conflicting branch.
Each reused session checks current eligibility and the saved checkpoint again
before returning output. Clearing private documents preserves this anti-rollback
state; the checkpoint contains no document text, question, or vector.

## Current release boundary

The [retained physical document experiment](../status/document-search-2026-09-06/README.md)
now exercises real embedding and reranking through an installed immutable local
Doppler candidate. The signed F16 embedding Pack passed comparison with pinned
CPU source outputs; all 18 searches passed the small frozen corpus thresholds.
The archive preserves numerical failures, repaired application failures, exact
served runtime bytes, startup and memory measurements, and package receipts.
It does not qualify generated answers or establish independent-user adoption.

The [0.6.0 assistant follow-up](../status/document-assistant-2026-09-06/README.md)
adds real signed generation: 24 searches and six referenced answers, with exact
CPU source token and text parity. A clean candidate build matches the executed
tarball. Repeated answers still incur model reloads, and the retained answer
review identifies incomplete support in two cases. Source parity does not
qualify answer faithfulness. The candidate's GitHub browser and offline checks
also pass; it has not been published to npm or enabled in the public catalog.

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

Reviewed public tasks and complete remote operations are described in
[remote operations](remote-operations.md).
