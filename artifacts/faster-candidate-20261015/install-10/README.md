# Native installs of final-10 on amd-host

The procedure is `../../signed-completion-candidate-20261013/install-9`'s, using the unchanged `remote-verify.js`:

1. copy the tarball, the runtime archive and `remote-verify.js`, and hash them on the host;
2. extract, then run `npm ci`;
3. run `remote-verify.js`, which opens no GPU, peer, checkpoint store or ledger;
4. run `--help`.

Each pass went into a new directory. Public contributors 4103868 and 4121371 were untouched. intel-host
received no final-10 install.

| Pass | Directory | Tarball | Descriptor | Runtime archive (files) | Receipts |
|---|---|---|---|---|---|
| 1 (Capsule 1) | `/var/tmp/reploid-signed-completion-10-20261015/reploid` | `5417c9ce...` | `8e3b2c64...` | `21d054ee...` (1,998) | [attempt-1/](attempt-1/) |
| 2 (Capsule 2, unrolled) | `/var/tmp/reploid-signed-completion-10-20261015-2/reploid` | `c8a05ae6...` | `20057408...` | `21d054ee...` (1,998) | [pass-2-unrolled/](pass-2-unrolled/) |
| **3 (Capsule 3, rolled, frozen)** | `/var/tmp/reploid-signed-completion-10-20261015-3/reploid` | **`f822a36e4636c0bf40d9784254a261468563138c29e567c2a241e344583fd932`** | **`a2ee0c631d428b4218283c4f6e4d2b2ab69d17bd9fde326a59aaf94710de7577`** | **`3b132ee7...` (1,999 equal)** | `amd-host-*` |

In every pass `npm ci` and `remote-verify.js` exited 0, ordered plan admission passed for stages 0-2, and
`--help` exited 0 listing `--room-token-file`.
