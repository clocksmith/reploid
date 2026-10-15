# CATSCAN: Server Search

Parent: [Hosted Services](../CATSCAN.md)

## Target

Server-side web search and bounded cited-page text extraction for retrieval-backed answers.

## Authority
- Owns the Brave and SearXNG adapters, provider credentials, page fetches, fetch tokens, daily budget, priced usage logs and the configured [support reviewer](support-reviewer.js).
- Extraction, passages and fetch limits come from the retrieval library.
- Excludes permission, wording, citation verification, support review and answer quality.

## Scope

- This directory.

## Contracts

Inputs:
- Configuration from [config.js](config.js); callers authorized by the mounting host.

Outputs:
- `/api/retrieval` status, search, extract and usage routes from [router.js](router.js), mounted by [mount.js](mount.js).

## Invariants
- Keys stay server-side: never in URLs, responses, logs or the repository.
- No budget, no routes. A different expected provider sends nothing.
- Extraction fetches only this server's search results, to public addresses, within byte, time, redirect and content-type bounds; passages are exact hashed slices. PDF is unsupported.
- Only accepted queries are billable; unconfigured prices and failed fetches cost null.
- Usage rows carry category and answer key, never query text.
- The approved permission wording names Brave; SearXNG needs owner-approved wording before consumer use.
- The support reviewer is off unless configured; its packets are a separate disclosure.

## Acceptance
- Evidence: [providers](../../tests/unit/server-search-providers.test.js), [extraction](../../tests/unit/server-search-extraction.test.js), [routes](../../tests/unit/server-search-routes.test.js), [reviewer](../../tests/unit/server-support-reviewer.test.js) and the opt-in [live smoke](../../tests/integration/search-live-smoke.test.js).
- Fixtures follow documented formats, not live recordings. Live keys, budgets and provider terms need separate acceptance.

## Non-goals
- Ranking, caching, crawling or browser credentials.

## Freedom
Preserve these boundaries and pass acceptance.
