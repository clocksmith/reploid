# Durable remote ESM-2 job recovery

The actual ESM-2 model reconstructed from authorized peers completes a remote
`encodeSequence` job. The fixture drops its first completed response, closes
the provider object, and creates a replacement with the same signing key and
native IndexedDB journal. The replacement restores the signed response after
the requester's retry. It performs no additional model calculation.

| Observation | Result |
| --- | --- |
| Frozen CPU reference checks | 8 of 8 pass |
| Signed job deliveries | 2 |
| Remote model calculations | 1 |
| Provider objects replaced | 1 |
| Retained attempts / serialized journal bytes | 1 / 276,711 |
| Loaded-model job including retry | 2,167.8 ms |
| Peer acquisition time to runnable | 13,466 ms |
| Installed Doppler runtime files matched to package | 549 |

The provider replacement in this GPU experiment occurs within one browser
process. Separate retained Playwright observations replace the entire Chromium
process and reopen its browser profile for four cases: completion, failed send,
unfinished calculation, and cancellation before the job arrives. Those four
cases use synthetic model outputs, real signatures and native IndexedDB. Each
replacement performs zero calculations; unfinished work returns its saved
partial result followed by failure. The live concurrent-provider test also
releases the original calculation after replacement and rejects its completion.

The physical run uses one internally operated AMD Radeon 8060S machine.
It does not prove independent operators, scheduling improvement, power-loss
recovery, storage survival after eviction, or exactly-once execution. The model
remains open across provider-object replacement. The elapsed job measurement
includes the delivery retry and is not cold model startup latency.

## Reproduction and retained evidence

The [index](index.json) binds 35 retained files and two unchanged external weight
artifacts. The [episode](episode.json) includes the signed job, response,
requester acceptance, frozen checks, custody faults and journal accounting.
All indexed files are required in clean checkouts. Original-host and mirror
model downloads remain disabled during peer reconstruction; corruption and
supplier departure remain exercised.

Reploid source base is `57417bde6954b3d937bff3264124fdc76ad7585d` plus
[the retained source patch](reploid-runtime.patch). Doppler source is clean
`09a359a5f1d1e31180a135264fdc8da01192ff3b`. Its immutable candidate package SHA-256
is `95d722c5d3ae10b60e78cd9c8c2ce3a769ecb39229c7f25c1d26a8bf7bee6b10`;
the [file comparison](attachments/runtime-package-equivalence.json) checks the
served runtime against that package. The package itself is retained with the
[document assistant experiment](../document-assistant-2026-09-06/README.md).

Reconstruct the Pack using indexed artifacts, verify their hashes, apply the
source patch to the recorded base, and rewrite local paths in `episode.config`
for the Pack, Doppler checkout, immutable package bundle, CPU reference and
[remote reference](attachments/remote-reference.json). Run
`node scripts/verify-peer-pack-execution.js --config <config.json>`.
The remote full-output baseline comes from a previous same-host run; the eight
CPU checks cover sampled numerical values separately.

Run `REPLOID_E2E_SKIP_LOCAL_SERVER=1 npx playwright test
tests/e2e/peer-pack-jobs.spec.js tests/e2e/peer-pack-custody.spec.js
--project=chromium` for native storage, process replacement, corruption,
concurrent writers, real WebRTC framing and Verification Worker checks.
The [browser log](attachments/reploid-durable-browser.txt) records 10 passes.
The retained unit log records 2,386 passes and 35 skips before this archive's
additional offline validation case. Contract checks pass and registry generation
is idempotent with zero unresolved issues.

Component: Poolday complete-job recovery and Runtime Infrastructure.
Intent: preserved. Acceptance evidence: linked episode, browser observations,
test logs and contract logs. Boundary effects: infrastructure owns journal
transactions; Poolday owns admission, signature validation and acceptance.

*Last updated: September 2026*
