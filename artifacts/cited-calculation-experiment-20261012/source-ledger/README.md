# Source-role ledger preparation

Status: adapter and primary-renderer preparation only. No model output, model qualification,
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
- Selected conditions propagate through deposit/date dependencies and remain
  attached to exact quoted passages. No selected condition means unknown
  unconditionality, not an unconditional promise.

`adapter.test.js` uses an unrelated studio estimate. It checks arithmetic,
provenance, included-charge handling, unresolved inputs, unit/scope rejection,
assistant exclusion, duplicate/unknown references and existing authorization.
`render.js` is a distinct proposed output treatment. It presents only selected
source evidence and admitted derived values, with source IDs, visible conditions
and unresolved fields. It does not consume or rewrite a failed generated answer.
It does not infer a deadline guarantee, all-in price or unconditional recommendation.
`render.test.js` includes a deliberately wrong source-role selection: its quoted
spans and arithmetic remain valid, but independent fixture criteria reject the
wrong subtotal and included/excluded interpretation. Rendering cannot grant
semantic acceptance. The output limit rejects the whole report rather than
silently truncating missing requirements.

All 17 controls pass. The actual Verification Worker checks four files and
passes with three warnings and no errors. Passing these controls does not
establish that a model chooses correct relations.

The proposed later model experiment must reuse the existing evaluator/runner,
authorized source model, exact seven ordered histories, unchanged full factual
and citation criteria, and aggregate 4096 generated/8192 prompt-plus-generated
tokens/16000 raw UTF16 limits. The original complete ordered history must reach
the model selecting source roles; catalog construction still excludes assistant
assertions as operand evidence. Every repeated prompt and any correction must
be charged. The proposed primary report replaces a later free-prose call; it does
not claim to pass the old free-prose treatment or rewrite its rejected answer.
Rendered characters must fit the remaining output-character allowance after
all raw model output; renderer output and model token counts must be reported
separately. No historical input or criterion may be changed. Conditions,
contradictions, missing information and citation entailment still require
independent review. The existing locked holdouts remain unrun.

No source experiment may launch before the active four-pair direct control
finishes, tokenizer preflight admits the complete workflow, and a concrete
candidate freeze is reviewed. This preparation is not that freeze.

Component: `reploid` application experiment. Intent: preserved.
Boundary effects: none; no production imports or Doppler computation changes.

*Last updated: October 2026*
