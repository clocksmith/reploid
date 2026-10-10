# Reploid network product intent

Reploid lets people and agents use intelligence beyond one device’s capacity.
Participating computers share verified model pieces and cooperate on the same
computation; agents combine tools and approaches to solve useful problems.
Chat is the first interface to the self-organizing network. Independent operation
remains a participant capability; the collaborating network remains the product.
This describes the target, not completed qualification.

[GOALS](../../GOALS.md), [INTENT](../../INTENT.md) and
[CATSCAN](../../CATSCAN.md) own repository direction. This document applies those
boundaries to the network journey. Current pins, enabled catalogs and support
remain machine-owned: [chat models](../../self/config/chat-models.json),
[Doppler package](../../self/config/doppler-package.json), the scoped
[scientific catalog](../../self/pool/pool-config.json) and
[surface claims](../status/surface-claim-index.json).

## Ordinary network journey

Open Reploid, choose an available model, start an independent conversation,
authorize the necessary disclosure and receive a complete answer. Public discovery
uses the configured bootstrap without invitations, manual room setup or selecting
computers. A prepared execution path requires no requester weight downloads.
Contribution preparation is separate from consuming prepared capacity.

A requester can keep drafts and completed answers when no eligible path is ready.
Changing availability must not silently substitute a model, recipient or cloud
provider. Contribution and disclosure remain optional, bounded and revocable.
Private invitations remain a private participation option, not the public entrance.
See the [network quick start](../QUICK-START.md).

Browser and native participants use the same library contracts. Host support,
model compatibility and physical execution are separately qualified. The browser
application is one host; its particular storage APIs do not define the whole
participant contract.

## Four distinct forms of cooperation

| Capability | Meaning | What it does not establish |
| --- | --- | --- |
| Model custody | Store and supply authorized, verified pieces | Permission to see prompts or run computation |
| Whole-request execution | A provider completes an identified model operation | Computation split across devices |
| Model partitions | Different participants execute complementary Doppler-defined portions of one computation | Numerical parity, physical independence or useful capacity without their own tests |
| Agent subtasks | Agents contribute bounded tools and approaches to a goal | Permission to change objectives, evaluators, grants or adoption policy |

Storage participants may be different from executors. Intermediate tensors are
input-derived material: their recipients and scope require disclosure authority.
WebRTC transports bytes, not shared GPU memory. Count readback, serialization,
transfer, upload and failures in benefit comparisons.

## Ownership

Doppler owns model/artifact verification, dependencies, valid partitions, tensor
interfaces, tokenization, model mathematics, generation/scoring state, sampling,
stopping and cleanup. Reploid owns discovery, placement, grants, conversations,
agent coordination and improvement. Poolday is the internal peer infrastructure
for authenticated connections and authorized, bounded delivery.

The package implements these mechanics; hosts supply credentials, catalog,
policy, storage and runtime ports; views render state and request actions.
No UI controller, transport adapter or Reploid coordinator duplicates model math.
See the [technical diagrams](../open-mesh-architecture.md#technical-diagrams).

Use current Doppler terminology for current executable artifacts. Existing
serialized `Pack`, `AdapterPack` and signed job protocols retain their actual
compatibility names and specific verification rules. A manifest-backed resident
is not automatically a qualified signed Capsule.

## Contribution and disclosure

Each participant controls storage, compute, egress, accepted models and limits.
Membership and advertised readiness grant no execution or disclosure. A contributor
is executable only after assigned pieces and runtime resources exist; stale
advertisements cannot replace admission and reservation checks.

Grant custody, computation, input/intermediate disclosure, candidate delivery,
evaluation and adoption separately. Recheck grants and budgets at the relevant
boundary. Changing recipients or model identity requires appropriate approval.
Discovery observes capacity; it does not prove execution or honest hardware.

## Conversations, cancellation and recovery

Conversations own independent history, drafts, permissions, attempts and output.
Selecting or closing one does not cancel another. Stop identifies one attempt;
resource reuse waits for execution and cleanup settlement, not just a UI label.
Submitted GPU work may finish after cancellation.

An interruption preserves previous output and explicitly fails or interrupts the
attempt. Replacement restores an eligible execution path; retry starts a distinct
attempt. Do not splice replacement text into an old answer or assume cached
continuation survives unless Doppler’s qualified contract explicitly allows it.

## Problem solving, decisions and improvement

Agents pursue bounded objectives through authorized tools, context, model
operations and observed results. Generation, retrieval and decision/scoring
operations support that work. A score or semantic judgment is data, not permission,
scientific authority or an adoption decision. See
[typed decisions and scoring](../doppler-choice-scoring.md).

Keep three outcomes separate: executing the same work more efficiently, solving
unfamiliar tasks better, and improving the improvement machinery itself. Preserve
Bayesian uncertainty, provenance and dependent observations; duplicate records
are not independent experience.

Freeze objectives, protected evaluators, budgets and thresholds before candidate
creation. Independently evaluate, adopt within operator grants and retain rollback.
Candidates cannot control evaluators, broaden permissions or self-approve. Weight
changes require separate model execution and evaluation contracts. Runtime actions
within valid grants are independent of CI. Causal recursion additionally requires
A-to-B-to-C evidence and an enabled/disabled machinery comparison; tool repair or
another patch alone does not establish it.

The [scoped tool workflow](../work-collaboration.md) preserves helper controls,
private candidate delivery, recipient evaluation, explicit adoption and rollback.
It is not the whole network’s onboarding or acceptance contract.

## Qualification and scoped scientific workflows

Partition code and retained physical execution establish their identified
mechanisms, not full release acceptance. Keep implemented, tested under a named
configuration, qualification open and planned distinct. See
[current package and deployment identities](../doppler-partition-handoff.md#current-checkout-and-evidence)
and [conversation acceptance](../chat-mvp.md).

Compare useful outcomes against the strongest feasible local option and comparable
centralized resources, counting communication, verification, failures, evaluation,
resources and human intervention. Numerical fidelity and factual answer quality
are separate. A signed receipt proves identity/integrity, not honest GPU execution,
hardware attestation or correctness.

Research Room-1 remains an optional scientific workflow with its own
[Discovery Contract](discovery-contract.md), [pilot](room-1-pilot-charter.md),
[biological sequence restrictions](biological-sequence-lane.md) and
[claims/nonclaims](claims-and-nonclaims.md). Public-protein-only and related safety
restrictions apply to those catalogs/protocols; they do not redefine every network
operation or authorize private scientific inputs.

Detailed scientific procedures, experiment counts, old Pack recipes and their
original conditions are preserved in the
[research and legacy qualification checkpoint](product-intent-checkpoint-2026-10-09.md).
That checkpoint is history and scoped protocol detail, not the current default
user journey. No scientific admission or permission has been broadened.
