# Blueprint 0x000084: Observability

**Objective:** Token tracking, mutation stream, and metrics for real-time visibility into agent behavior.

**Target Module:** `Observability`

**Implementation:** `/infrastructure/observability.js`

**Prerequisites:** `0x000003` (Core Utilities), `0x000058` (Event Bus)

**Category:** Infrastructure

---

## Overview

The Observability module provides real-time metrics on token usage, API costs, and agent behavior. It tracks usage per model/provider and calculates estimated costs.

## Key Features

1. **Token Tracking** - Input/output tokens per request
2. **Cost Estimation** - Per-model pricing for cost tracking
3. **Session/Daily Aggregates** - Usage totals with reset
4. **History Buffer** - Last 100 requests for analysis

## Interface

```javascript
// Record token usage
Observability.recordTokens({
  inputTokens: 1500,
  outputTokens: 500,
  model: 'claude-3-sonnet',
  provider: 'anthropic'
});

// Get session stats
const stats = Observability.getSessionStats();
// { input: 15000, output: 5000, total: 20000, cost: 0.12 }

// Get usage by model
const byModel = Observability.getUsageByModel();
```

## Cost Table (per 1K tokens)

| Model | Input | Output |
|-------|-------|--------|
| claude-3-opus | $0.015 | $0.075 |
| claude-3-sonnet | $0.003 | $0.015 |
| claude-3-haiku | $0.00025 | $0.00125 |
| gpt-4 | $0.03 | $0.06 |
| gpt-4-turbo | $0.01 | $0.03 |

---

**Status:** Implemented
