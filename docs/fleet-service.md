# Native fleet service

`server/fleet/` adds enrolled computer identities, non-cash service credits and
placement to the existing native participant. It uses the existing WebRTC,
whole-model and ordered-partition execution paths. It does not change Doppler's
model arithmetic or qualification rules.

This is an operator-configured private fleet. A paired browser can use it from the
normal chat workspace; unpaired public-network chats do not use this coordinator.
Purchased credits and payouts are separate.

## Computer identity

An owner-only `identityFile` retains an Ed25519 signing identity across launches.
The coordinator enrollment maps its public key to the computer ID, display name
and owner. Several provider keys may belong to one computer account. Generate
enrollment from the workspace fleet registry; do not maintain another static
machine inventory in this repository.

GPU adapter information, buffer limits and live memory observations describe
capacity. They are not unique hardware identifiers or remote attestation. A
copied signing key can impersonate its enrolled computer.

## Credits

Before sending a prompt, the requester reserves its maximum charge and records
dispatch. Providers independently check that admission before executing. The
credit policy explicitly sets the integer rate, debt limit, output limit,
pending-request limit and whether computers belonging to one owner may trade.
Negative balances are permitted within the configured debt limit.

Completed whole-model work requires a provider-signed, requester-countersigned
receipt. Partitioned work requires the ordered stages' signed closing receipts
and the requester's signed output acknowledgment. Exact model, adapter, route,
request and participant identities must match. Duplicate settlement has one
economic effect. Every credit has an equal debit. A requester's own partition
share is unbilled; there is no reward for paying itself.

A caller's output limit is checked against the token count the provider reports
in its receipt, because the requester has no tokenizer, so a provider that
under-reports its tokens is not detected by this check. The limit is enforced in
the provider's sampler and bounds the charge, not the length of text a dishonest
provider could return.

SQLite retains balances, reservations, the complete signed evidence, provider
admissions, and the journal. Requester and provider outboxes retry proofs after
process restart without generating another answer. Partition acknowledgments
are retained before they return to the coordinator; each contributor independently
submits its signed closing receipt. Invalid proof is retained as a rejected record
rather than retried forever.

Cancellation can settle an acknowledged prefix. All admitted stages must prove
cleanup, and a signed final-stage receipt must match that prefix's output chain.
Unacknowledged work is not billed. A signed `failed` receipt proves cleanup only
with its closing timestamp; it does not turn a failed answer into a completed one.
Equivalent verified re-signatures retain the original economic outcome.

For a fenced partition request, `POST /v1/reploid/recover` returns
`serviceCredit.awaitingStages` while settlement is pending. Its zero-based
indices identify stages from the accepted route whose closing evidence is
still required. `heldCredits` is the outstanding reservation, and
`acknowledgedOutputTokens` is the durably signed count. A null count means
the ledger is waiting for the requester’s acknowledgment. Zero means the
requester signed the empty prefix. Recovery reads those facts across restarts.

For whole-model cancellation or failure, the provider retains and submits
`reploid.generation-terminal/v1` only after its execution owner confirms cleanup.
Usage remains unknown. Setting `creditPolicy.wholeModelTerminalCharge` to `0`
accepts zero non-cash terminal charge, frozen into each reservation; omission
keeps the hold pending. This does not change purchased-credit accounting.

A credited native ordered stage and its fleet service now bind each admission to an exclusive process owner.
The stage keeps an owner-only SQLite journal beside its identity file. It commits each signed step receipt before
returning the step. The requester already records its signed output acknowledgments at the service. These writes
are part of the serving cost. A retained signed terminal is replayed if its original delivery was interrupted.

On restart with the same profile, the stage reacquires the exclusive filesystem lock and checks the previous
process lifetime before reporting an interrupted owner to the service. On Linux the check uses the boot,
PID namespace and process start time. A copied journal, a live predecessor, or an ambiguous PID namespace
cannot close the admission. This lifecycle report carries the last signed step when one exists. The service
still requires the requester’s signed output count and all other stages’ closing evidence. An interrupted
execution charges the requester nothing and pays no stage, and returns `failed` with reason
`interrupted-stage-owner`. A reservation made before these terms keeps its acknowledged-prefix charge. `POST /v1/reploid/recover` can read that outcome before a replacement model is loaded.
Unpublished work, physical GPU recovery and output text beyond the acknowledged prefix remain unknown.

