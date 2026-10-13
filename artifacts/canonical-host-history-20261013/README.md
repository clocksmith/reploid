# Optional canonical host history

Component: host chat composition. Intent preserved; legacy `createChatSession`
remains synchronous by default. `openCanonicalChatSession` explicitly requires
canonical runtime contracts, persistent identities, CAS writer epochs and bounded
IndexedDB options. No catalog, accepted runtime pin or default activation changed.

The host composes the existing transaction adapter and library history owner.
Saved local history verification is separate from new execution authorization.
New publication requires an active attempt, committed disclosure approval and
exact stage participants; revoked or expired permission cannot admit new output.
Reading verified saved records after revocation needs no renewed disclosure.

Draft saves share the root transaction and writer fence. Existing draft validation
is reused; queued changes become visible only after persistence, preserve other
threads, and fence unknown commit outcomes. Original localStorage workspace and
draft bytes remain unchanged. Active execution is marked ephemeral in the host
view; text and terminal metadata always come from committed workspace snapshots.
Canonical controls reject legacy whole/local execution before dispatch.

Evidence:
- `source.log`: actual host session, Doppler transitions and signed stage records;
  persisted approval, recipient mismatch refusal, durable drafts, revoked grant
  and reopen without execution. Numerical steps are injected.
- `unit.log`: 39 legacy/session/workspace/draft controls pass.
- `browser.log`: five GPU-disabled Chromium/IndexedDB controls, including actual
  async host opener, legacy byte preservation, draft reopen, and unsupported
  canonical route refusal without loading any model.
- `types.log`, `worker.json`: declarations and actual Verification Worker pass;
  exact production source hashes and warnings retained.

Ordinary automatic placement/product/UI opt-in wiring is the next source boundary.
This checkpoint does not qualify installed runtime or physical canonical execution.
Generated library delivery also includes the already committed root-owned swarm
cleanup fix; no combined browser manifest is regenerated here.
