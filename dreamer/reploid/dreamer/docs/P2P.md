# Dreamer P2P Architecture

Peer-to-peer model distribution and remote inference for browser-based LLMs.

## Overview

| Component | Description |
|-----------|-------------|
| **Discovery** | WebTorrent tracker signaling for NAT traversal |
| **Transport** | WebRTC data channels (control + bulk) |
| **Replication** | Content-addressed RDRR shard distribution |
| **Inference** | Optional remote inference offload |

---

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
const ws = new WebSocket('wss://your-server.com/dreamer-signal');
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

### Integration with Dreamer Loader

Dreamer provides `setCustomShardLoader()` for P2P integration:

```javascript
import { setCustomShardLoader, downloadModel } from 'dreamer';

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

Uses existing `computeHash()` from shard-manager.js:

```javascript
import { computeHash } from 'dreamer/storage/shard-manager';

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
import { getShardsForExpert } from 'dreamer/storage/rdrr-format';

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
- `p2p/swarm.js` - Peer swarm management
- `p2p/tracker-client.js` - WebTorrent tracker signaling
- `p2p/peer-connection.js` - WebRTC wrapper
- `p2p/shard-protocol.js` - Shard request/transfer

**Integration points**:
- Hook into `setCustomShardLoader()` in dreamer-loader.js
- Use `computeHash()` from shard-manager.js for verification

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
| `loader/dreamer-loader.js` | `setCustomShardLoader()` extension point |
| `storage/shard-manager.js` | `computeHash()` for verification |
| `storage/rdrr-format.js` | `getShardsForExpert()` for MoE |
| `storage/downloader.js` | HTTP fallback implementation |
