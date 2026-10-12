# Public capacity restoration — 2026-10-12

Component: Reploid public participation. Intent: preserved. Boundary effects:
operator-approved model-file supply and explicit contributor restart; no runtime,
model, precision, placement policy or production source change.

## First failed boundary

Fresh public discovery found two ready nodes on x@128, while Suby's browser and
native nodes were connected but failed at tokenizer loading. Both Suby logs
reported missing `tokenizer.json`. All four nodes had compute permission but
file supply was disabled. x@128's approved model directory contains the pinned
tokenizer, SHA-256 `8fc3b6de02de5a8e21d3867aba335e2d9a3c2263201f55daaed1feab3541bea4`.
The initial discovery observations are retained separately from readiness.

The user explicitly approved model-file sharing on x@128's native node, within
the existing 4 GiB transfer allowance. Its idle process stopped and logged
owned-device destruction. It restarted from the same installed application with
`--share-files --contribute`, retaining its approved directory, cache and identity.
Suby's failed native process also stopped with zero unsettled owners and explicit
GPU destruction before a new attempt. No supplier permission was inferred from
compute or discovery, and no direct weight-download fallback was introduced.

## Acquired capacity and ordinary conversation

[Suby native state](suby-native-ready.json) records 75 verified pieces,
307,887,776 verified bytes, layers 12–23 and resident weight bytes 285,497,344.
Its model directory began without the missing model data; verified pieces came
from the authorized peer supplier. Previously retained manifest/index metadata
remained. [x@128 state](x-native-settled.json) records layers 0–11 and source hashes
for the unchanged installed host. Supply at that snapshot was 1,244,221,280 bytes,
below 4,294,967,296, with no pending transfer.

The idle x@128 browser node was stopped temporarily, making its former output
partition unavailable. Existing automatic placement selected prepared Suby
capacity. The [ordinary requester harness](conversation.mjs) opened
`https://replo.id/` in fresh Chromium storage, without room invitations or manual
peer selection. It approved each exact request and recipient pair through the
deployed UI. [Receipt](conversation.json):

- Three tickets at $12: `$36`.
- Follow-up using the same history, four tickets: `$48`.
- Both native executors' reservation records are settled, with zero active
  reservations and zero unsettled owners.
- Zero requester HTTP weight-file requests. This run did not independently walk
  OPFS; it does not claim a new exhaustive requester-storage audit.

The authoritative participant IDs are x@128
`peer:688e732256ab83155c54f72e` and Suby `peer:57adcc49bae5ed5eefe8fbf1`.
Both calls reached completion. No generation or tensor values were supplied by
the harness. This is a narrow useful-answer check, not general factual quality.

## Browser restoration and diagnostic failure

Both browser launchers were explicitly restarted against the public application
with their existing profiles and compute grants. Suby's browser transferred
missing pieces and reached Ready, confirmed by [live inspection](browser-observation.txt).
An inspector cleanup expression then attempted dynamic import in a Node debugger
evaluation context, which lacks that callback. Its unhandled rejection terminated
the browser launcher. [Failure retained](diagnostic-cleanup-failure.txt). The
completed native conversation was unaffected. The browser was restarted again
from the retained verified cache; no invalid receipt was promoted and no model
data was deleted. The temporary inspector tunnel was closed.

The [final fresh public probe](discovery-after.json), at 14:52:52 UTC, sees all
four prepared nodes and makes zero HTTP weight requests. A probe during the
controller failure timed out and is retained as
`discovery-during-controller-failure.json`. Live processes after restoration:

| Computer | Browser node PID | Native node PID | File supply |
| --- | ---: | ---: | --- |
| x@128 | 848860 | 803750 | Native only, explicitly approved |
| clocksmith@suby | 4037818 | 4031894 | Off |

All use the public rendezvous for `replo.id`. The observed placement has one
input owner and three ready output replicas; four nodes do not mean a four-way
partition or four independent physical computers.

## Scope

The public application is `c13cd97e`; Doppler remains 0.6.27 and the existing
native installations were not repackaged. This is verified pinned-manifest
opening, not physical signed-Capsule qualification. Numerical failures, document
quality, simultaneous long prompts under 1.42 billion allocated bytes, full
exact-package acceptance, continuous uptime and independent-network/NAT breadth
remain open. The native and browser processes are retained to serve public users.
