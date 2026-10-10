# Bounded peer introduction checks

Component: `reploid.transport`. Intent: deliberately extended to carry authenticated,
encrypted introductions through existing peers and explicit host bootstrap ports.
Boundary effects: host composition and separate introduction-assistance consent;
Doppler computation, artifact-sharing permission and compute grants are unchanged.

Acceptance on the candidate with browser bundle
`sha256:a22c232a379ace6850b57b002f5060f179bb282b9c3ce940a072fd7dafc6e599`:

- `npm test`: 2,976 passed, 29 skipped (274 files passed, 3 skipped).
- `npm run verify:layers`, `npm run verify:library-types`, `npm run verify:catscan`: passed.
- `npx playwright test --config tests/playwright.config.js tests/e2e/peer-introductions.spec.js tests/e2e/peer-pack-jobs.spec.js --project=chromium`: 18 passed.
- `node tests/library-package-acceptance.js`: detached installation, public browser/Node imports,
  consumer pages, installed work lifecycle and Verification Worker passed; report retained here.

The introduction browser test uses three isolated contexts, real WebRTC data channels,
a failed entry-point route followed by an independent participant, and blocked company
signaling. Peers exchange signed contact records and encrypted signaling through the
introducer, establish their own channel, then retain message and custody traffic after
its removal. Bootstrap delivery is a test host port, not a deployed public endpoint.
A relay-only configuration without relay service rejects the connection within its
bound. This is a controlled restriction, not qualification across physical NATs.

Unit tests include private-room capability verification, wrong recipients, altered
records, replay, expiry, rollback, permission denial, cancellation during admission
and connection setup, bounded queues and route failover. Introduction assistance is
separate from compute and file sharing. Revoking it prevents further assistance.

This evidence does not establish distributed model correctness, signed-Capsule
physical execution, WebRTC Direct support, public bootstrap availability, or deployment.
Numerical acceptance and the ordinary application journey remain pending. The earlier
acquisition disconnect has not been causally attributed to signaling closure.

Earlier browser attempts failed on obsolete nested-document selectors. Those were
corrected to the existing summary and permission-preview controls before the passing
run; no product acceptance requirement was removed.
