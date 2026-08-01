# Maverick Hunting and Bug Hinting Guide

Maverick hunting is Reploid's surface-specific practice for detecting and containing evidence-backed deviation. It is not a named runtime subsystem and it is not a claim that Reploid can prove browser hardware or GPU execution was honest.

A maverick is an actor, candidate, execution, or state transition that conflicts with the evidence and policy for its surface. A bug hint is narrower: it identifies an observed failure and the next safe corrective action. Neither label proves root cause by itself.

---

## Two Complementary Loops

| Loop | Question | Input | Action | Closure evidence |
|---|---|---|---|---|
| Maverick hunting | Which participant or candidate should not proceed? | Signed records, policy results, timeouts, validation outcomes | Quarantine, block routing, retain a candidate in shadow, or reject promotion | Surface record plus the rule that caused containment |
| Bug hinting | What should the operator or agent try next? | Structured error, failed precondition, nearby valid path, parse failure | Give one bounded corrective action | Reproduced result, regression test, or successful retry |

Do not turn a bug hint into an accusation. Do not turn a maverick finding into a claim about facts the evidence does not establish.

---

## Surface Rules

### Poolday

Poolday hunts provider behavior that violates its evidence or policy boundary. Useful signals include:

- Signed receipt rejection.
- Repeated assignment timeouts.
- Model or runtime identity violations.
- Failed canaries and challenges.

The reputation projection maps these events to `routingBlocked` and a `quarantineReason`, such as `repeated_rejected_receipts`, `repeated_assignment_timeouts`, or `canary_failed`. Provider admission then places the provider in a quarantined lane and prevents it from receiving work when policy requires it. See [reputation projection](../server/pool/reputation-projection.js) and [provider admission](../server/pool/runtime-profile.js).

Poolday evidence supports a routing decision. It does not prove that a browser, GPU, or remote hardware component executed honestly. Keep that non-claim explicit in records and operator messages.

### X

X hunts unsafe self-modification candidates. A risky candidate remains provisional until it has verifier-backed evidence for promotion. Substrate changes use sandbox verification and Arena gating when enabled, with a snapshot available for rollback. See [tool runner](../self/core/tool-runner.js) and [Recursive GEPA Ring](../self/blueprints/0x000112-recursive-gepa-ring.md).

Validator changes are a special case. They require quarantine, and no candidate may approve the judge that evaluates it. A candidate that fails verification stays unpromoted. Its evidence and failure reason remain available for review.

### Zero

Zero does not have a general autonomous bug zapper. It records structured tool failures, applies bounded retries, and returns corrective text for recoverable errors. Tool-call parse failures explain the required retry shape. See [Tool Executor](../self/infrastructure/tool-executor.js) and [Agent Loop](../self/core/agent-loop.js).

This is operational recovery, not proof that Zero localized or repaired a software defect. Escalate repeated or security-relevant failures to a scoped diagnosis and tested fix.

---

## Traditional Bug Hinting

Use hints to shorten a safe retry, not to conceal uncertainty.

1. State the observed fact: error, rejected precondition, timeout, or mismatched record.
2. Name the narrowest likely boundary: input shape, VFS path, authorization, lifecycle, transport, or receipt integrity.
3. Give one concrete next action that is safe to retry.
4. Preserve the original error and evidence for later diagnosis.
5. Stop retrying when the failure is non-retryable or the retry budget is exhausted.

`ReadFile` provides a narrow example: after a VFS miss, it can suggest a nearby path with a small edit distance. That is a path-recovery hint, not a general code fault-localization engine. See [ReadFile](../self/tools/ReadFile.js).

---

## Investigation and Containment Procedure

1. **Classify the surface.** Poolday provider evidence, X promotion evidence, and Zero runtime/tool state have separate authority and record formats.
2. **Capture the evidence.** Retain the signed receipt, assignment, timeout, validation result, tool trace, candidate diff, or error text that triggered the finding.
3. **Apply the smallest valid containment.** Block Poolday routing, keep an X candidate in shadow, or halt a Zero retry loop. Do not use one surface's state to authorize action in another.
4. **Write a bounded hint.** Describe the observable mismatch and the next safe action. Avoid asserting an unverified root cause.
5. **Fix the invariant.** Change the authorization, validation, lifecycle, or data-binding rule that allowed the defect. Do not substitute a label, TODO, or warning for the correction.
6. **Test adversarially.** Include the negative case that resembles the original defect: missing credentials, wrong role, cross-tenant identifier, forged receipt/body mismatch, oversized input, or remote WebSocket upgrade without credentials.
7. **Verify the deployment boundary.** Confirm the running service has the intended environment values, proxy behavior, listener exposure, origin policy, and reachable-network posture. A committed source patch is not deployment evidence.

