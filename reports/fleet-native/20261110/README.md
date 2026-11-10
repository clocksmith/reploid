# Private fleet accounting and native execution, November 10

This package repairs the F1–F6 settlement failures audited against `263f93c38`.
The checks cover non-cash credits on an enrolled private fleet. They do not
activate credits on the public chat site or qualify Flash-Next.

## Recovery boundaries

- Completed-output and early-cancellation races retain signed cleanup evidence.
  Only acknowledged output is billed; unused holds are released after proven cleanup.
- Graceful remote retirement carries the signed closing receipt. Undefined array
  entries and non-finite values are rejected before signing or writing an outbox.
- Output acknowledgment retries reuse the exact record. If the output RPC remains
  unavailable, the bounded closing response carries the actual signed outputs for
  requester verification. This is not a token count inferred from answer text.
- Requester acknowledgments and provider closing proofs have durable outboxes and
  independent service collection. A requester crash does not require regeneration.
- Reservation token caps and deadlines reach execution. Provider admission records
  the actual request cap. Admission fences and never-dispatched expiry release
  known unused holds; admitted unknown owners remain pending.
- Equivalent verified re-signatures have one economic effect. Different output
  chains, invalid signatures and unfinished cleanup do not gain acceptance.

SQLite retains full signed evidence and immutable economic results. Rejected proof
is kept for diagnosis outside the retry queue. Old reservations without an admission
journal cannot use the zero-admission release rule.

## Retained physical checks

The [delivery manifest](native-delivery.json) pins 222 files and Doppler 0.6.36.
Its SHA-256 is `e719f45c6078c26768cbb920cf7599a0fee44644d29c9620d76094bb7afa2421`.
These runs used a macOS Metal requester and Windows AMD contributor over WebRTC.
The exact Qwen 3.5 2B manifest is recorded in each receipt. GPU allocation ceilings
were 6 GiB per contributing device; the Windows single-buffer limit was 2 GiB.

[Whole-model](whole-model.json): three prompts, including 921 input tokens and
64 output tokens, plus a request after demand-driven loading. Four requests settled
72 units, with equal debit/credit and no remaining hold. Owner opt-out stopped the
idle provider. The requester held no model weights.

[Partitioned](partition.json): 12 layers on each device, two completed prompts,
cancellation after one acknowledged output, and successful reuse afterward. Four
requests settled six remote units. The requester's own stage share was unbilled;
all holds and owned test resources were released.

The two modes are separate service checks, not a controlled speed comparison or
full-logit numerical qualification. No Jupiter GPU job was started and its public
27B provider was not restarted. Private operator paths, tokens and signing secrets
are excluded from these files.

## Reproduction and verification

```sh
node tests/fixtures/fleet-credit-replay.js \
  reports/fleet-native/20261110/whole-model.json \
  reports/fleet-native/20261110/partition.json
```

This CPU-only replay verifies all eight retained requests in fresh databases,
rejects corrupted signatures, checks conservation, and proves duplicate settlement
leaves balances and journals unchanged.

Focused results: 95 tests across fleet service/credits, ordered evidence/peers,
route bounds/channel loss, native participant and whole-model ownership; three
native delivery tests; library types, scoped lint, charters and symbol checks.
The source tests additionally cover requester/ledger restart, provider outbox
recovery, final-output RPC failure, retirement and cancellation through real
protocol channels, token/deadline bounds, and unknown-owner holds. Their numerical
sessions are CPU fixtures, not GPU inference.

## Private deployment

[Deployment check](deployment.json): the restored coordinator and on-demand
Windows scheduled task used the same delivery. A fresh sky-explanation request
produced 30 output tokens and settled 30 credits. Existing balances were preserved:
requester -60, provider +60, both with zero held balance. The old signed receipt
was retained through an idempotent replay that changed no balance or journal row.
This check covers the operator's private room; the public chat site is unchanged.
