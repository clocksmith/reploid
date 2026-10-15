# Local earning UI demonstration, 2026-10-15

Non-production. Local test sign-in, the test payment processor, a Firestore
emulator as the durable store, and the in-repository fixture route instead of
a model. Run against Reploid `ef33767f` from a clean detached checkout (no
other session's uncommitted files).

## What ran

[`demo.mjs`](demo.mjs) started, all on loopback:

- the Firestore emulator (firebase-tools, cloud-firestore-emulator v1.19.8);
- `server/proxy.js` with `REPLOID_EARNING_ROUTES=enabled` and
  `REPLOID_EARNING_COMPOSITION=server/earning-composition/index.js`,
  `REPLOID_EARNING_STORE=firestore` (emulator), the local test sign-in flow,
  the test processor, an operator-declared admitted-capacity file, an
  operator-declared Community Access capacity file (one admitted slot) and an
  operator file holding only a token digest, and `REPLOID_EARNING_SCHEDULER=in-process`:
  the server runs the durable scheduler over the policy's schedule (every job
  every 5 s, demonstration values); the policy file, capacity files and
  operator file lived outside the checkout and are not committed;
- [`contributor.mjs`](contributor.mjs): two native contributor devices of one
  account (`carol`) opened through `server/native-earning.js` (the module the
  native CLI's `--earning-config` opens), hosting the two resident stages of
  `tests/helpers/resident-route.js` with signed stage receipts, reached over a
  loopback WebSocket;
- headless Chromium, one browser profile per person. Every non-loopback HTTP
  and WebSocket request was blocked and recorded (none were made:
  `evidence/blocked-requests.json` is empty); the app ran with `?swarm=off`.

Four people, six devices:

| Person | Devices | What happened |
| --- | --- | --- |
| alice (requester) | browser profile A | Signed in from the app's Settings → Credits, topped up $10 on the test checkout page (1,000 credits), set a 20-credit standing limit, sent three answers. Each was quoted (maximum 20), held 20, charged 10 and released 10. Balance 970. |
| carol (contributor) | 2 native devices, browser profile B | The native devices accepted service-authored stage-share offers, submitted their signed receipts and claimed 8 stage shares (4 credits each: 6 from alice's answers, 2 from dave's); 2 claims for carol's own answer were rejected as self-demand. On browser profile B, carol saw 24 earned credits in the app and spent them on one answer (held 20, charged 10, released 10). Balance 22. |
| erin (Community Access) | a scripted device | Took the pool's one admitted slot, then ended her answer before dispatch. |
| dave (Community Access) | browser profile C | No credits. His request queued behind erin's while his client polled it. After erin's answer ended, the server's scheduler admission sweep (`community-access.admitWaiting~0000000003`, runner `local-demo-server`) released her slot and admitted his request, which his client was polling. The answer was charged to the pool; dave's own journal is empty. |

Every paid and Community Access quote carried evidence terms
(`reploid.attempt-evidence-rules/1.1.0`, two unacknowledged outputs): the
requester page signed charge bindings and acknowledged each output over the
bridge, and each settlement records `rules` and an `evidenceIds` entry with no
dispute (`evidence/accounts.json`). The founder's $100 weekly commitment
(10,000 US cents) is recorded in the funding register and allocated in full to
the pool as 10,000 credits (`evidence/founder-commitment.json`); the pool's
journal audits as consistent.

No step needed next-day timing; no clock was injected.

## How the UI was used

- **The app** (`/`, the actual boot): the Credits panel in Settings for sign-in,
  balance, recent activity, top-up hand-off, spending limit and last quote
  (screenshots 01, 02, 05, 09, 10, 12, 13).
- **The test checkout page** served by the provider routes (03, 04).
- **A harness page** (`/__earning-demo`, [`requester-page.mjs`](requester-page.mjs))
  for sending answers: the shipped chat session, conversation workspace,
  remote-contributor permission dialog, network inspector and Credits panel,
  arranged as the app's home route, composed with the same credits
  composition and the same browser storage. Only its partition port differs:
  it reaches the contributor process's fixture route over the bridge instead
  of the Poolday mesh (06, 07, 08, 11, 14). The app itself cannot send a
  charged answer here because no mesh route exists without real contributors.

## Evidence

- `evidence/screenshots/` (14 PNGs): kept in this directory locally; the
  repository's local exclude rule keeps `artifacts/**/*.png` out of git.
- `evidence/accounts.json`: each person's account, devices, balance, journal
  and reservations as the service returned them.
- `evidence/founder-commitment.json`: the commitment, its allocation and the
  pool account's audit.
- `evidence/contributor-log.jsonl`: native device registration, offers,
  attempts and claim outcomes.
- `evidence/scheduler-admission-passes.json`: the admission sweep's recorded
  passes that released or admitted requests, read from the emulator.
- `evidence/scheduler-cli-round.jsonl`: one round of
  `node server/earning-composition/run-scheduler.js --once` beside the
  server's runner. Every job reported `not_due` because the server's runner
  had just run it; this shows the shared job state, not a job run by the
  separate process (the tests cover that).
- `evidence/server-log-excerpt.txt`, `evidence/page-errors.json` (only 404s
  for the unconfigured search status route), `evidence/run.json` (timeline).

## What this does not show

- Live Supabase or Stripe: the test sign-in flow and test processor only;
  live smoke stays skipped. Native Supabase sign-in is not implemented.
- A model, GPU execution, answer quality or the WebRTC mesh: the answer text
  `012` is fixture output, and the requester-to-coordinator hop is the bridge.
- The native participant CLI end to end: its `--earning-config` path is
  unit-wired, but this run used the same module from a fixture host.
- Measured costs: the reward rate is a placeholder marginal cost of 1 credit
  per output token per stage plus the 20% pilot bonus; admitted capacity is
  operator-declared, not measured.
- Production, installed apps, phones, multi-instance rate limiting.

## Reproduce

```
node artifacts/earning-ui-demo-20261015/demo.mjs --repo <clean checkout> \
  --work <directory outside the checkout> --out <evidence directory> \
  --server-port <free port> --bridge-port <free port> --emulator-port <free port> \
  --java-home <JDK 21 or newer>
```

The demonstration's policy values are in `demo.mjs`; the owner's provisional
pilot values used there are the $10 top-up, the 30 s first-output and 180 s
complete-answer deadlines, the founder's $100 weekly Community Access
commitment and the marginal-cost-plus-20% reward rule. All others (prices, the
one-credit-per-cent conversion, queue and usage limits) are demonstration
values, not adopted policy.
