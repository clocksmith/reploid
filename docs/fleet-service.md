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

For whole-model cancellation or failure, the provider retains and submits
`reploid.generation-terminal/v1` only after its execution owner confirms cleanup.
Usage remains unknown. Setting `creditPolicy.wholeModelTerminalCharge` to `0`
accepts zero non-cash terminal charge, frozen into each reservation; omission
keeps the hold pending. This does not change purchased-credit accounting.
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
The model manifest digest is checked before preparation.

`observationFile`, `auto: true` and `pollMs` enable reconciliation. `daemon: true`
keeps the host running after standard input closes. `initialModel` and
`initialContribution` explicitly choose startup behavior. A requester using
`followPlacement: true` must supply a bounded `capacityWaitMs`.

The JSON-lines control interface accepts `select`, `state`, `reconcile`,
`balances`, `generate` and `cancel`. Every command has an `id`; generation emits
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

## Authenticated HTTP text API

An enrolled native requester can also serve `/v1/models`, `/v1/chat/completions`
and `/v1/responses` over its private pool by adding `textApi` to its
`reploid.fleet-native/v1` configuration:

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
publishing `reploid.http-execution/v1`. Signing keys and room tokens remain on
the native host.
