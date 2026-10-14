# Fresh qualification: complete

Component: Reploid physical qualification fixtures. Intent preserved. Boundary
effects: isolated candidate and diagnostic processes only; public package,
contributors, model reference and resource limits unchanged.

This is the third three-host campaign for Doppler archive `2df37d88…` and the
second with the repaired freeze. The [first campaign](../completion-candidate-20261013/README.md)
passed numerically but its reports were rejected for a graph-hash domain error;
the [first rerun](../completion-qualification-20261013/README.md) was interrupted
by the supervisor deadline. This run completed. Machines are named `mac-host`,
`amd-host` and `intel-host`; no file here carries a private address.

Four outcomes are kept separate.

## Numerical: pass

All 55 required prefixes were compared against the unchanged independent F64
reference and all are within `0.001`. Maximum absolute error is
`9.520044947919359e-07`. [`summary.json`](summary.json) carries the capture
hashes; the compressed capture is retained locally and is not in Git.

## Lifecycle: pass, with one thin margin

Every attempt closed on every resident, and all three residents closed with no
active, deferred-cleanup or retained-model owners. Close times were
1946 ms (Mac), 9972 ms (AMD) and
3359 ms (Intel) against the unchanged 10,000 ms limit; the AMD
close was inside the limit by under 30 ms. GPU peaks were
705,193,152 / 196,760,720 / 339,500,176 bytes, below
the unchanged 1,420,000,000-byte limit. The longest stage operation was
186.5 s against 300 s. Both native providers released their
provider and exited 0 inside their memory limits.
[`support-settlement.json`](support-settlement.json) records the shutdown.

## Evidence: reports produced and validated

The unchanged producer (`sha256:714cc204…`, the hash frozen in the
expectations) converted the capture into [`reports/`](reports/): one contract
and three partition reports, each `passed` with a complete 55-step comparison.
The contract binds execution-graph digest `sha256:9e28445d…`, the
execution-identity domain. The producer ran the exact archive's resident
qualification validators before writing. [`expectations-diff.json`](expectations-diff.json)
shows what changed from the original frozen expectations: the graph digest and
the two native machine labels, which are now aliases. Reservation, process
preflights, endpoints and output were fresh; expected identities came from the
first campaign's retained load-only observations and were re-verified live by
the harness before any token executed.

## Application: not established

These reports qualify direct resident execution on three physical hosts. They
do not prove signed application opening, peer acquisition, automatic route
selection, conversations, history, concurrency, cancellation or deployment.
Each report records `applicationQualification: false`. Public Doppler `0.6.27`
remains the accepted package.

## Timing observations

This run's Intel stage took 186.5 s for the long prefill and a median 6.2 s per
decode step, close to the first campaign; the interrupted rerun's median was
13.7 s. `amd-host.jsonl` and `suby-host.jsonl` are read-only samples of load,
temperature, CPU and GPU frequency and busiest processes, taken every five
seconds on the AMD and Intel hosts. They can show what coincided with a slowdown, not its cause.
Stage timers include diagnostic evidence persistence and controller transport;
none of this is performance acceptance.

## Next

Bind these reports into signed delivery and exercise installed conversations
through the application, measuring ordinary latency there with separate timing
boundaries. No further numerical campaign is needed for this candidate.
