# Native installs on amd-host and intel-host

The native tarball (`reploid-native-0.1.0.tgz`, SHA-256 `a7462eb8…`) built from
export `f1b2fd77` was copied with the runtime archive (`2df37d88…`) to a new
directory on each contributor host, extracted, and installed with
`npm ci --no-audit --no-fund` (install scripts enabled, as in the precedent).
`remote-verify.js` then checked, without opening a GPU, peer, checkpoint store
or ledger:

- the tarball and archive hashes;
- every installed runtime file against the archive (1,984 equal on both hosts);
- the native modules present (`@roamhq/wrtc` 0.10.0, `ws` 8.21.0, `webgpu` 0.4.0);
- ordered plan admission for stages 0, 1 and 2 through the installed
  application code and runtime (layers 0-7, 8-15, 16-23).

`native-participant.js --help` also exited 0 on both hosts. Receipts:
`amd-host-install-verification.json`, `intel-host-install-verification.json`
and the `npm ci` logs. Nothing was started; no identity, cache, checkpoint or
ledger was created or opened by these steps.
