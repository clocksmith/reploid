# DOPPLER P2P Architecture

Peer-to-peer model distribution and remote inference for browser-based LLMs.

Status: Proposal. Not implemented.

## Overview

| Component | Description |
|-----------|-------------|
| **Discovery** | WebTorrent tracker signaling for NAT traversal |
| **Transport** | WebRTC data channels (control + bulk) |
| **Replication** | Content-addressed RDRR shard distribution |
| **Inference** | Optional remote inference offload |

---

## MVP Scope

### Goals

- Make model distribution faster and cheaper for small swarms (10 to 50 peers) by sharing RDRR shards peer-to-peer.
- Improve cold start: multi-source shard fetch plus local caching (OPFS) after verification.
- Keep a single "truth" for integrity: shard hashes in the manifest plus optional manifest signatures.

### Non-goals (for MVP)

- Distributed transformer inference across peers (tensor parallel, pipeline parallel). This is a research track and is not required for useful P2P.
- Trust-by-default. P2P transport must treat peers as untrusted and verify all content.

### What P2P Enables vs Does Not Enable

- P2P can distribute and cache a 500B+ MoE model's shards across a swarm. This reduces origin bandwidth and can make download and updates practical.
- P2P alone does not make 500B+ inference fast. Compute and per-token cross-device communication are usually the bottleneck for distributed inference.
- A realistic near-term "frontier-ish" path is expert paging and local offload (Native Bridge), plus optional remote inference offload for specific tasks where latency is acceptable.

### MVP: Swarm Shard Cache

At runtime, DOPPLER treats peers as additional shard sources. The loader asks for shards by content hash. Peers respond with chunked shard bytes. The receiver verifies the shard hash before storing in OPFS and using it for inference.

Required MVP pieces:

1. **Peer discovery**: connect to a tracker or self-hosted signaling.
2. **Shard availability index**: peers advertise which shard hashes they can serve.
3. **Shard transfer**: request, stream, ack, retry. Use a reliable channel for correctness.
4. **Integrity**: verify shard hashes from the manifest before accepting data.
5. **Local caching**: store verified shards in OPFS so future loads are local.

Optional MVP upgrades:

- **Live shard tuning**: dynamically adjust concurrency, chunk size, and peer scoring based on observed throughput and failures.
- **Delta distribution**: distribute LoRA adapters or small "delta shards" instead of full weights when iterating on models.

---

## P1 Extension: P2P Expert Paging (Swarm as Storage)

Primary goal: unlock larger MoE models by treating the swarm as network-attached storage for experts, not network-attached compute.

### Summary

MoE models only activate a small subset of experts per token. Expert paging exploits this sparsity:

- Keep the core model and commonly-hit experts local.
- Fetch rare experts on demand from peers.
- Overlap expert fetch with compute so decode stays local and low-latency.

This keeps the "per token" compute local, avoids cross-peer activation exchange, and focuses networking on bulk weight transfer, where WebRTC is a better fit.

### Why This Is Browser-First

Browsers have constraints that make weight distribution harder than compute:

- OPFS quotas vary across browsers and configurations.
- Large downloads are slow if every peer must fetch from the origin.
- Local file access is limited unless Native Bridge is available.

A P2P swarm can act as a distributed cache that supplies missing expert shards quickly when a small group shares the same model.

### Design Overview

**Key idea**: the loader requests experts by content hash. Peers provide shards. The receiver verifies hashes before use and caches to OPFS.

```
Decode step (local)
  1. Router selects top-k experts for layer L.
  2. For each selected expert:
     - If local: run expert FFN.
     - If missing: request expert shards from swarm.
  3. Overlap: while expert shards download, run other work (other layers, next-token prep).
  4. After verification: cache in OPFS, then execute expert FFN locally.
```

### Required Changes (High-Level)

| Area | Change |
|------|--------|
| Manifest | Add expert shard registry keyed by content hash. Include per-expert mapping (layer, expert index) to shard hashes. |
| Loader | Add `loadExpert(layerIdx, expertIdx)` that resolves to local OPFS, Native Bridge, HTTP, or P2P. |
| Scheduler | Add prefetch and prioritization. Prioritize experts on the critical path for the next decode steps. |
| Storage | Cache verified expert shards in OPFS with LRU eviction. Optionally keep a small "hot expert" set pinned. |
| P2P | Add peer "have" announcements and chunked shard transfer by hash. |

### Overlap Strategy

Expert paging only helps if DOPPLER overlaps I/O with compute.

