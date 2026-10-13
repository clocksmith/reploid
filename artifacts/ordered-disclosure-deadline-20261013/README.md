# Ordered disclosure deadline

Component: mesh partition chat, entry and grant owners. Intent preserved: prior requester approval cannot be silently extended at the coordinator. Boundary effects: optional absolute `disclosureExpiresAt` travels through the ordered requester/input-v3/chat path and caps the existing signed v4 claim's expiry. Legacy input and grant schemas are unchanged.

The coordinator checks the deadline before approval, after preparation and after asynchronous grant signing. Entry rejects expired inputs and streamed disclosure. Callers without an earlier requester approval retain the existing explicit coordinator approval flow.

`tests.txt` retains 70 passing focused controls, including actual requester-to-entry-to-chat signed grants, expiry while remote approval waits, and rejection before tokenization. The same test update accepts the runner's measured per-stage `stepMs` and asserts finite nonnegative totals. `worker.json` retains the actual Verification Worker result and warnings; `types.txt` and `charters.txt` retain successful library declarations and charter checks. No GPU, installed candidate qualification, deployment, or performance claim.
