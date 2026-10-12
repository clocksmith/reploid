# Durable file-supply allowance

The existing 4 GiB supply limit now belongs to persistent host storage, not a contribution session. Browser tabs share an origin IndexedDB ledger; native processes share a SQLite ledger in the cache directory. The existing signed custody protocol reserves the complete requested file or verified piece before reading or serving it. Reservations are never refunded after cancellation, failed transfer, failed verification, or uncertain completion. Refreshing inventory, stopping sharing, reconnecting, and reopening the host do not renew the allowance. File-sharing consent remains separate from compute consent.

New empty stores initialize zero before their first cache write. Existing nonempty caches without a ledger reject supply with `CUSTODY_BUDGET_MISSING`; they cannot infer historical usage from the old process counter. Corrupt records, unavailable persistence, changed limits, and exhausted allowances have distinct errors. Acquisition remains usable when supply persistence fails. No public supplier or existing cache was migrated, reset, or restarted. Deliberately deleting all origin/cache data, browser storage eviction, or selecting a different profile/directory is outside this persistence guarantee; the ledger is not an external identity quota or tamper-proof accounting service.

`before.log` retains the failing regression: old custody code read/served bytes despite reservation failure. `unit-after.log` records 40 passing checks, including native reopen, separate owners/processes, legacy missing records, corruption, closed storage, custody stop/reoffer, grants, integrity, and cleanup. `browser-after.log` records five Chromium checks: reload, competing tabs, missing/corrupt ledgers, actual IndexedDB abort, and signed synthetic transfers over isolated real RTC channels. These prove correctness, not transfer performance.

The first browser run (`browser-public-namespace-failure.log`) joined the existing public namespace and failed its expected-one-peer assertion after finding six. It offered no fixture inventory. Both fixture contexts closed; the fixture now uses an isolated namespace. This failure is retained rather than discarded.

`worker-verification.json` is the actual Verification Worker result for all six production sources, with exact source hashes and warnings. All six hashes were rechecked unchanged after testing. Parent owns the combined full-suite log and browser-manifest regeneration.

`native-delivery.json` binds the standard 89-file native artifact, accepted Doppler dependency unchanged. `installed-processes.json` and `installed-processes-amd.json` verify its shipped SQLite adapter outside the checkout on Mac and x128: separate processes reserve 7 of 10 fixture bytes, reject 4, then accept 3. `check-installed.mjs [delivery.json]` reproduces this bounded control; the supplied receipt must name the extracted artifact directory. No GPU or inference ran. The actual deployment allowance remains 4 GiB. No release, pin promotion, or public deployment is claimed.

## Subsequent authorized migration and physical execution

The user approved one fresh persistent 4 GiB allowance on x; exact scope is in
`migration-approval.json`. Its old cache remains intact. The new directory is
`/home/x/.local/share/reploid/public-native/cache-budget-20261012` and future
restarts reuse its ledger. Suby's separate file-sharing permission stays off.

Both native contributors now run the same installed artifact outside checkout.
The `*-installed-identity.json` receipts verify all 89 source files and identical
1,897-file runtime trees. `runtime-archive-content.json` additionally compares
every installed runtime file byte-for-byte with accepted archive `9280ead5…`.
No replacement numerical archive was adopted.

After real model-piece supply, x reserved 637,534,208 bytes. The actual contributor
process was stopped and restarted with the same cache. `x-before-restart.json`
and `x-after-restart.json` report the identical cumulative charge. It did not
renew its allowance. Native/native automatic public chat and follow-up then
completed ($36/$48) with zero requester weights in
`native-after-restart-conversation.json`. Both browser contributors were paused
for that native-only control and restored using their original profiles/consent;
the operator scripts and process records are retained. Their earlier steady
browser/browser conversation is in `steady-conversation.json`.

`x-restored-ready.json` and `suby-restored-ready.json` confirm both restored
browser processes reached Ready, and both installed native processes reported
ready with zero active reservations and zero unsettled owners. The earlier
`suby-restored.json` retains its still-loading observation. These are sampled
process/status observations, not a continuous-availability guarantee.

One request attempted during rolling preparation was rejected because the
approved placement changed; `deployed-native-conversation.json` retains it.
The old Suby browser launcher also exited on missing supply during the first
native restart; its explicit replacement is recorded. These observations prevent
claiming uninterrupted public availability from this upgrade. Later successful
requests do not erase them.

The browser repair is deployed as `68b3997b…`, with all 1,912 files verified in
the adjacent preparation-errors receipt. Native/browser opening still uses the
accepted verified-manifest path. These checks do not qualify signed Capsules,
simultaneous long prompts, complex document quality or the numerical candidate.
