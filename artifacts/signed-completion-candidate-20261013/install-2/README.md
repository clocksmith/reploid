# Native installs of the rebuilt delivery (final-2)

Native tarball `845b84bb…` from export `d7931c57` (see `../final-2/`) installed
in new directories on `amd-host` and `intel-host` with `npm ci --no-audit
--no-fund`, then checked by `../install/remote-verify.js` without opening a
GPU, peer, checkpoint store or ledger: tarball and archive hashes, all 1,984
runtime files equal to archive `2df37d88…`, native modules present, and
ordered plan admission for stages 0-2 through the installed code. The
installed transport admits `reploid-partitions-ordered`, and the CLI's
`--help` exits 0. The earlier installs from `../install/` are superseded.
