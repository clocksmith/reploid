# Multi-Model Evaluation

Multi-model evaluation runs the same task suite across multiple model configs and scores outputs. It is a lightweight harness for comparing quality, latency, and schema compliance.

---

## Module

**Path:** `core/multi-model-evaluator.js`
**Capability shim:** `capabilities/intelligence/multi-model-evaluator.js`

**Primary API:** `evaluate(tasks, modelConfigs, options)`

---

## Task Format

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Optional stable task identifier |
| `prompt` | string | Prompt text when `messages` is not provided |
| `messages` | array | Chat messages array for LLMClient |
| `schema` | object | JSON schema for SchemaRegistry validation |
| `expected` | string | Expected output or substring for matching |
| `matchMode` | string | `exact` or `contains` matching mode |
| `chatOptions` | object | Optional LLMClient chat options |

---

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `modelConcurrency` | number | `2` | Max concurrent model evaluations |
| `matchMode` | string | `contains` | Output match mode if task does not define one |
| `lengthTarget` | number | `400` | Target output length for scoring |
| `scoreOutput` | function | - | Custom scoring hook |
| `timeoutMs` | number | `0` | Per-task timeout in milliseconds (0 disables) |
| `abortOnError` | boolean | `false` | Stop remaining tasks for a model after first error |
| `persist` | boolean or object | `false` | Persist runs to VFS for replay |

---

## Results

`evaluate()` returns:

- `runId` - Unique evaluation run id
- `totals` - Task and model counts
- `summary` - Per-model aggregates
- `models[].results` - Per-task scoring and timing data

---

## Persistence and Replay

Persistence stores runs under `/.memory/multi-model-eval/` when VFS is available.

Persist options:
- `persist.includeInputs` - Store tasks and model configs (default: true)
- `persist.includeOutputs` - Store per-task outputs (default: true)
- `persist.includeOptions` - Store evaluation options (default: true)
- `persist.path` - Override run file path

Replay helpers:
- `listRuns(limit?)` - List stored runs
- `loadRun(runId)` - Load a stored run
- `replayRun(runId, options)` - Re-run the stored inputs

Example:

```javascript
const result = await MultiModelEvaluator.evaluate(taskSuite, modelConfigs, {
  persist: true
});

const runs = await MultiModelEvaluator.listRuns(5);
const replay = await MultiModelEvaluator.replayRun(runs[0].runId, {
  modelConcurrency: 1
});
```

---

## Events

| Event | Payload |
|-------|---------|
| `multi-model:eval:start` | `runId`, counts |
| `multi-model:eval:progress` | `runId`, `modelId`, `taskId`, progress |
| `multi-model:eval:complete` | `runId`, duration, summary |

---

## Example

```javascript
const taskSuite = [
  {
    id: 'schema-task',
    prompt: 'Return JSON: {"ok": true}',
    schema: {
      type: 'object',
      required: ['ok'],
      properties: { ok: { type: 'boolean' } }
    }
  },
  {
    id: 'expected-task',
    prompt: 'Say hello to Reploid',
    expected: 'hello'
  }
];

const modelConfigs = [
  { id: 'fast', provider: 'openai', modelId: 'gpt-4.1-mini' },
  { id: 'deep', provider: 'anthropic', modelId: 'claude-3-7-sonnet' }
];

const result = await MultiModelEvaluator.evaluate(taskSuite, modelConfigs, {
  modelConcurrency: 2,
  matchMode: 'contains'
});
```

---

## Notes

- Schema validation uses SchemaRegistry when available.
- Timeouts are not enforced by default. Set `timeoutMs` for per-task limits.

---

*Last updated: January 2026*
