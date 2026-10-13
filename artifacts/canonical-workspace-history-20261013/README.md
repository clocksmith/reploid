# Transactional workspace history checkpoint

Component: conversation workspace. Intent preserved: requester-owned durable
publication is the only canonical answer writer; execution remains explicit.
This is source integration proof, not deployed or physical canonical acceptance.

`openCanonicalWorkspaceHistory` uses the existing transaction port for metadata
and authenticated publication records under one compare-and-swap writer epoch.
Original workspace and draft strings are retained unchanged. Canonical metadata
stores references with empty answer text; reopening verifies saved stage evidence
and reconstructs text. Archive retains references; removing or downgrading a
canonical reference rejects. Unknown writes fence the owner until reopen.

The opt-in workspace awaits admission before dispatch and saved projection before
notification. Its regular snapshot contains committed metadata only. Active
phase/approval is an explicitly separate ephemeral execution view. A completion
requires the exact saved terminal publication. Legacy synchronous mode remains.

Evidence:
- `source.log`: actual Doppler transitions, WebCrypto stage signatures and root
  transactions; stale writer, same-writer head race, unknown receipt, denied new
  publication after disclosure revocation, readable authenticated old answers,
  deletion rejection, delayed writes and overlapping notifications.
- `browser.log`: four GPU-disabled Chromium tests using actual IndexedDB,
  including close/reopen, retained signature corruption, immutable legacy bytes,
  and revoked disclosure without loss of readable history.
- `legacy-before.log`: retained initial regressions from an unconditional async
  yield and changed legacy error/close behavior; fixed in the owning workspace.
- `legacy-after.log` and `legacy-latest.log`: all 13 legacy workspace controls pass.
- `types.log`: library declarations pass.
- `worker.json`: actual Verification Worker, exact production hashes and warnings.

Commands use `DOPPLER_SOURCE_ROOT=/Users/xyz/deco/doppler` for source-contract
controls and the existing `canonical-publication-evidence-20261012/playwright.config.mjs`.
Host session/draft/automatic execution composition remains the next boundary.
No accepted package, catalog, public contributor or browser manifest was changed.
