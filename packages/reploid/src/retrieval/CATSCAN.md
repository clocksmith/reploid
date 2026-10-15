# CATSCAN: Retrieval and Citations

Parent: [Reploid Browser Library](../../CATSCAN.md)

## Target
Retrieval-backed answers whose cited sources were actually retrieved, with failure reported.

## Authority
Owns limits, provenance records, numbered context and mechanical citation checks.
Hosts supply search providers, passage extractors, support checkers, credentials and provider disclosure.

## Scope
This directory.

## Contracts
Inputs: policy JSON, a query, limits and host ports.
Outputs: `reploid.retrieval-record/v1` and `reploid.citation-verification/v1`.

## Invariants
- Requests narrow policy limits; count, characters and time stay bounded.
- Records keep source id, URL, retrieval time, content hash and exact passage before disclosure.
- Failure or emptiness yields no source and dispatches nothing.
- Citations resolve only to recorded sources; uncited claims and unrecorded URLs are flagged.
- Support is supported, unsupported or unverified with a reason; no checker means unverified.
- Sources travel in conversation messages under the existing disclosure authorization.

## Acceptance
Evidence: [retrieval](../../../../tests/unit/retrieval-citations.test.js), [chat](../../../../tests/unit/chat-retrieval.test.js).
These cover software contracts with fixed documents only.
A search provider, a support checker and REP-8 answer quality each need separate qualification.

## Non-goals
Search providers, ranking, the lexical test checker as support judgment, answer grading, UI.

## Freedom
Preserve boundaries and acceptance.
