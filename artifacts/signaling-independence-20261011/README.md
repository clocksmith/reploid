# Physical signaling independence

Component: Peer Transport and Verification Evidence. Intent: preserved.
Boundary effects: test-owned signaling faults and passive transport observations;
no model arithmetic, production transport, permissions or package changes.

This batch extends the existing two-host application journey with
`node scripts/test-distributed.js --local --signaling-only`; `--reverse` selects
the opposite placement. Reversed-placement completion is not yet established.
This is a scoped transport diagnostic, not numerical, complete
application or deployment acceptance. Both hosts use the standard 0.6.27 archive
and browser bundle `sha256:892258b5366b0e82ddee4719bdab9cc99992371b5d60c02e2a6f38f474d5656d`.

The diagnostic blocks the configured signaling WebSocket and its retries during
selective acquisition, then removes remaining signaling routes during real
generation. It requires EOS completion under the same attempt, another request
through the surviving channels, and failure of active work after an explicit
contributor disconnect. Model origins remain blocked for contributors; the
requester downloads no weights. No checkpoint or transparent restart is used.

## Preserved failed attempts

- `initial-setup-failure.json` and `initial-setup-exception.json`: the first fault
  injector watched `/signaling`, while the application used the configured
  `/swarm` endpoint. No outage was injected. The failed run's teardown was
  interrupted after its exception and state were retained.
- `interrupted-run.json` and `interrupted-run-report.json.gz`: acquisition and
  generation continued with signaling unavailable, but the test waited on an
  unbounded UI action. The test was interrupted; this is not a passing result.
- `hidden-control-failure.json`, `hidden-control-state.json.gz` and
  `hidden-control-run.log.gz`: bounded waits localize the stalled action to the
  hidden disconnect switch. All three conversations completed. The fixture now
  selects the Participants section before starting the disconnect control.
- `dialog-fixture-failure.json` and `dialog-fixture-run.log.gz`: a stale
  `aria-expanded` assumption caused the fixture to click the opener underneath
  an already-open dialog. It now tests actual dialog visibility. The corrected
  interaction passes the desktop/mobile UI tests before physical repetition.

These are harness corrections, not evidence of a production transport defect.
No acceptance assertion was removed. Phase checkpoints now precede and follow
the fault and generation actions, and UI actions have bounded waits.

## Historical acquisition boundary

`historical-acquisition-trace.json` is derived from the original retained failed
capture. The Mac initially received a supplier offer with three connected peer
entries. When shard 1 failed, only one peer with an empty inventory remained.
The original capture lacks the triggering socket/ICE/timeout event. Successful
retries and induced signaling loss cannot establish that historical cause.
Checklist item 10 therefore remains open.

The existing passive observer now captures peer-retirement call sites, channel
and ICE states, signaling state, manual-stop state and heartbeat age. It retains
neither SDP nor credentials. It does not change liveness or authorization rules.

## Other validation

- `focused-tests.log.gz`: 12 transport lifecycle, signaling and credential tests pass.
- `browser-tests.log.gz`: 18 browser introduction/custody tests pass, including
  Verification Worker coverage.
- `ui-tests.log.gz`: 10 UI tests pass, covering dialog reopening and switching
  from Device to Participants on desktop and mobile widths.
- Layer/delivery verification, public declaration type checking, CATSCAN,
  JavaScript syntax and diff checks pass.

## Qualified Linux configuration

[linux-physical-receipt.json](linux-physical-receipt.json) records a passing real
GPU application run: Chrome 146.0.7680.177, AMD RDNA 3, one physical Linux GPU,
four isolated browser contexts including two contributors. This is not a
two-host or combined-capacity result.

Selective acquisition completed after its signaling route was closed, with
contributor origins blocked and no requester weight requests. After all remaining
signaling routes and retries were blocked, generation completed with EOS under
the same attempt identity. Each contributor opened one resident. Recorded GPU
buffer peaks were 497,336,720 and 862,828,944 bytes, each below 1,420,000,000.

The next request began through the surviving channels. Explicitly disconnecting
one contributor failed that active attempt. Its cleanup remained unconfirmed and
capacity stayed unavailable; the test does not claim remote settlement after a
lost connection. There were no captured page errors. Expected RTC channel errors
were logged at explicit disconnect. Full result, exit state and command output
are retained as `linux-physical-{result,state}.json.gz` and
`linux-physical-run.log.gz`.

This closes checklist item 11 for the tested Linux configuration alongside the
retained authenticated browser and liveness controls. It does not close numerical,
original acquisition-cause, two-placement application or release acceptance.

## Interrupted two-host qualification

`host-unavailable.json` and `host-unavailable-run.log.gz` preserve the final
Mac/Linux attempt's observable boundary. The Mac became unreachable over SSH and
VPN before its final result could be retrieved. The host's disappearance is not
attributed to application signaling. Earlier two-host attempts establish scoped
positive acquisition/generation behavior but failed their UI test controls.
Neither final two-host passage nor reversed placement is claimed here.


## Recovered Mac result

The host is reachable again. [recovered-mac-failure.json](recovered-mac-failure.json)
records the retrieved final result: acquisition and same-attempt EOS completion
passed, but the next request could not start because no prepared contributor
path remained. The explicit-disconnect assertion was not reached. Mac channels
closed at 01:18:54 UTC; its power log records Clamshell Sleep at 01:18:59 UTC.
This supports suspension as the interruption cause for this run. It does not
explain the earlier item 10 acquisition failure. Compressed result, exit state
and command output are retained under `recovered-mac-*`.

Fresh two-host controls run with `caffeinate -i` around the existing runner to
prevent idle system sleep. This does not change application liveness rules or
promise operation while the laptop is suspended.


## Reversed Mac/Linux placement

[reverse-receipt.json](reverse-receipt.json) passes on two physical hosts with
Mac and Linux roles reversed. Both selective acquisitions completed, generation
reached EOS in the same attempt after signaling loss, and a trusted pointer
activation disconnected the contributor and failed active work. Remote cleanup
remained explicitly unconfirmed. Each contributor loaded one resident; there
were no requester weight requests, contributor origin requests or page errors.
Buffer peaks stayed below the unchanged per-contributor ceiling.

The earlier awake ordinary-placement run remains failed:
[awake-click-failure.json](awake-click-failure.json). Its pointer action returned
but the switch stayed Connected and the request completed. It captured no input
event trace, so it does not establish whether the UI received the intended click.
Subsequent runs retain bounded trusted-click targets and switch action snapshots.
The reversed pass does not erase this failure or qualify full application release.


## Both physical placements now pass the transport control

[normal-receipt.json](normal-receipt.json) retains the passing ordinary-placement
repeat with trusted input capture. Acquisition and same-attempt EOS generation
survive the signaling outages; explicit disconnect receives a trusted click,
switches the control off, and fails the next active request. Each contributor
loads one resident and stays below its GPU buffer ceiling. No page errors,
requester weight requests or contributor origin requests were observed.

Together with the reversed receipt, this qualifies the scoped signaling control
in both Mac/Linux placements. The earlier awake pointer failure remains retained
and unexplained; this repeat does not retroactively establish why that activation
did not take effect. Full application, numerical and deployment acceptance remain
separate and open.
