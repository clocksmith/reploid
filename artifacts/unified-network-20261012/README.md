# Shared hosted/localhost network — 2026-10-12

Component: Reploid discovery and browser authentication composition. Intent: deliberately changed so public localhost pages join the same network as hosted browser and native nodes. Boundary effects: public origin admission, endpoint selection and authenticated TURN bootstrap; no model operation or disclosure permission change.

## Implementation

- Cloudflare and Node discovery share one origin validator. Exact hosted origins remain allowed; HTTP(S) localhost, 127.0.0.1 and [::1] are allowed on any port. URLs with credentials/paths, lookalike domains, opaque origins and arbitrary LAN hosts are rejected.
- Public local pages select the configured production rendezvous, not an implicit local signaling server. Explicit private test rooms/endpoints remain separate.
- Public local pages acquire authenticated RTC credentials through the same existing service. Explicit host RTC configuration and private loopback test networks remain independent.
- Firebase web auth metadata in `self/config/firebase-public.json` is the public `https://replo.id/__/firebase/init.json` configuration (only apiKey, authDomain, projectId and appId). It is browser configuration, not a service credential. Hosted pages retain Hosting initialization; local pages can initialize the same project without a Hosting-only endpoint. Explicit injected configuration still takes precedence. Authentication, room admission and recipient-bound disclosure remain enforced.

No contributor restart is needed. A local checkout must include this client correction and its page must reload. An older localhost client still choosing its own server does not change merely because the public service was updated.

## Live evidence

Discovery Worker deployed from `383c3a53` as `cloudflare-swarm-20261012-loopback`, version `b086a567-bee7-47cb-950c-c54c7df41661`. [Deployment identity](deployment.json). The Worker change is live; this task does not deploy the conversation UI or change Doppler.

[Live browser record](live-discovery.json): fresh Chromium pages at `https://replo.id`, `http://localhost:50237` and `http://127.0.0.1:50238` automatically join the public rendezvous. All three discover the same ready participants:

- Browser contributor on x@128: `3c58e9a2-fe7e-4b3f-8cd1-4f97cba1907c`, partition 2; existing launcher PID 34457 verified still running.
- Native contributor on x@128: `0762c10f-8537-4476-ab7c-230922ebb6a9`, partition 1; existing Node participant PID 55889 verified still running.

Each page makes zero `.bin`, `.safetensors` or `.gguf` weight requests. This establishes shared prepared-node discovery and real peer connections, not a newly executed generation, numerical qualification, successful Suby preparation or universal NAT reachability. Suby's existing unavailable participants remain visible; this change does not fix their acquisition failures.

The [probe](check-live.mjs) serves the running local application through two real ephemeral HTTP ports. Run it from the checkout with the existing application server on port 8000. It never enables contribution or submits inference. The public and localhost page assets intentionally differ; public UI deployment is separate.

Retained failures establish the corrections: [implicit local routing](local-routing-failure.json), [post-deployment upgrade failure](rollout-upgrade-failure.json), [relay authentication failure](rtc-auth-failure.json). The initial additional 403 during rollout is retained without assigning an unverified cause. Later live joins and peer readiness pass.

## Checks

- 8 Node origin/integration tests, 15 Cloudflare runtime tests, 16 join/transport repair checks, and 8 authentication/identity/RTC unit checks pass (47 distinct checks; the earlier four RTC checks are included in the eight).
- Private namespace isolation, capabilities, rate/size bounds, TURN authentication and exact-origin rejection remain covered. No wildcard CORS or authorization bypass.
- Actual Verification Worker passes the new validator, entry adapter, Node adapter, browser selection, credential selection and Firebase bootstrap. The full Durable Object file still triggers the Worker's existing SQL `exec`/child-process false positive; the unchanged baseline has the identical finding. [Full](verification-full.json), [baseline](verification-baseline.json), [focused](verification-focused.json). No validator rule was weakened. Real Cloudflare runtime tests and deployment build pass.
- Component charters and generated browser manifest check pass.

Suggested vocabulary (not a bulk API rename): **node** is a running participant; **browser node** and **native node** identify its host; **requester**, **executor**, and **file supplier** identify roles. One physical computer may run multiple nodes. Browser/native composition shares the library's network/model contracts, with environment-specific adapters.
