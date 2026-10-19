# Discovery write amplification repair — 2026-10-18

Component: Cloudflare discovery and admission. Intent preserved; no authority or protocol boundary changes. No model, browser bundle, credentials, account plan, capacity limit, lease duration, join deadline, or peer timeout changed.

## Repair

The deployed predecessor rewrote every live admission lease on every room alarm, normally every ten seconds. Healthy rooms used the pending-join cadence even when nobody was joining.

Admission now reads each durable expiry and rewrites it only in the latter half of its existing 90-second lifetime. A missing or expired lease is still rejected. Fresh lease state needs no process-local cache, so this behavior survives eviction. Room alarms now use the earliest pending join or inactive-peer deadline, capped by the existing 30-second heartbeat interval. A new connection can still bring the alarm forward. Cleanup and capacity enforcement remain durable.

The live post-quota check exposed a second issue: existing overdue alarms were never rearmed. Recovery now rearms overdue room/admission alarms, and a heartbeat restores missing room cleanup without postponing an earlier deadline. Two additional regression tests failed before that repair; all 20 Workers tests pass afterward.

## Evidence

- [Cloudflare namespace metrics](quota-metrics.json): the October 18 UTC query reports 101,591 SQL rows written by `SwarmAdmission` and zero by `SwarmRoom`. This attributes the reported SQL write volume to admission; it does not break down individual methods or every billable alarm operation.

- [Before](before.log.gz): 15 existing Workers tests passed; all three added regressions failed. A one-hour, eleven-peer fixture polling renewals every 30 seconds recorded 1,320 lease row changes.
- [After](after.log.gz): all 18 tests passed in the actual local Workers runtime. The same fixture enforces at most 660 lease row changes, with no lost lease. That is at least 50% fewer lease updates at the identical polling cadence. Production also stops polling healthy rooms at the old ten-second cadence. These fixture counts are not account-wide Cloudflare billing measurements.
- Tests cover eviction, durable lease retention, renewal near expiry, expired/missing rejection, earlier join/idle deadlines, admission and peer caps, room isolation, hibernation, departure, credentials, origins and frame/rate boundaries.
- [Build](build.log.gz): Wrangler dry run passed. Scoped ESLint passed; source diff whitespace check passed.
- The browser Verification Worker was also tried against the server files. Both [baseline](verification-worker-baseline.json) and [candidate](verification-worker.json) produce the same two process-execution errors because its broad `exec(` pattern matches the existing SQLite API. These are retained failed diagnostics, not passes. This is a Cloudflare server adapter; the component's executable acceptance is the Workers runtime suite, and there are no changed browser modules. The browser verifier was not modified or bypassed.
- [Deployment](deploy.log.gz): `reploid-swarm`, version `87941425-da17-4814-a115-63cd0a871ca6`, release `cloudflare-swarm-20261018-lease-renewal`, at https://reploid-swarm.reploid.workers.dev.
- [Final local runtime tests](alarm-recovery-after.log.gz): 20 passed, including both [new recovery regressions](alarm-recovery-before.log.gz).
- [First live check](live-before-reset.json): the new release responds at `/health`, but WebSocket upgrade returns HTTP 503 before the reported daily quota reset. Deployment does not reset consumed quota. Post-reset attempts remained blocked through 00:03:13 UTC; the subsequent attempt connected but failed expiry. Those failed receipts are retained as `live-reset-first.json` and `live-recovery-*.json`.

- [Hosted CI](ci.json) for `9c17760c` passed: 4,603 unit/integration tests passed and 36 remained skipped; installed-package smoke and all nine browser-boot checks passed. Optional skipped checks remain unqualified.

## Rollout and recovery

The first recovery deployment was version `ed17da8c-3f25-48c4-b9f8-98ee0afa236a`. Fresh private-room expiry passed, but the existing public room still failed cleanup. The live trace showed the existing room/admission actors still executing the earlier `87941425` version while the front Worker reported the new release. The installed Wrangler defaults to deferred actor updates with a 300-second maximum delay; the front Worker's health response alone does not identify the actor version.

[Immediate deployment](deploy-immediate.log.gz) and [explicit rollout](rollout.log.gz) selected final version `9f152187-7788-469d-8eac-e11d2837dbb9`, release `cloudflare-swarm-20261019-lease-recovery`. Immediate selection was also not treated as proof of immediate actor activation: another failed lifecycle receipt remains in [live-immediate.json](live-immediate.json). Subsequent live trace entries confirmed both actors running `9f152187`. Final lifecycle and application checks run only after that confirmation.

Final live result: **passed** on confirmed actor version `9f152187`.

- [Public-room lifecycle](live-confirmed.json): joined, stayed connected for 120 seconds (past the initial 90-second lease), forwarded negotiation after renewal, observed departure and rejoined with the same identity. Unjoined and inactive connections closed with code 4001 within their declared deadlines. All probe sockets were closed afterward.
- [Actual application](app-probe.json): two fresh Chrome contexts opened https://replo.id, showed authenticated connections in Computers, and each displayed `4 connected · 1 ready · 0 working · 0 unavailable`. This verifies discovery/UI readiness, not answer quality or a new inference request.
- Earlier `app-*.json` failure receipts used the obsolete `[data-mesh-peers]` selector. Those timeouts do not establish a product failure. The corrected probe uses the current Computers panel and requires observed identity authentication. Failures were retained rather than reclassified as passes.
- [Runtime commit CI](ci-recovery.json) for `31369273` passed. The 36 previously skipped unit/integration checks remain unqualified; the separately executed Cloudflare runtime suite passed all 20 tests.

The final confirmed lifecycle ran from 2026-10-19T00:12:56.737Z to 2026-10-19T00:14:57.947Z. The quota and rollout delays observed earlier are preserved separately; neither a deployment receipt nor a healthy front Worker was treated as proof of actor recovery.

## Reproduction

```sh
npm run verify:swarm-cloudflare
npm run build:swarm-cloudflare
node artifacts/swarm-write-repair-20261018/live-probe.mjs
node artifacts/swarm-write-repair-20261018/app-probe.mjs
# For urgent existing-object rollout, explicitly select immediate updates and
# verify actual actor versions afterward; the health route identifies only the front Worker.
# npm run deploy:swarm-cloudflare -- --durable-objects-code-update-mode immediate
```

The live probe opens four temporary public-discovery connections, exercises active renewal, ten-second unjoined expiry, sixty-second inactive expiry, negotiation, departure and same-identity reconnect, then closes its sockets. It requests no inference, weights or TURN credentials. It requires the service quota to be available and runs for approximately two minutes to cross the original lease lifetime.

The free plan remains finite. This repair removes unnecessary periodic writes; it does not promise unlimited simultaneous peers or protection from every source of quota consumption. Namespace-level SQL metrics are retained; individual operation shares and post-deployment daily savings remain unmeasured.
