# Combined ordinary ordered source checkpoint

Component: Reploid ordinary ordered chat, host composition, permissions and lifecycle. Intent: preserved. Boundary effects: existing browser/native entrypoints now explicitly opt into ordered participation; defaults and the accepted public runtime pin remain unchanged.

Source commit: `d29cdec8` (includes host composition `9f55a5f1`, automatic 2–7-stage controls `89be5d1e`, disclosure expiry `3bba09c9`, and full-route UI timings `3c19e155`).

`scope.json` records the 58 selected suites; `tests.log` records **511 passed, one existing skipped**. These are CPU/unit source integration checks, including injected numerical ports, not 511 physical model runs. Separate actual Chromium presentation and Verification Worker evidence remains linked from each owning checkpoint. No tests were newly skipped to obtain this pass.

The scope covers route binding and grants, real automatic protocol composition with injected channels/numerics, concurrent local and remote requests, host opt-in forwarding, retained failed cleanup owners, native device/provider lifetime, bounded receipt timing and retained conversations. The tests do not establish physical N-stage numerics, signed installed opening, shared physical-device accounting, autonomous cold stage assignment, demanding long concurrency or deployment. The source catalogue records intended user outcomes separately in docs/critical-user-journeys.md.
