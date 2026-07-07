# Poolday Receipt-Backed Retrieval

This is the missing Poolday strategy note for retrieval, embeddings, reranking,
and vector memory.

Status: target strategy and contract direction. This is not yet a public product
claim and not a claim that Reploid is currently a managed vector database.

## Thesis

Poolday should extend from receipt-backed browser inference into
receipt-backed distributed retrieval.

The strategic attack is not "a cheaper hosted vector database." The attack is:

```text
open/pinned local models + browser/peer execution + signed retrieval evidence
```

Pinecone owns the managed hosted vector database lane: storage, indexing,
metadata filters, embedding, reranking, operations, and enterprise service
contracts. Poolday should not copy that shape first. Poolday should own a
different proof surface: every embedding, index build, query, rerank, and
retrieval result can be bound to model identity, corpus identity, runtime
identity, provider identity, policy, hashes, signatures, and optional quorum
agreement.

Public-facing language should stay disciplined:

```text
receipt-backed retrieval and browser inference
```

Do not claim trustless retrieval, hardware-attested retrieval, private retrieval
through public peers, or guaranteed honest browser execution.

## Why This Belongs In Poolday

Poolday already has primitives that retrieval needs:

- signed assignment-bound provider receipts
- exact model id, model hash, manifest hash, runtime, and backend binding
- WebRTC prompt/output/full-receipt transport
- policy-controlled admission
- provider reputation
- requester countersignatures
- ring quorum agreement across browser providers
- embedding workload identity in the pool model catalog
- `vectorHash` receipt support for embedding outputs
- `vectorHash` peer agreement for embedding workloads

The old Reploid cognition stack also has useful local seeds:

- VFS-backed embedding storage
- semantic search
- hybrid retrieval across semantic, summary, and episodic memory
- retention and temporal-contiguity scoring

Those local cognition pieces are not Pinecone-class infrastructure. They are
proof that Reploid already has the right memory concepts. The Poolday version
needs a stricter receipt, index, policy, and benchmark layer.

## Current Boundary

Current claim:

```text
receipt-backed, audit-backed, reputation-backed, policy-controlled browser inference
```

Allowed internal extension:

```text
receipt-backed embeddings as a Poolday workload
```

Target extension:

```text
receipt-backed retrieval: embed, index, query, rerank, and verify
```

Not yet allowed:

```text
Pinecone replacement
trusted public-peer private search
hardware-attested retrieval
trustless vector database
```

## Retrieval Job Types

Poolday retrieval should become a set of explicit workload types, not a hidden
mode inside text generation.

### `embed_documents`

Inputs:

- document or chunk payload hashes
- chunking policy hash
- embedding model id/hash/manifest hash
- normalization policy
- expected embedding dimensions

Outputs:

- vector hashes per chunk
- embedding stats
- provider receipt
- optional batch receipt hash

Agreement field:

```text
vectorHash
```

### `build_index`

Inputs:

- corpus manifest hash
- chunk manifest hash
- embedding receipt set
- index algorithm and parameters
- namespace id
- metadata schema hash

Outputs:

- index manifest
- index build hash
- index snapshot hash or root hash
- index stats
- build receipt

Agreement field:

```text
indexBuildHash
```

### `query_index`

Inputs:

- query hash
- query embedding receipt or query vector hash
- index build hash
- namespace id
- metadata filter hash
- top-k
- score normalization policy

Outputs:

- candidate ids
- candidate score commitments
- candidate set hash
- query receipt

Agreement field:

```text
candidateSetHash
```

### `rerank_results`

Inputs:

- query hash
- candidate set hash
- candidate text/content hashes
- reranker model id/hash/manifest hash
- reranker policy

Outputs:

- reranked ids
- score commitments
- final result set hash
- rerank receipt

Agreement field:

```text
resultSetHash
```

### `retrieve_context`

Inputs:

- query hash
- index build hash
- retrieval policy
- optional reranker policy
- maximum context budget

Outputs:

- final context bundle
- ordered source ids
- source hash list
- retrieval receipt
- optional quorum agreement

Agreement field:

```text
contextBundleHash
```

## Receipt Shape

Retrieval receipts should reuse the provider receipt spine, then add
retrieval-specific fields.

Required shared fields:

- `receiptVersion`
- `signatureDomain`
- `assignmentId`
- `jobId`
- `requesterId`
- `providerId`
- `policyId`
- `workload`
- `model.id`
- `model.hash`
- `model.manifestHash`
- `model.runtime`
- `model.backend`
- `runtime`
- `inputHash`
- `outputHash`
- workload-specific evidence hash
- `verification.runtimeProfileHash`
- `providerSignature`

Retrieval-specific fields:

