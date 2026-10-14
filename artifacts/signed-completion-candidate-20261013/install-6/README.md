# Native installs of the final-6 delivery

Native tarball `a2f5a7d0…` (descriptor `0d9536c9…`, 155 files) from export `cec3ff6b`
(see `../final-6/`) was installed in new directories,
`/var/tmp/reploid-signed-completion-6-20261014/reploid`, on `amd-host` and `intel-host`.
The procedure followed `../install-5/`:

1. Copy the tarball, runtime archive `2df37d88…` and `../install/remote-verify.js` into the new
   directory, and hash all three on the host.
2. Extract the tarball and run `npm ci --no-audit --no-fund`.
3. Run `remote-verify.js` without opening a GPU, peer, checkpoint store or ledger.

On both hosts, `remote-verify.js` confirmed the tarball and archive hashes, all 1,984 installed
runtime files equal the archive, and ordered plan admission for stages 0-2 (layers 0-7, 8-15,
16-23) through the installed code. The installed `native-delivery.json` hashes to `0d9536c9…`
on both hosts. `node server/native-participant.js --help` exited 0, lists `--room-token-file`
and is identical on both hosts.

The public contributor processes (`amd-host` 4103868 and 4121371; `intel-host` 297260 and
299769) were present before any write and after the last step, and were not touched. The final-5
installs and every earlier install directory are untouched. Receipts: `*-install-verification.json`,
`*-npm-ci.log`, `*-native-help.txt`, `install-summary.json`.
