# Fleet browser journey, replay bundles, and disconnect propagation, November 10

[Hosting receipt](hosting.json) records the coordinated deployment and physical
verification of Reploid `f6419986725fb8ae079b60f4ee707635e3fd0062` with pinned
`doppler-gpu` `0.6.36`
(`sha512-0gqBQVBl6wVXZPBlRWyHmvGlcjSzGehk3wYMlXGp76tm2/VZWQvHW+Xqax+6Kc8M2DOw6AJicGvyZmy4YJTLog==`)
on https://replo.id/, followed by disconnect-propagation deployment and
verification on the private `/v1/responses` fleet ingress.

## Frozen release and paired deployment

- Firebase Hosting (`hosting:reploid`) deployed 2,404 files; post-deployment
  verification matched all 2,403 bundle files at https://replo.id/ against
  `sha256:d76eaf80c68e85fdf10d9b450f567b009fdda97af7cb9782c9589eda2287737d`.
- The native coordinator and paired requester rolled out from the matching
  native package (`47e5b357c56d96526aedcb6c2936e02abf86792e5ce9eaf26abc4064eec3d27d`,
  updated to `2d707a670380adbb6fbfd92745b455623baa8706bc72549ecb6e6829c92a9458`
  for disconnect propagation) without restarting the public 27B provider or
  the resident private whole-model contributor
  (`sha256:38a4c6fa2219a6149b6ee85ede6807540f0097801c1c878796e13520f02578bd`).
- Prior UI layout captures remain retained in [desktop.png](desktop.png) and
  [phone.png](phone.png).

## Hosted paired execution and honest cancellation

- On https://replo.id/ in Chrome `157.0.8103.39` (automated headless launch
  required explicit `--disable-features=BlockInsecurePrivateNetworkRequests,LocalNetworkAccessChecks`
  for loopback bridge access from an HTTPS origin), the browser paired with the
  local native requester (`peer:721778acd0c5f26a47f936d5`), selected
  `qwen-3-5-2b-q4k-ehaf16`
  (`sha256:a0dc69e917133a82780823d17fc771c0f6b882d7c86c571deeaef45be2ff108b`),
  and executed on remote contributor `peer:5c0ecd2fd5fd8a105a4f8068` with zero
  requester weight downloads.
- Reservation `service:peer:721778acd0c5f26a47f936d5:50378eb7-2385-4fe7-99ee-09a0223c8cf2`
  held `512` maximum credits during execution, settled `70` output tokens
  (`70` non-cash service credits), and returned remaining holds to `0`.
  Reloading https://replo.id/ preserved the completed answer and remote
  provider attribution without resending.
- Active streaming cancellation (`service:peer:721778acd0c5f26a47f936d5:b1dfb075-2dfc-435f-8892-99a15b389925`)
  transitioned the browser attempt to `cancelled` in `91 ms` without accepting
  partial text as a completed answer. The remote provider stopped between
  Doppler token decode steps (not mid-kernel GPU preemption), awaited WebGPU
  queue settlement, and signed `reploid.generation-terminal/v1`
  (`status: "cancelled"`, `charge: 0`), closing the `512`-credit hold in
  `327 ms` with conserved balances (`-1735` / `+1735`). Reloading preserved
  `["completed", "cancelled"]` attempt states with zero resend.

## Independent receipt replay

Sanitized bundles omit prompts, completions, bearer secrets, network addresses,
and private nicknames:

- [valera-synthetic-replay.json](valera-synthetic-replay.json): four physical
  requests from the earlier synthetic gateway run (`+6`, `+230`, `+230`, `+230`;
  net `696` credits from `±899` to `±1595`), including `cbbe2d58` where
  upstream CDN buffering let the dispatched pass complete and settle `230`
  credits.
- [hosted-browser-replay.json](hosted-browser-replay.json): four physical
  requests on the hosted browser bridge (`+70`, `cancelled 0`, `+70`,
  `cancelled 0`; net `140` credits from `±1595` to `±1735`).
- [worker-disconnect-replay.json](worker-disconnect-replay.json): three
  physical in-flight abort settlements (`cancelled 0`, `±1735` conserved) plus
  recorded queued pre-dispatch cancellation and `/v1/reploid/recover` outcome
  metadata.

Replay signatures, admission fences, maximum credit holds, settlement,
idempotent duplicate settlement, conflicting-settlement rejection, and balance
conservation without GPU or network access:

```sh
node tests/fixtures/fleet-credit-replay.js \
  reports/fleet-browser/20261110/valera-synthetic-replay.json \
  reports/fleet-browser/20261110/hosted-browser-replay.json \
  reports/fleet-browser/20261110/worker-disconnect-replay.json
```

## Disconnect propagation boundary trace and verification

- **Upstream CDN hop (`app.valera.systems/api/cloud/**` -> Cloud Run)**:
  Cloud Run request logs show `cbbe2d58` ran `24.144s` (`HTTP 200`) because the
  Firebase Hosting CDN rewrite terminated the client HTTP/2 stream reset while
  draining the backend HTTP/1.1 response from Cloud Run. Calling a direct
  non-buffering origin avoids that proxy drain.
- **Worker and tunnel hop (`reploid-fleet-api` `5d6dd4bb-4ae8-4301-86c1-972adc7a2766` -> `cloudflared` -> `/v1/responses`)**:
  `server/fleet/cloudflare-tunnel-worker.js` links `request.signal` and
  downstream SSE `ReadableStream.cancel()` to an upstream `AbortController` and
  `reader.cancel()`, returning `499` on pre-header client disconnect.
- **Native HTTP, queue, hold retention, and recovery (`server/http-request-owner.js`, `server/fleet/requester.js`, `server/fleet/native-host.js`, `server/fleet/text-api.js`)**:
  - Pre-header socket close aborts queued work before provider dispatch. A live
    second request queued behind an active pass on `/v1/responses` aborted in
    `309 ms` with `0` reservations created, `0` held credits, and `0` provider
    executions.
  - Disconnecting an in-flight pass (`1d8a9a31-cdd7-4bd7-8823-ae994352da5d`)
    fenced admission while retaining the `512`-credit hold (`held: 512`) until
    signed provider cleanup settled `202 ms` later; client disconnect never
    issues refunds or releases holds on its own.
  - `POST /v1/reploid/recover` reconciles interrupted reservations against
    coordinator state and the provider journal without repeating inference,
    returning `reploid.request-outcome/v1` (`acknowledged`, `finished`,
    `unknown`).

## Scope boundary

Larger-model placement, multi-user concurrency qualification, public payouts,
and economic advantage remain separate qualification work.
