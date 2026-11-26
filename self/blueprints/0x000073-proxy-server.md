# Blueprint 0x000073: Proxy Server

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/server/agent-bridge.js`, `/server/pool/routes.js`, `/server/proxy.js`, `/server/proxy-app.js`, `/server/proxy-static.js`, `/server/proxy-providers.js`, `/server/proxy-storage.js`, `/server/signaling-server.js`

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x000073-proxy-server.md`, `self/blueprints/0x000089-proxy-server.md`
**Objective:** Define the Reploid HTTP and WebSocket host that serves product surfaces, enforces access policy, proxies approved model requests, and attaches signaling and agent-coordination services without becoming the browser-inference authority.

**Target Module:** `server/proxy.js` (entry) and `server/proxy-app.js` (`createProxy`)

**Affected Artifacts:** `/server/proxy.js`, `/server/proxy-app.js`, `/server/proxy-static.js`, `/server/proxy-providers.js`, `/server/proxy-storage.js`, `/server/signaling-server.js`, `/server/agent-bridge.js`, `/server/pool/routes.js`

---

## 1. Intent

The proxy is the development and compatibility host for Reploid. It serves static browser assets, exposes bounded model-provider and operational routes, mounts the Poolday compatibility router, and owns the HTTP upgrade seam for signaling and the Agent Bridge. Browser-local or peer-local execution remains in the browser; the proxy must not convert a Poolday browser-execution claim into hidden server inference.

## 2. Process shape

`server/proxy.js` is a 40-line process entry: it loads `.env`, calls `createProxy()`, listens, starts runtime services and installs SIGTERM/SIGINT shutdown. Importing it never listens. The application is built in `server/proxy-app.js` (`createProxy`, `:49`), which mounts route modules:

| Module | Mounted by | Owns |
| --- | --- | --- |
| `server/proxy-app.js` | itself | Config, JSON body limits, CORS, rate limiting, access guards, health/status/GPU/Ollama/stats routes, `/pool`, `/change-control`, earning, text API, fleet, search, the HTTP server, the upgrade dispatcher and shutdown |
| `server/proxy-providers.js` | `proxy-app.js:455` | Provider proxy routes and `/zero/gemini` |
| `server/proxy-storage.js` | `proxy-app.js:557` | `/api/vfs/*` backup and restore |
| `server/proxy-static.js` | `proxy-app.js:587` | Product, Change Passport and substrate HTML routes, Doppler/proto/kernel roots, the browser-tree fallback and the 404 handler |

```text
Express application
  +-- product and lab HTML routes
  +-- static self/, Poolday, Doppler, proto, and WGSL assets
  +-- provider proxy and operational APIs
  +-- /pool compatibility router
  +-- HTTP server
        +-- public swarm discovery upgrade -> PublicSwarmServer
        +-- /signaling upgrade -> SignalingServer
        +-- /agent-bridge upgrade -> AgentBridge
```

`POOL_BACKEND_ONLY` disables the product-side signaling and Agent Bridge initialization and skips runtime-service startup, while retaining the declared backend router surface (`proxy-app.js:593,671`).

## 3. HTTP route families

The route modules above are authoritative; this table is a summary. Current families include:

| Family | Examples | Boundary |
| --- | --- | --- |
| Health and status | `/api/health`, `/api/proxy-status`, `/api/gpu/status`, `/api/gpu/logs` (`proxy-app.js:431-525`) | Operational diagnostics. |
| Provider proxy | `/api/gemini/*`, `/api/local/*`, `/api/openai/*`, `/api/anthropic/*`, `/api/huggingface/models/:model(*)` behind `requireServerAccess`; `/api/chat` behind `admitAnonymousInference` (`proxy-providers.js:6-333`) | Access-controlled provider compatibility. |
| Local model control | `/api/ollama/models` | Local runtime discovery. |
| VFS compatibility | `/api/vfs/status`, `/api/vfs/backup`, `/api/vfs/restore` (`proxy-storage.js:28-55`) | Explicit server-side backup/restore; not the browser VFS authority. |
| WebSocket stats | `/api/signaling/stats`, `/api/agent-bridge/stats` (`proxy-app.js:564,577`) | Read-only operational projections. |
| Product routes | `/`, `/work`, `/network`, `/improve`, `/examples`, `/experiments`, `/ask`, `/compute`, `/records`, `/room-1`, `/history` (`proxy-static.js:22`) | Poolday/Reploid product entry. |
| Change Passport | `/passports` (`proxy-static.js:23`) | Change Passport entry. |
| Lab routes | `/zero`, `/x` (`proxy-static.js:24`) | Separate Zero and X surfaces. |

The removed proxy summary shell named `/api/llm/:provider`, `/api/models`, `/api/run`, `/health`, and `/claude-bridge`. Those are not the current route contract and are not retained as aliases.

## 4. Access, rate, and failure policy

- JSON request size is bounded and tighter in backend-only mode.
- Protected server routes use the configured server-access guard.
- Anonymous inference, where admitted, passes the public-inference guard.
- Rate limiting uses a client-id, forwarded address, request address, or origin bucket; it does not rely on one global counter.
- CORS policy is explicit and origin-bound.
- Provider errors preserve upstream status where possible and return bounded diagnostics when payload parsing fails.

## 5. Static and browser route policy

WGSL files are served as text. Product routes return the served `pool-entry.html` (source `apps/poolday/pool-entry.html`); `/passports` returns `change-passport-entry.html`; `/zero` and `/x` return the served `index.html` from the composed browser tree (`proxy-static.js:35-48`). Files resolve through `browserFile`, which uses `resolveServedFile` over the overlay of `self/`, `shared/` and `apps/poolday/` (`proxy-app.js:112`, `server/browser-tree.js`). Doppler, proto and kernel assets retain explicit roots. The final static fallback serves the browser tree, and unknown routes return 404 (`proxy-static.js:79-110`).

## 6. WebSocket ownership

The HTTP server owns one `upgrade` handler (`proxy-app.js:644-659`). It dispatches matching requests to `PublicSwarmServer`, `SignalingServer` or `AgentBridge`; unknown upgrade paths are destroyed. Both services apply their own path, origin, local-only, token, heartbeat, and timeout contracts.

Signaling carries rendezvous metadata. It must not be described as the model-execution path. The Agent Bridge coordinates agents and tasks. Neither service is Poolday consensus authority.

## 7. Shutdown

`close()` (`proxy-app.js:663-669`) closes runtime services (including GPU monitoring), the text API, the self-serve fleet, the external brain, the public swarm server, signaling and the Agent Bridge, then the HTTP server. If any close fails it throws an `AggregateError` and can be retried. New long-lived resources must join this shutdown path.

## 8. Verification requirements

- [x] Product and lab routes remain separate.
- [x] Provider proxy, VFS compatibility, diagnostics, Poolday router, static assets, and WebSocket services share one explicit host.
- [x] Public swarm, signaling and Agent Bridge use one upgrade dispatcher and unknown paths fail closed.
- [x] Local-only/origin/token policy is delegated to the owning WebSocket service.
- [x] Route families reflect the current source rather than deprecated shell endpoints.
- Add a focused route inventory test that fails when public documentation drifts from source.

*Last updated: August 2026*
