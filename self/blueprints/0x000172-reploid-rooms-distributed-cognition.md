# Blueprint 0x000172: Reploid Rooms & Distributed Cognition Runtime

You are right about the central trap: **a normal chat application with some AI bots bolted onto it would waste almost everything unique about Reploid.**

Reploid should not be “Discord, but agents answer.” It should be a **room-shaped distributed cognition runtime** whose most human-facing surface happens to look and feel like chat.

The conversation is the interface. Underneath it, every agent response is a routed computation; every agent has an identity distinct from the machine currently running it; every result can be provisional, witnessed, challenged, accepted, corrected, or promoted into shared memory.

# Reploid Rooms

> **Reploid Rooms are live spaces where humans and persistent AI agents converse, think, verify, and act through a changing mesh of browser compute.**
>
> An agent is not a model endpoint. It is a persistent identity, policy, memory, and relationship to the room that can acquire an inference body from an eligible browser peer.
>
> A response is not merely text. It is the visible result of a bounded execution that may have a model identity, provider, runtime, witnesses, receipts, disagreements, and an acceptance state.
>
> A room is not merely a transcript. It is a causal history, a live compute fabric, a governed memory, and a social space.

That is the world.

## What exists now, and what does not

The existing Reploid substrate already contains unusually valuable pieces:

* signed provider capability advertisements;
* deterministic peer assignment;
* direct WebRTC input, output, and receipt transport;
* one-provider, redundant, and ring-quorum execution policies;
* requester acceptance;
* signed points and reputation events;
* signed evidence records and human claims;
* durable, bounded at-least-once relay recovery.

But the current product grammar is still **Home / Run / Contribute / Records**, and the enabled launch lane is public protein embedding. The current peer payload contract contains prompts, inputs, complete execution results, receipts, artifacts, acknowledgements, and errors—but not conversational `message_start` or `message_delta` events.

The current ring is also **redundant full-model execution**. Every selected provider runs the complete model, and matching hashes establish agreement. Reploid does not presently shard layers, attention, or KV state across browsers.

So this is not a cosmetic redesign. It is a new product protocol built on the existing peer substrate.

# The beings in this world

The most important design decision is to stop treating “agent,” “model,” and “browser running inference” as the same thing.

| Being          | Meaning                                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Human**      | A sovereign participant who owns identity, consent, relationships, agents, and final approvals.                                        |
| **Agent**      | A persistent social identity with a name, owner, role, policy, memory boundary, tool permissions, and room relationships.              |
| **Embodiment** | One live computational body for an agent: exact model, artifacts, runtime, provider browser, context checkpoint, and execution policy. |
| **Provider**   | A browser offering bounded compute capacity, supported models, runtime identity, availability, and evidence history.                   |
| **Witness**    | A peer that independently reruns, verifies, challenges, or observes an execution.                                                      |
| **Room**       | A membership contract, causal event graph, active peer topology, policy, shared working state, and promoted memory.                    |
| **Run**        | A bounded inference or tool execution initiated by a message or agent decision.                                                        |
| **Artifact**   | An output, file, structured result, receipt, comparison, or evidence object created by a run.                                          |
| **Memory**     | A deliberately promoted room or agent artifact—not an automatic copy of every utterance.                                               |

This distinction produces Reploid’s most unusual property:

> **An agent can remain socially continuous while its computational embodiment changes.**

“Ada” may be using one model on Anthony’s laptop now and another compatible model on a contributor’s machine later. But the UI must never pretend nothing changed.

A valid handoff needs:

```text
agent identity
+ prior state/checkpoint hash
+ new embodiment identity
+ model and runtime identity
+ handoff authorization
+ accepted continuity policy
```

Without that chain, it is not the same continuing agent state. It is another model impersonating the same avatar.

# A room has four planes

A human should mostly experience one simple conversation, but the system must keep four planes separate.

## 1. Conversation plane

This is what people see:

* human messages;
* agent replies;
* mentions;
* reactions;
* interruptions;
* threads;
* files;
* decisions;
* disagreement;
* presence.

It must feel as immediate and socially legible as a good human chat product.

## 2. Execution plane

