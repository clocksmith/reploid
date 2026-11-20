# Fill one stage from an enrolled supplier

Use the qualification checkout on the receiver. Supply and compute run separately. The inventory generator is in commit `d4ac192d1` on `qualification/private-split-request`. Generate the inventory once, save its SHA-256 independently, and carry the same inventory to both stages.

```sh
node tests/fixtures/partition-source-preflight.mjs "$MODEL" --piece-inventory > inventory.json
shasum -a 256 inventory.json
```

Each receiver needs its own enrolled identity, the operator’s private room token, and the supplier’s public key and participant ID obtained through enrollment. Place its pinned manifest and index in its model directory, or use the metadata bundled with that catalog entry. Configure an exclusive private piece cache on each stage. Use **that same cache and model directory** for subsequent native partition service. Keep other writers off the cache while filling. Choose a disk allowance covering assigned ranges, metadata, SQLite files, and any quarantined or abandoned temporary entries. The transfer ledger and process lock live beside the cache. Preserve both across restarts.

The per-receiver JSON has this shape. Supply the actual budgets as byte counts.

```json
{
  "enrollmentStatus": "enrolled",
  "modelId": "qwen-3-8-27b-text-q4k-ef16-af32",
  "modelIdentity": "sha256:<catalog-manifest-hash>",
  "planId": "sha256:<catalog-plan-hash>",
  "inventorySha256": "<independently-pinned-inventory-hash>",
  "stageIndex": 0,
  "receiverId": "<enrolled-stage-participant-id>",
  "supplierId": "<enrolled-supplier-participant-id>",
  "supplierPublicJwk": { "kty": "OKP", "crv": "Ed25519", "x": "<supplier-public-key>" },
  "roomId": "reploid-swarm-<private-room>",
  "signalingUrl": "wss://<private-signaling>/signaling",
  "identityFile": "/absolute/private/receiver.json",
  "roomTokenFile": "/absolute/private/room-token",
  "modelDirectory": "/absolute/private/model",
  "cacheDirectory": "/absolute/private/stage-cache",
  "maxCacheBytes": 0,
  "maxDownloadBytes": 0,
  "offerTimeoutMs": 15000,
  "hostIceOnly": true
}
```

Use `offline-unenrolled` for metadata-only profiles. They refuse `--transfer`. Use the receiver’s actual OS paths. Both byte limits must be positive. Stage 1 uses `stageIndex: 1`. On POSIX, the token file must belong to the current user and have mode 0600. Use `hostIceOnly` when both hosts have a direct private route. The optional `origin` field sets the WebSocket Origin header for the signaling server.

Check the assignment locally. The default invocation reads metadata and produces a plan without joining the room, opening WebGPU, or fetching weights.

```sh
node tests/fixtures/prefill-private-stage.mjs stage.json inventory.json
```

When real transfers are approved, run an enrolled native supplier in a private room. Set its cumulative upload allowance explicitly and use its existing verified model directory.

```sh
node server/native-participant.js --share-files --execution-mode whole-model --model "$MODEL" \
  --model-directory "$WEIGHTS" --identity-file "$SUPPLIER_IDENTITY" \
  --cache-directory "$SUPPLIER_CACHE" --supply-limit-gib "$SUPPLIER_ALLOWANCE_GIB" \
  --rtc-module @roamhq/wrtc --ws-module ws --signaling-url "$PRIVATE_SIGNALING" \
  --room "$PRIVATE_ROOM" --room-token-file "$PRIVATE_TOKEN_FILE"
```

Run the receiver with explicit transfer enabled. Its final JSON reports the range and byte counts, verified local reuse, successful transfers, and cumulative reserved payload before and after execution. Progress goes to stderr. Use the same files and budget to resume.

```sh
node tests/fixtures/prefill-private-stage.mjs stage.json inventory.json --transfer
```

The receiver reuses verified local pieces first. On a miss it proves the peer’s enrolled identity before requesting a grant, validates the supplier certificate against its pinned public key, and requests the indexed range over signed custody. External origins are disabled. The persistent reservation covers every payload chunk requested, including retries. WebRTC/IP overhead, control messages, and supplier disk reads are separate. Preparing a full supplier inventory can read every shard, and the baseline supplier can reread a whole shard to serve a small range. The supplier independently meters grants; an interrupted transfer can consume allowance on both ends.

The native cache hashes a complete piece before committing it under its content address. The next run revalidates completed pieces. Partial files are never admitted, and corrupt entries are quarantined. Concurrent prefill processes for the same cache are excluded by a process-lifetime database lock; the ordinary provider does not participate in that lock. A completed fill proves the assigned bytes are readable. GPU memory fit, numerical parity, routing, cancellation, and settlement require their own evidence.