---

## Configuration Is Evidence

Configuration is part of the security and promotion boundary. A fail-closed code path can be reopened by a development bypass, an incorrectly trusted forwarded header, a reverse proxy that exposes a loopback listener, or an overly broad origin rule.

For every containment or security fix, record:

- The relevant configuration values and their source.
- The effective remote address and proxy-trust model.
- The listener and origin/network reachability that were tested.
- The exact regression and deployment checks that passed.

Treat a finding as source-fixed only after the invariant and regression test pass. Treat it as operationally fixed only after the deployed configuration and reachable boundary are verified.

---

## State and Evidence Discipline

These practices are general. Apply them within the owner surface rather than creating cross-surface state or authority.

### Invalidate stale work

Every long-lived controller, session, or promotion attempt needs an explicit lifecycle and generation boundary. A generation is a monotonically increasing epoch or token that identifies the currently valid work.

- Invalidate the active generation before reset, stop, reconnect, reassignment, replacement, or disposal begins.
- Capture the generation before asynchronous work starts. Recheck it after every `await` and before publishing state, writing a receipt, persisting, dispatching, rendering, or invoking a callback.
- Make terminal settlement, acceptance, or promotion single-flight for a generation.
- Prevent queued work from starting after its owner is no longer active.

Use this for Zero tool runs, Poolday provider and signaling sessions, and X candidate promotion. A stale completion must not overwrite a newer result or produce a valid-looking record.

### Retain immutable evidence

Treat received peer data, callbacks, restore data, provider output, and plugin-like extension output as mutable hostile input.

- Validate shape before use.
- Deep-clone before retaining, comparing, signing, persisting, or exposing an object.
- Deep-freeze retained plain-object evidence when the receiving surface owns an immutable record.
- Snapshot typed arrays and buffers by value, then retain canonical hashes with the snapshot. Do not rely on freezing non-empty typed arrays.
- Retain the input identity, policy, result, and receipt needed to compare a later replay.

A shallow freeze or an object retained by reference does not protect evidence from later mutation.

### Prove replay and resume

Reload or resume proves reproduction. It does not merely recover a plausible terminal state.

1. Validate the persisted envelope before reading it.
2. Reconstruct from current governed inputs and artifacts.
3. Compare the retained identity, result, policy, and receipt evidence.
4. Clear divergent state and record a bounded failure when comparison fails.

Never preserve invalid saved state as a compatibility fallback.

### Quarantine stale or divergent evidence

Treat evidence freshness as a containment condition, not only a validation warning. Quarantine the affected provider, candidate, session, or recovered state when any of these conditions holds:

- A signed receipt, capability record, assignment, or validator result is stale or expired for the action it would authorize.
- A relay cursor has a replay gap, loses ordering, or advances beyond records the consumer has processed.
- Recovered state has a different canonical input, policy identity, configuration identity, validator identity, or terminal-result identity.
- A replayed receipt or terminal result differs from the immutable evidence retained at the original boundary.

Before accepting recovered state, compare canonical identities for the input, policy, configuration, validator, terminal result, and receipt. A mismatch blocks acceptance, retains the divergence evidence, and follows the owner surface's quarantine or failure-record path.

### Containment lifecycle

Containment has an explicit lifecycle:

```text
active -> quarantining -> quarantined -> released
```

- `active`: work may start under the current generation and policy.
- `quarantining`: one single-flight containment operation captures an immutable snapshot, invalidates the active generation, and records the triggering evidence.
- `quarantined`: routing, promotion, acceptance, or resumed execution remains blocked. Queued work, retries, and stale callbacks cannot bypass this state.
- `released`: an auditable surface-specific rule has verified the release evidence and created a new active generation. Release never reuses stale callbacks, queued work, capabilities, or receipts.

Only the owner surface may release its own quarantine. Poolday release follows provider/policy evidence, X release follows governed promotion evidence with rollback available, and Zero release follows an explicit operator or runtime recovery decision. Do not use containment in one surface as authorization to release another.

### Preserve authority at boundaries

Trace authority rather than repairing a downstream symptom. At each boundary, ask:

