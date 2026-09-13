# Incremental consumer checkpoint

The installed consumer uses Doppler candidate SHA-256
`f012daff99372165bd7721c9a985abe2e101eda19bf680de4479b48594b1c454`.
This is unpublished candidate code; its package version remains 0.6.1.

Installed generation, v2 reconstruction, signed peer retry/replay and request-bound
adapters pass with injected programs. Forty focused unit tests pass. Native
journal tests pass, including migration and approximately linear copying.
Three WebRTC tests failed on an upstream configuration syntax error; they passed
after its repair, now supplied by upstream commit 2cbe2fc. The retained logs
separate those results. Physical execution of this candidate remains pending.
The upstream CATSCAN validator currently reports formatting and inventory drift
in the library extraction charters; this checkpoint does not claim that gate passed.

Component: Reploid Runtime Infrastructure and Poolday Evidence Runtime.
Intent: preserved.
Acceptance evidence: installed-consumer.json, unit.log, journal logs, webrtc-restored.log.
Boundary effects: Doppler public operation v2 and native journal storage layout.
