# Configuration Reference

All configurable settings exposed in the boot UI and their corresponding localStorage keys.

---

## Web search and page access

The host [WebAccess interface](../self/host/web-access.d.ts) separates
`search(query, limits, signal)` from `fetch(url, options)`. Search returns the
existing `SearchProvider` results; page reads return a Fetch-compatible response.
Known URLs can be read without issuing a search.

[Implementations](../self/host/web-access.js):

- `createProviderWebAccess({ provider, fetch })` composes an API or MCP search
  provider with a page reader. The default reader is ordinary browser Fetch,
  subject to the destination's cross-origin policy.
- `createBrowserWebAccess({ bridge, authorized })` uses an already attached
  browser bridge for both operations. The bridge implements the same methods;
  its host owns attachment, destination permissions, public-page isolation,
  redirects and cancellation. The adapter checks authorization and attachment
  identity before dispatch and before returning results. Failure never silently
  switches to a different implementation.

Embedding hosts can pass `webAccess: { server, access }` to
`createProductSession`. `server` must match the search server disclosed in
Settings. A different configured server disables that adapter. Search still
requires its existing enablement and per-answer permission; injection grants
nothing. This device route permits public-page reads without sign-ins on the
requester's device. Contributor-hosted browsing needs a separately disclosed
route; it cannot reuse that grant.

Both implementations use the same bounded page extraction, hashes, passages and
citation pipeline through `createDeviceSearch`. The adapter tests use injected
ports. The hosted app does not automatically attach an extension or automation
browser; an embedding host must supply that connection.

## Boot UI: Advanced Options

Expand "Advanced options" in the boot UI to access these settings.

Primary `/` Reploid keeps boot minimal:
- `Configure` attaches your own inference to this browser
- `Swarm` toggles provider or consumer launch
- Expandable `Sponsor access` details appear only when a provisioned browser-cloud window exists

Zero and X keep the broader research configuration surface.

### Zero Managed Proxy Admission

