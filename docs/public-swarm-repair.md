# Public discovery and pinned runtime repair

Reploid starts public WebRTC discovery after application startup. Its conversation
workspace remains unchanged. Discovery membership grants no authority to disclose
conversation inputs, contribute compute, distribute files, or adopt improvements.
Each permission remains separately controlled. Disconnect stops pending joins and
reconnects, persists opt-out, and is distinct from Stop sharing.

## Owners

- `self/config/swarm-bootstrap.json` owns public rendezvous policy and limits.
- `swarm-join-policy.js` selects public discovery unless a current private
  invitation supplies its room-scoped capability. Saved private rooms do not
  redirect ordinary startup. Public invitations contain no private capability.
- `swarm-autoconnect.js` owns application retry timers; the existing transport owns
  socket reconnects. Importing either module does not start discovery.
- Hosted peer negotiation obtains short-lived authorized ICE configuration from
  the existing authenticated Poolday RTC endpoint through a host port. The library
  does not mint or persist TURN credentials. Loopback development and explicit
  host configuration remain independent. Credential failure uses bounded retry.
- `PublicSwarmServer` admits exact origins and bounded public/private negotiation
  on `/swarm`. It rejects application relay payloads and cross-namespace targets.
  Origin admission is not authentication. Existing job and resource grants apply.
- Doppler defines execution. `resolveDopplerBrowserAssets` consistently selects
  developer overrides or the pinned same-origin package; obsolete saved defaults
  cannot displace it. Node-generated configuration stays origin-relative.

## Reproducible delivery

`node scripts/vendor-doppler.js [archive]` verifies the archive's SHA-512 against
`package-lock.json`, checks its package identity and paths, and extracts the entire
`doppler-gpu@0.6.2` package under `self/vendor/doppler/0.6.2/`. The original archive
is also retained under `deploy/artifacts/` for integrity-checked offline npm cache
seeding during the backend build. No dependency declarations are changed.

Run `sync:runtime-config`, `sync:library`, registry generators, and
`build:browser-bundle` from their canonical owners. Deploy the backend and complete
Hosting tree from the same release snapshot. Use the direct configured Cloud Run
WSS endpoint, not an assumed WebSocket server on static Hosting. The in-memory
directory requires one signaling process, maximum one instance and unsplit traffic;
it does not establish an unlimited overlay. Shared rendezvous is required to scale.

## Acceptance and limitations

`npm run verify:swarm-bootstrap` exercises selection, admission acknowledgement,
retry and disconnect races. Integration tests cover exact origins, private/public
isolation, message/connection limits and unjoined expiry. Host lifecycle tests
exercise pending initialization and manual opt-out.

`npm run smoke:swarm-bootstrap -- --url https://replo.id` imports the complete
browser module graph and tooling, requests every shipped WGSL shader, checks a
missing module returns 404, then exercises **normal startup** in three isolated
browser contexts. It verifies public WebRTC peers, private isolation, contribution
off, and disconnect persistence through reload; it never manually starts discovery.

These contexts share one physical machine. Final cross-device acceptance still
requires two physical devices opening the public workspace without room parameters,
establishing WebRTC and checking disconnect and separate contribution consent.
Asset delivery and discovery evidence does not qualify model generation, LoRA
application or distributed layer execution. Server-side asset verifiers must use an
explicit public application origin to resolve origin-relative configuration.

Follow-up [physical-device evidence](../artifacts/physical-swarm-2026-09-23.md)
records a TURN-relayed connection with local patched modules, persistent opt-out,
private isolation, and a **failed** real chat attempt during cold model loading.
It does not qualify the patched modules as deployed or chat as working.
