# Cloudflare discovery and TURN migration

**Migration record (September 2026).** This records how signaling rendezvous and TURN
credential issuance moved to Cloudflare. The current owner is
[`server/cloudflare/CATSCAN.md`](../server/cloudflare/CATSCAN.md); the live browser
configuration is [`shared/config/swarm-bootstrap.json`](../shared/config/swarm-bootstrap.json).

## Boundary

The migration gave Cloudflare signaling rendezvous and temporary TURN credential issuance,
not inference. Firebase Hosting, identity, Firestore and the other Poolday APIs kept their
owners. The conversation interface and resource grants did not change.

Each public/private namespace was routed to its own SQLite-backed `SwarmRoom` Durable
Object. Hibernating WebSocket attachments retain membership and limits; a private
capability hash persists after clients leave. `SwarmAdmission` coordinates only
bounded admission leases and credential quotas, not messages or conversations.
Discovery rejects application relay payloads. TURN relays encrypted WebRTC packets;
it does not execute models or replace recipient disclosure grants. Origin admission
is not identity.

TURN issuance verifies Firebase signatures, issuer, audience and expiration, then
requests 600-second credentials with a server-only Cloudflare key. Rate limits and
bounded response parsing precede delivery. The browser receives temporary ICE
credentials, never the signing key. Credential failure remains explicit.

## Deployment inputs

- Account: `a83dfba998fd42d3dab5dc607e7c6b60`.
- Worker: `reploid-swarm`; config: `deploy/cloudflare/wrangler.jsonc`.
- Discovery: `wss://reploid-swarm.reploid.workers.dev/swarm`.
- Credential URL: `https://reploid-swarm.reploid.workers.dev/rtc-config`.
- Secret: `TURN_KEY_SECRET`, stored only as a Worker secret. `TURN_KEY_ID` is public
  configuration. Do not commit credentials or paste their values into chat.
- Worker health is public and returns its release marker; all discovery/credential
  requests enforce the bootstrap policy's exact origins.

The browser cutover changed only `signalingUrl` and `rtcConfigUrl` in
`shared/config/swarm-bootstrap.json`, followed by inventory/bundle regeneration and
Hosting deployment. Explicit private invitation endpoints remained explicit. A
room ID in the WebSocket URL selects the object, not its admission capability.

## Commands and qualification

```sh
npm run verify:swarm-cloudflare
npm run verify:swarm-bootstrap
npm run build:swarm-cloudflare
npm run deploy:swarm-cloudflare
node scripts/verify-cloudflare-swarm.js
node scripts/verify-cloudflare-swarm.js --deployed
```

The staged browser check substituted the SDK, join policy, generated transport and
bootstrap JSON inside isolated contexts of the existing `https://replo.id` application. It
did not change production Hosting and never manually started discovery. Default mode
requires Cloudflare TURN and relay candidate pairs with transferred bytes.
`--discovery-only` explicitly retains the previous Poolday credential issuer. It
qualifies discovery integration only, not Cloudflare TURN.

The tests covered automatic discovery, private isolation, contribution remaining off,
no implicit weight download, persistent disconnect, deliberate reconnect and a
simulated network interruption. Three contexts shared one physical machine. They
do not establish different-network connectivity, inference, LoRA or layer splitting.
The runtime suite separately checks hibernation, admission, rejection and limits.

## Rollback

The previous source overlay and bundle record were retained as
`artifacts/chat-files-2026-09-25/`, now listed in the
[evidence catalog](evidence-catalog/README.md) and restorable with
`node scripts/restore-evidence.js artifacts/chat-files-2026-09-25`. Remote `main` does not
reconstruct it. Cloud Run and the old TURN service were to stay intact until an operator
authorized their retirement.

An explicit rollback restores the previous bootstrap signaling URL
(`wss://<cloud-run-service>.run.app/swarm`) and removes
`rtcConfigUrl`, then regenerates the browser bundle and redeploys Hosting. The SDK then uses
the authenticated `/pool/rtc-config` route. Do not add runtime fallback between issuers.
Worker code rollback does not undo Durable Object data or migration bindings.

## Release evidence

See [the migration handoff](https://github.com/clocksmith/reploid/blob/e543183bed54dfdf2b6e6139dd4c31c8686f47bd/artifacts/cloudflare-2026-09-26/README.md) for the
deployed Worker, completed browser qualification, retained failures and rollback.
Configuration alone is not a deployment or end-to-end capability claim.

*Last updated: November 2026*