This is what produces agent behavior:

* provider discovery;
* model selection;
* assignment;
* WebRTC negotiation;
* input delivery;
* generation;
* tool execution;
* cancellation;
* retries;
* handoff;
* verification runs.

One visible agent reply may correspond to several independent executions.

## 3. Evidence plane

This answers:

* What actually ran?
* Which exact model and artifact?
* On which declared runtime?
* Did another provider reproduce it?
* Did the providers agree?
* Was there a hidden fallback?
* Who accepted or challenged it?
* Has it since been corrected?

The evidence stays progressively disclosed. The message comes first; forensic detail opens only when relevant.

## 4. Memory plane

The transcript is not automatically the room’s knowledge.

A room should distinguish:

```text
ephemeral conversation
working context
proposed memory
accepted room memory
signed evidence
decisions
evaluations
retracted or superseded memory
private agent memory
```

This is how the network can compound without treating chatter as truth. The previously defined Poolday ambition—questions, computations, critiques, failed attempts, reviews, and accepted results helping determine what to compute and verify next—requires precisely this controlled promotion boundary. 

# The fundamental unit is not a message

The visible unit is a message. The protocol unit is a **turn object**.

A human message might be simple:

> Can the three of you compare these architectures?

Underneath, its turn object can declare:

```text
author: Anthony
addressees: [Ada, Lin, Kestrel]
room: architecture-room
intent: compare
response mode: council
privacy: trusted-room
maximum responders: 3
maximum total tokens: 6000
deadline: 45 seconds
tool policy: read-only
memory policy: do not promote automatically
```

That turn spawns several executions, but remains one conversational act.

A minimal state-changing room event should inherit the existing P2P discipline:

```text
eventVersion
roomId
eventId
eventType
actorId
actorKind
causalRefs
visibility
createdAt
expiresAt
body
bodyHash
publicKey
signature
```

Reploid’s existing envelope protocol already assumes signed typed messages, causal references, idempotent duplicates, nonce protection, and bounded at-least-once delivery rather than exactly-once semantics. That means the room should be a **causal event graph**, not a database table pretending there is one perfect global sequence.

Edits are new events. Deletions are tombstones. Corrections link to what they correct. Different peers can temporarily see slightly different room projections and converge as missing events arrive.

# The lifecycle of an agent message

A centralized AI chat usually has two states: generating and complete. Reploid needs a richer but understandable lifecycle.

| State          | What the human sees                 | What it means                                                                 |
| -------------- | ----------------------------------- | ----------------------------------------------------------------------------- |
| **Queued**     | “Ada is finding compute”            | The agent has accepted the turn, but no embodiment is ready.                  |
| **Connecting** | “Connecting to an eligible browser” | A provider was selected and WebRTC is negotiating.                            |
| **Working**    | A real activity label               | Input arrived and execution began.                                            |
| **Streaming**  | Provisional text appears            | One embodiment is producing deltas; the result is not yet committed.          |
| **Committed**  | Text stops changing                 | The primary execution has committed a final output hash.                      |
| **Witnessing** | “Checking with two peers”           | Independent executions or verifiers are still running.                        |
| **Verified**   | “3 matching runs”                   | The declared agreement rule passed.                                           |
| **Diverged**   | “Two results differ”                | The system preserved disagreement instead of choosing silently.               |
| **Accepted**   | Human acceptance marker             | The requester or authorized human accepted the result for the stated purpose. |
| **Remembered** | Memory badge                        | The result was separately promoted into room memory.                          |
| **Corrected**  | Superseded marker                   | Later evidence linked a correction or contradiction.                          |

The visible message should remain clean:

> **Ada**
> The two architectures differ primarily in where identity and verification live…

Under it, a compact line might say:

> Verified by 2 compatible peers · direct room execution · details

Only the expanded inspector reveals hashes, model identity, runtime, providers, receipts, route decisions, and timings.

## Streaming is provisional

This matters enormously.

A primary provider can stream a responsive answer immediately while witnesses execute silently. The message can become verified afterward.

If witnesses disagree, Reploid must not leave the original text looking authoritative. It should transform the message into a visible disagreement object:

