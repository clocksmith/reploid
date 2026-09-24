# Physical swarm boundary checks — 2026-09-23

## Source and scope

- Comparison release: `18b27b9fa5bc5a9d774db9e9c99836c2c12ea446`, retained by
  `baseline/public-swarm-18b27b9` and `artifacts/releases/18b27b9/source.tar.gz`.
- Archive SHA-256: `a0dd1face3a7a90e0c5fd1f4d0917c828d246b1a29f7f811175a30188ec6bab2`.
- Test surface: the normal `https://replo.id/` conversation workspace, not a demo.
- Devices: this Apple GPU Mac and the operator-supplied Suby Ubuntu physical
  machine (Intel Tiger Lake GPU, 32 GiB RAM). Suby's isolated Chrome was operated
  through a loopback-only debugging port forwarded over authenticated SSH.
  The devices exposed different observed server-reflexive NAT addresses.
- Baseline checks used deployed modules. Patched checks intercepted only the
  application library adapter and generated swarm/legacy-generation module
  responses with local source bytes. These are **local-patch physical-browser
  results, not deployment acceptance**. No inference response was substituted.
- No passwords, TURN credentials, private invitation capabilities, or signed
  artifact URL query strings are retained in evidence.

## Observations and repairs

1. Both physical browsers joined public signaling without invitation parameters.
   Unmodified startup supplied only STUN; the attempted data connection failed.
   The existing authenticated `/pool/rtc-config` endpoint successfully supplied
   expiring TURN credentials, but the swarm adapter never requested them.
2. With the local repair, both browsers opened a WebRTC data channel and displayed
   one peer. Candidate-pair statistics identified a TURN-relayed path. Joining
   alone left contribution off and requested no model weights.
3. Disconnect on Suby closed the channel. It remained stopped for the observed
   14-second interval and through reload: stored opt-out `false`, zero constructed
   peer connections, and a Connect control. Explicit reconnect restored WebRTC.
4. A private invitation on Suby had no channel to the public Mac. Giving the Mac
   the same deliberately created invitation established a private WebRTC pair.
   Returning one to public discovery left the private participant at zero peers.
5. Departed advertisements originally remained in displayed peer counts and the
   eligible provider catalog. Transport now emits disconnection and the mesh
   retires that advertisement. The physical private/public transition then
   displayed zero peers correctly.
6. A controlled ordinary chat request from Suby was explicitly approved for the
   Mac's advertised Qwen 3.5 2B supplier. It reached real Doppler loading of the
   pinned Hugging Face artifact revision
   `977d145bf2478a7fb542e6aca65030585620ca60`. Suby made no observed model-file
   requests and its storage estimate was 18,651 bytes, all IndexedDB.
7. **Generation failed:** `Timed out waiting for remote host slot response`.
   The configured request deadline is 45 seconds; the supplier was still loading.
   No assistant output was produced. The failed thread and messages remained in
   storage and appeared in the thread list after reload.
8. Timeout previously did not send cancellation, and the WebRTC message allowlist
   rejected the existing generation-cancel protocol message. Both are repaired.
   This proves cancellation dispatch/acceptance, not instantaneous GPU or loader
   termination. The contributor was stopped and its test page reloaded to retire
   the remaining cold-load work.

## Evidence and remaining acceptance

Machine-readable observations, source hashes, and Verification Worker results:
`physical-swarm-2026-09-23.json` (generated alongside this report).

Checks: 13 Node bootstrap tests; 61 focused Vitest tests across RTC configuration,
host lifecycle, WebRTC, legacy-generation threading and public-server isolation.
All three Playwright release-boundary tests passed on Chromium.
Verification Worker accepted the three modified browser modules with no errors.
Registry validation: zero unresolved issues; 18 existing modules without an
architectural blueprint remain informational. Canonical package synchronization,
layer checks, runtime configuration and browser-bundle checks passed.

Browser offline emulation alone did not sever UDP WebRTC and is not evidence of
physical network interruption. A separate test closes the real signaling socket
while that browser is offline, then restores it; its result is recorded separately
in the JSON. Both views dropped to zero peers and a data channel reopened after
restoration without clicking Connect. No router or operating-system network
interface was disabled.

Not established: successful generation, simultaneous real-model threads, actual
executed model/adapter identity, resident-weight reuse, LoRA execution, model-file
exchange from another peer, or physical layer splitting. The next execution
boundary is cold-model admission/readiness and the shared execution lifecycle;
increasing a timeout alone does not qualify those capabilities.

Component: swarm host adapter, peer transport, legacy whole-request mesh.
Intent: preserved. Boundary effects: authenticated Poolday RTC credentials are
provided through an explicit transport port; no new sharing or disclosure grants.
No new release has been deployed or pushed by this repair.
Both isolated test browsers and the SSH debugging tunnel were closed afterward.
