# Canonical partition grants

Component: model partition coordination. Intent preserved: explicit approval, authenticated input owner, bounded disclosure and settlement.

The v3 grant binds the actual Doppler generation and full resident attempt, including epochs, participants and authorization scope. The existing v2 signature and validation path remains unchanged. Admission with N=0 is authorized without a step; revoked or expired grants cannot dispatch, while exact signed settlement remains possible. Private snapshots precede asynchronous signing and verification.

`before.log` retains the missing-capability failure. `after.log` runs `DOPPLER_SOURCE_ROOT=/Users/xyz/deco/doppler node tests/canonical-grants-source.js` with real identity signatures and actual source Doppler policy/attempt validation. `legacy.log` retains 65 passing partition API/runner tests; `types.log` passes library declarations. `worker.json` is the actual Verification Worker result (two warnings, no errors). `binding.json` identifies the tested sources.

This is a source contract checkpoint. Receiver, runner and durable publication wiring remain separate work; no deployed, physical canonical or accepted-package qualification is claimed. The library mirror is included; the combined browser manifest is reserved for its final owner.