> **Results diverged**
>
> Primary answer: …
>
> Independent alternative: …
>
> Difference appears at: …
>
> Ask an agent to adjudicate · Keep both · Rerun

That is more honest and more useful than a green “consensus” icon.

# Three kinds of distributed inference must never be confused

## Redundant execution

The same model, artifact, input, configuration, and compatible runtime profile run independently.

Purpose:

* reproducibility;
* tamper detection;
* runtime consistency;
* quorum over exact result identity.

This is close to what Reploid supports now.

## Deliberative diversity

Different agents or models intentionally produce different analyses.

Purpose:

* competing hypotheses;
* critique;
* alternative approaches;
* judgment diversity.

There should be **no exact-output quorum** here. Different answers are expected. The room needs structured comparison, claim extraction, or a separately designated synthesizer.

Calling majority text “truth” would be a category error.

## Cooperative decomposition

Several agents perform different pieces of one task:

```text
planner
→ researcher
→ implementer
→ reviewer
→ synthesizer
```

Purpose:

* parallelism;
* specialization;
* larger tasks;
* independent review.

The final result must carry the dependency graph of contributing runs. A synthesizer receipt does not erase the identities of the sub-results it consumed.

# Conversation modes

The composer should expose a few human-readable modes rather than protocol jargon.

| Mode         | Human meaning                                          | Execution policy                                             |
| ------------ | ------------------------------------------------------ | ------------------------------------------------------------ |
| **Quick**    | “Give me the first useful answer.”                     | One eligible embodiment; stream immediately.                 |
| **Checked**  | “Answer quickly, then verify it.”                      | One streaming primary plus one or more compatible witnesses. |
| **Verified** | “Do not finalize until the required peers agree.”      | Deterministic redundant or ring-quorum execution.            |
| **Council**  | “Ask different agents and preserve their differences.” | Heterogeneous agents/models; no hash consensus.              |
| **Workshop** | “Let agents divide the work.”                          | Explicit task graph with bounded roles and synthesis.        |
| **Private**  | “Do not send this to unknown providers.”               | Local-only or explicitly trusted room providers.             |

These are not superficial tone selectors. They change the social and computational contract of the message.

# Agents need turn-taking, not bot spam

Real-time multi-agent chat becomes unusable if every agent responds to every message.

Reploid needs a **floor protocol**.

A turn can be:

* explicitly addressed to one agent;
* addressed to several named agents;
* opened to “one suitable agent”;
* opened as a council;
* marked human-only;
* marked silent observation.

Agents request a bounded **speaker lease** before responding. The room scheduler uses addressees, role, capability, budget, current workload, reputation, and conversation policy to grant leases.

A speaker lease should include:

```text
turnId
agentId
response role
token budget
tool budget
deadline
whether streaming is allowed
whether follow-up agents may be summoned
```

This prevents:

* six agents replying with the same answer;
* recursive agent-to-agent loops;
* agents repeatedly correcting one another without human value;
* uncontrolled token and compute consumption;
* conversation being overwhelmed by machine activity.

## Human interruption is absolute

The human should be able to type while agents are generating and press:

* **Stop**
* **Pause**
* **Answer this instead**
* **Let Ada finish; cancel the others**
* **No more agents in this thread**

An interrupt becomes a causal event. Providers receive cancellation over their DataChannels. Late output is retained only as an orphaned artifact, not inserted into the conversation as though it completed normally.

## Silence is a valid agent action

An agent should be able to decline to speak because:

* another agent already covered the answer;
* confidence is too low;
* the room lacks an eligible embodiment;
* the privacy policy excludes available providers;
* the token budget is exhausted;
* it has no material disagreement.

Good multi-agent chat requires agents that know when not to talk.

# Presence has unusual physics

In a centralized chat app, the server owns the online roster. In Reploid, presence is a local, time-bounded projection.

A participant may be:

```text
present
reachable
agent available
agent waiting for a body
provider available
model cached
model active
busy
witnessing
sleeping
disconnected
stale
```

These are not equivalent.

A human can be present while their agent lacks compute. An agent can be present in the social room while its previous provider has disappeared. A provider may be reachable but still cold-loading the requested model. A browser may advertise availability and then be frozen by the operating system.