Practical overlap points:
- Prefetch experts for layer L+1 while running attention for layer L.
- Prefetch experts for the next token based on recent routing history.
- Maintain a rolling window of "likely experts" and prefetch in the background.

### Live Shard Tuning (P1)

Once shard paging works, tune it live:

- Peer scoring: prefer peers with recent low RTT and high throughput.
- Adaptive chunk size: increase on stable links, decrease on lossy links.
- Concurrency control: increase parallel downloads until GPU becomes the bottleneck.
- Prewarm set: persist a pinned expert set per model and device.

### Trust and Abuse Model

Peers are untrusted.

Minimum safety requirements:
- Verify every shard against a manifest-provided hash.
- Reject invalid shards and down-rank peers that serve corrupt data.
- Rate-limit requests per peer to avoid becoming an amplification target.
- Support private swarms via invite links or shared secrets for signaling, if needed.

Optional integrity upgrades:
- Signed manifests (publisher signature).
- Per-shard Merkle trees for partial verification (useful for very large expert shards).

### Success Metrics

| Metric | Target |
|--------|--------|
| Cold start bytes from origin | Reduce by 50%+ in a 10 to 50 peer swarm |
| Time to first token (TTFT) | No regression vs non-paged baseline for small prompts |
| Expert miss penalty | Bounded, with observable improvements after warmup due to OPFS caching |
| Cache hit rate | 90%+ on typical interactive sessions after warmup (model-dependent) |

### Related Work (Inspiration)

This design borrows two ideas:

- Expert offload: overlap expert fetch with compute. Server systems use NVMe and CPU memory for this. DOPPLER replaces the storage medium with a swarm.
- Consumer pooling: devices collaborating to make large artifacts usable. Some systems pool memory or split compute. DOPPLER prefers "swarm as storage" to avoid per-token cross-device latency.

## 1. Discovery & Signaling

### WebTorrent Tracker (Primary)

Uses BitTorrent tracker protocol over WebSocket for peer discovery.

Notes:
- Trackers are signaling infrastructure. They do not relay shard bytes, but they are still servers.
- If you want zero third-party dependencies, run your own tracker or use an out-of-band exchange (copy/paste offer and answer, QR code, etc).
- Use multiple trackers for resilience and to reduce reliance on a single operator.

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────┐
│   Peer A    │────▶│  wss://tracker  │◀────│   Peer B    │
│  (seeder)   │     │   (openwebtorrent.com)│  (leecher)  │
└─────────────┘     └─────────────────┘     └─────────────┘
       │                                           │
       └───────────── WebRTC offer/answer ─────────┘
```

**Info Hash**: Derived from a stable, content-addressed identifier (prefer a manifest hash so the swarm changes when weights change)
```javascript
// Many WebTorrent implementations use a 40-char hex string (20 bytes).
// Avoid using a human-readable model name here.
const infoHash = sha1(manifest.modelId);
```

**Announce Message**:
```json
{
  "action": "announce",
  "info_hash": "<40 hex chars (20 bytes)>",
  "peer_id": "<40 hex chars (20 bytes)>",
  "numwant": 10,
  "offers": [{ "offer_id": "...", "offer": { "type": "offer", "sdp": "..." }}]
}
```

### Volunteer WebSocket Fallback

For private deployments without public trackers:
```javascript
const ws = new WebSocket('wss://your-server.com/doppler-signal');
ws.send(JSON.stringify({ type: 'join', modelId: manifest.modelId }));
```

### Peer Discovery Flow

```
1. ANNOUNCE
   ├─ Connect to tracker WebSocket
   ├─ Generate 5-10 WebRTC offers
   └─ Send announce with offers

2. RECEIVE PEERS
   ├─ Tracker returns peer list with answers
   └─ For each answer: setRemoteDescription()

3. ICE NEGOTIATION
   ├─ Exchange ICE candidates via tracker relay
   └─ Connection established when ICE completes

4. MESH MAINTENANCE
   ├─ Re-announce every 30s
   └─ Prune dead connections
