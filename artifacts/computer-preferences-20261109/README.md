# Computers: local names and optional GPU checks

Component: Poolday host computer preferences and Computers interface.
Intent: preserved; display preferences and diagnostic measurements grant no execution authority.
Boundary effects: product host/UI composition and generated browser delivery. No provider service, model runtime, pricing, or GPU limit is changed.

The stable-label baseline `bec8da437` was published and its packaged browser
manifest, app bundle and label module were compared with replo.id. This change
adds the optional controls on top of the chat-control release `664f438`.

A connected computer's Details contains Name on this device after a verified
participant-key binding is observed. Save verifies that channel again and refuses
a different key from the one displayed. Names are local to this browser and are
saved by the complete verified participant ID. Blank input restores the generated label.
Unverified peer claims and reused transport IDs cannot inherit a saved name.
The authenticated-identity readout now includes an observed participant proof.

Computers → This device → GPU check is collapsed by default. Run GPU check is
an explicit local action; opening the page or restoring preferences never runs
it. Save baseline is a separate storage action. The selected adapter's reported
GPU appears with the measurement. Stop, application pause and close cancel owned
work; close waits for its cleanup. Missing WebGPU and failed storage remain
visible. A corrupt baseline can be cleared. A failed new check cannot offer an
older measurement as its result.

Saving a measurement as its own baseline asks for another check, rather than
presenting a zero-distance self-comparison. Subsequent comparisons always remain
uncertain without supplied calibration. These controls do not claim to identify
an individual physical GPU or authenticate a remote response.

## Checked

- 87 focused tests across the seven suites listed in checks.json, including
  identity changes during rename, persistence failures, baseline validation,
  cancelled cleanup, stale-result rejection and the surrounding host/UI lifecycle.
- Scoped ESLint, CSS layers, browser ownership boundaries, ownership inventory,
  regenerated product bundle and exact hosting packaging pass.
- The conversation suite logs a local port-3000 connection refusal while its
  assertions pass. No live provider qualification is inferred from those tests.
- receipt.json records actual Chrome 157 / Apple Metal captures through the UI.
  A complete browser process restart preserves the local nickname and baseline.
  Two fresh checks remain uncertain. Baseline clearing and the 390px layout pass,
  with no page errors. This uses a controlled identity-verifier fixture, not a
  fresh physical remote-identity exchange. Source hashes and the packaged bundle
  identity bind the actual browser-loaded files.

Reproduce after npm run prepare:hosting:

```sh
node tests/fixtures/computer-preferences-browser.mjs
```

Raw orders remain local under .cache/computer-preferences-browser/recordings.json;
only descriptive results and screenshots are retained here. The GPU workload is
the unchanged SDK probe already checked in the sibling computer-identity packet.
No new arithmetic, recognition threshold, training result or performance promotion
is introduced.

## Still unqualified

OS reboot, driver changes, controlled load variation, different physical GPUs of
the same model, false-match/missed-match rates and fabricated-response recognition
resistance. Browser-process persistence is not those results. This single-device
check supplies no basis for selecting recognition thresholds. Signing keys remain
the basis for label continuity.

## Production

Published `25e7e04` to the existing `hosting:reploid` target. The actual replo.id
manifest, app bundle and four computer-preferences modules match their packaged
bytes. The deployed bundle is
`sha256:1ce45956be438cefbb18361aa8638affe6402271ea7e0ce79114072e958be939`.

[live.json](live.json) records the actual application drawer, not the isolated
verifier fixture: Run GPU check, Save baseline, reload without an automatic
measurement, a fresh uncertain comparison, Clear baseline and the 390px layout
all pass on Chrome / Apple Metal with no page errors. No model execution or
provider restart was required. This does not add physical remote-name verification
or any of the recognition qualifications still open above.
