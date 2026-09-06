# ESM-2 capability planning observation

The v3 signed job executed the actual peer-reconstructed ESM-2 model using an
immutable capability/assignment plan. The provider advertised its exact resident
model, supported operation, observed GPU identity, declared budgets and current
load. Free physical GPU and storage memory remained explicit unknown values;
the configured admission policy used declared budgets and recorded that choice.
There was one eligible provider in this physical run. Competing-provider selection
is covered separately by synthetic-output tests.

All eight frozen CPU reference checks passed. A dropped completion and provider
object replacement recovered the original signed result through IndexedDB on
the second delivery, with one remote calculation. The loaded-model remote job,
including retry, took 2,062.9 ms. The journal retained one completed attempt and
283,886 serialized bytes.

All 549 served Doppler runtime files match the immutable 0.6.0 candidate package,
SHA256 `95d722c5d3ae10b60e78cd9c8c2ce3a769ecb39229c7f25c1d26a8bf7bee6b10`.
This identifies a locally installed candidate; it does not claim npm publication.

The separate browser log records four operations over actual WebRTC through
the shared room owner, plus native attempt recovery and Verification Worker
checks. Its model outputs are synthetic. The real-model episode replaced the
provider object within one browser process. One internal operator used one
physical computer. This does not demonstrate independent machines, operator
independence, useful history, LoRA execution, distributed experts, guaranteed GPU
capacity or exactly-once physical execution. History routing remains disabled.

## Reproduction

`index.json` hashes the retained files and names unchanged external weight
shards. `episode.json` retains the signed candidate advertisement, complete plan,
policy snapshots, original host disabled, supplier faults, model execution and
reference comparisons. Source patches apply to the recorded base revisions. The retained run used a
frozen checkout after a concurrent workspace push prevented archiving an earlier
successful run under its original base revision.
The episode explicitly records a modified Reploid tree. No private signing keys
are retained.

Run `npx vitest run tests/unit/retained-peer-pack-episode.test.js` to verify the
archive offline. To rerun the physical experiment, restore indexed model files
and exact runtime package, apply the source patches, copy the episode config
with local paths and a fresh output directory, and run
`node scripts/verify-peer-pack-execution.js --config <configuration>`.
The config retains declared requester/provider resource budgets and browser
flags. These are explicit experiment settings, not portable hardware promises.

Component: Poolday planning, complete jobs and room orchestration. Intent:
preserved. Acceptance evidence: indexed episode and attachments; planning,
job, room and retained-episode tests. Boundary effects: signed provider advert
v2 and job v3. Transport and Doppler mathematical execution are unchanged.

*Last updated: September 2026*
