# Native verified acquisition and file supply

Component: native participant file ports. Intent: preserved. Native hosts use the existing authenticated WebRTC custody, signed grants, and Doppler public verified-piece reader. Compute consent and file-supply consent remain separate.

`server/native-model-files.js` adds a bounded filesystem cache. It verifies complete SHA-256 pieces before atomic retention; only requested pieces are acquired. Corrupt cache entries are quarantined and must be reacquired under the original identity. Symlinks, mismatched grants and invalid bytes fail. Complete pieces survive restart; this adapter does not persist partial transfer checkpoints.

## Physical custody check

An actual Node host on amd-host began with an empty model directory and empty cache. It obtained one 4,194,304-byte piece from the Mac browser file supplier, verified it through installed Doppler 0.6.27, and returned the requested first eight bytes. Only the pinned manifest, piece index and that piece were retained. No GPU provider was created. See `node-receive.json` and `node.log.gz`.

After explicit file-supply approval, that same Node host offered its retained inventory. A fresh Mac Chrome context used the real browser `createWorkModelFiles` implementation and restricted custody to the Node transport identity. It acquired the same piece from Node: 4,194,304 peer bytes, zero cached piece bytes and one transfer. The receipt records metadata delivered by that Node too. See `browser-receive.json`, `browser.log.gz` and the two harnesses.

The first reverse harness used a synthetically fulfilled local document. Chrome blocked its local signaling request with `ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`, so it found no supplier. That failed observation is retained. Navigating a real local resource supplied the actual local address context; no browser security feature was disabled. The corrected run succeeded.

The files-only Node process was stopped with SIGTERM and disappeared normally. It never offered computation or displaced the existing contributors. These checks establish actual cross-machine custody in both directions, not a complete model load through the new acquisition adapter. A subsequent complete native preparation/answer check is required. Initial successful transfers preceded the final cleanup-only repairs; focused tests below cover those repairs.

## Operation

The existing `node server/native-participant.js` accepts `--cache-directory` and explicit `--share-files`. Supply does not require `--gpu-module`; `--contribute` still does. Both switches can be selected independently. The existing model catalog fixes manifest and piece identities. `--model-directory` is a read-only, explicitly approved source and may be empty. Missing assigned pieces are acquired from already connected authorized suppliers; there is no HTTP weight fallback.

Use a separate cache per running host. Filesystem admission is serialized within that host, bounded by the existing file policy, and does not evict another conversation's weights. The cache does not claim cross-process reservation or directory sharing. `stopSharing()` revokes file supply while compute can continue; `stop()` stops compute independently. Full host shutdown attempts every cleanup owner, preserves errors and does not infer remote settlement from transport loss.

## Checks

`focused-tests.log.gz`: 32 passing tests across native host, native file ports and custody exchange. These cover missing-piece acquisition, retained reuse, supply approval/revocation, corrupt supplier replacement, corrupt cache quarantine, grant mismatch, cancellation, cache budget, symlinks, failed cleanup and overlapping host stops. Layer/loader/cycle verification and `git diff --check` pass. The actual Verification Worker passes both native sources with warnings and no errors (`worker.json`). Its earlier process.exitCode false positive is retained; the CLI now awaits signal-driven cleanup and propagates errors through its top-level promise for natural failure exit. Physical receipts are separate from fake-channel regression tests.

The accepted Doppler archive and public APIs are unchanged. These results do not qualify signed Capsule opening, model accuracy, document quality or public deployment.

## Complete cold preparation and conversation

The canonical native CLI at `7cd5fbd0` started with a new identity, empty approved model directory and empty cache on amd-host. Automatic placement paired it as output partition B (layers 12–23) with the already resident Suby browser A. It acquired all 75 required pieces, 307,887,776 verified bytes, through the Mac browser supplier's signed custody protocol. The loader reported successful model opening in 278,047 ms in this single cold run; this includes peer acquisition and is not a comparative benchmark. The model directory remained empty; the cache contained those 75 pieces and two pinned metadata files. `cold-compute/launch.json.gz` records inputs and source hashes; `ready.json.gz` and `final-custody.json.gz` retain all unique signed transfers. Every one of the 1,897 installed Doppler files matched the accepted archive. Native Dawn and WebRTC mapped-library identities are recorded.

The ordinary requester then completed four short answers across two two-turn conversations: three tickets cost $36; four cost $48. The second pass verifies remembered disclosure and zero HTTP model-weight requests. The first harness incorrectly counted the JavaScript module `piece-acquisition.js` as weight traffic; its failed assertion remains in the application evidence. See [the ordinary conversation receipt](../live-conversation-20261012/native-cold-conversation.json). The cold preparation initially exceeded the requester's harness readiness timeout; no request was sent during that timeout. It remains recorded by the application owner.

Actual output-owner state, read through the process inspector after completion, showed all four reservation records settled without failure, zero active reservations and 285,497,344 resident weight bytes. No additional pieces were transferred for those requests. `settled.json.gz` retains that state. `memory-settled.json.gz` records the public memory snapshot: pool-tracked current 315,687,424 bytes, peak 328,623,360 bytes. This is pool accounting, not a new full-device allocation or long-prompt acceptance claim. Two unsuccessful inspector approaches and the API-discovery result are retained separately; none establishes cleanup.

After settlement, SIGTERM caused model unload and explicit GPU device destruction, and the canonical CLI exited naturally with status zero. `shutdown.json.gz` and `process-events.log.gz` record that outcome. The owned SSH tunnel closed; the unrelated public contributor was left untouched. Full repetitive raw network logging remains on amd-host at the path/hash in `raw-log-identity.json`; unique signed custody receipts are in this repository.

A subsequent custody-only correction advertises newly verified assigned pieces when file supply for that same model remains approved. Otherwise `--share-files --contribute` could leave a cold host offering only its initial metadata. Its regression fails against `7cd5fbd0`, then passes with the fix; 33 focused checks and the actual Verification Worker pass. Revoking file supply prevents later acquisitions from republishing. The physical cold-compute run selected compute only and therefore did not exercise this additional supply-refresh behavior.


## Physical acquisition cancellation and retry

`acquisition-stop.mjs` uses the existing native file adapter on amd-host, an empty
source/cache, the live Mac browser supplier and no GPU. It waits for the actual
required shard advertisement rather than treating any connection as supply.
The first 4,194,304-byte piece completed and was retained. Cancellation during
the second piece occurred after 1,835,008 bytes arrived. Acquisition and two
concurrent source-close calls settled; the incomplete piece was not retained,
no temporary file survived, and the completed piece remained intact.

A fresh source reused the first piece with zero transferred bytes, then acquired
and verified the missing 4,194,304-byte piece. Both concurrent host-close calls
settled with zero pending work. The Node process exited normally and its owned
tunnel closed. Existing browser contributors/requester stayed running and ready.
`acquisition-stop.json` and `acquisition-stop-pass.log.gz` retain the physical
receipts. This checks acquisition ownership; it does not inject failed GPU cleanup.

Two failed harness observations are retained. The first incorrectly counted a
cached piece in `completedPieces`, which counts new acquisitions only; separate
`reusedBytes` and verified-piece identities now assert both outcomes. The second
started before the required supplier advertisement arrived and correctly failed
with no eligible source. Waiting for any connected peer was an invalid acquisition
precondition. The corrected control observes the specific offer; it adds no
production retry or weaker authorization. The original two raw logs remain in
`acquisition-stop-count-failure.log.gz` and `acquisition-stop-inventory-failure.log.gz`.
