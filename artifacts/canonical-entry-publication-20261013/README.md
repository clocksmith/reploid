# Requester-owned entry publication RPC

Component: partition entry coordination. Intent preserved: the conversation owns
publication, while A owns execution. This is an explicitly enabled source
capability; the accepted package, catalog, public deployment and legacy v1 route
are unchanged.

The existing duplex data channel carries a bounded v2 input and v1 publication
RPC. Every call binds the admitted route, requester, thread, attempt and frozen
generation/stages/epochs. Reconciliation exposes only the durable head and that
attempt's identity, not unrelated history. The requester awaits its transaction
owner before projection/response; no canonical raw delta is delivered. Final
text must equal the saved terminal projection. Failed cancellation remains owned
for explicit close retry. Detailed signed records are not retransferred in the
final summary.

`node tests/canonical-entry-publication-source.js` exercises actual framing over
in-memory channels with an injected store. It checks commit-before-projection,
private snapshots, duplicate projection, revocation, unknown storage outcome,
close racing admission, failed cleanup retry, changed context, mismatched final
text, nonterminal completion and capability refusal. It is protocol proof, not
real IndexedDB/signature integration or physical inference qualification. Those
owners have separate earlier controls; ordinary chat/history composition follows.

`before.log` retains the initial missing-module failure. `after.log` is the
complete new source control. `legacy.log` retains 114 passing tests in five
existing suites; `types.log` retains the library declaration check. Actual
Verification Worker result and exact production file hashes are in `worker.json`
(6 warnings, no errors). No GPU was opened. Browser bundle manifest is deliberately
not regenerated; only the owned library mirror is synchronized.
