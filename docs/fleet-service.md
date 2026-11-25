# Native fleet service

`server/fleet/` adds enrolled computer identities, non-cash service credits and
placement to the existing native participant. It uses the existing WebRTC,
whole-model and ordered-partition execution paths. It does not change Doppler's
model arithmetic or qualification rules.

This is an operator-configured private fleet. A paired browser can use it from the
normal chat workspace; unpaired public-network chats do not use this coordinator.
Purchased credits and payouts are separate. The same ledger can also run with open
enrollment behind replo.id's accounts, where people pair their own computers by code:
see [self-serve accounts](self-serve-credits.md).

## Computer identity

An owner-only `identityFile` retains an Ed25519 signing identity across launches.
The coordinator enrollment maps its public key to the computer ID, display name
and owner. Several provider keys may belong to one computer, and several
computers to one owner. Generate
enrollment from the workspace fleet registry; do not maintain another static
machine inventory in this repository.

GPU adapter information, buffer limits and live memory observations describe
capacity. They are not unique hardware identifiers or remote attestation. A
copied signing key can impersonate its enrolled computer.

## Credits

Before sending a prompt, the requester reserves its maximum charge and records
dispatch. Providers independently check that admission before executing. The
credit policy sets the integer rate, debt limit, output limit, pending-request
limit and whether computers belonging to one owner may trade. Negative balances
are permitted within the debt limit.

### One balance per owner account

The balance belongs to the owner (`ownerId` in the enrollment), not to one
computer or key. Credit your desktop earns by serving pays for an answer your
laptop asks for, as long as both computers are enrolled under the same owner.
Work one of an owner's computers does for another of that owner's computers is
neither charged nor credited. The pending-request limit still counts per
computer.

Each journal row keeps the computer its delta is attributed to (`computer_id`),
so a statement still shows which computer earned and which spent. A ledger
snapshot has one row per owner account, with its `computerIds`, the joined
computer names and its debt limit. A self-serve account
([self-serve accounts](self-serve-credits.md)) is its own owner, with each
paired computer as a key on it, so it is the same unit.

A ledger written before owner accounts kept one balance per computer. It refuses
to open until the operator migrates it explicitly, with the same service
configuration it runs with:

```sh
node server/fleet/credit-migration.js /absolute/operator/service.json
```

`migrateFleetCredits` in `server/fleet/credit-migration.js` sums each owner's
computer balances and holds into one account, records which computer every
existing journal row belongs to, and stores the before and after balances with
the policy change in one SQLite transaction. Totals are conserved; nothing is
issued, forgiven or converted. A request reserved before the migration settles
with the per-computer arithmetic it was accepted under. The same migration adds
the default release windows and debt limit below when the stored policy left
them out; that needs a new policy `version`. It can also add
`maxUnacknowledgedOutputs`, the acknowledgment bound `K` the stages enforce
(currently 2), which publishes it to settlement verifiers through the policy
digest ([settlement-replay.md](settlement-replay.md)); once published it cannot
change. It cannot change the enrollment, the unit, the rate, the output ceiling,
the request deadline, the terminal charge or the same-owner rule. Repeating it
returns the retained record. A policy whose `partitionUnclaimedReleaseMs` is not
longer than its `maxClockSkewMs` is refused.

### First request and starter allowance

There is one allowance mechanism: an account's debt limit, the most it may owe.
These are non-cash service credits with no cash value. A negative balance is
not issued credit: every credit has an equal debit on another account. A policy
that omits `maxDebt` gets one answer at the policy's own output ceiling
(`maxOutputTokens × creditsPerOutputToken`). A new account with a zero balance
can then make its first request, of any size the policy allows, and its
computers earn by serving. Until it has earned, it cannot ask for a second
answer. An explicit `maxDebt`, including 0, is kept as written. With `maxDebt:
0` and every balance at zero, nobody can ask, so nobody can earn.

An enrolled computer's `debtLimit`, or a self-serve account's starter debt
(`starterDebt`), lowers the limit for that account, never above `maxDebt`. An
owner whose computers set different limits gets the smallest. The optional
`creditPolicy.maxTotalDebt` caps what all accounts may owe together.

### Refusals

A request the account cannot cover is refused before any hold or disclosure.
The ledger error carries `creditRefusal: { code, quote, ... }`. The authenticated
text API answers `402` with `error.code` `service_credit_insufficient`, or `409`
with `service_credit_pending_limit` when the account has too many unfinished
answers. `error.service_credit` holds the refused quote and what can be spent
(or the pending count). The message text is unchanged. A refusal by the
network-wide debt cap is `service_credit_insufficient` with
`reason: "network-debt-cap"`.

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
Unacknowledged work is not billed, and neither is an acknowledgment signed after
the request deadline plus clock skew: the ledger keeps the requester's earlier
in-time acknowledgment and refuses to settle on the late one, as the
[settlement replay](settlement-replay.md) does. A stage's closing receipt still
counts when it arrives after the deadline and is signed by the deadline plus the
release window plus clock skew, even when the steps it reports ran after the deadline; a step receipt signed
after the deadline plus clock skew is verified and ignored.
A signed `failed` receipt proves cleanup only
with its closing timestamp; it does not turn a failed answer into a completed one.
Equivalent verified re-signatures retain the original economic outcome.

