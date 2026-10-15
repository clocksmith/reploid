# CATSCAN: Retrieval and Citations

Parent: [Reploid Browser Library](../../CATSCAN.md)

## Target
Retrieval-backed answers whose cited sources were actually retrieved, with failure reported.

## Authority
Owns limits, provenance, numbered context, claim-to-span mapping, mechanical citation validity, the entailment reviewer contract, per-answer costs and shared page text, passage and fetch limits.
Hosts supply search providers, passage extractors, reviewers, credentials, prices and provider disclosure.

## Scope
This directory.

## Contracts
Inputs: policy JSON, a query, limits and host ports.
Outputs: `reploid.retrieval-record/v1`, `reploid.retrieval-costs/v1`, `reploid.citation-verification/v1`, `reploid.claim-support/v1`, blinded review packets and per-claim results.

## Invariants
- Requests narrow policy limits; count, characters and time stay bounded.
- Records keep source id, URL, retrieval time, hashes/offsets, usage, exact passage and supply before disclosure.
- Fetched-page sources keep that page's own address and title; search-response titles and snippets stay transient.
- Failure or emptiness yields no source and dispatches nothing.
- Valid citations resolve to fetched sources whose passage hash, context digest and exact span hold.
- Support is supported, unsupported or unverified with a reason; only generator-independent reviewers decide it.
- Packets omit generator, route and contributor identity; model reviewers are off unless configured and are a separate disclosure.
- Retrieval, verification and fallback costs stay separate, outside conversation text; unpriced or unmeasured work is null, not zero.

## Acceptance
Evidence: [retrieval](../../../../tests/unit/retrieval-citations.test.js), [claims](../../../../tests/unit/retrieval-claim-support.test.js), [chat](../../../../tests/unit/chat-retrieval.test.js), [costs](../../../../tests/unit/retrieval-costs.test.js), [device](../../../../tests/unit/device-search.test.js).
Fixed documents only. Providers, reviewers and REP-8 quality need separate qualification.

## Non-goals
Search providers, result ranking, lexical overlap as support judgment, answer grading, UI.

## Freedom
Preserve boundaries and acceptance.
