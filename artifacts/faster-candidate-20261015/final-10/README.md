# final-10: the faster candidate's installed delivery

final-10 has the same shape as final-9 ([../../signed-completion-candidate-20261013](../../signed-completion-candidate-20261013/README.md)):

- an export of Reploid `5610260ac55c757fdb37b70b0b4fa9b9546fcf9e` (main when frozen). It carries
  preparation progress (`1f95f0b1`) and the REP-12 owner controls (`abf8973f`), which are inactive without
  an owner policy; the REP-10/REP-11 server ledger and rewards are present but not wired;
- the candidate runtime archive installed by npm and vendored;
- the signed catalog binding the Capsule and its release history;
- staged metadata, the hosting payload and the native package.

`partition-policy.json` declares `limits.maxPreparationMs` 1,200,000 and is unchanged from main. Main later
advanced to `3110c480` (browser custody key certificates), which is not in final-10.

[build-export.sh](build-export.sh) scripts attempt 1's recorded steps (`attempt-1/*.txt`, `*.json`). Each
pass's receipts are kept.

| Pass | Runtime archive | Capsule (release) | Prepared catalog | Browser bundle | Native tarball | Outcome |
|---|---|---|---|---|---|---|
| [attempt-1/](attempt-1/) | `21d054ee` | `e84a2024` (seq 7, min 7) | `2960a606...` | `10c1e9cb...` | `5417c9ce...` | refused at installed opening (closure lacked the Q/K head-norm program). The first preflight named a wrong fork Capsule and is kept as `preflight-attempt-1-wrong-fork-argument.json` |
| [pass-2-unrolled/](pass-2-unrolled/) | `21d054ee` | `5a750ed8` (seq 8, min 8) | `8d0db9f1...` | `085b4bf4...` | `c8a05ae6...` | served run 8 attempt b; superseded by the variant choice |
| **pass 3 (this folder)** | **`3b132ee7`** | **`b1527013` (seq 9 `dd837996`, min 9)** | **`8d7e5b94a12b94643ea9911a4befdc78c05c28d4891700024303a7398c29a95c`** | **`sha256:da29387cf4e0d563b61c520c9324d7d2db61d62de5bb20b49aa42a6051bae585`** (2,074 served files) | **`f822a36e...`** (descriptor `a2ee0c63...`, 163 files) | **frozen candidate; run 8 attempt c** |

## Pass 3 checks

All checks passed:

- **Preflight** ([preflight.json](preflight.json), from [preflight.js](preflight.js), a copy of final-9's with
  recorded differences):
  - runtime 1,999/1,999 files in both the npm and browser vendor copies;
  - plan admission for stages 0-2;
  - zero address matches;
  - 20 of 20 release-history cases.
- **Release history:** held checkpoints (read-only, [held-checkpoints.json](held-checkpoints.json)) are
  amd-host 8 (both native states), mac-host stage 0 at 8 and intel-host at 5. Each accepts the history 1-9.
  - Every intermediate holder (2-8) accepts it.
  - Forked sequence-1 histories are rejected.
  - The stale history ending at 8 is rejected below the minimum of 9.
- **Preflight attempt 1** ([preflight-attempt-1-holder-count-regex.json](preflight-attempt-1-holder-count-regex.json))
  stopped on the script's own holder-count regex, which counted sequences 2-7 only; all 20 cases were as
  expected. The regex was fixed and the preflight rerun on the same inputs. Staging and packaging had
  already run between the two. They read neither the runtime copies nor the catalog that the preflight
  checks.
- **Delivery verification** ([delivery-verification.json](delivery-verification.json), [verify-delivery.js](verify-delivery.js)):
  163 native, 1,999 runtime, 2,075 browser and 45 metadata files.
- **Delivery checks:**
  - the swarm label and `--room-token-file` equal `5610260a`;
  - 68 changed files since final-9's `1473eda7` are served or packaged as committed.
- **Verification Worker** ([worker.json](worker.json)): passed, with warnings retained.

The install is in [../install-10](../install-10/README.md). Physical opening: the amd-host natives and the
stage 0 profile opened Capsule 3 from their held checkpoint 8 and advanced to 9 (run 8 attempt c).
