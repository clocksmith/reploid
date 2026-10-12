# Native verified acquisition and file supply

Component: native participant file ports. Intent: preserved. Native hosts use the existing authenticated WebRTC custody, signed grants, and Doppler public verified-piece reader. Compute consent and file-supply consent remain separate.

`server/native-model-files.js` adds a bounded filesystem cache. It verifies complete SHA-256 pieces before atomic retention; only requested pieces are acquired. Corrupt cache entries are quarantined and must be reacquired under the original identity. Symlinks, mismatched grants and invalid bytes fail. Complete pieces survive restart; this adapter does not persist partial transfer checkpoints.

## Physical custody check

An actual Node host on x@128 began with an empty model directory and empty cache. It obtained one 4,194,304-byte piece from the Mac browser file supplier, verified it through installed Doppler 0.6.27, and returned the requested first eight bytes. Only the pinned manifest, piece index and that piece were retained. No GPU provider was created. See `node-receive.json` and `node.log.gz`.

After explicit file-supply approval, that same Node host offered its retained inventory. A fresh Mac Chrome context used the real browser `createWorkModelFiles` implementation and restricted custody to the Node transport identity. It acquired the same piece from Node: 4,194,304 peer bytes, zero cached piece bytes and one transfer. The receipt records metadata delivered by that Node too. See `browser-receive.json`, `browser.log.gz` and the two harnesses.

The first reverse harness used a synthetically fulfilled local document. Chrome blocked its local signaling request with `ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`, so it found no supplier. That failed observation is retained. Navigating a real local resource supplied the actual local address context; no browser security feature was disabled. The corrected run succeeded.

The files-only Node process was stopped with SIGTERM and disappeared normally. It never offered computation or displaced the existing contributors. These checks establish actual cross-machine custody in both directions, not a complete model load through the new acquisition adapter. A subsequent complete native preparation/answer check is required. Initial successful transfers preceded the final cleanup-only repairs; focused tests below cover those repairs.

## Operation

The existing `node server/native-participant.js` accepts `--cache-directory` and explicit `--share-files`. Supply does not require `--gpu-module`; `--contribute` still does. Both switches can be selected independently. The existing model catalog fixes manifest and piece identities. `--model-directory` is a read-only, explicitly approved source and may be empty. Missing assigned pieces are acquired from already connected authorized suppliers; there is no HTTP weight fallback.

Use a separate cache per running host. Filesystem admission is serialized within that host, bounded by the existing file policy, and does not evict another conversation's weights. The cache does not claim cross-process reservation or directory sharing. `stopSharing()` revokes file supply while compute can continue; `stop()` stops compute independently. Full host shutdown attempts every cleanup owner, preserves errors and does not infer remote settlement from transport loss.

## Checks

`focused-tests.log.gz`: 32 passing tests across native host, native file ports and custody exchange. These cover missing-piece acquisition, retained reuse, supply approval/revocation, corrupt supplier replacement, corrupt cache quarantine, grant mismatch, cancellation, cache budget, symlinks, failed cleanup and overlapping host stops. Layer/loader/cycle verification and `git diff --check` pass. The actual Verification Worker passes both native sources with warnings and no errors (`worker.json`). Its earlier process.exitCode false positive is retained; the CLI now awaits signal-driven cleanup and propagates errors through its top-level promise for natural failure exit. Physical receipts are separate from fake-channel regression tests.

The accepted Doppler archive and public APIs are unchanged. These results do not qualify signed Capsule opening, model accuracy, document quality or public deployment.
