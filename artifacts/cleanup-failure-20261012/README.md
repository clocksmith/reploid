# Physical cleanup rejection and Retry stopping

Component: Reploid browser contribution lifecycle. Intent: preserved.
Acceptance evidence: `controller.mjs` and `result.json` (2026-10-12).
Boundary effects: diagnostic interception of the existing resident close method;
no production source, model, package, or permission changes.

## Result

The ordinary contribution controls prepared the Mac output partition (layers
12–23) with the physical Suby input contributor available. After preparation,
the diagnostic rejected the first close before calling the original resident
close. The interface displayed **Cleanup not confirmed**, disabled new
contribution, and offered **Retry stopping**. Resident weights remained owned.
Retry called the original close and reached the closed resident/reservation
state. A new contribution session then prepared and stopped independently.
The old resident received two close calls; its replacement received one.

The test completed successfully from 12:11:40 to 12:12:43 UTC. The isolated
browser context was closed in `finally`. No generation was submitted here.
This establishes idle resident cleanup failure/retry and replacement behavior,
not simultaneous long attempts, signed Capsule opening, or useful answers.

## Allocation observations

| State | Device allocated bytes | Weight-labeled bytes |
| --- | ---: | ---: |
| Ready | 296,010,000 | 285,497,344 |
| Failed stop | 296,010,000 | 285,497,344 |
| Retried stop | 58,021,376 | 47,535,360 |
| Replacement ready | 296,010,000 | 285,497,344 |
| Replacement stopped | 58,021,376 | 47,535,360 |

Peak allocation was 497,336,720 within the unchanged 1,420,000,000-byte cap.
Device allocation includes buffers beyond the resident owner. Doppler's
`BufferPool.release()` can retain buffers for reuse; this receipt did not
capture pool ownership, so it does **not** establish that every remaining
buffer was pooled or that GPU allocation reached zero. Both resident owners
and their reservations closed; observed allocation did not grow on replacement.
The browser context subsequently closed. Physical RAM/residency was not measured.

## Identity and reproduction

The controller serves subresources from a frozen `git archive f7757a81 self`
snapshot at `/var/tmp/reploid-cleanup-failure-20261012/self`, retains SHA-256
for each served resource, and requires the real HTTP entry document to match
that snapshot's `pool-entry.html`. Doppler remains standard archive
`9280ead598b098f9f3ad49574a001e88c3ad4b1a433d58349e79ee0e9c01fccc`.
Opening uses verified pinned manifests, not signed Capsule qualification.

With the existing local HTTP/signaling server, model file supplier, and
prepared physical input contributor available, run:

```sh
node artifacts/cleanup-failure-20261012/controller.mjs
```

The fixed profile path makes this a retained reproduction controller, not a
parallel-safe test. It creates real contribution sessions; coordinate GPU use.
CDP pauses only at the existing prepared-resident return boundary and wraps
close. Model operands and execution are untouched.

## Retained unsuccessful setup attempts

- `discovery-failure.json` and `discovery-failed-controller.mjs`: intercepting
  the navigation HTML caused Chrome's local-network address-space check to
  block the localhost WebSocket. No model loaded.
- `discovery-control.json` and `discovery-control.mjs`: a real HTTP document
  discovered three peers; intercepted navigation reproduced the blockage.
- `entry-preflight-failure.json` and its controller: preflight incorrectly
  compared `/` against `index.html`. The server serves `pool-entry.html` there.
  It stopped before model loading.

The final controller preserves real HTTP navigation and verifies its bytes.
No application networking repair or browser security bypass was introduced.

## Active conversation follow-up

`active-controller.mjs` / `active-result.json` extend the same frozen browser
contributor to an actual streaming conversation through the existing requester.
The first close is rejected while the answer is executing. The original attempt
becomes interrupted with its partial answer retained; Retry stopping settles the
resident. A replacement session prepares. The requester explicitly retries and
approves the actual Suby/Mac recipient pair again. The new attempt completes;
its entire answer is exactly the newline-separated integers 1 through 100.
All 27 pre-existing conversations compare unchanged. Two disclosure approvals
are recorded, and no HTTP weight request from the requester is observed.
This follow-up does not add a new full requester-storage scan or signed-opening
claim. The existing requester was attached over its retained CDP endpoint; only
the contributor's served module closure is freshly hashed in this receipt.

The follow-up ran 12:25:07–12:27:26 UTC and closed its contributor context.
Peak device allocation: **504,255,752 bytes**, within the same ceiling. It does
not establish simultaneous long conversations or final candidate acceptance.

A second one-time CDP observation captures the already-selected buffer pool
at `getBufferPool()`'s existing return boundary; it neither allocates a pool
nor changes the public application interface. Before retry, the pool retains
285,497,344 model bytes. After Retry stopping, retained-model, active and deferred
cleanup resources are all zero; exactly 9,411,328 bytes in 64 reusable buffers
remain. After the replacement completes and stops, queue settlement confirms
the same pool counts. Device accounting is 9,422,104 bytes: the additional
10,776 bytes are cached uniform buffers, with labels retained in the receipt.
This is measured pool ownership for this active run, not retrospective proof
of the idle run's entire 58,021,376-byte remainder or a zero-GPU-allocation claim.

This closes the focused active cleanup/retry boundary. It leaves the final
signed, simultaneous-long, exact-runtime acceptance open.

## Input-side observer failure after the successful conversation

`observe-input-failed-cleanup.mjs` attached to the still-running Suby input
contributor after the active receipt completed. Its public memory observation
(`input-after-active.json`) found zero recurrent bytes and 1,280 attention bytes,
all labeled cached KV-write uniforms, with weights still resident. This alone
does not establish reservation settlement.

The observer then scheduled `import('node:inspector')` in an inspector-evaluated
timer. Node does not supply a dynamic-import callback in that context, so the
unhandled `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` terminated the contributor.
`input-observer-crash.log` and `.json` retain this **diagnostic-caused failure**.
It occurred after the completed active test, before an input reservation snapshot;
input-side reservation settlement for that attempt remains unqualified.

The observer now uses Node's existing `process.getBuiltinModule('node:inspector')`
for debugger cleanup. The contributor was restarted using the same explicit
compute command and persistent profile; this restart reopens its lifecycle and
cannot prove old resident reuse. No production runtime or networking change was
made to explain away the diagnostic failure.

`input-observer-recovery.json` records restored PID 4018571, sharing/waiting
without an error. The corrected debugger cleanup leaves that process alive and
closes its inspector endpoint. The attempted reservation observer timed out
without hitting its source breakpoint and supplies no reservation proof. It is
retained as a diagnostic limitation, not a passing lifecycle assertion. Observe
both resident owners from their actual creation boundaries in the next required
integrated run rather than infer the original input ownership retrospectively.

The next reservation-probe revision moved the breakpoint from the arrow-function
creation statement into its body. Its observer callback then raced a second
Debugger.resume and allowed the rejection to escape into the contributor host.
`input-observer-resume-race.json` / `.log` retain that second diagnostic failure.
The callback now catches an already-resumed error, but the observer is not
qualified and was not run again. The original uninstrumented contribution
command was restored as PID 4019648 with the same profile, recorded in
`input-final-restoration.json`. No old input reservation-state claim follows.
These failures belong to the ad hoc observer, not application shutdown logic;
the observer must be isolated from the contributor process before future use.
