# Chat loading regression — 2026-09-21

Component: Runtime Host (`self/host/chat-session.js`).
Intent: preserved.
Boundary effects: progress callback consumption only; no Doppler numerical,
Poolday transport, permission, or scheduling changes.

The Reploid debugging workflow identified mixed callback payloads: the network
provider emits strings, while Doppler 0.6.1 emits loading records. The chat host
called `.includes()` on both. The regression test reproduced the exact reported
`message.includes is not a function` error before the fix. The host now handles
structured loader progress as local loading and checks strings before matching.

Acceptance evidence:

- 36 focused unit tests passed (chat session, conversation workspace, chat
  workspace, scheduler, Doppler provider).
- 9 charter/style tests passed; layer verification passed.
- 10 Chromium tests passed, including thread isolation, reload, contextual
  approval, and Verification Worker checks. Execution in these tests is injected.
- The host reload regression and Verification Worker test also passed against
  `https://replo.id` (2 tests, injected execution).
- Registry-audit regeneration was byte-identical on its second run. Generated
  JSON parsed, and registry validation reported zero unresolved issues.
- Firebase Hosting deployed; 807 served files verified against bundle
  `sha256:a451747a053c8af6dfb7e509d0d5f05f01ef9b6a1df025fbd131bc896b67c8c6`.
  Cloud Run was not changed.

## Actual inference check — failed separately

A fresh headless Chromium WebGPU browser loaded the real host from
`http://localhost:8000`, created a session with the default runtime (no injected
service, no swarm, no persisted history), and sent `hi` using Qwen 3.5 2B
(`qwen-3-5-2b-q4k-ehaf16`). The original callback crash did not recur. The loader
reached 24 layers, then the attempt failed after approximately 270 seconds:

```
[Embed] CPU-resident embedding gather requires a verified preloaded row; materialize a GPU or split embedding weight.
```

The answer was empty. This check does **not** establish working end-to-end Qwen
chat. The separate embedding failure originates in the pinned Doppler runtime's
`src/inference/pipelines/text/embed.js`; no numerical workaround or model
substitution was applied. The browser and session were closed after the check.
