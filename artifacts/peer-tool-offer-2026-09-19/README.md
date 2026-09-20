# Peer tool offer and recovery acceptance

This increment carries the existing `reploid.tool-offer/v1` payload over an explicitly authorized WebRTC channel. Delivery creates a local preview; local evaluation, adoption, and rollback remain separate.

`report.json` binds the changed sources and generated browser bundle to the checks. The full Vitest run passed 2,650 tests with 36 skipped. After the final cancellation/verification refinements, the 75 focused checks and all 86 required Chromium checks passed. Installed-package acceptance passed all 16 checks. Registry generation was idempotent with zero unresolved issues.

The browser scenario uses real WebRTC across isolated browser contexts on this computer and handwritten candidate code. It covers refusal, delivery, reload, local evaluation, separate adoption, unfamiliar input and rollback. Protocol tests add duplication, lost acknowledgement, interruption, stale identity/contract rejection, tampering, expiry, persistence failure, withdrawn consent and close. Existing file-exchange tests cover a changed local baseline before evaluation/adoption.

The initial physical run in `../cross-device-loop-2026-09-19/local-attempt/report.json` loaded Qwen 3.5 2B through Doppler 0.6.1 on a hardware-backed Intel WebGPU adapter. It reached the unchanged 300-second task deadline before producing a candidate. That failure exposed premature checkpointing. The shared agent now exposes settlement; Work waits for borrowed operations and retains the original timeout with a checkpoint. Unit and browser tests prove this recovery boundary with a deliberately delayed provider. The repeatable real-model runner is `tests/actual-work-improvement.js`; its separate artifacts contain actual outcomes, including failures.

This increment does not establish an independently operated recipient, a model-generated successful improvement, a network advantage, or recursive improvement. The current finite FormatJson acceptance objective remains unchanged. Versioned continuing objectives and a method that influences later improvement generation remain subsequent work.

The repeated physical run in `../actual-work-improvement/2026-09-20T03-44-22-819Z/report.json` again reached the task deadline without a candidate. It then settled, preserved `Work deadline reached`, and committed a checkpoint. This confirms the repaired recovery path on actual Qwen/Doppler execution; it does not turn the incomplete task into a success.

No deployment was performed.
