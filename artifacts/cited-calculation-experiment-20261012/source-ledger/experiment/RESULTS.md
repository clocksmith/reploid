# Source-ledger treatment: rejected

The first model call reached natural EOS after 49 generated tokens within the
unchanged budget. It returned document IDs rather than the required document
ledger objects. The strict adapter rejected this as `Unexpected document ledger
fields`, before arithmetic or rendering. No answer was repaired or retried.

The exact official-template input includes the full typed tool schema and all
original ordered messages. Input IDs match tokenizer admission. The failure is
an observed invalid model selection; there is no established serialization or
calculator bug. Six later cases remain **unrun**, per the predeclared stopping rule.
This is 0 accepted tasks from 1 attempted call, not seven factual rejections.

Accounting: 3218 prompt tokens +49 generated =3267 charged tokens; 145 raw UTF16
units, zero rendered characters. Process elapsed 94.217 seconds, including
source loading and prefill; no performance claim. Both owned processes exited,
and no GPU was used.

`review.json` binds the exact failed call, full result/log and unchanged criteria.
`source.json.gz` retains original messages, executed schema, raw token IDs and
validator failure. Earlier narrative/tool failures remain intact. The treatment
is not eligible for production or converted/runtime qualification. No further
candidate was launched.
