# Native installs of the final-3 delivery

Native tarball `fcacf463…` from export `9b42f5ee` (see `../final-3/`)
installed in new directories on `amd-host` and `intel-host` with `npm ci
--no-audit --no-fund`, then checked by `../install/remote-verify.js` without
opening a GPU, peer, checkpoint store or ledger: tarball and archive hashes,
all 1,984 runtime files equal to archive `2df37d88…`, and ordered plan
admission for stages 0-2 through the installed code. The installed CLI's
`--help` lists `--room-token-file`. Installs from `../install/` and
`../install-2/` are superseded.
