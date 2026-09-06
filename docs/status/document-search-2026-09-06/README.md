# Physical document search, 2026-09-06

Reploid executed real Qwen embeddings and reranking through the installed
Doppler `openPack().executeOperation()` interface. All 18 searches passed the
frozen relevance thresholds: 12 short documents, six questions, and three modes
(embeddings, reranking, repeated reranking). Each mode achieved MRR@3 and
recall@3 of 1.0. Embeddings alone already reached those scores; this experiment
does **not** demonstrate a relevance improvement from reranking.

This is an internally authored corpus, frozen before execution, operated by one
person on one AMD Radeon 8060S machine using physical Chromium 151 WebGPU. It is
not an independent benchmark, external adoption, network scheduling improvement,
or referenced-answer qualification. The operating system cache was not cold and
the host was not isolated from other work.

| Measurement | Observed value |
| --- | --- |
| Embedding model load | 69,050 ms |
| Reranker model load | 54,988 ms |
| First query, including index construction and embedding load | 74,504 ms |
| Median repeated query with reranking | 866 ms |
| Highest sampled JavaScript heap | 2,601,462,264 bytes |
| Doppler buffer pool peak | 1,430,321,408 bytes |

The last two values exclude untracked GPU allocations and process overhead.
The application opened only two model sessions across all 18 searches. Query
embedding reuse retains the original operation receipt; it does not invent a
new execution. Reranking still executes for each reranked query.

## Independent source comparison within this host

The embedding source is `Qwen/Qwen3-Embedding-0.6B` at revision
`97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3`. A CPU FP32 Hugging Face Transformers
reference retains all token IDs and all 1,024 vector values for 18 texts. The
acceptance policy froze exact token IDs and maximum absolute vector error 0.02.

The Q4 candidate failed that policy for every vector. The F16 candidate passed
all 36 token/vector checks, with maximum absolute error approximately 0.000071.
The final signed F16 Pack also passed all checks and retained 36 completed
operation receipts from repeated execution. The Q4 failure remains archived;
the threshold was not relaxed. Activations remain explicitly F32 in the recipe.

The reranker is the previously qualified Qwen Q4 Pack with semantic root
`sha256:769823e659b1b7ff1d0e52dc7a3536b7a04cfa301bd1f7f2168ed462415496de`.
This document experiment measures retrieval relevance, separately from the
reranker's numerical source qualification.

## Inspect and reproduce

[index.json](index.json) hashes every entry in [evidence.json.gz](evidence.json.gz),
plus the 32 omitted weight shards. The archive contains 660 files: exact served
runtime bytes, the runner, CPU reference, observations, non-weight Pack artifacts,
model licenses, build inputs, two immutable local package candidates, their
installation receipts, and check logs. Private signing keys are excluded.
Omitted weight hashes were checked against their local bytes during retention.
The index does not claim those weights have been published.

From this repository, extract into a new directory:

```sh
node scripts/retain-document-search-evidence.js extract \
  docs/status/document-search-2026-09-06 /tmp/document-search-evidence
npx vitest run tests/unit/retained-document-search.test.js
```

The extractor verifies the compressed archive and each file before writing.
The offline test recomputes token/vector comparisons and retrieval acceptance,
checks runtime hashes and receipt identity/digests, and preserves the failed
attempts. It does not rerun a GPU or reconstruct omitted operation payloads.
Complete operation input/output binding was checked by the live consumer.

Inside the extracted archive:

- `document-search/qualification.json` contains all 18 results and measurements;
  `document-search/runtime/` contains the exact 563 served files.
- `observations/` preserves the Q4 failure, F16 controls, signed Pack comparison,
  and both failed application attempts. The failures exposed missing persisted
  release checkpoints and undefined GPU timing fields; both were repaired before
  the final run. Earlier attempts retain reports and reported source hashes,
  not complete runtime source snapshots.
- `packs/` contains both signed model descriptions and all non-weight artifacts.
  Restore the listed weight paths with bytes matching `index.json` before a GPU
  rerun. The embedding recipe and pinned source comparison tools are under
  `doppler-source/`; the source identity is in `inputs/`.
- `software/document/doppler-gpu-0.5.2.tgz` is the exact package used by the final
  document run: SHA-256
  `b19ae84aa6b6b59fb29df47d5c1125d107bd9d700a8c1ec2aaf03fcd86f9769b`.
  The separate `software/final-embedding/` candidate was used for the signed
  embedding comparison. All 1,756 installed files matched each candidate's tarball.

To rerun, install the extracted document tarball into a fresh consumer, restore
the weights, then supply explicit local paths and browser executable in the
retained runner configuration. Pack trust and application bindings are retained
in `inputs/document-models-evaluation-01.json` and in the report. They identify
internal evaluation applications, not a public catalog admission. V3 release
history retains its real expiration; a later run needs currently eligible signed
history and persisted checkpoints, not an altered clock.

Both packages are local **release candidates**, not npm-published 0.5.2. Their
source-state records disclose modified source trees. The final candidate passed
the full Doppler check chain (763 test files); separate browser and offline
application contract logs are included. Those latter tests use synthetic model
fixtures and are distinct from the physical model runs. Reploid's retained logs
record 2,366 passing tests, 35 skipped, and 14 passing browser checks including
the Verification Worker sandbox and native IndexedDB recovery.

Component: Poolday local documents and Doppler Pack execution. Intent: preserved.
Acceptance evidence: retained archive, offline artifact test, and named check
logs. Boundary effects: local session reuse and application-owned release
checkpoints; public model admission, publication, remote execution, independent
machines, and generated referenced answers remain separate work.
