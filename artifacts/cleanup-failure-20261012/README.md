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