For a fenced partition request, `POST /v1/reploid/recover` returns
`serviceCredit.awaitingStages` while settlement is pending. Its zero-based
indices identify stages from the accepted route whose closing evidence is
still required. `heldCredits` is the outstanding reservation, and
`acknowledgedOutputTokens` is the durably signed count. A null count means
the ledger is waiting for the requester’s acknowledgment. Zero means the
requester signed the empty prefix. Recovery reads those facts across restarts.

### Stop

A person's Stop is signed. The browser's **Stop** (the bridge's `/cancel`), the
native host's `cancel` command and `POST /v1/reploid/recover` with
`"stop": true` make the requester sign `reploid.settlement-stop/v1` for the
reservation. For a whole-model answer the requester has not countersigned a
receipt for, that stop settles the hold at once, as `cancelled` with zero
charge and no credit. This also covers a Stop that arrives after the provider has
finished, when nobody signs a cancellation. Whole-model output has no per-token
acknowledgment, so the acknowledged count is zero. That is the same economic
outcome as the provider's own signed `cancelled` cleanup, which is later
accepted with no second effect. A countersigned receipt can only exist if the
requester accepted the answer. Whichever signed closing statement reaches the
ledger first settles the request, and a conflicting later one is refused. If the
requester countersigned just before the Stop and the receipt arrives second, the
provider is not paid for that answer.

A split answer settles on its stages' signed closing receipts and the
requester's signed acknowledgments, by the settlement replay's charge rule
([settlement-replay.md](settlement-replay.md), step 9; `credit-shares.js`,
`credit-evidence.js`). When the person stops a split answer, the requester signs
`reploid.settlement-stop/v1` and hands it to the ledger through `collect` before
its stages are told to stop (it waits at most 2 s for the ledger), then sends it
again with the closing evidence. With that stop the acknowledged prefix is
charged. Without it, an unfinished answer that the stages closed, with `settled`
or `failed` receipts, is an unattributed disconnect and charges the same
acknowledged prefix, capped at the signed output ceiling and split by the signed
weights, with reason `unattributed-disconnect-acknowledged-prefix`. This is the
owner's decided rule (`settlementRules: reploid.settlement-replay/v2`; settlement
terms name it as `unfinishedTerms:
reploid.unfinished-answer/acknowledged-prefix-provider-relief/v1`), and the
ledger and the settlement replay agree on it
([settlement-replay.md](settlement-replay.md#unfinished-answers)). A verified
provider failure, a stage that never signed its close or a stage owner that
vanished, charges the requester nothing and pays no stage. A requester's
silence is never a provider failure. Reservations accepted under
`reploid.settlement-replay/v1` keep that rule: such an answer charged nothing,
with reason `stage-ended-unfinished-answer`. Reservations accepted under the
interim `reploid.settlement-replay/v1+acknowledged-prefix` charged the
acknowledged prefix, with reason `unfinished-answer-closed-without-requester-stop`.
Outputs acknowledged past the reservation's output ceiling
are accepted, never charged, and recorded as `beyondCeiling`. A reservation made
before these rules (no `settlementRules` in its binding) keeps the rules it was
accepted under.

A lost connection is not a Stop: a closed HTTP stream or browser stream leaves
the answer recoverable through `POST /v1/reploid/recover` until its deadline
plus the release window. The credit outcome of a Stop is final, but it does not
establish GPU cleanup; the provider still reports that.

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

### Release windows

No hold outlives its request deadline plus a release window. A whole-model
provider that admitted a request and then never returns has the deadline plus
`creditPolicy.wholeModelUnclaimedReleaseMs` to submit completion or cleanup
evidence. After that the hold is released with status `expired`, no charge and
no credit, and a later claim for that request is refused. A provider that did the
work but returns after the window is therefore not paid for it.

A split request has the same gap, and a wider one: settlement needs every
stage's signed closure, so one stage host that disappears for good would strand
the hold even when the other stages signed. `creditPolicy.partitionUnclaimedReleaseMs`
bounds it. Once the clock passes the request deadline plus this window plus the
clock skew allowance (the last instant a closing receipt still counts; a
reservation accepted before the interim rules is decided at the deadline plus the
window), a split request whose proof is still incomplete reaches one final outcome: status `expired`, reason
`stage-unclaimed-after-window`, no charge, and no credit to any stage, including
stages that did sign. The outcome records the acknowledged output count and
lists each stage that never signed with `cleanup: "unverified"` (or
`"never-admitted"`); it asserts nothing about what a silent host did. When the
answer was delivered (the final stage signed `done` at the count the requester
acknowledged in time) but some stage has no receipt covering it, the reason is
`unknown-delivered-answer-without-covering-receipt` instead: the replay's
`unknown`, with the same zero amounts. A later
claim or late receipt for that request is refused and pays nobody, and the
outcome survives a restart. A requester that retries does so as a new request,
charged once. A request whose proof is complete is settled when that proof
arrives and is never expired.

One case settles at the window instead of expiring, the same rule the settlement
replay applies ([settlement-replay.md](settlement-replay.md), step 6): the final
stage's retained receipt signed `done` at count `N > 0`, the requester's
retained acknowledgment of `N` carries that receipt's chain and was signed by
the deadline (plus clock skew), every stage that closed covers `N`, and each
stage that never closed has a retained step receipt signed by the deadline with
`steps >= N`. Those stages are treated as closed at their last signed step, so
one stage withholding its closing receipt cannot stop every stage's pay for an
answer the requester received and acknowledged in full. The request settles
once, with the `credit-shares.js` arithmetic: the requester is charged for `N`
outputs and every stage is credited its share. The outcome has reason
`closed-at-last-signed-step-after-window` and lists the stages in
`closedAtLastStep`; the journal entry's evidence carries the same list, and the
statement verifier accepts it only when the entry is dated at or after the
deadline plus the window and the retained receipts meet every condition. A
closing receipt or claim that arrives later returns the settled outcome and
moves nothing. An answer that did not finish, as after a provider loss, never
meets the rule and still expires with no charge. Stages that exited through a
signed owner closure keep their own rule.

Both windows default to 120000 ms (`DEFAULT_UNCLAIMED_RELEASE_MS` in
`server/fleet/contract.js`) when a policy omits them, and cannot be switched
off. They are part of the frozen credit policy, so a ledger created without them
gets them through the explicit migration above.
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

Each owner account can export its own journal statement
(`reploid.fleet-credit-statement/v2`, from `statementMine` on the service,
`client.statement()`, or `{"id":"1","op":"statement"}` on the native host control
stream) and verify its balance offline without trusting the service operator.
It names the account (`accountId`) and its `computerIds`. Each entry is one
settled request with the account's total delta and its `attribution` per
computer. The verifier recomputes both from the signed evidence, so moving a
delta between the account's own computers is detected. A v1 statement, issued
per computer before owner accounts, still verifies:

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
`participantIds` to pin the account's own signing keys (all its computers') without the full
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

Two host settings are easy to get wrong:

- **Which mode asks.** A model entry with `mode: "whole-model"` loads that model
  to serve it; its process has no requester and cannot ask other computers. A
  computer that asks for a model it does not serve uses `mode: "partition"`
  with `ordered: null`. Selecting a whole-model entry without contribution
  (for example `initialContribution: false`) is refused at startup with that
  explanation, rather than waiting for providers it would never see.
- **A smaller output cap.** A requester whose `maxOutputTokens` is below the
  model's `generation.maxTokens` sends its own cap as the request's
  `maxOutputTokens` setting, so the provider admits and generates within it. A
  provider that would still generate past the reserved limit is refused with
  an error naming both limits.

`observationFile`, `auto: true` and `pollMs` enable reconciliation. `daemon: true`
keeps the host running after standard input closes. `initialModel` and
`initialContribution` explicitly choose startup behavior. A requester using
`followPlacement: true` must supply a bounded `capacityWaitMs`.

The JSON-lines control interface accepts `select`, `state`, `reconcile`,
`balances`, `statement`, `generate` and `cancel`. Every command has an `id`; generation emits
`delta` events followed by the result. `generate` is prepared and run through
[`reploid/inference`](confidential-execution.md): its `request` may carry `execution`
requirements in the API's shape, and without them it names the enrolled computers this
host pins. A peer `privacy` policy is refused. The result carries the API's
`executionReceipt`, and a refusal reports its stable `code`. `state` includes computer identity,
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
on demand. Opening **Service credits** reads the paired requester's own account
(balance, held and available credits), its recent journal (credits earned by
serving, credits spent by asking, and holds released unclaimed) and the other
enrolled accounts. **Save statement** downloads that account's signed statement for
the offline check above. Before Send, a priced route states the most one answer can
cost. A request the account cannot cover is refused before any hold or disclosure,
and the answer says so with the quote and what can be spent. Each answer states
what was charged, including a Stop or failure that settled at zero. An answer whose
hold is still pending shows the held amount, and Execution details re-reads the
ledger when the answer is opened again. Stop is signed and settles a whole-model hold at zero (see Stop above); a lost stream leaves a pending outcome until
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

A credit refusal before anything is sent is `402` (`service_credit_insufficient`)
or `409` (`service_credit_pending_limit`) with the refused quote in
`error.service_credit`, on every protocol; see Refusals above. `POST
/v1/reploid/recover` with the original messages and `"stop": true` ends an
unsettled whole-model answer with the requester's signed stop, at zero.

For a split interrupted by a provider disconnect, the Chat Completions and
Responses APIs return the `connection_lost` error code, including when a stream
has already emitted tokens. Keep the `x-reploid-reservation-id` for recovery.
Partial output may already be acknowledged; the ledger can hold a reservation
while it waits for missing stage evidence.
