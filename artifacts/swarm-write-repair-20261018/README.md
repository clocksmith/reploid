# Discovery write amplification repair — 2026-10-18

Component: Cloudflare discovery and admission. Intent preserved; no authority or protocol boundary changes. No model, browser bundle, credentials, account plan, capacity limit, lease duration, join deadline, or peer timeout changed.

## Repair

The deployed predecessor rewrote every live admission lease on every room alarm, normally every ten seconds. Healthy rooms used the pending-join cadence even when nobody was joining.

Admission now reads each durable expiry and rewrites it only in the latter half of its existing 90-second lifetime. A missing or expired lease is still rejected. Fresh lease state needs no process-local cache, so this behavior survives eviction. Room alarms now use the earliest pending join or inactive-peer deadline, capped by the existing 30-second heartbeat interval. A new connection can still bring the alarm forward. Cleanup and capacity enforcement remain durable.

## Evidence

- [Before](before.log.gz): 15 existing Workers tests passed; all three added regressions failed. A one-hour, eleven-peer fixture polling renewals every 30 seconds recorded 1,320 lease row changes.
- [After](after.log.gz): all 18 tests passed in the actual local Workers runtime. The same fixture enforces at most 660 lease row changes, with no lost lease. That is at least 50% fewer lease updates at the identical polling cadence. Production also stops polling healthy rooms at the old ten-second cadence. These fixture counts are not account-wide Cloudflare billing measurements.
- Tests cover eviction, durable lease retention, renewal near expiry, expired/missing rejection, earlier join/idle deadlines, admission and peer caps, room isolation, hibernation, departure, credentials, origins and frame/rate boundaries.
- [Build](build.log.gz): Wrangler dry run passed. Scoped ESLint passed; source diff whitespace check passed.
- The browser Verification Worker was also tried against the server files. Both [baseline](verification-worker-baseline.json) and [candidate](verification-worker.json) produce the same two process-execution errors because its broad `exec(` pattern matches the existing SQLite API. These are retained failed diagnostics, not passes. This is a Cloudflare server adapter; the component's executable acceptance is the Workers runtime suite, and there are no changed browser modules. The browser verifier was not modified or bypassed.
- [Deployment](deploy.log.gz): `reploid-swarm`, version `87941425-da17-4814-a115-63cd0a871ca6`, release `cloudflare-swarm-20261018-lease-renewal`, at https://reploid-swarm.reploid.workers.dev.
- [First live check](live-before-reset.json): the new release responds at `/health`, but WebSocket upgrade returns HTTP 503 before the reported daily quota reset. Deployment does not reset consumed quota. Post-reset lifecycle verification is pending.

## Reproduction

```sh
npm run verify:swarm-cloudflare
npm run build:swarm-cloudflare
node artifacts/swarm-write-repair-20261018/live-probe.mjs
```

The live probe opens four temporary public-discovery connections, exercises active renewal, ten-second unjoined expiry, sixty-second inactive expiry, negotiation, departure and same-identity reconnect, then closes its sockets. It requests no inference, weights or TURN credentials. It requires the service quota to be available and runs for approximately two minutes to cross the original lease lifetime.

The free plan remains finite. This repair removes unnecessary periodic writes; it does not promise unlimited simultaneous peers or protection from every source of quota consumption. No exact account-wide write attribution has been claimed.