Both the service and the stage need the owned-admission operation. Legacy stages still use their existing
admission protocol. Historical holds without a matching owner claim remain unresolved if a stage signature
is missing. Use a private local filesystem with SQLite locking for the journal and retain it across restarts.

A whole-model provider that admitted a request and then never returns leaves
the requester's hold open: no timeout asserts remote cleanup. Setting
`creditPolicy.wholeModelUnclaimedReleaseMs` bounds that. The provider has the
request deadline plus this window to submit completion or cleanup evidence;
after it the hold is released with status `expired`, no charge and no credit,
and a later claim for that request is refused. A provider that did the work but
returns after the window is therefore not paid for it. The field is part of the
frozen credit policy, so adding it to an existing ledger needs an explicit
migration; omitted, such holds stay open as before.

A split request has the same gap, and a wider one: settlement needs every
stage's signed closure, so one stage host that disappears for good strands the
hold even when the other stages signed. `creditPolicy.partitionUnclaimedReleaseMs`
bounds it. After the request deadline plus this window, a split request whose
proof is still incomplete reaches one final outcome: status `expired`, reason
`stage-unclaimed-after-window`, no charge, and no credit to any stage, including
stages that did sign. The outcome records the acknowledged output count and
lists each stage that never signed with `cleanup: "unverified"` (or
`"never-admitted"`); it asserts nothing about what a silent host did. A later
claim or late receipt for that request is refused and pays nobody, and the
outcome survives a restart. A requester that retries does so as a new request,
charged once. A request whose proof is already complete is settled normally and
is never expired. Like the whole-model window, the field is part of the frozen
credit policy and is off unless set. Whether a stage that signed should be paid
when another stage vanishes is an open policy question; today it is not.
`acceptFleetTerminalPolicy` in `server/fleet/terminal-policy.js` records an
operator-approved zero-charge policy migration and an explicit list of unresolved
whole-model reservations to which it applies. It cannot change metered rates,
completed balances, or release work without verified cleanup.

Admission closes atomically before recovery. A never-dispatched reservation can
expire. A dispatched request with no admitted providers can release after that
fence; one with admitted providers still needs their signed closing receipts.
Deadline expiry closes admission but never proves remote cleanup. Old reservations
without the admission journal cannot use the zero-admission release rule.
A request whose dispatch or completion is uncertain retains its hold. Cancellation
alone does not establish that work was never performed. There is no automatic
hold forgiveness or cash conversion. Enrollment or policy changes require an
explicit migration; editing a JSON file cannot reinterpret existing balances.

Each enrolled computer can export its own journal statement (`statementMine` on
the service, `client.statement()`, or `{"id":"1","op":"statement"}` on the
native host control stream) and verify its balance offline without trusting the
service operator:

```sh
node server/fleet/credit-statement.js /absolute/statement.json [/absolute/enrollment.json] [--late-claim /absolute/late-claim.json]
```

