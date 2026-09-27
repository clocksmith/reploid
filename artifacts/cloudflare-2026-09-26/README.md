# Cloudflare migration handoff

## Current state

- Worker deployed: `https://reploid-swarm.reploid.workers.dev`.
- Version: `fcf39371-bf46-42ab-a53e-9eb2c969b04d`.
- Account: `a83dfba998fd42d3dab5dc607e7c6b60`.
- Health: HTTP 200, `discoveryOnly: true`, release `cloudflare-swarm-20260926-2`.
- Production Hosting and bootstrap now select Cloudflare discovery and TURN.
  Firebase auth, Firestore, other Poolday APIs and Cloud Run stay unchanged.
  Old TURN and discovery endpoints remain available for operator rollback.
- The user created TURN key `17352396aa1d4598b73065ce71b3ad8e`. Its secret was
  transferred from the ignored owner-only `.env` to the Worker's `TURN_KEY_SECRET`
  through Wrangler stdin. It is not in source, browser files or release artifacts.
  The separately supplied Realtime SFU credentials remain unused locally.
- Two full staged forced-relay runs and the [deployed forced-relay journey](deployed-turn.json)
  passed. The latter uses the served application with no source/policy overrides.
  All 2,688 declared Hosting files match the exact release hash. The pinned-runtime
  smoke loaded Doppler 0.6.2 and all 296 shaders and passed normal startup,
  private isolation and disconnect/reload opt-out.

## Evidence

- `npm run verify:swarm-cloudflare`: 14 tests passed in the actual local Workers
  runtime. Includes public/private isolation, hibernation, bounded admission,
  expiry, origin/frame/rate rejection, Firebase JWT checks and TURN-response checks.
- `npm run verify:swarm-bootstrap`: 14 tests passed, including a new regression
  that honors credential retry deadlines while preserving manual cancellation.
- [Unit results](unit.json): 38 tests passed across SDK, RTC configuration,
  transport lifecycle, swarm lifecycle and thread isolation.
- `playwright test tests/e2e/release-boundaries.spec.js --project=chromium`:
  3 tests passed, including Verification Worker checks for modified browser code.
- `npm run build:swarm-cloudflare`: dry run passed. Final Worker upload: 56.45 KiB
  uncompressed, 15.67 KiB gzip, 2 ms reported startup.
- [Staged browser discovery](staged-discovery.json): three isolated contexts of
  the existing production application on one machine. Bootstrap and two migration
  modules were intercepted in those contexts only. Automatic public discovery,
  private isolation, data-channel traffic, contribution off, no implicit model
  download, persistent disconnect/reload, deliberate reconnect, and simulated
  network-interruption recovery passed.
- That staged test explicitly retained the old Poolday TURN issuer and selected
  host/host ICE candidates. It **does not qualify Cloudflare TURN**. No inference,
  model-weight transfer, LoRA, physical-device or layer-split test ran here.
- [First forced-relay pass](staged-turn-first-pass.json) and
  [repeat forced-relay pass](staged-turn.json) used Cloudflare credential issuance
  and relay/relay candidate pairs. Credentials were HTTP 200, no-store, with a
  600-second TTL. Both runs passed automatic startup, private isolation,
  disconnect/reload, deliberate reconnect and network-interruption recovery.
- [Initial credential failure](staged-turn-credential-failure.json) exposed the
  unsupported `redirect: error` option in the deployed Workers runtime. The
  adapter now uses `manual` and rejects redirect responses without forwarding
  secrets. Failure responses expose bounded retry delays; transport honors them.
- [Stats observation failure](staged-turn-stats-timing.json) and
  [relay timeout](staged-turn-relay-timeout.json) are retained. Statistics now wait
  for a selected/nominated pair with bytes; the early relay timeout's cause was
  not established. Two subsequent complete staged runs passed, not an unlimited
  network-reliability claim.
- [First post-deploy attempt](deployed-turn-navigation-timeout.json) established
  relay/relay traffic but timed out navigating the private page during the parallel
  full-bundle audit. The verifier now waits for DOM readiness followed by explicit
  application/transport assertions, not every page resource's load event.