- `corpusId`
- `corpusManifestHash`
- `documentManifestHash`
- `chunkingPolicyHash`
- `namespaceId`
- `metadataSchemaHash`
- `embeddingModel`
- `indexAlgorithm`
- `indexParamsHash`
- `indexBuildHash`
- `queryHash`
- `queryVectorHash`
- `filterHash`
- `topK`
- `candidateSetHash`
- `rerankerModel`
- `rerankPolicyHash`
- `resultSetHash`
- `contextBundleHash`

The receipt should not store private document text by default. It should store
hashes, ids, scores or score commitments, model identity, policy identity, and
enough metadata for a permitted verifier to replay or challenge the result.

## Result Agreement

Text generation agreement compares token and output hashes. Retrieval agreement
needs workload-specific agreement fields.

Recommended fields:

- embedding: `vectorHash`
- index build: `indexBuildHash`
- vector query: `candidateSetHash`
- rerank: `resultSetHash`
- final context: `contextBundleHash`

Scores can vary across browser/GPU/runtime profiles. Strict agreement should be
limited to compatible runtime profile buckets, or use quantized score
commitments when exact floating-point equality is not the policy.

For most public pool work, agreement should be over ordered ids plus hash-bound
content identity, not raw private content.

## Trust Tiers

Retrieval trust tiers should mirror inference trust tiers.

| Tier | Name | Evidence |
| --- | --- | --- |
| T1 | Signed retrieval receipt | One provider signs assignment-bound retrieval output. |
| T2 | Canary-audited retrieval | Provider passes hidden retrieval/index/query challenges. |
| T3 | Redundant retrieval agreement | Multiple providers return matching evidence hashes. |
| T4 | Ring quorum retrieval | Browser provider ring reaches quorum on retrieval evidence. |
| T5 | Replayable retrieval | Verifier can replay the bounded query/index/rerank path. |

No tier proves hardware honesty unless a future hardware-attested lane is added
and named separately.

## Privacy Modes

Retrieval makes privacy more dangerous than generation because corpora can
contain sensitive documents.

Poolday should support three modes:

| Mode | Corpus placement | Provider set | Allowed content |
| --- | --- | --- | --- |
| Local private | Requester's browser or owned device | Local only | Sensitive data allowed by local policy. |
| Private room | Known team or trusted room | Explicit room members | Team data if policy allows. |
| Public pool | Public browser providers | Unknown providers | Non-sensitive/public content only. |

Public pool retrieval must not handle secrets, private medical data, private
legal data, credentials, or sensitive personal data unless a separate private
deployment and policy says otherwise.

## Required Vector Layer

To become credible against hosted vector databases, Poolday needs a real vector
layer. The current VFS JSON embedding store is not enough.

Required capabilities:

- OPFS-backed vector storage
- durable namespaces
- document/chunk manifests
- metadata filters
- batch upsert
- delete and tombstone handling
- index compaction
- index snapshots
- ANN search for larger corpora
- exact flat search for small/replayable corpora
- deterministic index manifests
- query receipts
- rerank receipts
- local verifier
- benchmark corpus runner
- recall, latency, and cost reports

The first useful implementation can be local-first and browser-only, but it
must expose the same receipt shape that peer and hosted modes will later use.

## Competitive Position

Do not pitch this as "Pinecone, but decentralized" first. That frames Reploid
as a worse hosted database.

The stronger position is:

```text
Pinecone gives you managed retrieval.
Reploid gives you evidence-backed retrieval work.
```

For low-risk public corpora, open-source docs, agent memory, browser-native
apps, benchmark/eval datasets, and local-first workflows, evidence-backed
retrieval can matter more than managed database convenience.

For enterprise hosted production search, Pinecone still wins until Poolday has
durable indexes, metadata filtering, ingestion, auth, observability, service
contracts, and a private deployment story.

## Product Rule

Every retrieval result shown to a requester should answer:

```text
What corpus was searched?
What model embedded the query and documents?
What index was queried?
What filter and top-k were used?
What reranker changed the order?
Which provider/browser/runtime produced the result?
What hashes bind the result?
Did other providers agree?
Who accepted it?
```

If the UI cannot answer those questions, it is a search result, not a Poolday
retrieval result.

## Build Order

1. Keep embedding as an explicit Poolday workload.
2. Add retrieval receipt schemas for `embed_documents`, `query_index`, and
   `rerank_results`.
3. Replace the old cognition embedding store path with an OPFS-backed local
   vector namespace for Poolday retrieval.
4. Add exact flat search with receipts before ANN.
5. Add metadata filters and corpus/chunk manifests.
6. Add reranker workload receipts.
7. Add peer agreement on `candidateSetHash` and `resultSetHash`.
8. Add ANN index manifests and benchmark receipts.
9. Add private-room retrieval policy.
10. Only then test the stronger competitive claim against Pinecone-class
    workloads.

*Last updated: July 2026*
