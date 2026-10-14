# Fresh qualification attempt: interrupted

Component: Reploid physical qualification fixtures. Intent preserved. Boundary
effects: isolated candidate and diagnostic processes only; public package,
contributors, model reference and resource limits unchanged.

This is the second three-host campaign for Doppler archive `2df37d88…`. It
re-ran the [first campaign](../completion-candidate-20261013/README.md) with the
repaired freeze, so that the qualification contract binds the execution-identity
graph digest. It did not finish. **It is not a qualification and produced no
reports.**

## What was frozen

The fresh expectations differ from the original in exactly one field,
`orderedContract.executionGraphHash`; [`expectations-diff.json`](expectations-diff.json)
records both hashes. The reservation, process preflights, inspector endpoints
and output path were new. Expected identities came from the first campaign's
retained load-only observations, with no additional load-only GPU run; the
unchanged harness verified live execution identities, providers and the
partition plan before any token executed. Reference, tolerance, deadlines and
the 1,420,000,000-byte allocation limit were unchanged.

## Outcome

[`interrupted-summary.json`](interrupted-summary.json) is the derived record.
Thirty-nine of the 55 required prefixes were compared and all were within
`0.001`; no numerical mismatch was recorded. During the third request both
native supervisors reached their unchanged 29-minute deadline and terminated
their providers, and the harness stopped with `Native inspector is closed`.

The run was slower than the first. The Intel stage's long prefill took 203.8 s
against 185.9 s, and its decode steps had a higher median with one far outlier.
The cause is not established. Stage timers include diagnostic evidence
persistence and controller transport, the hosts are shared with public
contributors, and no GPU-level attribution was collected.

## Cleanup

[`support-settlement.json`](support-settlement.json) records the shutdown. The
Mac resident closed normally. The AMD and Intel providers were terminated before
their residents closed, so GPU ownership for this attempt is unknown on both;
process exit alone does not establish settlement. Owned scopes are inactive,
owned ports are closed, and public contributors were not addressed.

## What is retained where

The raw capture, frozen expectations and configuration, process preflights, the
freezer, the launcher, native logs and memory receipts are kept in
operator-private storage because they carry private machine addresses. The files
here are alias-only derived copies; the summary carries the raw capture's
SHA-256. Machines are named `mac-host`, `amd-host` and `intel-host`.

## Before another attempt

Establish a coordinated device window on all three machines, and collect
execution, transport and persistence timings separately so the slowdown can be
attributed. Then repeat the correctly bound qualification with the same
deadlines. Signed installed conversations remain a later, separate gate.
