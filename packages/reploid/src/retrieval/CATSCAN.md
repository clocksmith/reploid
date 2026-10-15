# CATSCAN: Retrieval and Citations

Parent: [Reploid Browser Library](../../CATSCAN.md)

## Target
Retrieval-backed answers whose cited sources were actually retrieved, with failure reported.

## Authority
Owns limits, provenance records, numbered context, claim-to-span mapping, mechanical citation validity and the entailment reviewer contract.
Hosts supply search providers, passage extractors, reviewers, credentials and provider disclosure.

## Scope
This directory.

## Contracts
Inputs: policy JSON, a query, limits and host ports.
Outputs: `reploid.retrieval-record/v1`, `reploid.citation-verification/v1`, `reploid.claim-support/v1`, blinded review packets and per-claim results.

## Invariants
- Requests narrow policy limits; count, characters and time stay bounded.
- Records keep source id, URL, retrieval time, hashes, offsets, usage and exact passage before disclosure.
- A source backed by a fetched page keeps that page's own address and title; search-response titles and snippets are used only transiently.
- Failure or emptiness yields no source and dispatches nothing.
- Valid citations resolve to fetched sources whose passage hash, context digest and exact span hold.
- Support is supported, unsupported or unverified with a reason; only a reviewer independent of the generating model decides support.
- Packets omit generator, route and contributor identity. Model reviewers are off unless configured; sending to one is a separate disclosure.

## Acceptance
Evidence: [retrieval](../../../../tests/unit/retrieval-citations.test.js), [claims](../../../../tests/unit/retrieval-claim-support.test.js), [chat](../../../../tests/unit/chat-retrieval.test.js).
Fixed documents only. Providers, reviewers and REP-8 quality need separate qualification.

## Non-goals
Search providers, ranking, lexical overlap as support judgment, answer grading, UI.

## Freedom
Preserve boundaries and acceptance.
