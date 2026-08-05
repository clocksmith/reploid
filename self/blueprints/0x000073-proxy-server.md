# Blueprint 0x000073: Proxy Server

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/server/agent-bridge.js`, `/server/pool/routes.js`, `/server/proxy.js`, `/server/signaling-server.js`

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x000073-proxy-server.md`, `self/blueprints/0x000073-proxy-server.md`
**Objective:** Define the Reploid HTTP and WebSocket host that serves product surfaces, enforces access policy, proxies approved model requests, and attaches signaling and agent-coordination services without becoming the browser-inference authority.

**Target Module:** `server/proxy.js`

**Affected Artifacts:** `/server/proxy.js`, `/server/signaling-server.js`, `/server/agent-bridge.js`, `/server/pool/routes.js`

---

## 1. Intent

The proxy is the development and compatibility host for Reploid. It serves static browser assets, exposes bounded model-provider and operational routes, mounts the Poolday compatibility router, and owns the HTTP upgrade seam for signaling and the Agent Bridge. Browser-local or peer-local execution remains in the browser; the proxy must not convert a Poolday browser-execution claim into hidden server inference.

## 2. Process shape

```text
Express application
  +-- product and lab HTML routes
  +-- static self/, Poolday, Doppler, proto, and WGSL assets
  +-- provider proxy and operational APIs
  +-- /pool compatibility router
  +-- HTTP server
        +-- /signaling upgrade -> SignalingServer
        +-- /agent-bridge upgrade -> AgentBridge
```

`POOL_BACKEND_ONLY` disables the product-side signaling and Agent Bridge initialization while retaining the declared backend router surface.

## 3. HTTP route families

The exact route implementation in `server/proxy.js` is authoritative. Current families include:

| Family | Examples | Boundary |
| --- | --- | --- |
| Health and status | `/api/health`, `/api/proxy-status`, `/api/gpu/status`, `/api/gpu/logs` | Operational diagnostics. |
| Provider proxy | `/api/gemini/*`, `/api/local/*`, `/api/openai/*`, `/api/anthropic/*`, `/api/huggingface/models/:model(*)`, `/api/chat` | Access-controlled provider compatibility. |
| Local model control | `/api/ollama/models` | Local runtime discovery. |
| VFS compatibility | `/api/vfs/status`, `/api/vfs/backup`, `/api/vfs/restore` | Explicit server-side backup/restore; not the browser VFS authority. |
| Logs | `/api/console-logs` | Bounded diagnostic logging. |
| WebSocket stats | `/api/signaling/stats`, `/api/agent-bridge/stats` | Read-only operational projections. |
| Product routes | `/`, `/ask`, `/compute`, `/records`, `/history`, `/network` | Poolday/Reploid product entry. |
| Lab routes | `/zero`, `/x` | Separate Zero and X surfaces. |

The removed proxy summary shell named `/api/llm/:provider`, `/api/models`, `/api/run`, `/health`, and `/claude-bridge`. Those are not the current route contract and are not retained as aliases.

## 4. Access, rate, and failure policy

- JSON request size is bounded and tighter in backend-only mode.
- Protected server routes use the configured server-access guard.
- Anonymous inference, where admitted, passes the public-inference guard.
- Rate limiting uses a client-id, forwarded address, request address, or origin bucket; it does not rely on one global counter.
- CORS policy is explicit and origin-bound.
- Uncaught exceptions and unhandled rejections are logged so the host can report failures, but this is not a substitute for route-level error handling.
- Provider errors preserve upstream status where possible and return bounded diagnostics when payload parsing fails.

## 5. Static and browser route policy

WGSL files are served as text. Product routes return `pool-entry.html`; `/zero` and `/x` return the lab host `index.html`. Doppler and proto assets retain explicit roots. The final static fallback serves tracked `self/` content and unknown routes return 404.

## 6. WebSocket ownership

The HTTP server owns one `upgrade` handler. It dispatches matching requests to `SignalingServer` or `AgentBridge`; unknown upgrade paths are destroyed. Both services apply their own path, origin, local-only, token, heartbeat, and timeout contracts.

Signaling carries rendezvous metadata. It must not be described as the model-execution path. The Agent Bridge coordinates agents and tasks. Neither service is Poolday consensus authority.

## 7. Shutdown

Graceful shutdown stops GPU monitoring, closes signaling and Agent Bridge resources, and closes the HTTP server. New long-lived resources must join this shutdown path.

## 8. Verification checklist

- [x] Product and lab routes remain separate.
- [x] Provider proxy, VFS compatibility, diagnostics, Poolday router, static assets, and WebSocket services share one explicit host.
- [x] Signaling and Agent Bridge use one upgrade dispatcher and unknown paths fail closed.
- [x] Local-only/origin/token policy is delegated to the owning WebSocket service.
- [x] Route families reflect the current source rather than deprecated shell endpoints.
- [ ] Add a focused route inventory test that fails when public documentation drifts from source.

*Last updated: August 2026*
