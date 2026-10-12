# First extraction boundary

The first bathroom extraction naturally ends after 247 generated tokens from 798 prompt tokens. The actual rendered official template includes the complete extraction system instruction, unchanged user question and all document passage IDs/text. The nonthinking template ends with its closed empty thinking block. No instruction or source serialization omission was observed.

The model emits comma-separated fact objects, without the requested `facts`/`operations` root object. `json.loads` rejects extra data at character 90. No calculator operation executes and no automatic parser repair is attempted.

Additional raw-output discrepancies, independent of the JSON parse failure:

- `source` contains document IDs such as `D1`, where the instruction requests passage IDs such as `D1:P1`.
- Amount `value` strings omit the currency sign and thousands punctuation required by the exact-lexeme instruction.
- The duration is emitted as `kind: days`, `value: three weeks`, contrary to the explicitly described weeks/three representation.
- No calculation operations are emitted; missing operands and operations cannot be supplied by code.

There is also a protocol-description gap: the handler restricts fact IDs to lowercase identifiers, while the model instruction merely says identifier. That gap did not cause the first failure because the output is not a JSON document, but must be described accurately rather than attributed solely to model ability. The current frozen run is unchanged.

Doppler exposes `createJsonGrammarMask` through its structured tooling entry. Its own source states that it constrains JSON object syntax, not required application fields. It would not by itself establish valid fact extraction, source attribution or a complete calculation plan. Its applicability to the ordinary distributed resident path has not been established here.

If the remaining cases reproduce this protocol failure, one possible subsequent experiment is a fully specified root schema and field meanings, with the existing syntax constraint where supported. This is a proposal only. It does not justify repairing or relabeling the current outputs, and would require a new identity, unchanged task criteria and its own acceptance.
