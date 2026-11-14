# Mesh record keeping

Status: proposed architecture, November 14, 2026. This document answers the
owner's request for record keeping that uses the mesh. It does not activate
replication, change accepted credit terms, or establish proof of computation.

## Decision

Make retained, verifiable receipts the source of usage summaries. Keep copies
with the requester and suppliers, then replicate authorized evidence through
the mesh. Browser counters and operator indexes become rebuildable views.

Use the mesh for availability, independent verification and recovery. Preserve
the existing credit service as the admission and settlement authority for its
enrolled accounts. Replicating evidence does not authorize another spend.

See [view 3: record keeping](glossary.md#3-record-keeping) for the diagram,
with existing paths separated from proposed archive replication and replay.

## Existing foundation and gaps

| Boundary | Exists | Missing |
| --- | --- | --- |
| Whole-model evidence | [Provider signature, requester countersignature](../packages/reploid/src/artifacts/receipt.js), exact-model and output binding in [peer generation](../packages/reploid/src/mesh/peer-generation.js) | Durable retention by both browser parties and authorized replica repair |
| Native recovery | [SQLite generation journal](../server/native-generation-journal.js), admission fences and bounded result replay | Replicated evidence; the recovery journal is not an archival accounting history |
| Private credit service | [Transactional reservations, balances, evidence and journal](../server/fleet/credits.js), [verification](../server/fleet/credit-evidence.js), restart outboxes | Signed export of authoritative account revisions and replayable remote audit views |
| Browser dashboard | [Recent contribution metadata and saved attempt measurements](../apps/poolday/host/contribution-history.js) | Receipt-backed coverage, per-model projections and recovery outside one browser |

Implementation prerequisite in this revision: the browser retains a whole-model
receipt returned by its execution port with the saved answer, across history
reload. [Retention tests](../tests/unit/chat-receipt-retention.test.js) use injected
public/private execution ports and real provider/requester signatures, then
reverify the restored receipt without issuing another request. This closes an
evidence-loss gap. It does not implement an independent receipt archive,
persist-before-acknowledgment ordering, peer replication, or verified dashboard totals.

The public browser swarm does not automatically participate in private fleet
credit accounting. Backing up public usage receipts must not silently enroll a
device, create debt, or imply that its work earned private service credits.

## Records and identity

Retain the existing whole-model receipts, partition stage receipts, requester
acknowledgments, reservations and settlement records. Add archival envelopes
around them; do not reinterpret old signed payloads or build a second ledger.

Each envelope binds its schema, evidence type, payload digest, source key and
verification context. Context identifies the exact model artifact, adapters,
meter version, request and attempt, participants, admission and accepted terms.
Preserve runtime/tokenizer/template bindings where the underlying contract
establishes them; absent fields remain absent. Required new semantics need a
versioned execution contract, not inferred metadata in an archive.

Maintain two identifiers:

- A content digest identifies an exact proof object and detects altered bytes.
- The existing verifier's work identity identifies its economic effect. Equivalent
  re-signatures and copied receipts cannot create another debit, credit or usage
  event. Conflicting payloads for the same work are retained as conflicts.

Use enrolled signing keys for account attribution. A browser session ID is not
a physical computer ID. Bind key rotation to an authorized account history;
never merge computers because their names or GPU descriptions match. Multiple
keys controlled by one operator do not establish independent witnesses.

## Durable writes and replication

Browser hosts use transactional IndexedDB; native hosts use SQLite. Application
hosts own storage and keys; reusable library code receives explicit store and
transport ports. localStorage may cache a view, never establish accepted usage
or a spendable balance.

The provider persists its signed completion before transmitting it. The requester
verifies the exact response binding and atomically retains its countersignature
with an outgoing acknowledgment before sending it. The provider durably imports
that acknowledgment. Reconnect resends evidence, never regenerates an answer.
An acknowledgment cannot be reported as durable before the storage transaction
commits. If storage fails, preserve displayed answer text and expose the record
or settlement as pending; do not fabricate successful accounting.

Archive replication runs asynchronously through authenticated, authorized peer
channels. Exchange bounded inventories of content digests, request missing proof
objects, verify them on import, and retry from a durable outbox. Reuse existing
transport and custody boundaries. Model-file sharing grants do not authorize
receipt sharing. A universal ordered log and a new gossip framework are not
required to reconcile immutable evidence sets.

Select archive peers under an explicit storage/egress/retention policy and
authorized recipient set. Prefer different declared failure domains when
available. Show actual acknowledged copies and last contact, including degraded
replication. A storage acknowledgment is a signed retention claim, not proof
that a disk will survive. Replicas do not receive inference inputs or execution
permission. Optional archive availability does not block ordinary generation;
credited admission still requires its existing durable reservation.

## Verification and credit ordering

Every importing auditor independently checks the applicable receipt signatures,
enrollment revision, exact accepted bindings, acknowledgments, token bounds,
cleanup evidence and duplicate/conflicting work identities. Import never treats
an advertised total or a replica count as execution evidence.

The credit authority commits reservations, holds and settlements atomically using
the existing ledger. Extend its journal export with authority identity, account
revision, previous-record digest, accepted policy/enrollment revision and a
signature. Signed checkpoints bind an ordered prefix to retained evidence.
Readers can replay the prefix, recompute debits and credits, and detect forks
when incompatible signed histories are encountered. A hash chain alone cannot
prove that its writer published every event or prevent a concealed fork.

Archive peers can reproduce balances through a verified checkpoint. They cannot
declare a current spendable balance from a stale prefix. While the authority is
unreachable, only already accepted reservations remain eligible; no new unsecured
debt is admitted from cached balances. Timeouts never establish remote cleanup.
An authority replacement needs an explicit fenced handover that prevents the old
writer from authorizing new work. Otherwise admission remains closed.

Negative credits retain their existing policy limits. Conserved balances and
counterparty signatures do not prove fair hardware compensation or honest GPU
execution. A permissionless credit market would additionally need an explicit
membership, issuance, Sybil, default and double-spend design; it is not created by
replicating this fleet's records.

## Computer and model views

Build the same projections on browser, native host or authorized audit replica.
Group usage by account/computer, exact model artifact, adapters, meter and period.
Display friendly model names over those identities. Keep incompatible meters and
artifacts separate; a combined total is activity, not a normalized compute value.

Count a whole answer once as requester consumption and once as supplier output.
For split execution, count the final output once for the service. Preserve stage
participation and allocated credits separately; do not multiply the network's
output-token total by the number of stages. Local self-use stays local activity,
not traded supply or earned credit.

Expose distinct views:

- Recorded local activity, including executions with no exchanged receipt.
- Counterparty-acknowledged usage supported by verified receipts.
- Settled credits, pending holds and unresolved work under an account authority.
- Published statistics, with their issuer, covered revisions/period, missing
  ranges, freshness and verification level.

A checkpoint proves a covered prefix, not all lifetime activity. Offline devices,
unshared records, incomplete replication and lost history remain visible gaps.
Deleting a chat must not silently erase independently retained accounting proof.
Retention and authorized deletion follow accepted record terms; optional history
may be pruned without releasing unsettled obligations.

## Disclosure

Prompts, responses and token streams remain with their authorized execution and
history recipients. Archive the minimum evidence needed; encrypt private proof
objects for approved readers. Existing request/output hashes, identities, model
usage and timing can themselves be sensitive. Do not publish current receipts
wholesale or assume hashing makes short private prompts anonymous.

Publishing per-computer totals is an explicit disclosure choice. A signed public
summary whose evidence is private is issuer-reported to the public; authorized
auditors can verify its backing records. Do not label it publicly independently
verified without exposing sufficient evidence under the relevant permissions.

## First implementation boundary

First retain existing verified whole-model receipts durably at both browser
ends, alongside the existing native path, and expose one replayable per-model
usage query. Then replicate those same proof objects between explicitly paired
devices and demonstrate recovery after losing one local store. Reuse those
records for account and device views before extending authoritative credit
journal export. Historical local counters remain labeled local observations;
they cannot be retroactively upgraded into counterparty-signed evidence.

Acceptance must demonstrate altered/forged evidence rejection, one effect for
duplicate delivery and equivalent re-signatures, preserved conflicts, restart
between persist and acknowledgment, recovery from an authorized replica, and
unchanged totals after replay. Also demonstrate one-output counting for split
work, stale account prefixes refusing new credit, negative-balance limits,
unsettled cleanup retaining holds, and unauthorized archives receiving no proof
payload. These are focused correctness boundaries, not a new release campaign.