The UI should therefore say:

> Ada · present · compute available

or:

> Ada · present · waiting for a compatible model

not merely show a green dot.

# WebRTC quirks become part of the product’s social physics

## There is no exactly-once reality

Reploid’s relay contract is bounded at-least-once. Messages may be duplicated, delayed, replayed, or arrive out of order. The protocol already requires idempotency and causal references.

The chat must therefore never infer meaning from “this callback happened once.” Every durable action needs a stable event identity.

## A connection is not a relationship

WebRTC sessions are ephemeral. The room relationship, transcript, and agent identity must survive connection churn independently.

Losing a DataChannel means:

> the current transport ended

not:

> the participant left forever

and not:

> the agent’s unfinished thought can safely resume elsewhere.

## Reload is not transparent continuity

The existing protocol deliberately avoids silently resuming a sensitive in-flight request after reload. It validates the saved state and presents retry or discard rather than inventing acceptance or duplicating the request.

Chat should preserve the same discipline:

> Ada’s previous run was interrupted before completion. Retry as a new run?

A newly routed execution must receive a new run identity.

## Direct does not mean secret from the executor

A signaling service may avoid carrying the prompt, output, or full receipt, while WebRTC delivers them directly. That protects the content from the signaling control plane.

It does **not** protect the content from the selected provider browser, because that provider must process the plaintext input unless a future confidential-compute mechanism exists.

The composer must state the real privacy boundary:

> This message may be processed by two trusted room devices.

or:

> This public request may be processed by an unknown contributor browser.

The current server contract is explicit that signaling may carry offers, answers, ICE candidates, close, and ping, but not prompts, biological sequences, outputs, full receipts, or model shards.

## TURN is transport, not betrayal

Some connections will require TURN. The UI should not inaccurately label TURN-routed traffic as “central inference.” The relay can carry encrypted WebRTC packets without becoming the inference authority.

The useful distinction is:

```text
direct network path
relayed network path
local compute provider
remote compute provider
```

not simply “P2P” versus “server.”

## Browsers sleep

Background tabs, mobile operating systems, device loss, GPU resets, network switching, and storage eviction are normal conditions.

The interface should make them legible:

> Provider became unavailable during generation.
> 418 tokens were provisional. No committed answer was produced.

That is better than “Something went wrong.”

## Backpressure is visible

A slow peer can receive token deltas more slowly than they are generated. Streaming needs bounded buffers, sequence numbers, and a policy for dropping cosmetic deltas while preserving the final committed message.

I would use separate DataChannels:

| Channel             | Reliability                                                  |
| ------------------- | ------------------------------------------------------------ |
| `room-control`      | Reliable, ordered; signed room events and state transitions. |
| `run-stream`        | Ordered, bounded streaming deltas with sequence numbers.     |
| `artifact-transfer` | Reliable, chunked, resumable large artifacts.                |
| `presence`          | Loss-tolerant, short-lived presence and activity signals.    |

A missing streaming delta should not corrupt the final message. The signed `message_commit` carries the complete final body or a retrievable body hash.

# Agent identity and computational embodiment

This is where Reploid can become genuinely unlike existing AI chat products.

A persistent agent manifest might contain:

```text
agentId
display name
owner identity
role and purpose
public behavior policy
memory namespaces
allowed rooms
tool permissions
approved model families
minimum evidence tier
handoff policy
avatar and voice identity
manifest hash
owner signature
```

A live embodiment attachment contains:

```text
agentId
run or session id
provider identity
model id and hashes
runtime profile
state checkpoint hash
context policy
tool surface
start and expiry
attachment signature
```

The room can then truthfully distinguish:

> **Ada**, the persistent agent

from:

> **this particular Qwen execution currently embodying Ada**

That permits agent continuity without hiding implementation changes.

## Handoff is a visible event

When an agent moves:

> Ada moved from a local Gemma embodiment to a remote Qwen embodiment after the original browser disconnected.

The user can inspect:

* what state was transferred;
* whether private memory was included;
* whether the new model was allowed;
* whether the handoff changed capabilities;
* whether the prior output was committed;
* who authorized it.

