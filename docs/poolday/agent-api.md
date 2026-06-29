# Poolday Agent API

The agent-facing Poolday API submits deterministic inference jobs.
It must not give agents direct control over reputation or promotion gates.

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

Poolday receipts are inference evidence.
They are not self-improvement promotion evidence unless `/x` adds a separate validator gate.

*Last updated: June 2026*
