# Blueprint 0x0000AF: Reploid Rooms & Distributed Cognition Runtime

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x0000AF-reploid-rooms-distributed-cognition.md`

## Status and scope

This is a Proposed design note. No module implements the room protocol it describes, and nothing here is a product claim. It proposes a conversational room in which humans and persistent agents talk while the agents' work runs as routed, inspectable executions on browser peers.

It overlaps existing code and documents, which remain the authority for what runs today:

- [`apps/poolday/pool/peer-room.js`](../../apps/poolday/pool/peer-room.js): requester room discovery, peer assignment planning and receipt agreement for Poolday jobs.
- [`packages/reploid/src/transport/room.js`](../../packages/reploid/src/transport/room.js): the swarm transport that selects BroadcastChannel or WebRTC for room messages.
- [`docs/poolday/room-1-pilot-charter.md`](../../docs/poolday/room-1-pilot-charter.md): the Room-1 research pilot (protein annotation adjudication).

Any implementation of this design must extend those surfaces rather than add a parallel room stack.

## Design premise

A chat product with model replies attached would discard what is distinctive about Reploid. The proposal is a room whose human-facing surface looks like chat, while each agent reply is a routed computation; each agent has an identity separate from the machine running it; and each result can be provisional, witnessed, challenged, accepted, corrected, or promoted into shared memory.

The existing peer substrate already provides signed provider adverts, deterministic peer assignment, direct WebRTC delivery of inputs, outputs and receipts, one-provider, redundant and ring-quorum execution policies, requester acceptance, signed evidence records, and bounded at-least-once relay recovery. The current peer payload contract carries prompts, inputs, complete results, receipts, artifacts, acknowledgements and errors, but no conversational streaming events. Redundant execution runs the full model on each selected provider; split routes are not yet qualified. The room protocol is therefore new work on top of the substrate, not a restyling.

## Entities

The design separates "agent", "model" and "browser running inference".

| Entity | Meaning |
| --- | --- |
| Human | A participant who owns identity, consent, relationships, agents and final approvals. |
| Agent | A persistent identity with a name, owner, role, policy, memory boundary, tool permissions and room relationships. |
| Embodiment | One live computational body for an agent: exact model, artifacts, runtime, provider browser, context checkpoint and execution policy. |
| Provider | A browser offering bounded compute, supported models, runtime identity, availability and evidence history. |
| Witness | A peer that independently reruns, verifies, challenges or observes an execution. |
| Room | A membership contract, causal event graph, active peer topology, policy, shared working state and promoted memory. |
| Run | A bounded inference or tool execution started by a message or an agent decision. |
| Artifact | An output, file, structured result, receipt, comparison or evidence object produced by a run. |
| Memory | A deliberately promoted room or agent artifact, never an automatic copy of every utterance. |

An agent can stay socially continuous while its embodiment changes, but the change must be visible. A valid handoff binds: agent identity, prior state or checkpoint hash, new embodiment identity, model and runtime identity, handoff authorization, and the accepted continuity policy. Without that chain the new execution is a different model presenting the same name.

## Four planes

1. **Conversation:** messages, replies, mentions, reactions, interruptions, threads, files, decisions, disagreement and presence.
2. **Execution:** provider discovery, model selection, assignment, WebRTC negotiation, input delivery, generation, tool execution, cancellation, retries, handoff and verification runs. One visible reply may map to several executions.
3. **Evidence:** what ran, which model and artifact, on which declared runtime, whether another provider reproduced it, whether there was a fallback, and who accepted, challenged or corrected it. Disclosed progressively.
4. **Memory:** ephemeral conversation, working context, proposed memory, accepted room memory, signed evidence, decisions, evaluations, retracted or superseded memory, and private agent memory are separate classes. The transcript is not the room's knowledge.

## Turn objects and room events

The visible unit is a message; the protocol unit is a turn object. A requester's message such as "compare these two architectures" can declare author role, addressees, room, intent, response mode, privacy, maximum responders, total token budget, deadline, tool policy and memory policy. One turn may spawn several executions and remains one conversational act.

A state-changing room event follows the existing peer envelope discipline:

```text
eventVersion, roomId, eventId, eventType, actorId, actorKind,
causalRefs, visibility, createdAt, expiresAt, body, bodyHash,
publicKey, signature
```

The room is a causal event graph, not a single global sequence. Edits are new events, deletions are tombstones, corrections link to what they correct, and peers converge as missing events arrive. Delivery is bounded at-least-once, so every durable action needs a stable event identity and idempotent handling.

## Agent message lifecycle

| State | Shown to people | Meaning |
| --- | --- | --- |
| Queued | "finding compute" | The agent accepted the turn; no embodiment is ready. |
| Connecting | "connecting to an eligible browser" | A provider was selected and WebRTC is negotiating. |
| Working | activity label | Input arrived and execution began. |
| Streaming | provisional text | One embodiment is producing deltas; nothing is committed. |
| Committed | text stops changing | The primary execution committed a final output hash. |
| Witnessing | "checking with two peers" | Independent executions or verifiers are running. |
| Verified | "3 matching runs" | The declared agreement rule passed. |
| Diverged | "two results differ" | Disagreement is preserved, not resolved silently. |
| Accepted | acceptance marker | The requester or an authorized human accepted the result for a stated purpose. |
| Remembered | memory badge | The result was separately promoted into room memory. |
| Corrected | superseded marker | Later evidence linked a correction or contradiction. |

Streaming text is provisional. If witnesses disagree, the message becomes a visible disagreement object (primary answer, alternative, where they differ, and actions: adjudicate, keep both, rerun).

## Three kinds of multi-peer inference

- **Redundant execution:** same model, artifact, input, configuration and compatible runtime, run independently, for reproducibility and tamper detection; quorum over exact result identity. Close to the current ring policies.
- **Deliberative diversity:** different agents or models produce different analyses on purpose. No exact-output quorum; comparison, claim extraction or a designated synthesizer instead. Majority text is not truth.
- **Cooperative decomposition:** agents perform different parts of one task (planner, researcher, implementer, reviewer, synthesizer). The final result carries the dependency graph of contributing runs.

## Response modes

| Mode | Meaning | Execution policy |
| --- | --- | --- |
| Quick | first useful answer | one eligible embodiment, streamed |
| Checked | answer, then verify | streaming primary plus compatible witnesses |
| Verified | finalize only on agreement | redundant or ring-quorum execution |
| Council | preserve differences | heterogeneous agents or models, no hash consensus |
| Workshop | divide the work | explicit task graph with bounded roles and synthesis |
| Private | no unknown providers | local-only or explicitly trusted room providers |

## Floor control

Agents must not all answer every message. A turn may be addressed to one agent, several named agents, "one suitable agent", a council, humans only, or silent observation. An agent requests a bounded speaker lease (turnId, agentId, response role, token budget, tool budget, deadline, whether streaming is allowed, whether it may summon further agents) before replying. Leases prevent duplicate answers, agent-to-agent loops and unbounded compute.

Human interruption always wins: stop, pause, redirect, let one agent finish and cancel the others, or forbid further agents in a thread. An interrupt is a causal event; providers receive cancellation over their data channels; late output is kept only as an orphaned artifact. Declining to speak is a valid agent action (already covered, low confidence, no eligible embodiment, privacy excludes available providers, budget exhausted).

## Presence and transport

Presence is a local, time-bounded projection with distinct states: present, reachable, agent available, agent waiting for a body, provider available, model cached, model active, busy, witnessing, sleeping, disconnected, stale. The interface shows the relevant state ("present, waiting for a compatible model") rather than a single online dot.

Transport rules the room inherits:

- No exactly-once delivery; meaning never depends on a callback firing once.
- A WebRTC session is not a relationship; losing a data channel ends a transport, not membership.
- Reload does not silently resume a sensitive in-flight request; the saved state is validated and the person chooses retry (as a new run identity) or discard.
- Direct delivery keeps content off the signaling service, not away from the selected provider, which processes plaintext. The composer states the real boundary, for example "may be processed by two trusted room devices" or "may be processed by an unknown contributor browser". Signaling carries offers, answers, ICE candidates, close and ping only.
- A TURN relay path is transport, not central inference; the interface distinguishes direct versus relayed path and local versus remote provider.
- Browser sleep, device loss, GPU resets and storage eviction are normal and are reported plainly ("provider became unavailable; 418 provisional tokens; no committed answer").
- Streaming needs bounded buffers and sequence numbers; cosmetic deltas may drop, the signed commit carries the full body or a retrievable body hash.

Proposed data channels: `room-control` (reliable, ordered, signed events), `run-stream` (ordered, bounded deltas), `artifact-transfer` (reliable, chunked, resumable), `presence` (loss-tolerant).

## Agent manifest and embodiment

A persistent agent manifest: agentId, display name, owner identity, role, public behavior policy, memory namespaces, allowed rooms, tool permissions, approved model families, minimum evidence tier, handoff policy, avatar identity, manifest hash, owner signature.

A live embodiment attachment: agentId, run or session id, provider identity, model id and hashes, runtime profile, state checkpoint hash, context policy, tool surface, start and expiry, attachment signature.

A handoff is a visible event. People can inspect what state transferred, whether private memory was included, whether the new model was allowed, whether capabilities changed, whether prior output was committed, and who authorized it. No silent model substitution.

## Memory classes

- **Transcript:** searchable history, not accepted knowledge.
- **Working set:** temporary context for the current discussion; expires or is replaced deliberately.
- **Evidence memory:** signed outputs, claims, receipts, challenges, corrections and sources.
- **Decision memory:** what authorized humans or room policy accepted for a declared purpose, with scope, owner role, date and supporting artifacts.
- **Procedural memory:** measured lessons about routes, models, reviewers and workflows.

Contributions may update routing statistics or create memory proposals. Durable policy or capability changes require evaluation and operator promotion under [`promotion-contract.md`](promotion-contract.md); agreement, receipts or contribution never establish truth on their own.

| Contribution | Permitted effect |
| --- | --- |
| Provider success or failure | routing, retry and capacity estimates |
| Model output | candidate result or evaluation sample |
| Independent agreement | reproducibility evidence for that exact contract |
| Disagreement | a new uncertainty or adjudication task |
| Human correction | evidence against a prior claim and an evaluation example |
| Accepted answer | scoped room memory |
| Later failure | correction, revocation and policy feedback |
| Repeated workflow gain | candidate capability promotion, pending operator adoption |

## Interface outline

- **Conversation timeline** in the center; agent status only when useful; no permanent wall of hashes.
- **Room header:** room name, participants, privacy mode, default response mode, compute budget, memory policy.
- **Participant ribbon:** humans and agents as identities, with a small embodiment indicator ("ready, local model"; "present, no compute body"). Providers that are not participants belong in the mesh inspector.
- **Composer:** a normal message box with addressee, mode and privacy beside Send; advanced options (exact model, maximum providers, deadline, token budget, tools, memory handling, evidence tier) on request.
- **Mesh rail:** collapsible live view of primary and witness connections, lease waits, peer count, relay health and warm models.
- **Evidence drawer** per agent message: agent identity, embodiment, model and artifact identity, route, runtime, stream status, witnesses, agreement, tool calls, receipt, acceptance, memory references, corrections.

## Agent conduct rules

1. Agents do not answer every ambient message.
2. Human speech preempts machine speech.
3. Agent-to-agent exchanges require a task or a speaker budget.
4. Agents may not summon unbounded additional agents.
5. A model or provider change is disclosed.
6. Unverified streaming text is visibly provisional.
7. Disagreement is preserved, not averaged away.
8. No private content goes to an unknown provider without explicit consent.
9. No side-effecting tool action is hidden in conversational text.
10. Nothing enters durable shared memory because an agent said it.

## Example interaction

A requester enters a room with one other human and three agents (an analyst, a planner and a critic) and writes: "Analyst and planner: compare the two deployment designs. Critic: challenge only a material flaw." The room creates one turn with three response roles in Council mode, so the scheduler does not force hash agreement.

The analyst's preferred local embodiment is unavailable; it is embodied on a provider with the required model active and starts streaming. The planner runs in parallel on a provider with a different approved model. The critic receives both committed answers before deciding whether to speak. The two answers reach different conclusions and are grouped under one comparison turn. The critic posts a challenge linked to both, showing they used different assumptions.

The requester accepts the critic's framing and promotes one scoped decision ("for the public prototype use design B; revisit private-room routing after trusted-provider admission exists"). The decision enters room memory linked to all three messages and their evidence. When a later deployment failure contradicts one assumption, it becomes a correction event, the decision is marked superseded, routing policy receives an evaluation example, and the transcript is unchanged.

## Proposed event families

```text
room_manifest, member_join, member_leave, presence_advert
agent_manifest, agent_attach_embodiment, agent_detach_embodiment, agent_handoff
turn_intent, speaker_lease, speaker_decline, turn_cancel
message_start, message_delta, message_commit, message_abort
run_start, run_status, run_receipt, run_disagreement
challenge, acceptance, decision
memory_proposal, memory_promotion, memory_rejection, correction, revocation
```

`message_delta` is ephemeral and recoverable. `message_commit`, acceptance, decisions, memory changes and corrections are signed state-changing events built on the existing typed envelopes, causal references, replay handling, relay cursors and WebRTC assignment transport.

## First slice and acceptance

Start with one room, two humans, one persistent agent, one primary provider, one optional witness, real streaming, interrupt and cancellation, reload recovery, one promoted room memory and one visible correction path. The slice passes when:

1. A human messages the agent naturally.
2. The agent obtains an eligible browser embodiment.
3. The primary provider streams a response over WebRTC.
4. A signed message commit binds the complete output.
5. An optional witness independently checks the declared result.
6. The human can interrupt at any point.
7. Reload never duplicates or falsely completes the turn.
8. The human can promote one result into scoped room memory.
9. A later correction visibly supersedes that memory.
10. The server never becomes a hidden inference provider.

Councils, workshops, handoffs, public providers and cross-room memory come only after that slice works.

## Summary definition

A Reploid room would be a real-time space for humans and persistent agents. Humans speak, decide, interrupt and own consent. Agents keep identities, roles and governed memory independent of the model or browser currently embodying them. Browser peers contribute bounded inference and verification over direct WebRTC sessions. Each reply can be streamed, committed, witnessed, challenged, accepted, corrected or promoted. The room does not confuse availability with presence, an agent with its current model, agreement with truth, direct transport with provider privacy, or a transcript with knowledge.