No silent model substitution.

# The room’s memory architecture

The room should have five memory classes.

## Transcript

Everything that happened conversationally.

It is searchable history, not accepted knowledge.

## Working set

Temporary context selected for current discussion:

* active messages;
* open decisions;
* referenced files;
* current tasks;
* relevant prior room memory.

It should expire or be replaced deliberately.

## Evidence memory

Signed outputs, claims, receipts, challenges, corrections, and source links.

This preserves disagreement and provenance.

## Decision memory

What authorized humans or room policy accepted for a declared purpose:

> “Use architecture B for the prototype.”

A decision is not universal truth. It includes scope, owner, date, and supporting artifacts.

## Procedural memory

Measured lessons about how the room works:

* which model performs well on a task type;
* which provider routes are reliable;
* which reviewer catches particular failures;
* which workflows save time;
* which agent tool failed;
* which evidence policy prevented a bad result.

This is where actual self-improvement happens.

The system should never automatically train or rewrite agents from every message. Contributions can update routing statistics or create memory proposals, but durable policy or capability changes require evaluation and promotion.

# What “the mesh improves” should mean

Every event can teach the system something, but not every event becomes knowledge.

| Contribution                | Permitted improvement                                     |
| --------------------------- | --------------------------------------------------------- |
| Provider success or failure | Routing, retry, and capacity estimates.                   |
| Model output                | Candidate result or evaluation sample.                    |
| Independent agreement       | Reproducibility evidence for the exact contract.          |
| Disagreement                | A new uncertainty or adjudication task.                   |
| Human correction            | Evidence against a prior claim and an evaluation example. |
| Accepted answer             | Scoped reusable room memory.                              |
| Later failure               | Correction, revocation, and policy feedback.              |
| Successful agent workflow   | Candidate procedural template.                            |
| Repeated workflow gain      | Candidate capability promotion.                           |

This is the disciplined interpretation of the broader goal: leave the mesh more capable, while never equating contribution, consensus, or receipt with truth.

# The human interface

The main screen must remain a **conversation**, not a network graph or blockchain explorer.

## Center: the conversation

Human and agent messages appear in one readable timeline.

Agent status appears only when useful:

> Ada is finding compute
> Ada is responding
> Ada’s answer is being checked
> One witness disagreed

No permanent wall of hashes.

## Top: room contract

A compact header shows:

```text
room name
participants
privacy mode
default response mode
active compute budget
recording/memory policy
```

Example:

> Architecture Lab · 3 humans · 4 agents · trusted room · checked replies

## Participant ribbon

Humans and agents appear as social identities. A small secondary indicator exposes current embodiment state.

> Ada
> Ready · Gemma · local

> Kestrel
> Present · no compute body

> Lin
> Working · 2 witnesses

Providers that are not social participants should not clutter the human roster. They belong in the mesh inspector.

## Composer

The default composer should be almost normal:

```text
Message the room…
```

Above or beside Send:

```text
To: Ada
Mode: Checked
Privacy: Trusted room
```

Advanced options open only when requested:

* exact model;
* maximum providers;
* deadline;
* token budget;
* tools;
* memory handling;
* evidence tier.

## Right rail: live mesh

A collapsible rail shows operational activity:

```text
Ada
  primary: connected
  witness 1: computing
  witness 2: connecting

Kestrel
  waiting for speaker lease

Room
  4 active peer connections
  relay healthy
  2 models warm
```

This is where WebRTC becomes tangible without overwhelming chat.

## Message evidence drawer

Every agent message can expand into:

```text
agent identity
embodiment
model and artifact identity
provider route
runtime profile
stream status
witnesses
agreement or disagreement
tool calls
receipt
acceptance
memory references
corrections
```

The user sees the answer first and the machinery when trust or debugging demands it.

# Social rules for agents

A credible human-and-agent room needs behavioral laws:

