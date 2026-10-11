# Mac/Linux introduction acceptance

Component: peer transport and ordinary product host composition. Intent preserved.
Boundary effects: optional remote browser support in the existing introduction test;
no runtime, wire protocol, model policy or production configuration changes.

All three existing introduction browser scenarios pass across the Linux machine
and Mac identified in `bindings.json`, serving committed **7c8224c3** browser bytes.
`playwright-report.json` retains the results and attached observations;
`execution.txt` retains the invocation output. The existing physical-browser CDP
helper and SSH forwarding mechanism provide control and the same fixture assets.
No second hardware test harness or server implementation was added.

- Linux introducer B connects Mac A and Linux C. After B disconnects, A and C
  retain message delivery and a reliable auxiliary custody-channel byte echo.
- Relay-only policy with no configured relay rejects the connection. The test
  preserves that restriction rather than introducing another relay or relaxing ICE.
- Two ordinary product hosts discover each other through the explicit replaceable
  bootstrap port and independent ICE configuration. All external HTTP requests are
  blocked; no company endpoint is fetched. Compute and file sharing remain off,
  including after introduction assistance is separately enabled.

These are two physical hosts operated by one operator over the available private
network. They do not qualify arbitrary internet NATs, a public bootstrap endpoint,
WebRTC Direct, distributed model correctness, or generation quality. Initial
introduction delivery is an explicit test-host port. The supplied route proves
host composition; it does not create a default production participant.

The spec reuses `REPLOID_EXECUTOR_WS` and `REPLOID_EXECUTOR_CDP=1` for the remote
browser, placing its second context there. `REPLOID_INTRODUCTIONS_PORT` fixes the
existing fixture server port for SSH reverse forwarding. Without these inputs,
its original same-machine coverage remains available. Run the existing
`tests/e2e/peer-introductions.spec.js` with the Chromium project and
`REPLOID_E2E_SKIP_LOCAL_SERVER=1`; preserve endpoint ownership and close the owned
Mac profile and SSH tunnel afterward. Both were closed and profile removal was
verified for this run.
