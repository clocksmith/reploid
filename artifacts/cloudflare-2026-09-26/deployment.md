# Cloudflare discovery and TURN release

Date: September 26, 2026.

## Deployed identities

- Application: https://replo.id (Hosting site https://reploid.web.app).
- Worker: https://reploid-swarm.reploid.workers.dev.
- Worker version: `fcf39371-bf46-42ab-a53e-9eb2c969b04d`.
- Worker release marker: `cloudflare-swarm-20260926-2`.
- Account: `a83dfba998fd42d3dab5dc607e7c6b60`.
- TURN key ID: `17352396aa1d4598b73065ce71b3ad8e`.
- Browser bundle: `sha256:6765f4e8ab622cc688869e615b65fcb5bc0995b6189441aa486c2c099aa75a10`.
- Hosting target: `hosting:reploid`, project `reploid`. 2,689 files uploaded,
  including the descriptor; all 2,688 declared files verified byte-for-byte.
- Source: `f45d1c1632127c3961adfb45c1b0d2c2250c6100` plus the uncommitted overlay.
- Overlay: [source-overlay.tar.gz](source-overlay.tar.gz), 71 changed/new source,
  configuration, documentation and test files; evidence artifacts excluded.
- Overlay SHA-256: `4176dff7b5ecd09050e7654864da34b80530de0b3b1d6601f5a0974748b602b2`.
- Package pins: Wrangler `4.141.0`, Cloudflare Vitest plugin `1.2.8`, JOSE `6.2.12`,
  Doppler `0.6.2`. Existing Doppler package integrity declarations are unchanged.

The local `.env` remains gitignored with mode `600`. Only the TURN secret was
installed in the Worker, through stdin; its value is absent from the source overlay.
No commit, push, DNS migration, Google backend deployment, SFU integration or old
service deletion occurred. Firebase identity, Hosting, Firestore and other Poolday
APIs remain in use. Cloudflare serves discovery and TURN, not model inference.

## Acceptance

Passed:

```sh
npm run verify:swarm-cloudflare
npm run verify:swarm-bootstrap
npm run verify:runtime-config
npm run verify:layers
npm run verify:library-types
npm run verify:catscan
node scripts/validate-registry.js
npm run verify:browser-bundle:local
git diff --check
npm run deploy:swarm-cloudflare
firebase deploy --only hosting:reploid --project reploid --non-interactive
node scripts/verify-cloudflare-swarm.js --deployed
npm run verify:browser-bundle -- --url https://replo.id
npm run smoke:swarm-bootstrap -- --url https://replo.id
```

Also passed: 38 focused [unit tests](unit.json), 14 [Workers runtime tests](worker-tests.json),
14 join/lifecycle repair tests, and 3 Playwright import/Verification Worker tests.
The registry audit reports zero unresolved issues; generator reruns are idempotent.

The [deployed browser record](deployed-turn.json) uses three isolated contexts on
one physical machine, the ordinary conversation application, and no source or
bootstrap interception. Only instrumentation and forced-relay configuration are
injected. Automatic public discovery opens WebRTC data channels with relay/relay
candidates and transferred bytes. Credential issuance is HTTP 200, no-store,
600-second TTL. Private participation stays isolated. Disconnect persists across
reload, explicit reconnect succeeds, and simulated network loss recovers.
Contribution stays off and no model weights download without permission.

The separate default-mode smoke loads the complete pinned Doppler module graph
and 296 shaders, confirms missing runtime modules return 404, and repeats normal
automatic discovery, private isolation and persistent opt-out.

The [handoff](README.md) retains initial failures and their disposition. In
particular, an early relay timeout remains an unlocalized observation; subsequent
two staged and one deployed full journeys passed. These results do not claim
universal network reliability, physical multi-device execution, generation, LoRA,
or layer splitting. No inference runs were added by this migration.

## Rollback and boundary

Restore the prior bootstrap signaling URL and remove `rtcConfigUrl`, regenerate
the bundle, and redeploy Hosting as described in
[the migration document](../../docs/cloudflare-migration.md). Keep the previous
[release overlay](../chat-files-2026-09-25/README.md). Worker rollback does not undo
Durable Object data. Old Google services were not removed.

Component: discovery/TURN hosting and browser transport configuration.
Intent: preserved.
Acceptance evidence: commands and linked artifacts above.
Boundary effects: hosted rendezvous, temporary relay credentials, transport retry
timing and release tooling. UI, conversation ownership and resource grants unchanged.

*Last updated: September 2026*
