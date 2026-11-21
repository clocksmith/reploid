# Circle local admission integration candidate

This candidate composes owner pairing (3038daf5d) with the Wave 1 gateway.
It is staged on PR #13 d3ec0e325 and still depends on the PR #9 policy cutover.
It neither configures a public challenge nor enables public serving.

The guest sends exact host/request/model/limit metadata while waiting.
The receiving host grants a short-lived admission release only after a slot is
available. A release is bound to the authenticated peer, exact host and
request, is single use, and cannot switch to a different provider. The slot
is temporary; invite usage and persistent settlement begin only at content
execution, after current invite and owner checks. Queued revocation creates
no release and does not spend invite quota. For a previously issued release,
revocation retires the slot and denies execution; consent already delivered
does not retroactively withdraw bytes already in flight.

The local gateway fixture composes the real SQLite pairing and invitation
stores with two simulated client identities and a synthetic answer. It neither
runs Qwen nor measures real model-weight traffic. The separate native RTC
pairing fixture exercises actual local data channels, approval and reconnect,
with no external TURN unless deliberately configured by its operator.

## Release prerequisites

The browser has no production owner-pairing caller. Its invite panel consumes
an injected owner request port, which must come from the verified desktop
session. The gateway and browser guest helper are not connected to a shipping
route. Connect them through a direct authenticated desktop RTC control port,
not a coordinator HTTP proxy that would receive plaintext. The same desktop
must own pair approval, invite redeem/reserve/content, resident execution,
quotas and receipt identity. Keep ordinary native execution owner-only; the
invite lane must verify its own recipient and capability instead of widening
generic native authorization. Add fresh-browser issuance/redeem/turn and
pending-revocation tests around that actual composition.

Physical cellular phones, relay visibility, a 0.8B result and the 27B launch
path need separate qualifying evidence. No model process, fleet host,
coordinator service or deployment was changed to run these fixtures.
