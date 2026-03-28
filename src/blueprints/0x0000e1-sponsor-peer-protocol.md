# Blueprint 0x0000E1: Quorum-Controlled Community Key

**Objective:** Enable a pure P2P free tier for Reploid inference using a Shamir-split community Gemini key, quorum-gated execution, and a signed append-only receipt log -- with no privileged peer class.

**Target Upgrade:** QKEY (`community-key.js`, `peer-identity.js`, `gemini-relay.js`)

**Prerequisites:** 0x00003E (WebRTC Swarm Transport), SwarmTransport MESSAGE_TYPES, LLMClient ProviderRegistry

**Affected Artifacts:** `capabilities/communication/community-key.js` (new), `capabilities/identity/peer-identity.js` (new), `capabilities/communication/gemini-relay.js` (new), `capabilities/communication/swarm-transport.js` (message types), `core/llm-client.js` (new provider)

---

### 1. The Strategic Imperative

Reploid is browser-native, zero-install. A required proxy server or a privileged sponsor class contradicts that thesis.

The community key model preserves the flat swarm. No peer is special. Roles rotate per-request. The shared Gemini API key is split via Shamir's Secret Sharing so no peer holds the full key at rest. Execution requires quorum approval from witnesses who verify policy before releasing their shares.

**Key premise:** One peer will always see the full key in memory during execution. The goal is not impossible secrecy. The goal is **bounded, audited, policy-gated use** of a shared free-tier key.

---

### 2. Architecture

```
         Flat Swarm (WebRTC / BroadcastChannel)
         ========================================

  REQUESTER              EXECUTOR              WITNESS x t
  (wants inference)      (makes Gemini call)   (holds key shares)
       |                      |                      |
       |--- lease-request --->|                      |
       |                      |--- share-request --->|
       |                      |                      |-- verify policy
       |                      |                      |-- check receipt log
       |                      |<-- share-release ----|
       |                      |                      |
       |                      |== reconstruct key ==|
       |                      |--- HTTPS -----------> Gemini API
       |                      |<-- response ---------|
       |                      |== zeroize key ======|
       |                      |                      |
       |<-- inference-done ---|                      |
       |                      |--- usage-receipt --->| (append to log)
       |                      |                      |
```

**No privileged class.** Any peer can temporarily play any role per request:

| Role | Duration | Capability Required |
|------|----------|---------------------|
| **Requester** | Per-request | None (any peer) |
| **Executor** | Per-request | `gemini_executor` |
| **Witness** | Per-request | `key_custody` |

Capabilities are declared, not inherited. A single tab can hold all three.

---

### 3. Peer Identity

Each Reploid instance generates a persistent ECDSA P-256 keypair on first boot.

```javascript
// capabilities/identity/peer-identity.js

const IDENTITY_DB = 'reploid-identity';
const IDENTITY_STORE = 'keypair';

async function getOrCreateIdentity() {
  // Check IndexedDB first
  const stored = await loadFromIndexedDB();
  if (stored) return stored;

  // Generate new keypair
  const keypair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,  // not extractable -- private key never leaves CryptoKey
    ['sign', 'verify']
  );

  // Derive peer ID = SHA-256 of raw public key
  const pubRaw = await crypto.subtle.exportKey('raw', keypair.publicKey);
  const hash = await crypto.subtle.digest('SHA-256', pubRaw);
  const peerId = hex(new Uint8Array(hash));

  // Persist to IndexedDB
  await saveToIndexedDB({ keypair, peerId, pubRaw });
  return { keypair, peerId, pubRaw };
}

async function sign(data, privateKey) {
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    encoded
  );
  return base64(new Uint8Array(sig));
}

async function verify(data, signature, publicKey) {
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const sigBytes = unbase64(signature);
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    sigBytes,
    encoded
  );
}
```

- Keypair persists in IndexedDB (`reploid-identity` store)
- Public key shared during `peer-announce`
- Private key is `extractable: false` -- never serialized
- Peer ID = hex SHA-256 of raw public key bytes

---

### 4. Key Buckets and Scaling

Capacity does not scale by adding more custodians to one key. It scales by adding **key buckets** -- independent custody committees, each managing one shared Gemini API key.

```
  Key Bucket A (3-of-5)           Key Bucket B (2-of-3)
  ========================        ========================
  Custodians: P1, P2, P3, P4, P5  Custodians: P6, P7, P8
  Key: GEMINI_KEY_A               Key: GEMINI_KEY_B
  Quota: 20k output/day           Quota: 20k output/day
```