The hosted `/zero/gemini` function requires both Firebase Auth and Firebase App Check. Enable anonymous Firebase Auth, enable the Firebase App Check API, and register the hosted web app with its reCAPTCHA v3 provider using the [Firebase setup procedure](https://firebase.google.com/docs/app-check/web/recaptcha-provider).

Publish the provider's public site key in `self/config/zero-access.json` under `appCheck.siteKey`. Its `projectId` and `appId` must match the hosted `/__/firebase/init.json`. The checked-in null key deliberately blocks managed requests until provisioned. Never put a reCAPTCHA secret, service-account key, or Gemini API key in this public file. Deployment must include this file and the matching client module.

Zero reads that configuration before initializing Firebase Auth and App Check. An existing `window.REPLOID_ZERO_APP_CHECK_SITE_KEY` remains an explicit operator override. A failed initialization can retry on the next request after configuration is corrected; missing configuration never disables authentication or App Check. Local Doppler does not require these managed-proxy credentials. A populated public file does not establish that the project API, provider registration, or token exchange works; verify the deployed exchange separately.

The function accepts only `GEMINI_MODEL` by default. Set `ZERO_GEMINI_ALLOWED_MODELS` to an explicit comma-separated allowlist only when additional models are intentionally sponsored. `ZERO_GEMINI_MAX_RATE_BUCKETS` bounds retained authenticated-client rate-limit state.

### Runtime Mode

| Setting | localStorage Key | Values | Default |
|---------|------------------|--------|---------|
| Boot Mode | `REPLOID_MODE` | `reploid`, `zero`, `x` | `reploid` |
| Genesis Level | `REPLOID_GENESIS_LEVEL` | `full`, `substrate`, `cognition`, `reflection`, `spark`, `capsule`, `tabula` | `capsule` |
| Module Overrides | `REPLOID_MODULE_OVERRIDES` | JSON map of module id to `on` or `off` | `{}` |

### Safety & Approval

Settings stored in `REPLOID_HITL_CONFIG` as JSON object.

| Setting | localStorage Key | Values | Default |
|---------|------------------|--------|---------|
| Security enforcement | `REPLOID_SECURITY_MODE` | `'on'`, `'off'` | `'off'` |
| HITL approval | `approvalMode` | `autonomous`, `hitl`, `every_n` | `autonomous` |
| HITL cadence | `everyNSteps` | `1` - `100` | `5` |

### Execution Limits

| Setting | localStorage Key | Values | Default |
|---------|------------------|--------|---------|
| Max iterations | `REPLOID_MAX_ITERATIONS` | `0` (unlimited) or positive integer | `25` |
| Approval interval | `REPLOID_APPROVAL_INTERVAL` | `0` (never) or positive integer | `0` |

### Data

| Setting | localStorage Key | Values | Default |
|---------|------------------|--------|---------|
| Fresh Genesis | `REPLOID_RESET_ALL` | `'true'`, `'false'` | `'true'` |
| Preserve VFS on boot | `REPLOID_PRESERVE_ON_BOOT` | `'true'`, `'false'` | `'false'` |

### Goal

| Setting | localStorage Key | Values | Default |
|---------|------------------|--------|---------|
| Goal | `REPLOID_GOAL` | Free text | `''` |
| Include bootstrapper within self | `REPLOID_INCLUDE_BOOTSTRAPPER_WITHIN_SELF` | `'true'`, `'false'` | `'false'` |
| Use your own inference on `/` | `REPLOID_USE_OWN_INFERENCE` | `'true'`, `'false'` | `'false'` |

### Cognition

Settings stored in `REPLOID_COGNITION_CONFIG` as JSON object.

| Setting | Config Key | Values | Default |
|---------|------------|--------|---------|
| Semantic Memory | `semantic` | `true`, `false` | `true` |
| Symbolic Reasoning | `symbolic` | `true`, `false` | `true` |
| Similarity threshold | `minSimilarity` | `0.0` - `1.0` | `0.5` |
| Top-K results | `topK` | `1` - `20` | `5` |

**Read via:** `window.getCognitionConfig()`

### GEPA Evolution

Settings stored in `REPLOID_GEPA_CONFIG` as JSON object.

| Setting | Config Key | Values | Default |
|---------|------------|--------|---------|
| Population size | `populationSize` | `2` - `20` | `6` |
| Max generations | `maxGenerations` | `1` - `50` | `5` |
| Mutation rate | `mutationRate` | `0.0` - `1.0` | `0.3` |
| Crossover rate | `crossoverRate` | `0.0` - `1.0` | `0.5` |
| Elite count | `eliteCount` | `1` - `populationSize` | `2` |
| Match mode | `matchMode` | `'exact'`, `'includes'` | `'exact'` |

**Read via:** `window.getGEPAConfig()`

### Swarm / P2P

| Setting | localStorage Key | Values | Default |
|---------|------------------|--------|---------|
| Enable P2P Swarm | `REPLOID_SWARM_ENABLED` | `'true'`, `'false'` | `'true'` |
| Signaling URL override | `REPLOID_SIGNALING_URL` | WebSocket or HTTP URL | Same-origin `/signaling` |

---

## Model Configuration

Settings managed by the model selection UI.

| Setting | localStorage Key | Description |
|---------|------------------|-------------|
| Selected models | `SELECTED_MODELS` | JSON array of model configs |
| Consensus type | `CONSENSUS_TYPE` | `'arena'`, `'peer-review'` |
| API keys | `REPLOID_KEY_<PROVIDER>` | e.g., `REPLOID_KEY_GEMINI`, `REPLOID_KEY_OPENAI` |

---

## Security Settings

See [SECURITY.md](./SECURITY.md) for details.

| Setting | localStorage Key | Values | Default |
|---------|------------------|--------|---------|
| Arena gating | `REPLOID_ARENA_GATING` | `'true'`, `'false'` | `'false'` |

---

## Programmatic Access

### From Boot UI (Global)

```javascript
// Read configs
window.getCognitionConfig()   // → { semantic, symbolic, minSimilarity, topK }
window.getGEPAConfig()        // → { populationSize, maxGenerations, ... }
window.getExecutionLimits()   // → { maxIterations, approvalInterval }
window.getReploidMode()       // → 'reploid' | 'zero' | 'x'
window.getGenesisLevel()      // → 'capsule' | 'spark' | 'tabula' | 'reflection' | 'cognition' | 'substrate' | 'full'
```

### From Modules

Modules read config at factory initialization:

```javascript
// cognition-api.js, semantic-memory.js
const bootConfig = typeof window !== 'undefined' && window.getCognitionConfig
  ? window.getCognitionConfig()
  : {};

// gepa-optimizer.js
const bootConfig = typeof window !== 'undefined' && window.getGEPAConfig
  ? window.getGEPAConfig()
  : {};
```

---

## URL Parameters

Some settings can be set via URL:

| Parameter | Effect |
|-----------|--------|
| `?swarm=true` | Enable swarm mode with the default room |
| `?swarm=<room>` | Enable swarm mode and join a specific room id |
| `?signaling=<url>` | Override the WebRTC signaling endpoint for the current tab |
| `?dopplerBase=<url>` | Override the Doppler asset base URL for browser-local models |

### Standalone Local Signaling Server

Use the standalone signaling server when you want Reploid WebRTC rooms without the full proxy server.

```bash
npm run start:signaling
# or
node server/reploid-signaling.js
# or
bun server/reploid-signaling.js
```

Default behavior:

- Binds to `127.0.0.1:8787`
- Serves WebSocket signaling at `/signaling`
- Rejects non-loopback browser origins in local-only mode
- Exposes health at `http://127.0.0.1:8787/healthz`
- Exposes stats at `http://127.0.0.1:8787/api/signaling/stats`

Configure the browser client:

```javascript
localStorage.setItem('REPLOID_SIGNALING_URL', 'ws://127.0.0.1:8787/signaling');
```

Optional environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `REPLOID_SIGNALING_HOST` | `127.0.0.1` | Bind host |
| `REPLOID_SIGNALING_PORT` | `8787` | Bind port |
| `REPLOID_SIGNALING_PATH` | `/signaling` | WebSocket path |
| `REPLOID_SIGNALING_LOCAL_ONLY` | `true` | Restrict to loopback connections and origins |
| `REPLOID_SIGNALING_MAX_PEERS_PER_ROOM` | `256` | Per-room peer cap |
| `REPLOID_SIGNALING_MAX_PEERS_TOTAL` | `8192` | Global peer cap |
| `REPLOID_SIGNALING_MAX_ROOMS` | `4096` | Total room cap |

---

## Genesis Config (`config/genesis-levels.json`)

Settings used by boot seeding and module registration.

| Key | Purpose |
|-----|---------|
| `moduleFiles` | Module entry and auxiliary files used for module registration and lazy imports |
| `sharedFiles` | Always hydrated files (tools, UI, styles) |
| `levelFiles` | Level-specific file lists (tools/UI/styles per genesis level) |
| `levels` | Genesis level ladder and module grouping |

VFS hydration loads `config/vfs-manifest.json` at bootstrap and fetches all listed `self/` files into IndexedDB before boot. Set `REPLOID_PRESERVE_ON_BOOT` to `'true'` to keep existing VFS files and only fill missing paths.

---

## VFS Manifest (`config/vfs-manifest.json`)

List of all files under `self/` used for VFS hydration at bootstrap.

| Key | Purpose |
|-----|---------|
| `files` | Relative paths from `self/` to hydrate |

---

## Blueprint Registry (`config/blueprint-registry.json`)

Legacy compatibility map of runtime JavaScript files to maintained decision
blueprints. It does not turn every source file into an architecture document.

| Key | Purpose |
|-----|---------|
| `features` | Blueprint entries with file lists |

---

## Module Inventory (`config/module-inventory.json`)

Generated inventory of browser source paths, owning top-level subsystem,
import specifiers, and content hashes. `npm run build:blueprints` updates this
inventory before the legacy blueprint map. New source modules belong here unless
they introduce an architectural decision, invariant, protocol, or failure
boundary that warrants a maintained blueprint.

| Key | Purpose |
|-----|---------|
| `modules` | Source paths, owners, imports, and SHA-256 hashes |

---

## Module Registry (`config/module-registry.json`)

Derived map of runtime modules, dependencies, and genesis introduction levels.

| Key | Purpose |
|-----|---------|
| `modules` | Module metadata with dependency lists |

*Last updated: March 2026*

## Peer introductions

The browser library exposes `createPeerIntroductions`,
`bootstrapIntroductions`, and `createWebSocketIntroductionRoute` through
`reploid/transport`. `createWebRTCSwarm` and `createSwarmTransport` accept:

- `introductions`: the existing signing identity through `getIdentity`, an
  explicit `authorize` port, and optional bounded policy. Admission, connection,
  announcements and forwarding are separate authorization actions.
- `introductionBootstrap`: configured routes and an optional public-contact store.
  Retained routes run first, then remaining configured routes. Each route returns
  a signed contact plus `publish` and `close`; opening and connection have bounds.
- `signalingAdapter`: a borrowed publish/subscribe adapter for the existing swarm
  join/offer/answer/candidate messages. It must acknowledge namespace admission
  with matching `peerId`, `roomId` and a peer list. This is a different wire
  contract from assignment signaling; neither adapter silently converts it.

Without `webrtc.signalingUrl`, enabled introductions start in
`awaiting-introduction`. `transport.getIntroductions()` exposes `exportContact`,
`connect(contact, deliver)` and `receive(via, type, envelope, replyRoute)` for
out-of-band pairing or an already reachable channel. A contact alone is not a
reachable address. An invitation exchange must deliver encrypted offers,
answers and candidates in both directions. Do not put private keys or room
capabilities into contact storage.

Participant endpoints may implement the small WebSocket bootstrap exchange:
`{type:'contact', contact}` in each direction, then
`{type:'signal', envelope}`. The browser route requires a pinned participant
identity, WSS (or loopback WS), bounded messages and cancellation. The participant
owns the endpoint; no particular host or operator is required. Configure an
independent `getRtcConfig` or explicit `rtcConfig` alongside independent entry
points. The standard hosted profile still uses its configured credential issuer;
replacing introductions alone does not replace STUN/TURN provisioning.

The conversation host uses its existing identity. Public-room contacts require
valid endpoint signatures. Private-room contacts additionally prove the existing
room capability with `createRoomIntroductionAdmission`; the token is never sent
in an introduction. Neither proof authorizes inference or file disclosure.
“Help peers connect” grants one-hop forwarding separately from compute and files,
starts disabled, and can be revoked. Established direct channels survive loss of
signaling; socket-relayed routes do not. Explicit disconnect closes both.

Browser tests exercise encrypted introductions, bootstrap failover, real direct
channels and auxiliary bytes after removal of the introducer. They do not qualify
internet-wide discovery, restrictive NAT/TURN deployments, WebRTC Direct native
listeners, model numerics, or portable inference recovery. A newly opened browser
still needs an invitation, a reachable configured participant, or another live
connection. No independently operated public endpoints are installed by default.

*Last updated: October 2026*


### Contributor web search

Native contributors can explicitly add `--web-search` to `server/native-participant.js`.
This enables Bing public search and bounded extraction of that requester's returned
pages. It does not enable model execution, use browser sign-ins, or charge a priced
search service. Unmeasured costs remain unpriced. Search reliability is independent
of model readiness; provider refusal, inaccessible pages and empty results fail explicitly.

An operator-owned browser contributor can use `scripts/run-mesh-contributor.js --contribute web --web-search --url https://replo.id/ --profile <dedicated-profile>`.
The launcher attaches a native public-page bridge to that one top-level page.
Other tabs, frames and personal cookies are excluded. `--web-search` also works
alongside explicit `compute` or `files` contribution. Closing the launcher stops
its contribution. Ordinary tabs do not acquire this bridge automatically.

The requester discovers search contributors over its existing authenticated peer
connection. Each answer names its search contributor and Bing separately from
model executors. A changed contributor needs a new permission; there is no silent
provider fallback. Only the search query, result URLs and bounded passages travel
through the search worker, not attachments or unrelated conversation history.
The person's configured search server remains preferred; otherwise a discovered
search contributor is offered before the configured hosted route.
