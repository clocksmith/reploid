# Source-role ledger preparation

Status: adapter preparation only. No model output, model qualification,
production integration or release acceptance exists for this treatment.

The previous typed request allowed the model to assemble arithmetic expressions.
Its retained failure used a date as money, added an included allowance and omitted
required expression fields. The direct source control separately produces false
calendar calculations and unsupported clause conflicts. Those failures remain
unchanged.

This adapter changes the application contract: the model selects source literal
IDs for price roles and source passage IDs for explicit relations. It never
provides numbers, calculated answers, arithmetic operations or replacement text.
The existing `calculate.js` and authorized tool runner perform the calculations.
The catalog excludes assistant assertions. It retains exact source text and
literal spans, including the original user's budget and deadline.

- Base, additional charges and credits determine the known subtotal.
- Included amounts and deposits never increase that subtotal.
- The selected user budget minus the subtotal determines remaining headroom.
- A selected percentage and its source base determine the deposit.
- A selected start and duration determine the calendar result using the existing
  calculator's explicit year-ambiguity rejection.
- Missing selections, conflicting price roles and explicitly unsettled operand
  IDs keep their dependent results unresolved. An all-in total is never inferred.
- A counted price operand explicitly labeled included, excluded or conditional
  cannot enter an unconditional subtotal/headroom. Non-counted included
  allowances retain their source provenance without inflating the price.
- Relations retain complete selected source passages. Exact quotation establishes
  provenance, not semantic entailment or completeness.

`adapter.test.js` uses an unrelated studio estimate. It checks arithmetic,
provenance, included-charge handling, unresolved inputs, unit/scope rejection,
assistant exclusion, duplicate/unknown references and existing authorization.
All 12 controls pass. The actual Verification Worker passes with three warnings
and no errors. Passing these controls does not establish that a model chooses
correct relations.

The proposed later model experiment must reuse the existing evaluator/runner,
authorized source model, exact seven ordered histories, unchanged full factual
and citation criteria, and aggregate 4096 generated/8192 prompt-plus-generated
tokens/16000 raw UTF16 limits. Every repeated prompt and any correction must be
charged. The final call must receive the original complete ordered history plus
the retained ledger, without editing prior answers or repairing model output.
Conditions, contradictions, missing information and citation entailment still
require independent review. The existing locked holdouts remain unrun.

No source experiment may launch before the active four-pair direct control
finishes, tokenizer preflight admits the complete workflow, and a concrete
candidate freeze is reviewed. This preparation is not that freeze.

Component: `reploid` application experiment. Intent: preserved.
Boundary effects: none; no production imports or Doppler computation changes.

*Last updated: October 2026*
