# Native fleet service

`server/fleet/` adds enrolled computer identities, non-cash service credits and
placement to the existing native participant. It uses the existing WebRTC,
whole-model and ordered-partition execution paths. It does not change Doppler's
model arithmetic or qualification rules.

This is an operator-configured private fleet. The public chat site does not yet
use this credit coordinator. Purchased credits and payouts are separate.

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

SQLite retains balances, reservations, evidence hashes and the journal. A durable
client outbox retries lost settlement responses without generating another answer.
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
forged evidence, pending settlement, local-stage exclusion, placement bounds,
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
