# Available-family correction: boundary fixed, workflow rejected

Removing unavailable calendar operations fixed the first structural failure.
D1 naturally produced money-only JSON and the existing calculator executed two
exact operations: 25% of $8,400 is $2,100, then $8,400 minus $2,100 is $6,300.
Those are the model's actual selections, not inserted expected answers. They do
not establish the required $1,600 budget headroom or a correct complete response.

D2 naturally generated a request missing the schema's required nullable
`multiplier` fields. The validator rejected `Invalid money term`. Its single
correction again omitted those fields. It also selected the included $500
allowance as an addition and a date alias as a money amount; the correction
changed the date term's sign without fixing its type. Neither failed request
executed, and no compatible subset or final answer was manufactured.

| Call | Prompt tokens | Generated tokens | Disposition |
| --- | ---: | ---: | --- |
| D1 initial | 946 | 68 | EOS; exact calculator succeeds |
| D2 initial | 1,031 | 67 | EOS; validator rejects |
| D2 correction | 1,164 | 67 | EOS; validator rejects |

Total charge: 3,343 prompt-plus-generated tokens and 609 raw UTF-16 units.
The observed CPU process lasted 176.390173 seconds and exited 0 as a completed
harness run. This is not a controlled performance measurement or an accepted
model configuration. D3, the remaining six cases and both locked holdouts were
unrun. No complete factual/citation requirement was established.

The description calls a multiplier optional while the JSON contract requires an
explicit nullable field. That is interface friction, but allowing omission alone
would still leave wrong-type and included-charge selections. No further format
candidate or model run followed this rejection.

[Review](review.json) preserves the full unchanged criteria, actual selections,
failed calls and unrun dispositions. [Run binding](run-binding.json) and
[host identity](executing-host-identity.json) bind the exact original checkpoint,
command, CPU affinity and pre-output freeze. [Raw identities](raw-identities.json)
bind complete `result.json.gz`, all three per-call receipts and `run.log.gz`.
Originals remain on x128 at the directory in the run binding.

The schema/validation correction is artifact-only. The original1.7B source
workflow remains rejected; nothing qualifies deployed0.8B, converted weights,
installed runtime or distributed release. Numerical/runtime work and simple
chat acceptance remain separate. No production package, UI or policy changed.
