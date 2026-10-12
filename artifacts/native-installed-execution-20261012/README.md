# Installed native application: acquisition, execution and settlement

This exercises the previously installed, generated **85-file native application**
outside the source checkout. It retains accepted Doppler archive
`9280ead598b098f9f3ad49574a001e88c3ad4b1a433d58349e79ee0e9c01fccc`;
there is no allocation diagnostic, numerical candidate, pin change or deployment.

Application archive SHA256:
`f032431dc4416eeaa2d167d8e079c534aa45784dd42e532302aa0970e979a123`.
Installed directory:
`/var/tmp/reploid-native-installed-8n7b1i/final/reploid` on x128.
All 85 delivered files and all 1,897 installed Doppler files were freshly compared
with their respective archive identities before execution. The application's
executable source also matches the current canonical source. Dependencies use
normal package names: `@roamhq/wrtc`, `ws`, `webgpu`, and Doppler public operations.

The ordinary installed CLI ran with a new identity and empty model/cache
directories under `/var/tmp/reploid-native-installed-execution-20261012`:

```sh
node --inspect=127.0.0.1:18229 server/native-participant.js \
  --contribute --model qwen-3-5-0-8b-q4k-ehaf16 \
  --model-directory /var/tmp/reploid-native-installed-execution-20261012/weights \
  --cache-directory /var/tmp/reploid-native-installed-execution-20261012/cache \
  --identity-file /var/tmp/reploid-native-installed-execution-20261012/identity.json \
  --rtc-module @roamhq/wrtc --ws-module ws --gpu-module webgpu \
  --signaling-url ws://127.0.0.1:18200/swarm
```

The owned 18200 tunnel reaches the existing Mac application's discovery service.
The Mac browser supplier sends model pieces over authenticated custody. Suby's
browser retains input partition A; native participant
`peer:edd5c926ab3390d22f9274bc` executes output partition B. File supply remains
off: compute consent does not enable sharing. The inspector observes state and
memory only; it does not invoke model execution or inject requests. Ordinary UI
actions own requests, disclosure, cancellation and follow-up.

`preflight.json` and `mapped-provider.json` identify installation, dependencies
and the actual native libraries mapped by this process. The subsequent receipts
record acquisition, UI outcomes, resident settlement and process shutdown.

## Result

The installed host acquired **75 assigned pieces, 307,887,776 verified bytes**
from the browser supplier. Its cache contains those pieces plus two pinned
metadata files; the approved source directory remains empty. Every completed
custody receipt matches retained bytes. `complete-acquisition.json.gz` retains
all unique signed receipts extracted from the full log; the live file snapshot
intentionally retains only a bounded recent subset.

The ordinary UI returned **$36, $48, $60 and $72** for the successive ticket
questions. Both concurrent attempts were actually executing before one was
cancelled; its partial answer remained cancelled while the other completed.
A subsequent request succeeded with the same resident weights. Final read-only
UI verification retains all 23 previous threads and drafts, no HTTP model-weight
requests, and only the two-byte checkpoint index in requester OPFS. These are
specific short-answer outcomes, not document-quality qualification.

All **13 native reservation records** from the complete sequence and earlier
harness runs settled with null failures; active reservations and pending file
work were zero. Resident weight bytes stayed **285,497,344**. Public pool
accounting reported a **335,382,784-byte peak**; this is not full device allocation,
process RAM or a new long-prompt test. `settled.json.gz` and `settled-memory.json`
retain those observations.

After settlement, SIGTERM caused model unload and explicit owned-device
destruction. The installed CLI exited naturally with status zero. The owned
18200 tunnel closed; the unrelated public contributor and existing application
sessions stayed running. `shutdown.json`, provider identities and raw-log hash
remain inspectable.

## Retained harness failures

The first controller expected the nonexistent status `running` while the real
attempt was `executing`. The next checked the survivor immediately after
approval, while it was still queued; the corrected controller waits for actual
execution before cancellation. Both failed receipts and their owned request
cleanup are retained.

The completed controller then failed its final draft assertion because an absent
old empty draft had materialized as `{text: '', files: []}`. The final read-only
verification accepts only that empty default and rechecks the unchanged histories,
answers, cancellation and requester storage. It does not regenerate or rewrite
model output. See `UI-final-verification.json` and its preceding `UI-*` receipts.

Scope remains the catalog's current manifest opening. This is not signed Capsule
physical qualification, both native placements, document-quality acceptance,
long-prompt concurrency, a numerical pass or release promotion. Earlier
[installation-only evidence](../native-delivery-20261012/README.md) and its failed
observations remain retained; this run closes the separate actual-execution gap.