```

---

## 2. ICE & TURN Configuration

### ICE Configuration

```javascript
const iceConfig = {
  iceServers: [
    // STUN (third-party, for NAT traversal)
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },

    // TURN (relay, requires credentials)
    {
      urls: 'turn:turn.example.com:3478',
      username: 'user',
      credential: 'pass'
    }
  ],
  iceTransportPolicy: 'all',  // Set to 'relay' for mandatory TURN
  iceCandidatePoolSize: 10
};
```

### TURN Credentials

TURN is a relay. It needs authentication to avoid becoming an open relay.

- `username` and `credential` are the TURN auth inputs the browser presents to the TURN server.
- Credentials can be static (long-term) or short-lived (TURN REST style) generated from a shared secret.
- If you run your own TURN, prefer short-lived credentials plus rate limits to reduce abuse risk.
- STUN and TURN are both infrastructure. If you want no third-party dependencies, self-host them too.

### TURN Usage Modes (Fallback vs Mandatory)

The default strategy is "direct first, relay if needed". Making TURN mandatory trades cost and performance for reachability.
Mandatory TURN still needs signaling (SDP offer and answer plus ICE candidates). TURN is not a signaling channel.

| Mode | How to configure | Pros | Cons | Use when |
|------|------------------|------|------|----------|
| Direct-first (recommended) | `iceTransportPolicy: 'all'` with STUN and TURN in `iceServers` | Best throughput and latency in most networks. Lowest relay bandwidth cost. Preserves P2P scaling for shard replication. | Some networks fail to connect without relay (enterprise NAT, UDP blocked). More complex reconnect logic. | Public P2P distribution. Home networks. Most users. |
| Mandatory TURN (relay-only) | `iceTransportPolicy: 'relay'` or only TURN servers | Highest connection success in restrictive networks. Hides peer IPs from each other (peers see the relay). More predictable networking. | Requires always-on relay infrastructure. The relay operator pays the bandwidth bill. Higher latency and often lower throughput. Central bottleneck and potential single point of failure. | Enterprise networks. Privacy mode. "Always works" fallback. |

### TURN Cost Control

TURN relay is expensive. Implement application-level tracking:

```javascript
class TurnMonitor {
  constructor(maxBytesPerPeer = 500 * 1024 * 1024) {
    this.maxBytes = maxBytesPerPeer;
    this.bytesPerPeer = new Map();
  }

  async checkConnection(pc) {
    const stats = await pc.getStats();
    let relayBytes = 0;

    for (const report of stats.values()) {
      if (report.type === 'candidate-pair' && report.state === 'succeeded') {
        if (report.remoteCandidateType === 'relay') {
          relayBytes = report.bytesReceived + report.bytesSent;
        }
      }
    }

    return relayBytes < this.maxBytes;
  }
}
```

#### What "Expensive" Means

TURN bandwidth is paid by the TURN operator. If you use a third-party TURN, you depend on their quotas and policies. If you run your own TURN, you pay with your upstream bandwidth and uptime.

For shard replication, TURN can double transfer cost for the relay because the relay receives and sends every byte.

### Connection Strategy

```
1. Try direct connection first (host candidates)
2. Try STUN-derived candidates (srflx)
3. Fall back to TURN only if direct fails
4. Track relay usage, disconnect if over budget
```

---

## 3. WebRTC Transport

### Dual Data Channel Pattern

```javascript
// Control channel: ordered, reliable
const control = pc.createDataChannel('control', {
  ordered: true,
  maxRetransmits: undefined  // reliable
});

// Bulk channel: unordered, for shard data
const bulk = pc.createDataChannel('bulk', {
  ordered: false,
  maxRetransmits: 3  // semi-reliable
});
```

Notes:
- Shard bytes require correctness. If you use an unreliable bulk channel, you need chunk acknowledgements and re-requests. Hash verification will catch corruption, but it is better to avoid it.
- For simplicity, consider a reliable bulk channel for shard transfer and reserve semi-reliable transport for non-critical streams.

### Message Protocol

**Control Channel Messages**:
```typescript
type ControlMessage =
  | { type: 'have', shardIndices: number[] }
  | { type: 'want', shardIndex: number }
  | { type: 'cancel', shardIndex: number }
  | { type: 'bitfield', bits: Uint8Array }
  | { type: 'inference_request', requestId: string, prompt: string }
  | { type: 'inference_response', requestId: string, tokens: number[] }
  | { type: 'ping' }
  | { type: 'pong' };
```

**Bulk Channel Messages**:
```typescript
type BulkMessage = {
  type: 'shard_chunk',
  shardIndex: number,
  offset: number,
  data: ArrayBuffer  // 128KB chunks
};
```

### Flow Control

```javascript
const MAX_BUFFERED = 16 * 1024 * 1024;  // 16MB buffer limit

