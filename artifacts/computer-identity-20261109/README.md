# Computer identity and optional GPU signature

Component: Reploid library mesh and Poolday computer labels.
Intent: preserved; stable labels use verified participant keys. An explicit local
GPU measurement adds a diagnostic signal without making hardware identity claims.
Boundary effects: shared browser library delivery and product label projection.
No provider service, inference configuration, pricing or deployment changed.

## Acceptance

- 55 focused unit tests passed across computer labels/identity, GPU signature,
  mesh identity, legacy generation and whole-model receipt integration.
- Library declarations, scoped lint and browser ownership boundaries passed.
- Generated library mirror, ownership inventory and product bundle regenerated.
- Physical Chrome 157.0.8103.38 on an Apple Metal adapter, with no additional
  browser launch flags: three captures; all 6,144 GPU checksums matched the CPU
  calculation. Mid-dispatch cancellation passed and the borrowed device remained
  usable. No page or uncaptured GPU errors. Probe buffers totaled 17,432 bytes.
- The same-device repeated signatures differed (RMS distances about 0.131 and
  0.110). These are descriptive observations, not a calibrated match threshold.

Run the physical check with:

```sh
node tests/fixtures/computer-identity-browser.mjs
```

The harness retains raw orders locally in `.cache/computer-identity/recordings.json`.
The committed [physical receipt](physical-receipt.json) contains measurements and
probe source hashes, without publishing the full device signature.

No cross-device recognizability, reboot stability, driver-update stability or
spoof resistance was established. The probe uses fixed workloads, not a fresh
remote authentication challenge. Comparisons without operator-supplied calibrated
thresholds remain `uncertain`; missing captures remain `unmeasured`.
