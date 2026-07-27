# Poolday Critical User Journeys

Poolday is the internal name for the public Reploid browser-inference surface at
`/`. The canonical journey registry is
[`../status/poolday-critical-user-journeys.json`](../status/poolday-critical-user-journeys.json).
It owns current user outcomes, prerequisites, status, implementation evidence,
tests, limitations, and remaining work.

## Current journey status

| Journey | Status | Honest outcome |
| --- | --- | --- |
| Request a text answer | Conditional | A compatible browser can answer one prompt and return a signed receipt. |
| Recover with local inference | Conditional | After explicit consent, a qualified browser can load the model and retry the preserved request. |
| Contribute browser compute | Conditional | A qualified tab can load one complete model, advertise, answer, sign, and stop. |
| Verify receipt agreement | Supported | The requester can require and inspect deterministic signed-receipt agreement. |
| Inspect records | Limited | Answers, contributions, room events, and scores persist in this browser and room. |
| Run a public protein embedding | Conditional | ESM-2 can return a receipt-bound pooled embedding for an explicitly public sequence. |
| Run a published adapter | Conditional | A promoted, compatible, fetchable adapter can be approved and bound into a receipt. |
| Earn protocol reputation | Limited | Accepted work creates signed local points and reputation events. |
| Receive paid compensation | Blocked | No monetary settlement system exists. |

`Conditional` is not a euphemism for supported everywhere. The registry names the
provider, device, artifact, network, registry, and privacy prerequisites for each
journey. `Limited` identifies the narrower outcome that works today.

## Updating status

A journey change is complete only when the same registry entry contains:

1. A user-visible outcome and its prerequisites.
2. Executable implementation paths.
3. Automated tests for success and relevant failure recovery.
4. Honest limitations and claim boundaries.
5. A release gate and, for deployed claims, a retained run artifact.

The release artifact must bind its journey ids, commit, deployment URL, pool
configuration identity, timestamps, browser, model, receipt, agreement, and final
result. A passing command reported only in prose does not advance journey status.

Remaining work belongs in the registry's `openWork` collection and must reference
one or more journeys. Architecture documents may explain a design, but they do not
own completion status.