**Scaling rules:**
- Keep each custody committee small: `3-10` peers
- Never split one key across the whole swarm
- Route requesters to the least-loaded bucket (or nearest bucket by transport latency)
- Each bucket has independent quota counters, receipt logs, and failure domains
- A compromised bucket does not affect other buckets

**Bucket discovery:**
- Buckets advertise via `qkey:advertise` with a `bucketId` field
- Requesters discover available buckets through swarm transport
- Bucket selection: prefer buckets with quota remaining, then prefer lower latency

**Bucket registry:**
```javascript
// Each peer tracks known buckets
const _knownBuckets = new Map();
// bucketId -> { keyId, custodians: Set<peerId>, executors: Set<peerId>, quotaRemaining, lastSeen }
```

For MVP (3-5 trusted tabs), one bucket is sufficient. The bucket abstraction exists from day one so scaling is additive.

---

### 5. Key Custody (Shamir Split)

Each key bucket holds one Gemini API key, split into `n` shares with threshold `t` using Shamir's Secret Sharing over GF(256).

```javascript
// Key deal ceremony (run once per bucket, or on key rotation)
const shares = shamirSplit(geminiApiKey, { n: 5, t: 3 });

// Each custodian in this bucket stores one share, wrapped with a device-local key
for (const [i, peer] of custodians.entries()) {
  const wrapped = await wrapShareWithDeviceKey(shares[i], peer.deviceKey);
  await sendToPeer(peer.id, 'key:share-store', { bucketId, shareIndex: i, wrapped });
}
```

**At rest:**
- Each share is AES-GCM encrypted with a device-local key (WebCrypto `wrapKey` or passkey-derived)
- No peer has the full key
- Share index is public; share value is encrypted

**Per-request reconstruction:**
- Executor collects `t` shares from witnesses in the same bucket
- Reconstructs key in memory
- Makes Gemini call
- Zeroizes: overwrite the ArrayBuffer, null all references
- **JS GC caveat acknowledged**: V8 may retain copies. The API key string used in the HTTP URL is immutable. This is accepted -- the real defense is the cloud-side quota, not in-browser secrecy.

**Key rotation:**
- Re-split periodically (daily or on peer churn) per bucket
- Old shares become invalid after re-deal
- Prevents accumulation of shares across leases

---

### 5. Protocol Messages

Added to SwarmTransport `MESSAGE_TYPES`:

```javascript
// Community key protocol
'qkey:advertise',          // peer announces bucket membership + capabilities
'qkey:lease-request',      // requester -> executor (includes bucketId)
'qkey:lease-grant',        // executor -> requester (batch: N requests / M minutes)
'qkey:lease-deny',         // executor -> requester
'qkey:share-request',      // executor -> witnesses (same bucket only)
'qkey:share-release',      // witness -> executor (encrypted share for this session)
'qkey:share-deny',         // witness -> executor
'qkey:inference-request',  // requester -> executor (within active lease)
'qkey:inference-chunk',    // executor -> requester (16KB streaming frames)
'qkey:inference-done',     // executor -> requester
'qkey:inference-error',    // executor -> requester
'qkey:receipt',            // executor -> bucket peers (append-only log entry)
'qkey:receipt-sync',       // peer -> peer (receipt log catch-up, per bucket)
```

All messages carry a `bucketId` field. Witnesses only respond to share requests for their own bucket.

---

### 6. Lease Protocol

Leases grant a **batch** of requests to amortize quorum cost. One quorum ceremony per lease, not per call.

**Step 1: Requester requests lease from an executor**

```javascript
{
  type: 'qkey:lease-request',
  payload: {
    bucketId: '<target bucket>',
    requesterPubKey: '<base64>',
    model: 'gemini-3.1-flash-lite-preview',
    requestedBatch: 10,         // requests in this lease
    maxOutputTokens: 2048,
    nonce: '<random>',
    receiptHead: '<hash of latest known receipt>',
    signature: '<requester signs nonce + bucketId + model + receiptHead>'
  }
}
```

**Step 2: Executor requests shares from witnesses**

```javascript
{
  type: 'qkey:share-request',
  payload: {
    bucketId: '<target bucket>',
    leaseId: '<uuid>',
    requesterPubKey: '<base64>',
    executorPubKey: '<base64>',
    model: 'gemini-3.1-flash-lite-preview',
    batchSize: 10,
    maxOutputTokens: 2048,
    receiptHead: '<hash>',
    signature: '<executor signs>'
  }
}
```

**Step 3: Witnesses verify policy, release shares**

Each witness independently checks:
1. Model is allowed (Flash Lite only)
2. Token caps within limits
3. Requester quota not exhausted (check receipt log)
4. `receiptHead` matches local receipt log head (or close enough)
5. Batch size within policy limits