function sendChunk(channel, data) {
  if (channel.bufferedAmount > MAX_BUFFERED) {
    // Wait for buffer to drain
    return new Promise(resolve => {
      channel.onbufferedamountlow = () => {
        channel.send(data);
        resolve();
      };
    });
  }
  channel.send(data);
  return Promise.resolve();
}
```

---

## 4. RDRR Shard Replication

### Integration with DOPPLER Loader

DOPPLER provides `setCustomShardLoader()` for P2P integration:

```javascript
import { setCustomShardLoader, downloadModel } from 'doppler';

// P2P shard loader
setCustomShardLoader(async (shardIndex) => {
  // Try P2P first
  const shard = await p2pSwarm.requestShard(shardIndex);
  if (shard) return shard;

  // Fall back to HTTP
  return await httpFetchShard(shardIndex);
}, { verify: true });  // Enable hash verification

await downloadModel(manifestUrl);
```

### Shard Request Protocol

```
┌─────────┐                    ┌─────────┐
│ Leecher │                    │ Seeder  │
└────┬────┘                    └────┬────┘
     │                              │
     │─── { type: 'want', shard: 5 } ──▶│
     │                              │
     │◀── { type: 'shard_chunk',   │
     │      shard: 5, offset: 0,   │
     │      data: <128KB> }        │
     │                              │
     │◀── { type: 'shard_chunk',   │
     │      shard: 5, offset: 128K,│
     │      data: <128KB> }        │
     │          ...                │
     │                              │
     │── [verify hash] ────────────│
     │                              │
     │─── { type: 'have', [5] } ───▶│
```

### Hash Verification

Uses existing `computeHash()` from shard-manager.ts:

```javascript
import { computeHash } from 'doppler/storage/shard-manager';

async function verifyShardFromPeer(data, expectedHash, algorithm = 'blake3') {
  const actualHash = await computeHash(data, algorithm);
  if (actualHash !== expectedHash) {
    throw new Error(`Shard hash mismatch: ${actualHash} !== ${expectedHash}`);
  }
  return true;
}
```

### Parallel Download Strategy

```javascript
class ShardDownloader {
  constructor(manifest, swarm, maxParallel = 4) {
    this.manifest = manifest;
    this.swarm = swarm;
    this.maxParallel = maxParallel;
    this.pending = new Set();
  }

  async downloadAll(onProgress) {
    const queue = [...this.manifest.shards.keys()];

    while (queue.length > 0 || this.pending.size > 0) {
      // Fill parallel slots
      while (this.pending.size < this.maxParallel && queue.length > 0) {
        const idx = queue.shift();
        this.pending.add(this.downloadShard(idx));
      }

      // Wait for one to complete
      const completed = await Promise.race(this.pending);
      this.pending.delete(completed);
      onProgress(completed);
    }
  }

  async downloadShard(index) {
    // Try peers with this shard
    const peers = this.swarm.getPeersWithShard(index);

    for (const peer of peers) {
      try {
        return await peer.requestShard(index);
      } catch (e) {
        continue;  // Try next peer
      }
    }

    // No peers have it, fall back to HTTP
    return await this.httpFallback(index);
  }
}
```

---

## 5. Remote Inference (Optional)

### Use Case

Offload prefill to peers with better GPUs:
- Mobile device connects to desktop peer
- Desktop runs prefill, sends KV cache state
- Mobile continues decode locally

Notes:
- Remote inference sends prompts (and potentially intermediate state) to another machine. Treat it as opt-in and assume peers can read everything they process.

### Protocol

```typescript
// Request prefill from peer
interface InferenceRequest {
  type: 'inference_request';
  requestId: string;
  modelId: string;
  prompt: string;
  maxTokens?: number;
  options?: {
    temperature: number;
    topP: number;
    topK: number;
  };
}

// Stream tokens back
interface InferenceResponse {
  type: 'inference_token';
  requestId: string;
  token: number;
  finished: boolean;
}
```

### Timeout & Fallback

```javascript
async function remoteInference(peer, prompt, timeout = 10000) {
  const requestId = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Remote inference timeout'));
    }, timeout);

    peer.onMessage = (msg) => {
      if (msg.requestId === requestId && msg.type === 'inference_token') {
        if (msg.finished) {
          clearTimeout(timer);
          resolve(msg.tokens);
        }
      }
    };

    peer.send({ type: 'inference_request', requestId, prompt });
  });
}

