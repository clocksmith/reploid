# Ordered peer retirement settlement

Component: model partition coordination. Intent preserved: release only after actual owner cleanup and authenticated exact-attempt evidence. Boundary effect: the existing ordered peer RPC adds `retired` and `settle-accepted` operations; legacy peer mode is unchanged.

Serving retirement closes the receiver/resident attempts, sends exact authenticated cleanup receipts, and waits for acknowledgment before closing the channel. Failed cleanup or receipt acknowledgment remains charged for explicit retry. Completed ordinary cleanup requests remain retained until the coordinator acknowledges their replies, covering concurrent retirement while a reply is delayed. Channel loss alone is never cleanup evidence. Bounded tombstones reject changed route, attempt, generation and signatures without closing another conversation.

`before.txt` retains the initial retirement failures. `delayed-settle-before.txt` retains the independently identified delayed ordinary-reply failure. `after-initial.txt` is the intermediate result; `after.txt` is the final 23-control peer/automatic-isolation run. `network.txt` records 32 existing ordered-network/transport controls. `worker.json`, `types.txt` and `charters.txt` retain the actual Worker and source checks. `binding.json` binds source and evidence bytes.

Commands:

- `npx vitest run tests/unit/ordered-partition-peer.test.js tests/unit/automatic-ordered-isolation.test.js --reporter=verbose`
- `npx vitest run tests/unit/ordered-partition-network.test.js tests/unit/partition-data-channel.test.js --reporter=verbose`
- `node artifacts/ordered-peer-retirement-20261013/verify-worker.js`
- `npm run verify:library-types`
- `node scripts/verify-catscan.js`

The automatic-isolation fixture and test belong to the separate reviewer checkpoint. These controls use in-process channels and injected computation with real grant signatures; they do not qualify physical WebRTC/GPU execution or an installed deployment. HTTP adapter work is excluded from this checkpoint.
