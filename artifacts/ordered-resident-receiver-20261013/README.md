# Ordered resident and receiver lifecycle

Component: resident partition and ordered step receiver. Intent adds explicit ordinary ordered mode while retaining legacy and two-stage canonical modes.

`createResidentPartition({ordered:{runtime,stage}, ...})` binds the host-owned stage before preparation, hashes generation with Doppler's public function, checks the provider v2 descriptor/stage count, and requires executeStage before Ready. The session adapter maps application identities into Doppler's ordered attempt identity for tokenization, execution and every cleanup path. Application reservations retain their original route identity. Unknown cleanup remains charged until retry settles. Canonical ordered mode is rejected.

The existing receiver accepts an explicit ordered stage binding and reuses authorization, payload fingerprinting, ordering, duplicate suppression and tombstones. A rejected cleanup promise can be retried without allowing reexecution. `receiver-before.txt` retains the absent ordered-binding failures; `after.txt` records 75 controls, including 65 legacy cases, stage substitution, duplicate/revoked replay, all three facade stages, missing capability before Ready, failure cleanup and survivor isolation. Independent review caught a mutable caller identity in the existing invoke failure path; the owner now uses its original snapshot, with a blocked-failure mutation regression.

The actual source Doppler resident plus this facade and real v4 WebCrypto grant integration is retained independently in `../ordered-route-integration-20261013/facade-grants-result.json`. Its numerical kernels/cache allocation are explicitly injected. It exercises real generation/tokenization/decoder/state ownership, not GPU correctness or capacity. Types, charters and actual Verification Worker evidence are retained here; warnings remain visible.

Authenticated binary middle-stage transport and ordinary host composition remain the next connection. No pin, installed runtime, signed application snapshot, GPU work or deployment changed.