If all checks pass:

```javascript
{
  type: 'qkey:share-release',
  payload: {
    leaseId: '<uuid>',
    shareIndex: 2,
    encryptedShare: '<AES-GCM encrypted with session key>',
    sessionKey: '<ECDH ephemeral, encrypted to executor pubkey>',
    signature: '<witness signs leaseId + shareIndex>'
  }
}
```

**Step 4: Executor grants lease to requester**

```javascript
{
  type: 'qkey:lease-grant',
  payload: {
    leaseId: '<uuid>',
    requesterId: '<peer fingerprint>',
    model: 'gemini-3.1-flash-lite-preview',
    maxRequests: 10,
    maxOutputTokens: 2048,
    expiresAt: '<now + 5 minutes>',
    executorId: '<executor fingerprint>',
    signature: '<executor signs>'
  }
}
```

**Step 5: Deny** (quota exhausted, receipt log divergence, policy violation)

```javascript
{
  type: 'qkey:lease-deny',
  payload: {
    reason: 'quota_exhausted' | 'receipt_divergence' | 'policy_violation',
    retryAfter: 60000
  }
}
```

---

### 7. Inference Flow

Once a lease is granted, the requester sends requests **without** another quorum ceremony:

```javascript
// requester -> executor
{
  type: 'qkey:inference-request',
  payload: {
    leaseId: '<uuid>',
    requestId: '<uuid>',
    seqInLease: 3,          // 3rd request in this batch lease
    messages: [
      { role: 'system', content: '...' },
      { role: 'user', content: '...' }
    ],
    maxOutputTokens: 1024,
    signature: '<requester signs requestId + leaseId + seqInLease>'
  }
}
```

Executor:
1. Verify lease not expired, seq within batch limit
2. Verify requester signature
3. Reconstruct key from cached shares (already have them from lease grant)
4. Call Gemini via `generativelanguage.googleapis.com`
5. Stream response back as 16KB chunks
6. Emit signed receipt after completion

```javascript
// executor -> requester (streaming)
{
  type: 'qkey:inference-chunk',
  payload: {
    requestId: '<uuid>',
    streamId: '<uuid>',
    seq: 0,
    content: '<partial response, max 16KB>',
    done: false
  }
}

// final
{
  type: 'qkey:inference-done',
  payload: {
    requestId: '<uuid>',
    streamId: '<uuid>',
    totalChunks: 4,
    usage: { inputTokens: 320, outputTokens: 890 }
  }
}
```

**Key zeroization after lease expires or batch exhausted:**
- Overwrite share ArrayBuffers with zeros
- Null all references to reconstructed key
- Executor does not retain key between leases
- JS GC caveat: documented, accepted. Cloud-side quota is the real cap.

---

### 8. Receipt Log (G-Counter CRDT)

Quota enforcement uses a **signed append-only receipt log** -- not a central authority.

Each receipt:

```javascript
{
  bucketId: '<bucket>',
  requesterId: '<peer fingerprint>',
  executorId: '<executor fingerprint>',
  model: 'gemini-3.1-flash-lite-preview',
  inputTokens: 320,
  outputTokens: 890,
  timestamp: 1711580400000,
  leaseId: '<uuid>',
  requestId: '<uuid>',
  prevHash: '<hash of previous receipt>',
  hash: '<SHA-256 of this receipt>',
  signature: '<executor signs>'
}
```

**CRDT structure:** G-Counter per peer ID, per bucket.

```javascript
// Each peer maintains counters scoped to buckets it participates in:
const quotaCounters = new Map();
// bucketId -> Map<peerId, { requests, inputTokens, outputTokens, windowStart }>

// Merge = max per peer per window within the same bucket
function mergeCounters(bucketId, local, remote) {
  const localBucket = local.get(bucketId) || new Map();
  const remoteBucket = remote.get(bucketId) || new Map();
  for (const [peerId, remoteCounts] of remoteBucket) {
    const localCounts = localBucket.get(peerId);
    if (!localCounts || remoteCounts.requests > localCounts.requests) {
      localBucket.set(peerId, remoteCounts);
    }
  }
  local.set(bucketId, localBucket);
}
```

**Consistency rule:** If a witness's receipt log head for a bucket diverges from the executor's by more than N entries, the witness **refuses to release shares** until they resync via `qkey:receipt-sync`. This prevents split-brain quota bypass. Divergence in bucket A does not block bucket B.

---

### 9. Scoped Egress: GeminiRelay Capability

One new egress permission, not a general network hole:

| Property | Value |
|----------|-------|
| Capability name | `GeminiRelay` |
| Allowed endpoint | `generativelanguage.googleapis.com` only |
| Allowed protocol | HTTPS only |
| Trigger | Valid quorum-signed lease only |
| Model restriction | `gemini-3.1-flash-lite-preview` only |
| Referrer | `replo.id/*` (API-side restriction) |

The Gemini API key itself is also cloud-side restricted:
- Referrer-locked to `replo.id/*`
- Generative Language API only
- Low cloud quota ceiling
- Model-locked to Flash Lite

So even if an executor reconstructs and caches the key, damage is bounded by the cloud quota.

---

### 10. Sponsored Mode Constraints

| Constraint | Value | Reason |
|------------|-------|--------|
| Model | `gemini-3.1-flash-lite-preview` only | Cheapest tier |
| Max output tokens | 2048 per request | Bound cost |
| Max input tokens | 8192 per request | Prevent long-context abuse |
| Batch lease size | 10 requests / 5 minutes | Amortize quorum, limit exposure |
| Daily token budget | 20k output tokens per peer | Sustainable for demo |
| Concurrent streams | 1 per peer | No parallel abuse |
| Arena / heavy RSI | Disabled | Not for substrate experiments |
| Quorum | t-of-n (e.g. 2-of-3, 3-of-5) per bucket | Scale with bucket count |
| Committee size | 3-10 custodians per bucket | Keep quorum fast, failure domain small |
| Scaling | Add key buckets, not more custodians | Independent failure domains |

---

### 11. BYOK Upgrade Path

Community key mode is intentionally constrained. BYOK removes all limits:

| | Community Key | BYOK |
|---|---|---|
| Model | Flash Lite only | Any (Pro, Ultra, GPT-4, Claude) |
| Output tokens | 2048 | Model max |
| Context | 8192 | Model max |
| Rate | Queued, quorum delay | Direct, instant |
| Arena | Disabled | Enabled |
| RSI levels | L0 only | L0-L4 |
| Daily quota | 20k output tokens | Unlimited |

**Upgrade nudges:**

| Usage | Action |
|-------|--------|
| 50% daily quota | Show usage meter |
| 80% | "Add your own key for full speed" |
| 100% | Hard stop. Offer: BYOK, local Doppler, or wait for daily reset |

---

### 12. Minimal Boot Experience

The non-research "community" boot path strips the wizard to essentials:

```
+------------------------------------------+
|                                          |
|   What should your Reploid work on?      |
|                                          |
|   [goal presets / text area]             |
|                                          |
|   [ Go ]                                 |
|                                          |
|   Or: use your own API key               |
|                                          |
+------------------------------------------+
```

**What's hidden:**
- Connection type selection (auto: community swarm)
- API key entry (not needed)
- Model selection (fixed: Flash Lite)
- Genesis level (fixed: sensible default)
- Module overrides (hidden)
- Security settings (hidden)
- HITL config (hidden)

**What's shown:**
- Goal input (text area or preset pick)
- Go button
- "Use your own API key" link (reveals BYOK direct config)
- Usage meter (once running, shows community quota)

The boot state machine auto-configures:
```javascript
setState({
  connectionType: 'community',
  mode: 'zero',
  communityConfig: {
    model: 'gemini-3.1-flash-lite-preview',
    maxOutputTokens: 2048
  }
});
```

No detection probes needed. No proxy check. No WebGPU check. Straight to goal.

---

### 13. LLMClient Integration

New `community` provider registered in ProviderRegistry:

```javascript
const createCommunityProvider = (swarmTransport, peerIdentity, communityKey) => ({
  chat: async (messages, modelConfig, requestId) => {
    const executor = findPeerWithCapability('gemini_executor');
    if (!executor) throw new Errors.ConfigError('No executor peers available');

    const lease = activeLease || await requestLease(executor, modelConfig);
    return executeWithinLease(lease, messages, modelConfig, requestId);
  },
  stream: async (messages, modelConfig, onUpdate, requestId) => {
    const executor = findPeerWithCapability('gemini_executor');
    if (!executor) throw new Errors.ConfigError('No executor peers available');

    const lease = activeLease || await requestLease(executor, modelConfig);
    return executeWithinLease(lease, messages, modelConfig, requestId, onUpdate);
  },
  status: () => ({
    available: getPeersWithCapability('gemini_executor').length > 0,
    mode: 'community',
    executors: getPeersWithCapability('gemini_executor').length,
    witnesses: getPeersWithCapability('key_custody').length,
    quota: getQuotaFromReceiptLog()
  })
});
```

