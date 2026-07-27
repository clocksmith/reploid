# Reploid Critical User Journeys

Reploid has three separate browser surfaces. Current product status is owned by
one machine-readable journey registry per surface:

| Surface | Route | Readable summary | Canonical registry |
| --- | --- | --- | --- |
| Poolday | `/`, `/ask`, `/compute`, `/records` | [Poolday journeys](./poolday/critical-user-journeys.md) | [`poolday-critical-user-journeys.json`](./status/poolday-critical-user-journeys.json) |
| Zero | `/zero` | [Zero journeys](./zero/critical-user-journeys.md) | [`zero-critical-user-journeys.json`](./status/zero-critical-user-journeys.json) |
| X | `/x` | [X journeys](./x/critical-user-journeys.md) | [`x-critical-user-journeys.json`](./status/x-critical-user-journeys.json) |

The registries own journey status, prerequisites, executable implementation
paths, tests, limitations, release-evidence requirements, and remaining work.
Architecture documents and blueprints may explain mechanisms, but they do not
advance completion status.

Run `npm run verify:journeys` to validate all three registries. The validator
fails on missing evidence paths, unlinked work, invalid status, uncovered
routes, or a missing release gate. Poolday additionally verifies that every
journey model is enabled and permitted by every policy named by that journey.

`Supported` means an executable outcome with automated end-to-end contract
coverage. It does not mean every model, device, network, or objective works.
`Conditional` names those prerequisites. `Limited` names the narrower outcome
that works while the complete user expectation remains unproved. Deployed
claims also require a retained artifact; a passing test mentioned only in prose
does not satisfy that requirement.
