# Isolated archive9 application delivery

Component: browser/native delivery. Intent preserved. No public deployment,
accepted-pin change, GPU launch, or signed-opening acceptance occurred here.

The source is a clean `git archive 37c7bc9f`, exported to
`/var/tmp/reploid-signed-candidate-archive9-20261012`. It excludes concurrent
uncommitted work. The isolated snapshot uses ordinary Doppler archive
`8cae56b0748a5c66add985122d8bbf72b7492e2e0828f713f1b0d7425a59a4e5`.
The catalog still contains the original verified-manifest entries. Signed
Capsule/catalog preparation requires actual qualifying reports and a subsequent
delivery freeze; this snapshot does not claim that acceptance.

## Preparation and checks

Replace the archive only in the isolated snapshot, remove its stale runtime
lock entry, and resolve it with `npm install --package-lock-only --ignore-scripts`.
Use existing `vendor-doppler.js` and `npm ci --ignore-scripts`; then regenerate
generation/partition contracts, runtime configuration, module inventory, VFS
manifest and browser bundle with the existing scripts. The first generation
sync failed because the clean export lacked esbuild; installing declared
dependencies resolved that setup failure. No implementation was patched.

`package-hosting.js` validates and copies 1,977 assets, including the descriptor.
The browser descriptor binds 1,976 content files as
`sha256:46a907ee7e0ab0ea1a2337c07f8962bac7df10074696ab61bdaa4f350eba5f0d`.
Browser-manifest and public generation/partition contract checks pass.

Existing `package-native.js` produces:

- 95 application/archive/metadata files.
- Native descriptor SHA256
  `cc1badba877e148654c9ffcb0f51715dac2427547f68000be6a9f67b6fa2bcb9`.
- Native archive SHA256
  `7e5bbc5579386f1d3fbaad83525487736a2a995d0272216de7b4a7c97881034b`.

That archive was copied to amd-host, its SHA256 checked, and extracted outside the
checkout at `/var/tmp/reploid-native-archive9-20261012/reploid`. Normal `npm ci`
installed twelve packages; the installed CLI's `--help` exits successfully.
Independent byte comparisons verify all 95 delivery entries and all 1,974
installed Doppler files against the exact descriptor/archive. See
[verification](native-verification.json), [installation](native-install.log)
and [CLI output](native-help.log).

## Remaining acceptance

This provides the installed artifact for the separately owned native numerical
fixture. It does not prove acquisition, model preparation, inference, signed
opening, concurrency, settlement, answer quality or deployment. The accepted
application archive remains `9280ead5…`. Original source-quality rejections and
the first archive9 physical split GPU-reset failure remain in their owning
receipts. Public contributors and their transfer allowances were untouched.
