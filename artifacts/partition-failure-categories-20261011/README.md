# Partition failure categories

Component: Reploid partition coordination and transport. Intent: preserved.
Boundary effects: typed, sanitized failure reporting; no model, arithmetic,
reference, tolerance, archive pin, resource ceiling or deployment change.

Output allowance, exhausted resources, unavailable prepared capacity,
authorization denial, connection loss, request timeout and unconfirmed cleanup
have distinct bounded categories. Unknown peer exceptions remain generic.
Reservation rejection cannot expose arbitrary remote reason strings. Authorization
is verified before reporting contributor capacity.

Failed cleanup retains charged admission capacity and the old attempt's partial
answer. Its public message does not claim GPU settlement or allow continuation.
The cause remains local. Existing attempt and wire identities are unchanged;
older peers safely treat unfamiliar codes as a generic failure.

Acceptance:

- `focused-tests.log.gz`: 81 partition API, runner and data-channel tests pass.
  The signed chat-adapter failure control retains `2 3 4 ` as incomplete output,
  hides private cleanup details and retains the failed reservation.
- `full-tests.log.gz`: 2,983 tests pass; 29 existing skips remain.
- `browser-tests.log.gz`: 17 authenticated partition/chat and durable-job browser
  tests pass, including Verification Worker inspection of changed production modules.
- `installed-report.json`: detached installed library/browser consumer checks pass.
- Library layer, type and CATSCAN checks pass; generated delivery is synchronized.
- `initial-tests.log.gz` preserves the first failure: an assertion expected the old
  capacity message. It now asserts the new `CAPACITY_UNAVAILABLE` contract.

Synthetic resident arithmetic and real browser transport prove these contract
boundaries; they do not qualify model numerics or both physical placements.
The standard Doppler 0.6.27 archive remains unchanged. Browser bundle:
`sha256:892258b5366b0e82ddee4719bdab9cc99992371b5d60c02e2a6f38f474d5656d`.

Active work and remaining gates: [TODO.md](../../TODO.md).