Provider resolution order:
1. `doppler` -- local WebGPU (free, fast, private)
2. `browser-cloud` -- BYOK direct (user's own key)
3. `community` -- P2P free tier (quorum-gated)
4. `proxy` -- server-backed (legacy)

---

### 14. MVP Scope

Do not start with a public mesh. Start with your own devices.

| Parameter | MVP Value |
|-----------|-----------|
| Key buckets | 1 (single bucket) |
| Peers per bucket | 3-5 trusted tabs/devices |
| Quorum | 2-of-3 or 3-of-5 |
| Executor | 1 per request |
| Witnesses | t per request (2 or 3) |
| Transport | BroadcastChannel (same browser) first |
| Key deal | Manual via `?deal=true` URL param |
| Receipt log | In-memory G-Counter per bucket, no persistence |
| Model | gemini-3.1-flash-lite-preview |
| Streaming | 16KB chunks over data channel |
| Boot route | `/community` |

**MVP does not include:**
- Multiple key buckets (single bucket only -- add buckets to scale)
- Automatic key rotation (manual re-deal)
- Cross-device WebRTC (BroadcastChannel only)
- Receipt log persistence (resets on tab close)
- Public peer discovery
- Sybil resistance beyond per-key quotas

---

### 15. Implementation Pathway

**Step 1: Peer Identity** (`capabilities/identity/peer-identity.js`)
- ECDSA P-256 keypair gen + IndexedDB persistence
- Sign / verify helpers
- Peer ID derivation

**Step 2: Shamir Module** (`capabilities/crypto/shamir.js`)
- GF(256) split / reconstruct
- Pure JS, no dependencies (well-understood math, ~200 lines)
- Unit tests against known test vectors

**Step 3: SwarmTransport Message Types**
- Add `qkey:*` message types to `MESSAGE_TYPES` set
- No other transport changes

**Step 4: Community Key Manager** (`capabilities/communication/community-key.js`)
- Share storage (encrypted in IndexedDB)
- Share release protocol (verify policy, check receipts, release)
- Key reconstruction + zeroization
- Receipt log (G-Counter CRDT, merge, hash chain)
- Lease management

**Step 5: Gemini Relay** (`capabilities/communication/gemini-relay.js`)
- Scoped fetch to `generativelanguage.googleapis.com` only
- Accepts reconstructed key, model, messages
- Streams response, emits chunks
- Returns usage metadata

**Step 6: Community Provider** (registered in LLMClient)
- Wraps lease negotiation + relay into ProviderRegistry interface
- Handles chunk reassembly on requester side
- Exposes quota status for UI

**Step 7: Minimal Boot Path**
- New `community` connectionType in boot state
- Auto-configure on `/` route when no saved BYOK config exists
- Goal + Go UI (see section 12)
- Usage meter widget post-boot

---

### 16. Verification Checklist

- [ ] Peer identity persists across page reloads
- [ ] Shamir split/reconstruct round-trips correctly for t-of-n
- [ ] Shares are AES-GCM wrapped at rest in IndexedDB
- [ ] Witness refuses share release when receipt log diverges
- [ ] Witness refuses share release when requester quota exhausted
- [ ] Executor reconstructs key, calls Gemini, zeroizes
- [ ] 16KB chunks stay under 64KB transport limit (with envelope overhead)
- [ ] Receipt log merges correctly (G-Counter: max per peer)
- [ ] Lease batches amortize quorum (no per-call ceremony)
- [ ] BYOK prompt at 80%, hard stop at 100%
- [ ] Minimal boot shows goal + go only
- [ ] `?deal=true` triggers key deal ceremony for MVP setup

---

### 17. Security Considerations

**What this is:** Bounded, audited, policy-gated use of a shared demo key.

**What this is not:** A secure key vault or production secret manager.

| Threat | Mitigation | Residual Risk |
|--------|------------|---------------|
| Executor caches key | Key rotation (re-deal), lease expiry | JS GC may retain copies -- accepted |
| Sybil peers | Per-key quotas, receipt log | New IDs get fresh small quotas |
| Receipt log fork | Witnesses refuse shares on divergence | Brief availability loss during resync |
| Colluding executor + witnesses | Cloud-side quota caps total damage | Bounded by API restrictions |
| Share accumulation | Re-deal on rotation, session-scoped ECDH | MVP trusts own tabs |

**Cloud-side defense (the real cap):**
- API key referrer-locked to `replo.id/*`
- Generative Language API only
- Low cloud quota ceiling
- Model-locked to Flash Lite

Even total protocol compromise is bounded by the cloud quota.

---

*Blueprint 0x0000E1 -- Quorum-Controlled Community Key for P2P Free Tier Inference*
