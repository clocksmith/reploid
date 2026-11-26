# Promotion Contract

**Classification:** Index & Meta Contract

`Promote` ([`self/tools/Promote.js`](../tools/Promote.js)) is the model-visible request path for durable `/self` changes on every surface that exposes it: Reploid, and X at the `reflection` level or higher ([`shared/config/tool-surfaces.js`](../../shared/config/tool-surfaces.js)).

One exception exists in code. In minimal Zero/X (`spark`), which has no `Promote`, `CreateTool` installs a verified, replayed new tool directly at `/self/tools/<Name>.js` without calling `Promote`. It refuses existing or protected targets ("requires promotion") and quarantines validator targets. See [`tool-contract.md`](tool-contract.md) and `activateZeroTool` in [`self/core/create-tool.js`](../core/create-tool.js).

## Authority

Evidence makes a promotion eligible; it does not grant it. Model output, candidate scores and Arena results never grant activation permission ([`INTENT.md`](../../INTENT.md): evolution requires independent evaluation and operator adoption within explicit, reversible grants). In code, `Promote` runs only when the host authorizes it: the default Reploid self authorization in [`self/tool-authorization.js`](../tool-authorization.js) allows only `ReadFile` and `WriteFile`, and the tool runner asks the HITL controller for approval of `Promote`, `CreateTool`, `WriteFile` and the other critical tools when an approval mode other than `autonomous` is configured (`CRITICAL_TOOLS` in [`self/core/tool-runner.js`](../core/tool-runner.js)). Validator mutations are rejected by `Promote` as requiring external review.

## Required Inputs

- Candidate path under `/shadow`.
- Target path under `/self`.
- Evidence path under `/artifacts`.

## Default Behavior

- Deny missing candidates.
- Deny missing evidence.
- Deny direct `/self` writes from ordinary model tools.
- Leave `/self` unchanged on denial.
- Return machine-readable approval or rejection reasons.
- Preserve the prior target bytes and hash before replacing an existing target.
- Write rollback metadata under `/artifacts/promotions/<promotion-id>/` before changing `/self`.
- Fail promotion if rollback evidence cannot be persisted.

Runtime-profile promotion is two-stage: `Promote` installs the exact staged bytes after human approval, then Doppler reruns the frozen canary contract. Canary rejection restores the previous active-profile pointer and records the rollback reason.

*Last updated: November 2026*
