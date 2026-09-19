# Installed Doppler 0.6.1 candidate

This is local compatibility evidence, not npm publication, a production pin,
complete-model qualification, or deployment.

## Exact inputs

- Reploid base: `659c0d7b546fd51a140cdbf6bcb80d5f297d041e`, in the isolated `codex/doppler-061-deployment` checkout.
- Doppler clean source: `9df46c39c4dba0aef4e8a0abecc8edee0841eb11`.
- Archive: `/var/tmp/doppler-061-release-20260908-final-package/doppler-gpu-0.6.1.tgz`.
- Archive SHA-256: `9be2c722068a540c95910637f4de2f96bb4ef085704a117ae0e7c02b62b22380`.
- Integrity: `sha512-vaJpBAzHgJA9iMyOQvmuNO5lCyrpy4iLPE9c/ZwFsE/W5dE8kplnpXzIpJmPY/jrRLg6JD8ynqqgmTxdHMBpIQ==`.
- Installed package: `node_modules/doppler-gpu`, an ordinary directory, not a source symlink.
- All 1,784 package files match the retained clean package consumer byte for byte.
- Package-order `[path, sha256]` JSON digest: `7894d7bab6423d7380adc5422f587c96454abc18f2f74b6270bc071354e48304`.

The default published `0.6.0` installation fails the public generation-export
check. The first candidate install with `--package-lock=false` failed inside npm
with a null `edgesOut` error. The subsequent ordinary `npm install --no-save
--ignore-scripts --no-audit --no-fund <archive>` succeeded. Both logs remain at
`/var/tmp/reploid-doppler-061-20260908-candidate-install*.log`.

## Local acceptance

The final Doppler `npm run check:green` starts and finishes with clean source
`9df46c39c4dba0aef4e8a0abecc8edee0841eb11` and passes, including 798 unit-test
files. Its separate physical AMD operator checks pass 96 penalty cases and
540 distribution cases. These operator checks do not establish complete public
generation, answer quality or physical-device family support. Initial failed
checks remain separate from both successful full-gate runs.
`npm publish <retained-archive> --dry-run --ignore-scripts` also passes. Its
`/var/tmp/doppler-061-release-20260908-publish-dry-run.log` is a dry run only;
it does not publish the archive or establish npm authentication.

The installed generation fixture passes with 17 phase calls, 17 releases and
two closed sessions. It checks options, budgets, stopping reasons, cancellation,
stale results and session isolation through Reploid's runtime service and the
installed public Doppler API. Its signed test model supplies injected logits;
this is not physical model or semantic evidence.

The unit suite passes 2,091 tests with 25 skips. Four Chrome document tests pass,
including the actual Verification Worker and durable release checkpoints.
Their model outputs are injected. Charter and layer checks pass. A stale
`ui/pool-home/controls.js` inventory hash also reproduces on unchanged main;
regenerating the module inventory fixes the module-system check without
editing application code. The generated browser inventory now binds 651 files
as `sha256:a5efbe92dafd17bc4f8aac71b6e9e1ada1119be8451659f8419d15fb4b54ee30`.

The only tracked local changes are generated contract provenance, module
inventory and browser inventory. Reploid's registry dependency, lockfile and
configured browser runtime still say `0.6.0`. The runtime-config check validates
those unchanged configured pins; it does not admit the locally installed
candidate. The injected installed fixture explicitly selects version `0.6.1`.
Publishing, repinning both package and browser runtime, rebuilding inventories
and qualifying that exact application remain required before deployment.

## Blocking external state

Fresh npm authentication returns E401. This host has no `gcloud` executable,
usual local Google Cloud credential files, or explicit Google credential-path
environment setting. Firebase is installed. No credentials were inspected or
stored here. The live deployment check returns HTTP 200 and source
`d1ba8ddc745eb7c55a1dc7b999d3a2edda00ae92`, platform revision
`reploid-pool-00086-kpj`. No production mutation was performed.

Component: Reploid runtime integration, configuration and acceptance tests.
Intent: preserved.
Acceptance evidence: `/var/tmp/reploid-doppler-061-20260908-installed-contract.json`,
`/var/tmp/reploid-doppler-061-20260908-unit.log`,
`/var/tmp/reploid-doppler-061-20260908-browser-documents.log`, and the retained
Doppler package receipt. The browser rerun after inventory regeneration also
passes all four cases in
`/var/tmp/reploid-doppler-061-20260908-browser-documents-inventory-fixed.log`.
The final clean Doppler gate is retained in
`/var/tmp/doppler-061-release-20260908-green-clean.log`.
Boundary effects: local generated identities only; no registry pin, model
promotion, answer-qualification claim, or deployment.

*Last updated: September 2026*
