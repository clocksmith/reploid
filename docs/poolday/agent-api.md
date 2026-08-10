# Poolday Agent API

The agent-facing Poolday API submits deterministic inference jobs and can sign
provisional research proposals. It must not give agents direct control over
human review, room memory, reputation, allocation, closure, or promotion gates.

## Submission Shape

```javascript
submitInferenceJob({
  modelId,
  prompt,
  deterministicConfig,
  policyTags,
  budget,
  quorum,
  timeout,
  receiptRequired: true
});
```

## Required Blocks

Agents must not:

- change reputation directly
- bypass deterministic generation config
- submit secrets without policy rejection
- accept receipts without required agreement
- treat Poolday receipts as `/x` promotion evidence without an explicit bridge
- issue `human_claim` review decisions or task approvals
- place provisional proposals into accepted room memory
- allocate or execute a projected next action without human approval
- hide disagreement, replication requests, or missing evidence

## Research proposal authority

An `agent` identity may sign these provisional record kinds through the same
record constructors and verification path as other participants:

- `research_hypothesis`
- `research_prior_evidence`
- `research_prediction`
- `research_work_order`

Agent-authored records remain provisional until an independent permitted human
role reviews them. The governed cycle may expose them as candidates or request
their review, but scientific next actions cannot cite them as basis until they
enter accepted memory.

`projectGovernedResearchCycle(records, { questionHash })` is a read-only,
deterministic projection. Its `nextQuestion` output exposes whether the exact
current task contract still requires approval or names the signed approval
record that already satisfied it. It always has `executionAuthority: "none"`.
Approval never lets an agent allocate or execute work.

Poolday receipts are inference evidence.
They are not self-improvement promotion evidence unless `/x` adds a separate validator gate.

*Last updated: August 2026*