- What is allowed to decide this value?
- Which exact record proves it?
- What invalidates it?
- Can an upstream side channel or mutable reference alter it after handoff?
- Does missing evidence produce a blocked, unsupported, or failure record?

Repair the owner boundary when a fallback, guessed field, unvalidated restored payload, or downstream read bypasses that authority.

### Test the old failure directly

Each repair needs a focused regression that fails on the old path. Useful fixtures include:

| Failure class | Regression assertion |
|---|---|
| Stale async work | Pause an operation, invalidate its generation, release it, and assert it cannot publish state, evidence, or callbacks |
| Duplicate terminal action | Race competing terminal calls and assert exactly one settlement, acceptance, or promotion commits |
| Disposal race | Queue work, dispose the owner, and assert no work or publication starts |
| Mutable handoff | Mutate the original nested input after handoff and assert retained evidence is unchanged |
| Invalid resume | Corrupt the persisted envelope and assert it is cleared with a failure record |
| Authority side channel | Poison a non-authoritative input and assert the consumer is unchanged or rejects the missing authoritative input |
| Missing evidence | Remove a required provider, artifact, receipt, or validation result and assert a blocked or unsupported result |
| Cache identity mismatch | Change a behavior-affecting identity and assert the cache is not reused |

Run this focused lane before broader checks. Treat broader suites as release evidence, not as a substitute for the boundary regression. If a wrapper is blocked by an external guard or unrelated dirty worktree, report that condition and the direct focused result separately.

### Make reuse and cleanup provable

Cache keys must include every identity that changes behavior: relevant model and artifact hashes, normalized input identity or hash, policy, provider, runtime, and construction mode. Reuse only proven-compatible handles or sessions. Dispose timers, workers, streams, WebRTC objects, and temporary GPU resources deterministically on teardown.

---

## Static Transport and Boundary Review Patterns

Source review is especially valuable at boundaries where a small default controls a large amount of authority or continuity. Review these invariants explicitly:

- **Authorization fails closed.** Missing, malformed, or unverifiable identity must not satisfy a role, participant, provider, or coordinator check. Development exceptions must be explicit, disabled by default, and tied to a trustworthy local boundary.
- **WebSocket upgrade is an authorization boundary.** Check the upgrade handler, not only message handlers. A remote bridge needs an authenticated connection before it can register an identity, enumerate peers, or delegate work. Origin policy is an additional browser control, not authentication for direct clients.
- **Relay cursors form a total order.** A timestamp alone is not a durable cursor when multiple messages can share a millisecond. Use an ordered tuple such as `(createdAt, messageId)`, paginate from that exact position, and deduplicate retried records. Never advance the cursor beyond messages that were not returned.
- **Pagination cannot silently discard backlog.** A newest-N query paired with a cursor advanced to the newest result loses older unseen records under load. Continue paging until caught up, or expose an explicit bounded-loss policy and make it unacceptable for offers, answers, acceptance, and ICE.
- **Connection attempts always settle.** Every initial-connect promise must resolve or reject on open, error, close, timeout, and cancellation. Explicit stop/disconnect must suppress retry scheduling; retry must have bounded backoff and a visible terminal state.
- **Ordering-sensitive WebRTC messages are buffered.** ICE received before a remote description should be queued per peer, bounded, expired, and drained after the description is applied. Treat overflow and expiry as observable transport failures, not silent drops.
- **Receipts bind returned bytes, not only metadata.** Recompute canonical hashes for returned tensors or other raw result bodies and compare them to the signed record before making the body available to a caller.
- **Input contracts enforce the actual boundary.** A declared public biological-input policy needs a canonical alphabet and an unconditional resource limit; model metadata may tighten the limit but must not be its only enforcement point.

When two transports implement the same cursor, retry, ICE, or status concept, compare their negative behavior as well as their happy path. Prefer shared low-level contracts and regression vectors over merging surface-specific policy or authority.

---

## Decision Boundaries

| Evidence | Permitted conclusion | Not permitted |
|---|---|---|
| Poolday receipt, timeout, canary, or challenge record | Provider routing should be blocked or quarantined under policy | Browser hardware or GPU execution was dishonest |
| X sandbox or verifier failure | Candidate must remain unpromoted or be rolled back | Candidate intent or root cause is known |
| Zero tool error and retry trace | Retry is bounded or operator action is needed | A general code defect has been localized |
| Static source review | A code path permits or fails to prevent the demonstrated condition | Production deployment has the same configuration or exposure |

*Last updated: July 2026*
