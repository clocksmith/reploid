# Physical document assistant, 2026-09-06

Reploid executed real embeddings, reranking, and referenced answer generation
through signed Packs and the installed Doppler 0.6.0 candidate. All 24 searches
passed the frozen retrieval thresholds on 12 short documents and six questions.
All six generated answers, full token sequences, and input prompts exactly
matched the pinned CPU source reference.

This is one internal operator on one physical AMD Radeon 8060S computer with
Chromium 151. It establishes a local integration result. It does not establish
independent adoption, production availability, answer faithfulness, or improved
network scheduling. The host was shared with repository checks and the operating
system cache was not cold.

## Results and limitations

Every retrieval mode achieved MRR@3 and recall@3 of 1.0: embeddings, reranking,
repeated reranking, and retrieval followed by an answer. Embeddings alone already
reached those scores. This corpus does not demonstrate a relevance benefit from
reranking.

| Measurement | Observed value |
| --- | --- |
| Embedding model load | 70,131 ms |
| First reranker load | 55,535 ms |
| First generator load | 79,838 ms |
| Median repeated search with reranking, without generation | 860 ms |
| First complete referenced answer, including generator load | 87,229 ms |
| Later complete referenced answers, including model switching | 140,863–146,231 ms |
| Model openings across the run | 13 |
| Highest sampled JavaScript heap | 3,870,179,296 bytes |
| Doppler buffer pool peak | 1,430,321,408 bytes |

Memory samples exclude untracked GPU allocations and process overhead. The local
executor keeps one model open. Switching between reranker and generator reloads
them, which dominates later answer latency. The fast repeated-search measurement
must not be reported as answer latency.

A post hoc review by the same Codex session found two answer-quality limitations:
the citation answer omits the distinction between a valid citation and faithful support;
the cancellation answer cites passage 1 for statements supported by passage 2. The remaining
four answers appeared supported in that review. This was neither blinded nor an
independent evaluation, and no answer-quality release gate passed. The review is
retained as `observations/document-answer-review-01.json`.

## Exact software and model evidence

The generator is `Qwen/Qwen3-0.6B` at source revision
`c1899de289a04d12100db370d81485cdf75e47ca`, converted with explicit F16 weights
and F32 activations. Its signed Pack semantic root is
`sha256:290a719e4dad4676072e6d7c2c7d531bf7ee35ae0a637c680f76422cae74f410`.
The archive retains its recipe, source reference, declared shader closure,
public signer, application identity, and all non-weight artifacts.

The earlier [embedding qualification and retrieval experiment](../document-search-2026-09-06/README.md)
retains the CPU vector comparison and rejected Q4 candidate. This follow-up uses
the same signed F16 embedding Pack and qualified Q4 reranker. It also retains an
18-search run on the 0.6.0 candidate before the generator stop-token fix.

Batched generation previously omitted the sampled terminal token from its
transcript. Doppler `1f4bc191` repairs that mismatch and adds a regression test.
The archive preserves the failing batched run, corrected runs, and an earlier
Vulkan device-loss failure. A separate raw-session diagnostic retained context
between questions; explicit session reset restored parity. The Pack adapter
already performed that reset. No device-loss reliability claim follows from
later successful runs.

The exact executed package has SHA-256
`95d722c5d3ae10b60e78cd9c8c2ce3a769ecb39229c7f25c1d26a8bf7bee6b10`.
A later clean build from release revision `09a359a5` produced identical tarball
bytes. All 1,756 installed files matched the tarball. That equivalence is retained
under `software/clean-build/`; it does not relabel the earlier working tree as
clean or claim an npm publication.

The candidate passed fresh installation, package imports/CLI/types, and all 763
local test files. Its [GitHub run](https://github.com/clocksmith/doppler/actions/runs/34011399823)
also passed repository checks, the browser WebGPU kernel contract, and the offline
PWA contract. The latter two use synthetic fixtures and remain separate from this
physical model execution. [Release PR 6](https://github.com/clocksmith/doppler/pull/6)
remains a candidate; npm/model-host authentication and the published Node provider
contract remain unresolved. Reploid's public package pin is still 0.5.1.

## Inspect and reproduce

[index.json](index.json) identifies 750 files in
[evidence.json.gz](evidence.json.gz), including the exact 563 served
runtime files, full operation requests and outputs for generation, receipts,
CPU references, diagnostics, build inputs, licenses, and immutable local package
candidates. The 55 omitted weight shards were checked against their
recorded hashes during retention. Private signing keys are excluded.

```sh
node scripts/retain-document-search-evidence.js extract \
  docs/status/document-assistant-2026-09-06 /tmp/document-assistant-evidence
npx vitest run tests/unit/retained-document-assistant.test.js
```

Extraction requires a fresh destination and verifies every archived byte. The
offline test recomputes source token comparisons, retrieval acceptance, citation
locations, package equivalence, and full generation request/output receipt
bindings. It does not execute a GPU or certify semantic support for citations.
The [post-retention checks](validation.json) identify the separate extraction,
offline verification, and Verification Worker browser logs by hash.

A physical rerun requires restoring the exact omitted weights, installing the
retained tarball into a fresh consumer, and remapping local paths in the retained
configuration. Internal Pack trust and application bindings are supplied in
`inputs/document-models-generation-evaluation-01.json`. The reranker's signed v3
history retains its real expiration; do not alter the clock to make it eligible.
Weight hosting, a public model preset, remote generic jobs, real model recovery
across a full browser restart, independent operators, and learned scheduling
benefit remain outside this result.

Component: Poolday document assistant and Doppler generation. Intent: preserved.
Acceptance evidence: retained archive, offline artifact checks, physical Pack
operations, Verification Worker browser tests, and the named CI run.
Boundary effects: evaluation includes signed generation; public release,
remote admission, and independent-use authority remain separate.
