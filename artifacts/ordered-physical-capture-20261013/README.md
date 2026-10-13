# Ordered physical capture preparation

Component: existing physical reference fixture. Intent preserved: compare actual public resident outputs against the unchanged independent F64 corpus; this opt-in branch forwards ordered stage activations without interpreting model arithmetic.

The CPU checks cover 2, 3, 4 and 7 ordered stages, exact activation bytes, final-only logits, original prompt binding, failure cleanup, and unchanged legacy preparation defaults. These are simulated orchestration controls. No GPU was launched and no physical qualification report was produced. Actual Verification Worker results and source hashes are retained here.

Run only from a frozen delivery after the coordinator reserves all selected providers:

```sh
REPLOID_ORDERED_QUALIFICATION_CONFIG=/absolute/frozen-config.json node tests/fixtures/browser-partition-memory-completion.js
```

The config has schema `reploid.ordered-qualification-capture/v1`. SHA-256-bound `{path,hash}` inputs are `expectations`, `reference`, `manifest`, `graph`, `archive`, `policy`, `pairedBinding`, `requests`, `delivery`, and each `requestContracts` entry. Hashes include `sha256:`. Additional fields are `root`, `runtimeDirectory`, `packageVersion`, original `model` metadata, new `outputPath`, and `gpuReservation:{approved:true,id,observedAt,sharedMachineNotes}`. Reservation data records actual coordinator authorization; writing a boolean does not grant permission.

Each ordered `executors` entry declares `executorId`, `kind` (`browser-cdp` or `native-inspector`), owned `endpoint`, browser `baseUrl`, `runtimeBaseUrl`, `modelSource`, and SHA-bound `preflight`. Preflight records `{executorId,endpoint,platform,observedAt,pid,executableIdentity}` from actual live processes. Its observation must follow the reservation; executable identity must equal the frozen expectation. Browser PID/version and actual adapter are checked after connecting. Native identity, installed archive and delivery are checked through the existing fixture port. Freeze the actual initial execution identities before creating expectations; do not derive observed identities from desired config.

Before launch, verify every host's installed archive and fixture closure, exact executable bytes/version, live controllers and other GPU consumers. Keep logical stage count separate from physical host count. The planned 24-layer model split is 0–7 / 8–15 / 16–23, with the same reference, weights, 0.001 tolerance and 1.42 GB per-executor ceiling. Suby's Intel support remains unqualified. A three-host reservation and compatibility evidence are still required; this checkpoint cannot substitute for either.

Boundary effects: test-only ordered capture and preparation option. Legacy fixture defaults, runtime kernels, application pin and provider processes are unchanged. This capture uses verified local files and controller forwarding; it is not signed application opening or authenticated peer transport proof.