- The first full-bundle audit reported three network `fetch failed` errors, not
  hash mismatches or identified missing modules. The verifier now includes file
  paths in errors, a 30-second fetch deadline and at most two transient retries.
  Authentication/404 failures and byte mismatches still fail. The rerun verified
  all 2,688 files byte-for-byte at `https://replo.id`.
- An ancillary read-only Cloud Run inspection did not return after four minutes
  and was cancelled. No Google backend mutation was issued. The prior revision
  below is the last recorded baseline, not a newly verified current-traffic claim.
- The first staged attempt stopped at an early private-join assertion: the UI
  offers Disconnect while connecting. The verifier now waits for the actual
  `joined` frame; the rerun passed. No UI change was needed.
- Registry validation: zero unresolved issues; the two stale hashes were rebuilt
  from source. Second generator pass produced identical five registry hashes.
  Genesis generator emitted the existing browser-only `document is not defined`
  skip for `experimental/openclaw-audit/index.js`; generated Genesis did not change.
- CATSCAN: 38 charters passed. Runtime config, layers, local bundle and
  `git diff --check` passed.

## Source and rollback

Base checkout: `f45d1c1632127c3961adfb45c1b0d2c2250c6100`, plus the pre-existing chat
changes and this migration. No commit or push occurred. Preserve the pre-existing
[chat release source overlay](../chat-files-2026-09-25/README.md), not just main.
The final migration overlay is [source-overlay.tar.gz](source-overlay.tar.gz);
its digest and deployment commands are in [deployment.md](deployment.md).

New Worker owner: `server/cloudflare/`. Deployment: `deploy/cloudflare/`.
Browser deltas: namespace query in `swarm-join-policy.js`, RTC-only issuer in
`pool/sdk.js`, explicit retry-deadline handling in the canonical swarm transport,
and Cloudflare bootstrap URLs. UI, model execution and grants are untouched.

Deployed browser bundle: `sha256:6765f4e8ab622cc688869e615b65fcb5bc0995b6189441aa486c2c099aa75a10`.
Last prior Hosting bundle:
`sha256:c46b08204868c3747c176c8a9843aaa1757bb8e067bd4d231141c14e5ebeef36`.
Prior Cloud Run rollback revision: `reploid-pool-00106-4wf`.

## Verification and future releases

1. Read `GOALS.md`, applicable CATSCANs and `docs/cloudflare-migration.md`.
2. List TURN keys through Cloudflare MCP. Record the key ID only; inspect Worker
   secret metadata for `TURN_KEY_SECRET`, never its value.
3. Preserve the key ID in Wrangler config, assign an identified release marker, deploy
   with the existing Worker secret preserved. Do not write a key into browser code.
4. Run `node scripts/verify-cloudflare-swarm.js` (without `--discovery-only`). It
   requires Cloudflare credentials and forced-relay data channels with bytes.
5. Once that passes, change bootstrap `signalingUrl` and `rtcConfigUrl` to the
   verified Cloudflare endpoints, regenerate registries/bundle, run boundary checks,
   then deploy Firebase Hosting. Do not delete old Google services.
6. Run `node scripts/verify-cloudflare-swarm.js --deployed` and the existing full
   `smoke:swarm-bootstrap` against `https://replo.id`. Record Worker version, exact
   Hosting bundle, configuration, credential identity and candidate-pair evidence.
7. Preserve failures separately and keep rollback explicit; a configuration edit
   or successful upload alone does not establish the migrated product works.

## Component handoff

- Component: Cloudflare discovery/TURN adapter and browser transport configuration.
- Intent: preserved; hosted implementation deliberately adds Cloudflare ownership
  under the existing server charter. Permissions and inference remain unchanged.
- Acceptance evidence: commands above and staged discovery JSON.
- Boundary effects: hosted rendezvous, credential issuance, transport retry timing,
  browser configuration and release tooling only.

The Cloudflare/Durable Objects/Workers/Wrangler skills informed the hibernating
namespace design, secret boundary and staged deployment. Registry-audit regenerated
the canonical inventory; Reploid debugging separated an in-progress UI state from
the required transport acknowledgement, localized the unsupported fetch redirect
option and verified retry timing. Three contexts on one physical machine remain
the evidence boundary; this migration adds no model-generation qualification.

*Last updated: September 2026*
