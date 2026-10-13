# Proposed source-row tagging treatment

Status: **proposal only; no model run**. The rejected nested/flat outputs remain immutable.

The retained flat run delivered the exact tokenizer-bound inputs. Its appended fact catalog included ID, source, kind and value but omitted the source quote. Full original passages were present earlier. The model first selected nothing, then copied incompatible facts into roles and assigned wrong passage links. `diagnose.py` reproduces these observations from raw retained output; it does not infer a serialization bug.

Two unrelated executable witnesses demonstrate real workflow coverage limits: Calculate already multiplies money by a source quantity, but the ledger schema cannot select that quantity; and two different earlier false assistant claims produce identical ledgers/reports because the renderer receives only a Boolean saying prior claims exist. Neither witness qualifies a model answer.

`proposal.json` freezes one treatment for review: model tags source-exact rows in their fixed order, a strict generic adapter maps those selections into existing calculation tools, and a final answer uses the full original ordered history plus actual tool results. No source row contains expected tags. This removes output alias/citation copying, adds explicit quantity selection through existing multiplication, and returns correction responsibility to an answer stage that actually receives the earlier claims. It may still fail model reasoning, conditions, or the unchanged aggregate budget.

All seven original histories/criteria, model policy and4096/8192/16000caps are copied unchanged into the proposal. Two new holdouts are frozen before output and stay unrun until every original task passes. Implementation and exact two-call tokenizer feasibility must be reviewed before a coordinated CPU run. No GPU or new model/download is needed. No production files changed.
