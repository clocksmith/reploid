# Placement C: 55-prefix physical qualification (mac-host, amd-host, amd-host)

Component: Reploid physical qualification fixtures. Intent preserved. Boundary effects: isolated candidate
processes only. The public package, contributors, model reference and resource limits are unchanged.

**Placement C:**

- stage 0: the mac-host Chrome browser, layers 0-7;
- stage 1: an amd-host native, layers 8-15;
- stage 2: a second amd-host native on the same GPU, layers 16-23 and the output head.

This is three logical stages on two physical hosts (`physicalHostCount` 2). Both natives run at the same time
in separate bounded scopes (10 GiB high, 12 GiB max, zero swap, core dumps on), each with its own inspector
port. The method is campaign 3's ([../../completion-qualification-3-20261014](../../completion-qualification-3-20261014/README.md)):

- the unchanged harness, producer `sha256:714cc204...`, F64 reference `ad26dfbc...` (evaluator `90376dde...`);
- 55 prefixes at 0.001;
- 300 s per stage, 10 s cleanup, 1,420,000,000 bytes per executor.

## What changed from campaign 3, and why

| Item | Change |
|---|---|
| Fixture root | [prepare-fixture.py](prepare-fixture.py) builds a new root from campaign 3's: the candidate archive replaces the vendored runtime, and the variant manifest and its `execution.json` replace the Capsule manifest. [install-native.py](install-native.py) installs the archive into the native app by verified extraction |
| Policy | [make-policy.py](make-policy.py): `prefillTokenChunkSize` 16 and `limits.maxPreparationMs` 1,200,000 (Reploid main's value). The candidate refuses an opening without a declared preparation bound (Doppler `ba72c310`) |
| Expected identity | Fresh load-only observations of all three stages ([observe-identity.js](observe-identity.js), unchanged code). [freeze.js](freeze.js) requires one identical identity across stages and records the leaves that changed from campaign 3; dtype lane, KV layout, memory policy and fusion set must be equal |
| Two natives on one host | [native-launch.sh](native-launch.sh) and [observe-native-c.js](observe-native-c.js) (the campaign supervisor with the scope name, port and, from c3, deadline as arguments) |
| Host sampler | [observe-host-c.py](observe-host-c.py) adds amdgpu VRAM/GTT and MemAvailable |
| Controller (c7, c8) | The unchanged controller ran on amd-host in a bounded scope. Both AMD stage calls were loopback and only the Mac stage crossed the network, over a reverse tunnel on the same port, so every endpoint URL is identical on both hosts. The fixture root is byte-identical on both hosts (binding `5a16484e...`) |

## Attempts

Every attempt is kept: config, expectations, preflights and logs are in `<attempt>/`, host logs in
`amd-host/<attempt>/`. Raw captures are kept locally, compressed where retained, and are not in Git.

| Attempt | Package | Prefixes within 0.001 | Lifecycle | Result |
|---|---|---|---|---|
| c | generation 1: archive `21d054ee`, manifest `64d74719` | 55/55, max 9.520e-07 | closes 1.9 / 1.9 / 1.6 s | **passed**; Capsule 1 later refused on install (closure) |
| c2 | generation 2: `21d054ee`, `c6220c6a` (+ Q/K head-norm program) | 54/55 | the native supervisor's 1,740,000 ms deadline ended both providers during the 55th prefix | failed (deadline; mac-host to amd-host round trips of several seconds) |
| c3 | generation 2 | 55/55, 9.520e-07 | closes 3.0 / 2.5 / 2.6 s | **passed**; Capsule 2 (unrolled) |
| c4 | generation 3: `3b132ee7`, `548e6559` (rolled state) | 55/55, 9.520e-07 | both amd closes over 10,000 ms while round trips were 0.8-1.0 s; providers exited 0 | failed (cleanup limit) |
| c5 | generation 3 | 32/33 compared, all within | the Mac owner's 1,740,000 ms deadline closed Chromium at 33 prefixes | failed (owner deadline) |
| c6 | generation 3 | 55/55, 9.520e-07 | stage-1 close over 10,000 ms, one attempt unsettled ("Ordered attempt ownership did not settle"), round trips 0.5-1.5 s with a ping timeout | failed (cleanup limit) |
| c7 | generation 3 | none | refused before any token: port 29993 was still held by c6's owner browser, so the connected browser differed from the frozen preflight | refused, fail-closed |
| **c8** | **generation 3** | **55/55, max 9.520e-07** (requests 8.40e-07, 8.90e-07, 9.52e-07) | **closes 3.4 / 2.7 / 2.7 s; providers exited 0** | **passed**; Capsule 3 (frozen) |

**The network failures.** Attempts c2, c4, c5 and c6 failed on network round trips, never on numerics.
Round trips stayed at 15-25 ms while idle. They rose to 0.5-1.5 s as soon as a capture's decode began,
because the controller pulls 1.3 MB of output-stage logits per step through the tunnel; see
`../journeys/logs/mac-health.log`, sampled every 10 s.

**What c8 changed.** It moved only the controller's location, so the logits stay on amd-host. No limit or
tolerance changed, and nothing was retried within an attempt.

## c8: memory of both AMD natives together

Measured during the 55-prefix capture, from the scopes' `memory.current` and `memory.peak` sampled every
second, the host sampler every 5 s and the device ledgers:

- **Process memory:** combined scope maximum 1,478,250,496 bytes; per-scope peaks 787,349,504 and
  766,459,904 (sum 1,553,809,408). Both are below the 10 GiB pressure limit each.
- **Device allocation peaks:** stage 1 125,659,504 and stage 2 271,700,368 bytes, each against the
  1,420,000,000-byte per-executor ceiling. Mac stage 0 peaked at 634,223,264.
- **GPU memory on the host** (Radeon 8060S, a unified-memory APU with a 512 MiB VRAM carve-out and 61.4 GiB
  GTT): GTT maximum 2.54 GB, VRAM 0.52 GB.
- **Headroom:** host MemAvailable never fell below 48.5 GB of 122 GB. The public contributor kept running.

Cold pipeline preparation is much larger: 5.9-7.2 GB of compiler memory per native, held after
preparation. It is measured in [../variant-choice](../variant-choice/README.md) and in the installed run.

## Timing observations (not performance acceptance)

Stage timers include diagnostic evidence persistence and controller transport. For request 2
(184 tokens, 12 chunks), c8 measured:

- **Prefill:** 29.7 s (Mac), 9.7 s and 9.7 s (AMD stages 1 and 2).
- **Decode medians:** 1.92 / 1.85 / 1.52 s. These include the evidence persistence of every step.

## Reports

`c8/reports/`: one contract and three partition reports, each `passed` with a complete 55-step
comparison, and `hashes.json`. Doppler `artifacts/faster-candidate-20261015/build.js c8` binds them.
`c/reports` and `c3/reports` remain for Capsules 1 and 2.