`verifyCreditStatement` in `server/fleet/credit-statement.js` checks every
journal entry's request-binding digest, participant signatures (whole-model
countersigned receipts, whole-model terminal cleanup proofs, ordered stage
closing receipts, interrupted stage-owner closures and requester output
acknowledgments), duplicate-work replay rules, claim-release windows
(`wholeModelUnclaimedReleaseMs`, `partitionUnclaimedReleaseMs`), expired
unclaimed holds (`statement.expired`) and integer stage shares
(`server/fleet/credit-shares.js`), then compares the recomputed balance against
the stated balance. Pass `computers` to pin an external enrollment file,
`participantIds` to pin the contributor's own signing keys without the full
registry, or `lateClaims` (`--late-claim`) to confirm offline that a late
receipt arriving after hold expiry cannot reopen settlement. Any entry whose
proof is missing, unsigned (for example a split cancellation relying only on the
operator's local admission table) or mismatched is listed in `unchecked` and
causes the CLI check to exit non-zero.

## Placement

Each computer submits owner preferences and measured execution envelopes. The
planner checks the exact model, installed delivery digest, measurement age,
observation age, input/output limits, GPU/host budgets and single-buffer binding
limit before ranking a candidate. Costs use measured loading, prefill and decode
rates. They are scheduling estimates, not throughput guarantees or billing meters.

It prefers feasible whole-model capacity, retains warm residents, and adds replicas
when queue demand warrants them. Otherwise it requires a complete ordered
partition route across distinct computers and measured links. Search is bounded.
Missing measurements produce an unavailable result, never an invented estimate.
Owner opt-out stops idle contribution; active work drains before replacement.
An opted-out provider cannot admit new credited work.

The host reads an operator observation file, refreshes live memory and hardware
limits, binds it to `native-delivery.json`, and applies plans at idle boundaries.
`followPlacement` publishes bounded demand while a request waits for an exact
ready model. Its UTF-8-byte input estimate is labeled as such and is not a token
charge. Conservative estimates can reject capacity outside the measured envelope.

The coordinator's read-only `rank` operation returns every measured, currently
feasible whole-model provider for one exact model and workload, lowest estimate
first. A requester may pass that order to the mesh as its provider ranking; the
mesh then reports the provider it chose, the reason (`conversation-affinity`,
`host-ranking` or `default-order`) and the eligible providers it considered with
the disclosure the requester approves. Without a ranking the order is the
self-reported contribution score, then connection id; neither measures speed.
The native host does this when its configuration sets `rankProviders: true`: it
proves each ready provider's identity, asks the coordinator for the order before
each credited whole-model request, and returns the choice as
`execution.placement`. If the ranking is unavailable it warns and keeps the
default order. This path is covered by the journey scenario below, not yet by a
physical run.

A host with an absolute `cacheDirectory` can complete a whole-model directory
from authorized peers in its room: a model entry with `fillFromPeers: true` may
start without its manifest, and every piece and file is verified against the
model's pinned identities before loading. A model entry with
`shareModelFiles: true` supplies its verified pieces to other computers in the
room. Both are off unless set.

For multi-provider assignments that assume non-colluding operators,
`selectDistinctOwnerProviders` in `server/fleet/placement.js` selects two or more
qualified whole-model providers under pairwise-distinct operator-enrolled `ownerId`
values (and optionally excludes `requesterOwnerId`), while partition plans or
workloads marked `requireDistinctOwners` enforce distinct enrolled owners across
stages. Separate signing keys or computer IDs never establish separate operators;
only operator enrollment (`enrollComputers`) qualifies.

## Running

Use Node 22.13 or newer and the packaged native delivery, with its locked Doppler,
WebRTC and GPU dependencies. The package must retain `native-delivery.json`.

```sh
npm run package:native
node server/fleet/service.js /absolute/operator/service.json
node server/fleet/native-host.js /absolute/operator/host.json
```

The service configuration uses schema `reploid.fleet-service/v1` and declares
`enrollmentFile`, `modelsFile`, `databaseFile`, `creditPolicy`, `placementPolicy`,
`listenHost`, `port`, and optional `tls: {keyFile, certFile}`. Non-loopback binding
requires TLS. Pin a private CA for the service processes rather than disabling
certificate checks. Requests are authenticated with enrolled signing keys.

Host configuration uses schema `reploid.fleet-native/v1`, explicit `computerId`,
`name`, `identityFile`, private `roomId`, `roomTokenFile`, `signalingUrl`,
`serviceUrl`, `maxOutputTokens` and `models`. Each model entry supplies the exact
catalog `model`, local artifact `directory`, `mode`, and, for ordered shards,
`ordered` stage configuration. Doppler's public partition API owns the layer plan.
The model manifest digest is checked before preparation. For a private LAN whose
peers can reach one another directly, set `hostCandidatesOnly: true` to use
WebRTC host candidates with an empty ICE server list. Configure the private
signaling URL separately. A pair behind incompatible NATs may fail to connect
with this setting.

`observationFile`, `auto: true` and `pollMs` enable reconciliation. `daemon: true`
keeps the host running after standard input closes. `initialModel` and
`initialContribution` explicitly choose startup behavior. A requester using
`followPlacement: true` must supply a bounded `capacityWaitMs`.

The JSON-lines control interface accepts `select`, `state`, `reconcile`,
`balances`, `statement`, `generate` and `cancel`. Every command has an `id`; generation emits
`delta` events followed by the result. `state` includes computer identity,
execution state, adapter information and owned GPU-buffer accounting. The
identity file, private room token, database and operator configuration stay out
of source control.

## Evidence

Focused tests cover admission, credit conservation, restart/replay, missing or
forged evidence, cancellation/completion races, partial settlement, remote retirement,
requester/provider restarts, token caps, admission fencing, local-stage exclusion, placement bounds,
clock skew and owner opt-out. The opt-in physical fixture is
`tests/fixtures/fleet-native-physical.js`; it consumes private operator paths and
an installed package receipt, verifies the remote delivery digest, runs real
WebRTC requests and retains settlement and cleanup results.

```sh
REPLOID_FLEET_PHYSICAL=1 node tests/fixtures/fleet-native-physical.js /absolute/operator/physical.json
```

The whole-request journey is `tests/fixtures/network-journey.js`, checked by
`tests/integration/network-journey.test.js`. One requester that holds no model
files and three test-owned providers run in one process over an in-memory
transport: a provider without the model completes and verifies it from peers,
the requester streams an answer with ranking off and on, the chosen provider is
stopped after its first streamed token, a fresh attempt finishes on another
provider, and a completion whose result is lost in transit is reconciled from
the provider's journal without generating or charging twice. It writes one
receipt with the route and reason, bytes moved, timings, charges and what still
fails. The mesh, custody exchange, journal, admission and credit service are the
real ones; the transport and the generator are not, so it establishes no real
inference, hardware speed, GPU cleanup or physical recovery.

```sh
node tests/fixtures/network-journey.js /absolute/receipt.json
```


`npm run verify:fleet-receipts` replays 50 signed requests from the November 10–11
native and browser receipts in fresh databases. Automatic CI verifies their
signatures, admission fences, conservation, conflicting proofs and idempotent
settlement against the current verifier. Empty input and empty request sets fail.
This CPU check preserves historical wire compatibility; it is not new inference,
new physical-loss testing or qualification of Launch 3 orchestration switches.

Physical receipts establish only the recorded devices, prompts, package and
route. They do not establish general model quality, a speed advantage for
sharding, Flash-Next readiness, or public-site deployment.

## Event feed

`server/fleet/notifier.js` publishes informational fleet events to a private
GitHub repository that an assistant can poll. It runs as its own process, opens
the credit database read-only, and keeps its cursor and outbox in a separate
SQLite file, so it cannot change balances or slow the service.

On first start it begins at the current end of the credit database; requests
still in flight are followed. When a request reaches a terminal state it queues
one event with a stable `event_id` (`fleet:<requestId>:<state>`):
`request.settled`, `request.cancelled`, `request.failed` (settled with a signed
terminal status) or `request.abandoned` (released before dispatch). Each batch is
one fast-forward commit through the operator's `gh` login that appends lines to
`events/YYYY-MM-DD.jsonl` and rewrites `latest.json`. Failed batches retry with
backoff (at least one minute after a rate limit); lines already in the feed are
skipped, so a lost delivery mark does not duplicate an event.

Events carry the request and work identifiers, the model identifier, computer
IDs from enrollment, token and credit counts, the evidence SHA-256 and journal
sequence numbers, and the notice "Informational only. Does not authorize any
action." They never carry prompts, outputs, evidence bodies, keys, network names
or addresses. The service exposes no host-error stream, so the feed has no
host-error events.

```sh
node server/fleet/notifier.js /absolute/operator/notifier.json --test-event  # one feed.test event
node server/fleet/notifier.js /absolute/operator/notifier.json               # poll loop
```

The private configuration names `creditFile`, `stateFile`, `repository`,
`branch`, `pidFile`, and optionally `ghCommand`, `pollMs` and `maxBatch`.

## Browser workspace

The existing Computers panel can pair with a native requester on the same computer.
Add `browserBridge` to its private `reploid.fleet-native/v1` configuration:

```json
{
  "browserBridge": {
    "port": 18784,
    "tokenFile": "/absolute/owner-only/browser-pairing-secret",
    "origins": ["https://replo.id", "http://localhost:8000"]
  },
  "daemon": true
}
```

Use at least 32 random bytes encoded as text for the pairing secret, with an
owner-only file. Run the existing `server/fleet/native-host.js` entry point with
that configuration. The bridge binds only 127.0.0.1. Every request checks the exact
browser origin and bearer secret. A browser may separately request permission to
access the local network. No signing key, private room token or model-file path
is returned to the browser.

In Computers, choose **Connect a native host**, enter its local address and secret,
and review the enrolled computer names. The pairing is stored only in that tab's
session storage. Choose a model under **Your private computers**. This authorizes
your native requester to serve the exact model through its reviewed private pool;
its existing per-provider disclosure, admission, spending limits and settlement
remain mandatory. It is delegation to the paired host, not browser-side hardware
attestation. A changed enrollment requires reconnection. Private selections never
fall back to public capacity or a local weight download.

The answer retains actual whole-model or ordered-stage execution and service-credit
records. Computers shows fresh observed capacity separately from execution receipts;
expired observations are offline, not ready. Service credits and receipt export are
on demand. Stop requests cancellation; a lost stream leaves a pending outcome until
the native owners reconcile. There is no automatic resend after interruption.
Browser history, drafts and reload use the existing conversation store; the bridge
does not retain prompt text. Signing keys and durable accounting remain native.

Local model downloads remain a separate reviewed action. Send does not acquire
weights, even if an older automatic-download preference was stored.

### Invited chat through the circle HTTP gateway

When a host runs the circle gateway, the browser keeps the draft on the requesting
device while waiting for a turn. It calls `POST /circle/admit` with the invite ID,
expected desktop identity, request ID, model identity and output limit. A paired
owner can revoke a waiting guest's invite before any prompt leaves the browser.

After admission, the browser checks the returned host, requester, model and budget.
It sends the draft to `POST /circle/chat` with the one-use grant and expected host
in the request headers. An unused grant expires or can be returned through
`POST /circle/cancel`. The host authenticates the peer at each step. A caller can
use [sendCircleChat](../apps/poolday/host/circle-invites.js) for this exchange.
The public challenge uses a separate switch. A successful invited turn leaves
that switch untouched.

## Authenticated HTTP text API

An enrolled native requester can also serve `/v1/models`, `/v1/chat/completions`,
`/v1/responses` and `/v1/messages` over its private pool by adding `textApi` to its
`reploid.fleet-native/v1` configuration (a Messages client may send the bearer
secret as `x-api-key`, on that route only):

```json
{
  "textApi": {
    "listenHost": "127.0.0.1",
    "port": 18785,
    "tokenFile": "/absolute/owner-only/fleet-api-secret",
    "allowedRecipients": ["peer:5c0ecd2fd5fd8a105a4f8068"]
  }
}
```

Use at least 32 random bytes encoded as text for `tokenFile` with mode `0600`.
Non-loopback `listenHost` values require `tls: { "keyFile": "...", "certFile": "..." }`.
Every request checks the bearer secret in constant time, verifies that the
requester remains in `private-pool` scope, checks disclosed provider signing
identities against the coordinator's enrolled computers (and optional
`allowedRecipients`), and reserves and settles non-cash service credits before
returning the `reploid` record (`executionReceipt` and the executor's `execution`
report) to a request that carries the [`reploid` extension](confidential-execution.md#http-adapters). Signing keys and room tokens remain on
the native host.


To serve a qualified split through this API, put an array of operator-reviewed
records in `textApi.privatePartitionApprovals`. Each record uses the same fields
as a [partition release](partition-releases.md): `modelId`, `modelIdentity`,
`adapterIdentities`, the complete ordered `partition` descriptor, and an
`evidence` reference. Review the exact plan and signed participant, transport,
resident and execution identities on each stage. Configure the matching plan
and stage credit weights on the fleet service. All stage providers must be
enrolled and, when specified, included in `allowedRecipients`.

The private API lists the approved route in `GET /v1/models` while it is ready
or busy. Submit the listed ID to `POST /v1/chat/completions` with `messages`
and optional `stream` and `max_completion_tokens`. A bare base model ID
continues to prefer available whole-model providers. Approval is local to the
configured fleet host and is checked again before dispatch. A changed stage
requires a new review. Public route approval is managed separately.

For a split interrupted by a provider disconnect, the Chat Completions and
Responses APIs return the `connection_lost` error code, including when a stream
has already emitted tokens. Keep the `x-reploid-reservation-id` for recovery.
Partial output may already be acknowledged; the ledger can hold a reservation
while it waits for missing stage evidence.
