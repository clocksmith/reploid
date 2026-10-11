# Mac / Intel physical numerical comparison

The accepted standard Doppler 0.6.27 archive executed all 55 frozen steps in
both placements on Mac and a second physical Intel/Vulkan computer. Numerical
acceptance **fails**: 28/55 Mac-to-Intel steps exceed 0.001 (maximum
0.0018434524536132812); 23/55 Intel-to-Mac steps exceed it (maximum
0.001850128173828125). All sampled token identities match the frozen tokens.
Neither token agreement nor successful execution closes the numerical gate.

The unchanged allocation ceiling is 1,420,000,000 bytes. Partition peaks were
756,922,768 and 391,430,544 bytes in both placements. After settlement, retained
model weights, active pooled allocations and deferred pooled cleanup are zero;
reusable buffers remain. No uncaptured GPU validation errors were recorded.
These short fixed-prefix checks do not rerun the 1,588-token memory workload,
prove peer acquisition, or establish a complete conversation journey.

[review.json](review.json) retains every step comparison, archive/browser/reference
identities, actual driver observation and hashes of the full local captures.
The raw run remains under `artifacts/distributed/2026-10-11T20-57-44-372Z/` and is
excluded from Git to avoid another large history copy. The remote provider is
physical Intel Gen12LP, Mesa 24.2.8, Chrome 136.0.7103.59; its fallback flag is
false. The harness calls this host `linux`; it was the additional Intel node,
not the AMD host used in earlier runs. No new reference is activated.

Reproduce using the existing `scripts/test-distributed.js --local --numerical-only`
with `REPLOID_TEST_PEER` and `REPLOID_TEST_PEER_ROOT` bound to the authorized
Intel host. Both checkouts must have the recorded browser identity and standard
archive. The harness owns separate profiles, servers and tunnels; all its child
processes closed at the end. The existing public contributor elsewhere was
untouched. Nothing was published or deployed.

Component: physical acceptance evidence. Intent: preserved. Boundary effects:
none. Exit status 1 is the retained numerical rejection, not an acquisition or
cleanup exception.
