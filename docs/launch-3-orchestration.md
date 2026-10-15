# Launch 3 orchestration: concurrent prepared service

Design note for Launch 3 (private roadmap) source work. It defines one
small supported arrangement, the authority model and how each mechanism is accepted. It is not
evidence: source and injected-port tests prove orchestration only. Physical acceptance is listed
at the end and has not run.

## Default: Launch 1 behavior

`main` also produces the Launch 1 candidate. Every mechanism below is off unless the host
passes an explicit `ordered.orchestration` member. Without one, stages come only from operator
assignment, routes use first-valid matching in peer-id order, each resident admits by its own
slots and the existing error codes are unchanged. Each mechanism's commit extends
[`launch3-default-off.test.js`](../tests/unit/launch3-default-off.test.js), which pins this.

## Arrangement

- One model and one ordered plan: Qwen 3.5 0.8B Q4K, three stages, on the existing
  test-signed delivery.
- One coordinator holding stage 0, operator-assigned or automatic.
- Two to four automatic contributors. Each is one browser page or one native process with one
  GPU device, so one Doppler runtime and one 1,420,000,000-byte allocation ceiling.
- Up to four routes per coordinator (`maxRoutes`) and the existing per-resident slots.

Larger meshes, more models, several stages per device and cross-process sharing of one GPU are
outside this arrangement.

## Authority

- An operator either assigns a stage, as today, or chooses `auto` for one model. Choosing
  `auto` authorizes this contributor's own policy to pick a stage index from what discovery
  observed. Discovery still grants nothing. No peer, link or coordinator can assign another
  participant's stage.
- Requesters never assign stages. A coordinator chooses routes only among stages already
  prepared and offered.
- Moving a contributor is local and happens only while it has no admitted, queued or
  unsettled attempt. Active conversations never move. A new route serves only new attempts.
- Existing grants, disclosure approval, reservations and settlement are unchanged.

## Mechanisms and switches

| Mechanism | Switch (`ordered.orchestration.*`) | What it does |
| --- | --- | --- |
| Cold stage assignment | `autoStage: { dwellMs }` with operator stage `{ modelId, assignment: 'auto' }` | Picks the least-supplied stage index from observed ready offers and auto claims; simultaneous joiners spread by participant-id rank. Re-evaluates only when idle, after `dwellMs`, when its stage has at least two more contributors than the least-supplied one, and only the highest participant id on that stage moves. |
| Measured route preference | `routeRanking: { margin, smoothing, maxObservations, workload, costs }` | Ranks complete prepared routes for new attempts by expected cost under `costs` (`reploid.route-cost-policy/v1`, all members required). Unmeasured or stale inputs use declared priors. A full or closed current route yields to an admissible one; otherwise the current route stays while it has active attempts, and another route must be cheaper by `margin`. Each decision is recorded as `reploid.route-selection/v1`. A route no longer preferred retires once idle. Peer id only breaks ties, in code-unit order. |
| Shared device admission | `admission: { maxBytes, maxConcurrentAttempts, attemptBytes }` | One budget per device: resident weights once, plus `attemptBytes` and one slot per admitted attempt, across every resident and route on that device. Released only after settled cleanup. |
| Fair bounded queues | `admission.queue: { maxQueued, maxQueuedPerRequester, maxWaitMs }` | Waits instead of failing when the device is full. The route owner with the fewest admitted attempts goes first, then the least recently served, then FIFO. Queue length is advertised as `capacity.queued` and `capacity.maxQueued`. A full queue, the per-requester bound or `maxWaitMs` fails with `CAPACITY_UNAVAILABLE`, which reaches the coordinator as that code. `maxWaitMs` must be below the 300 s channel timeout. Requesters do not yet see a separate waiting status. |
| Useful replicas | `replicas: { queueBound, bottleneckRatio }`, with `autoStage` | Once every stage is supplied, an automatic contributor joins a stage whose advertised queue exceeds `queueBound`. Failing that, it joins a stage that a ranking coordinator's advertised `stageCosts` show at least `bottleneckRatio` times slower than every other stage. An idle contributor moves there only if its own stage keeps another supplier. Coordinators with ranking route new attempts to either replica; existing attempts stay. |

Where admission is enforced without these switches: Doppler's device budget
(`configureDeviceMemoryBudget` in `self/host/work-partitions.js` and
`server/native-participant.js`) rejects allocations above 1,420,000,000 bytes while executing,
not at admission. Slots are counted per resident (`createPartitionReservations` in
`resident-partition.js`) and per route runner (`partition-route-execution.js`). Nothing charges
bytes at admission or shares slots across residents.

## Source acceptance

Each mechanism has unit tests with injected Doppler stages. The tests exercise the new behavior
and fail on the earlier source. Each commit also passes `verify:library-types`, `verify:layers`
and `verify:catscan`. These tests do not prove physical capacity, speedup, fairness under real
load or answer quality.

## Physical acceptance (not run)

It needs coordinated GPU time, the scoped campaign reservation, fresh process checks and the
existing stop conditions. Public contributors stay untouched.

1. **Delivery:** a test-signed delivery built from a commit containing these increments and the
   16-token prefill chunk. That chunk passed numerical requalification in both placements
   (`64afd281`) after a 256-token chunk reset the Intel GPU on 2026-10-14. The installed journey
   with that chunk remains its own gate.
2. **Devices:** four distinct GPUs: mac-host (coordinator, stage 0), amd-host, intel-host, plus
   a fourth device for a replica. Three hosts can test assignment, ranking, admission and queues,
   but not a replica on separate hardware.
3. **Configuration:** set `attemptBytes` from a measured per-attempt peak on each device. Keep
   the 1,420,000,000-byte ceiling. Keep orchestration configs per host with the run.
4. **Controls, each with the switch off first, then on:**
   - cold joins in each order and simultaneously;
   - an idle rebalance;
   - a move refused during an active answer;
   - placement A against placement B with ranking (diagnostic timing in `64afd281` shows the output
     head on AMD more than halves the short-prompt decode step);
   - concurrent requesters above slots plus queue: `CAPACITY_UNAVAILABLE` within `maxWaitMs`
     and no hang;
   - two coordinators sharing one contributor: completion order and per-route admission counts;
   - a shared-device refusal at the byte budget;
   - a replica prepared for the measured bottleneck, then new attempts on both replicas;
   - the Launch 1 cancellation, contributor-loss and retry journey repeated with switches on.
5. **Record per run:** host failure domains, stage choices with their observed inputs, route
   decisions, per-stage phase timings, queue lengths, admitted bytes, Doppler peak bytes,
   settlement receipts and per-requester outcomes.
6. **Comparison:** measured concurrency and latency against the same hardware with the switches
   off. A gain counts only if Launch 1 lifecycle checks still pass.