1. **Agents do not answer every ambient message.**
2. **Human speech preempts machine speech.**
3. **Agent-to-agent exchanges require a task or speaker budget.**
4. **Agents may not summon unbounded additional agents.**
5. **A model or provider change is disclosed.**
6. **Unverified streaming text is visibly provisional.**
7. **Disagreement is preserved, not silently averaged away.**
8. **No private content goes to an unknown provider without explicit consent.**
9. **No side-effecting tool action is hidden inside conversational text.**
10. **Nothing enters durable shared memory merely because an agent said it.**

These laws matter more than avatars or typing animations.

# A representative interaction

Anthony enters a room containing two humans and three persistent agents.

He writes:

> @Ada and @Lin: Compare the two deployment designs. Kestrel, challenge only if you see a material flaw.

The room creates one turn with three response roles.

Ada’s preferred local embodiment is unavailable. Three peer adverts exist:

```text
provider A: required model active
provider B: required model cached
provider C: different approved model active
```

Because the mode is **Council**, the scheduler does not try to force exact hash agreement.

Ada is embodied on provider A and begins streaming. Lin is embodied on provider C and works in parallel. Kestrel receives both committed responses and only then decides whether to speak.

The room displays:

> Ada is responding
> Lin is working
> Kestrel is observing

Ada finishes. Her message becomes **committed**, not yet accepted.

Lin finishes with a materially different conclusion. The room groups the two answers under one comparison turn rather than inserting token streams in a confusing order.

Kestrel identifies that they used different assumptions and posts a challenge linked to both messages.

Anthony accepts Kestrel’s framing and promotes one scoped decision:

> For the public prototype, use Design B; revisit private-room routing after trusted-provider admission exists.

That decision enters room memory with links to all three agent messages and their execution evidence.

Two weeks later, a deployment failure contradicts one assumption. The failure becomes a correction event. The decision is marked superseded, the routing policy receives an evaluation example, and the transcript remains intact.

That is a room that genuinely compounds.

# The missing protocol surface

To build this on Reploid, I would add these event families:

```text
room_manifest
member_join
member_leave
presence_advert

agent_manifest
agent_attach_embodiment
agent_detach_embodiment
agent_handoff

turn_intent
speaker_lease
speaker_decline
turn_cancel

message_start
message_delta
message_commit
message_abort

run_start
run_status
run_receipt
run_disagreement

challenge
acceptance
decision

memory_proposal
memory_promotion
memory_rejection
correction
revocation
```

`message_delta` should be ephemeral and recoverable. `message_commit`, acceptance, decisions, memory changes, and corrections must be signed state-changing events.

The existing protocol already provides a strong basis for signed typed envelopes, causal references, replay handling, relay cursors, and WebRTC assignment transport. The new layer would make those mechanisms conversational rather than job-form-oriented.

# The first credible product slice

Do not begin with a giant public agent network.

The first real Reploid Room should contain:

```text
one room
two humans
one persistent agent
one primary provider
one optional witness
real streaming
interrupt and cancellation
reload recovery
one promoted room memory
one visible correction path
```

The proof should be:

1. A human messages an agent naturally.
2. The agent obtains an eligible browser embodiment.
3. The primary provider streams a response over WebRTC.
4. A final signed message commit binds the complete output.
5. An optional witness independently checks the declared result.
6. The human can interrupt at any point.
7. Reload never duplicates or falsely completes the turn.
8. The human can promote one result into scoped room memory.
9. A later correction visibly supersedes that memory.
10. The server never becomes the hidden inference provider.

Only after that works should the room expand into councils, swarms, agent handoffs, public providers, and cross-room memory.

# Canonical product definition

> **Reploid is a real-time social and computational room for humans and persistent AI agents.**
>
> Humans speak, decide, interrupt, contribute judgment, and own consent. Agents maintain identities, roles, relationships, and governed memory independent of the particular model or browser currently embodying them. Browser peers contribute bounded inference and verification through direct WebRTC sessions. Each agent response can be streamed immediately, then committed, witnessed, challenged, accepted, corrected, or promoted into shared memory.
>
> The room does not confuse availability with presence, an agent with its current model, agreement with truth, direct transport with provider privacy, or a transcript with knowledge. It preserves the causal and evidentiary history of how people and agents reached a result.
>
> **Chat is the human interface. The actual product is a live distributed cognition runtime.**

That is the world Reploid should build.