// Usage with fallback
async function generate(prompt) {
  const fastPeer = swarm.getFastestPeer();

  if (fastPeer) {
    try {
      return await remoteInference(fastPeer, prompt);
    } catch (e) {
      console.warn('Remote inference failed, falling back to local');
    }
  }

  return await localPipeline.generate(prompt);
}
```

### Latency Considerations

| Phase | Local | Remote (LAN) | Remote (Internet) |
|-------|-------|--------------|-------------------|
| Prefill | ~500ms | ~600ms | ~800ms |
| Per-token | ~30ms | ~50ms | ~150ms |

Remote inference is best for:
- Prefill offload (one round-trip)
- Batch requests (amortize latency)

NOT recommended for:
- Interactive decode (latency per token)

---

## 6. MoE Expert Sharding

### Lazy Expert Loading

For Mixture-of-Experts models, load only activated experts:

```javascript
import { getShardsForExpert } from 'doppler/storage/rdrr-format';

class MoEP2PLoader {
  constructor(manifest, swarm) {
    this.manifest = manifest;
    this.swarm = swarm;
    this.loadedExperts = new Set();
  }

  async ensureExpert(expertIndex) {
    if (this.loadedExperts.has(expertIndex)) return;

    // Get shards containing this expert's weights
    const shardIndices = getShardsForExpert(this.manifest, expertIndex);

    // Download in parallel from peers
    await Promise.all(
      shardIndices.map(idx => this.swarm.ensureShard(idx))
    );

    this.loadedExperts.add(expertIndex);
  }

  async routerCallback(hiddenStates) {
    // Router returns top-k expert indices
    const expertIndices = await runRouter(hiddenStates);

    // Ensure experts are loaded before compute
    await Promise.all(
      expertIndices.map(idx => this.ensureExpert(idx))
    );

    return expertIndices;
  }
}
```

### Expert Distribution Strategy

For 8-expert MoE model:
```
Peer A: experts 0,1,2,3 (shards 0-15)
Peer B: experts 4,5,6,7 (shards 16-31)
Peer C: experts 0,2,4,6 (even experts)
Peer D: all experts (full seeder)
```

---

## 7. Implementation Roadmap

### Phase 1: Shard Replication (MVP)

**Files to create**:
- `p2p/swarm.ts` - Peer swarm management
- `p2p/tracker-client.ts` - WebTorrent tracker signaling
- `p2p/peer-connection.ts` - WebRTC wrapper
- `p2p/shard-protocol.ts` - Shard request/transfer

**Integration points**:
- Hook into `setCustomShardLoader()` in doppler-loader.ts
- Use `computeHash()` from shard-manager.ts for verification

**Deliverables**:
- Download shards from peers
- Fall back to HTTP when no peers available
- Progress UI showing P2P vs HTTP sources

### Phase 2: Seeding & Mesh

**Additions**:
- Announce available shards after download
- Respond to shard requests from peers
- Mesh gossip for peer discovery redundancy

**Deliverables**:
- Upload shards to requesting peers
- Peer count displayed in UI
- Bandwidth usage stats

### Phase 3: Remote Inference (Future)

**Additions**:
- Inference request/response protocol
- Peer capability discovery (GPU info, loaded models)
- Prefill offload implementation

**Deliverables**:
- "Use fast peer" toggle in UI
- Latency comparison display

---

## API Reference

### P2PSwarm

```javascript
class P2PSwarm {
  constructor(manifest, options = {}) {}

  // Lifecycle
  async join(): Promise<void>
  async leave(): Promise<void>

  // Shards
  async requestShard(index: number): Promise<Uint8Array>
  announceShards(indices: number[]): void

  // Peers
  getPeers(): Peer[]
  getPeersWithShard(index: number): Peer[]

  // Events
  on('peer', (peer: Peer) => void)
  on('shard', (index: number, source: 'p2p' | 'http') => void)
  on('progress', (downloaded: number, total: number) => void)
}
```

### TrackerClient

```javascript
class TrackerClient {
  constructor(trackerUrl: string, infoHash: string) {}

  async announce(offers: RTCSessionDescription[]): Promise<Peer[]>
  async close(): void

  on('peer', (peer: Peer, offer: RTCSessionDescription) => void)
}
```

---

## Related Files

| File | Purpose |
|------|---------|
| `loader/doppler-loader.ts` | `setCustomShardLoader()` extension point |
| `storage/shard-manager.ts` | `computeHash()` for verification |
| `storage/rdrr-format.ts` | `getShardsForExpert()` for MoE |
| `storage/downloader.ts` | HTTP fallback implementation |

---

*Last updated: December 2025*
