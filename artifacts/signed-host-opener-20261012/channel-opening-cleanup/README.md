# Failed primary channel cleanup

Component: peer transport. Intent preserved; native/browser host APIs and permissions unchanged.

The first physical native drain candidate threw while adapting a read-only `close` method. `connectToPeer` had already created its RTCPeerConnection but had not inserted it into the peer map. Disconnect therefore could not find it; SIGTERM left the process alive and required an explicitly retained forced stop. This was a rejected candidate, before model preparation or inference.

The owner now closes a newly allocated connection if primary channel creation throws, and preserves both errors if cleanup also fails. The regression failed before the change (close called zero times) and passes afterward. All23 tests in swarm-signaling-independence and p2p-transport-lifecycle pass. Actual Verification Worker passes with six warnings and zero errors. This proves the source ownership boundary; the corrected native artifact needs its own physical run.

The native adapter separately preserves read-only close in09a0a658, with a real installed-provider RTC smoke. Physical failure bytes and forced exit are retained under../native-drain-repair/physical-first.
