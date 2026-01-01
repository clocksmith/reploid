# FunctionGemma Integration for REPLOID

> Multi-FunctionGemma network orchestration layer

**Status:** Research / Design Phase
**Dependency:** DOPPLER inference engine (see `feature-log/doppler/inference.jsonl`)
**Last Updated:** December 2025

---

## Overview

This document covers how REPLOID orchestrates multiple FunctionGemma instances running on the DOPPLER WebGPU inference engine. The underlying infrastructure (KV caching, LoRA loading, buffer pools, attention kernels) is implemented in DOPPLER.

Current Doppler primitives available for integration:
- `MultiModelLoader` (base + LoRA adapters)
- `MultiPipelinePool` (parallel expert pipelines with locking)
- `MultiModelNetwork` (topology execution + combiner)
- `MultiModelRecorder` + `prefillKV` / `prefillKVOnly` (shared prefix KV)

**Architecture:**
```
┌─────────────────────────────────────────────────────────────┐
│                      REPLOID                                 │
│  (Orchestration, Routing, Evolution, State Management)      │
├─────────────────────────────────────────────────────────────┤
│                      DOPPLER                                 │
│  (WebGPU Inference, KV Cache, LoRA, Buffer Pools)           │
└─────────────────────────────────────────────────────────────┘
```

---

## Module Integration

| FunctionGemma Component | Reploid Module | Integration Strategy |
|-------------------------|----------------|----------------------|
| Router FnG | SemanticMemory | Embed tasks, map to `ExpertNode` set for `MultiModelNetwork` |
| Expert Pool | ArenaHarness | Run experts via `MultiModelNetwork.executeParallel` / `MultiPipelinePool` |
| KV Cache Sharing | ContextManager | Hold `KVCacheSnapshot` from `prefillKV`/`MultiModelRecorder` and reuse with `generateWithPrefixKV` |
| Genetic Evolution | ArenaHarness + ReflectionStore | Evaluate genomes via `MultiModelNetwork.executeGenome`, persist winners |
| Combiner | SchemaRegistry | Validate merged outputs + use `MultiModelNetwork.combineOutputs` |
| Self-Adaptation | ReflectionStore | Track adapter success rates to choose `MultiModelLoader` adapters |

---

## 1. Router Integration with SemanticMemory

SemanticMemory already provides MiniLM embeddings for similarity search. Reuse for expert routing:

```javascript
// reploid/core/semantic-memory.js - extension

class SemanticMemory {
  // Existing: embed and search memories
  async embed(text) { /* ... */ }
  async search(query, k) { /* ... */ }

  // NEW: Route task to FunctionGemma experts
  async routeToExpert(task, experts) {
    const taskEmbed = await this.embed(task.description);

    // Compute similarity to each expert's specialization
    const scores = await Promise.all(experts.map(async expert => {
      const expertEmbed = expert.embedding || await this.embed(expert.specialization);
      expert.embedding = expert.embedding || expertEmbed; // cache for future routes
      return {
        expert,
        score: this.cosineSimilarity(taskEmbed, expertEmbed)
      };
    }));

    // Return top-k experts
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, task.topK || 1).map(s => s.expert);
  }
}
```

---

## 2. Expert Pool via ArenaHarness

ArenaHarness runs multiple LLM candidates and selects the best. Extend for FunctionGemma experts:

```javascript
// reploid/infrastructure/arena-harness.js - extension

class ArenaHarness {
  // Existing: run candidates, vote on winner
  async runArena(prompt, candidates) { /* ... */ }

  // NEW: Run FunctionGemma expert pool
  async runExpertPool(task, experts, network) {
    const tasks = experts.map(expert => ({
      id: `${task.id}:${expert.id}`,
      expertId: expert.id,
      prompt: task.prompt
    }));

    // Execute in parallel via MultiModelNetwork + MultiPipelinePool
    const outputs = await network.executeParallel(tasks, {
      maxTokens: task.maxTokens
    });

    const scored = await Promise.all(experts.map(async expert => {
      const output = outputs[`${task.id}:${expert.id}`];
      const score = await this.evaluateOutput(output, task);
      return { expert, output, score };
    }));

    // Select winner(s)
    scored.sort((a, b) => b.score - a.score);
    return scored[0];
  }

  async evaluateOutput(output, task) {
    let score = 0;

    // Syntax validity
    const parsed = this.safeParseJson(output);
    if (parsed) score += 0.3;

    // Schema compliance
    if (task.schema && parsed && this.validateSchema(parsed, task.schema)) {
      score += 0.4;
    }

    // Test pass rate (if tests provided)
    if (task.tests && parsed?.code) {
      const results = await this.runTests(parsed.code, task.tests);
      score += 0.3 * (results.passed / results.total);
    }

    return score;
  }

  safeParseJson(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
}
```

---

## 3. Context Sharing via ContextManager

ContextManager handles conversation context. Extend with KV cache prefix support:

```javascript
// reploid/core/context-manager.js - extension

class ContextManager {
  // Existing: manage conversation context
  constructor() {
    this.messages = [];
    this.kvPrefixCache = null;  // NEW: shared KV cache
  }

  // NEW: Initialize shared prefix for FunctionGemma network
  async initSharedPrefix(doppler, systemPrompt) {
    this.kvPrefixCache = await doppler.prefillKV(systemPrompt);
  }

  // NEW: Get context for specific expert
  getExpertContext(expertId) {
    if (!this.kvPrefixCache) {
      throw new Error('Shared prefix not initialized');
    }

    const expertPrompt = this.getExpertPrompt(expertId);
    return { prefix: this.kvPrefixCache, expertPrompt };
  }

  getExpertPrompt(expertId) {
    const prompts = {
      'react': 'You specialize in React components with TypeScript and Tailwind.',
      'api': 'You specialize in REST API endpoints with Express and Zod validation.',
      'css': 'You specialize in CSS, Tailwind, and responsive design.',
      'test': 'You specialize in Jest/Vitest tests with high coverage.',
    };
    return prompts[expertId] || '';
  }
}
```

Usage with Doppler primitives:
```
const { prefix, expertPrompt } = context.getExpertContext(expert.id);
const output = await network.executeExpert(
  expert.id,
  `${expertPrompt}\n\n${task.prompt}`,
  { maxTokens: task.maxTokens },
  { prefix }
);
```

---

## 4. Genetic Evolution via ReflectionStore

ReflectionStore persists learnings. Use for evolving network configurations:

```javascript
// reploid/infrastructure/reflection-store.js - extension

class ReflectionStore {
  // Existing: store and retrieve reflections
  async store(key, value) { /* ... */ }
  async retrieve(key) { /* ... */ }

  // NEW: Store winning network configuration
  async storeNetworkGenome(taskType, genome, fitness) {
    const key = `network:${taskType}`;
    const existing = await this.retrieve(key) || { generations: [] };

    existing.generations.push({
      genome,
      fitness,
      timestamp: Date.now()
    });

    // Keep top 10 configurations
    existing.generations.sort((a, b) => b.fitness - a.fitness);
    existing.generations = existing.generations.slice(0, 10);

    await this.store(key, existing);
  }

  // NEW: Get best network configuration for task type
  async getBestGenome(taskType) {
    const key = `network:${taskType}`;
    const stored = await this.retrieve(key);
    return stored?.generations[0]?.genome || null;
  }

  // NEW: Track adapter success rates (UCB1 bandit)
  async updateAdapterStats(taskType, adapterId, success) {
    const key = `adapter:${taskType}:${adapterId}`;
    const stats = await this.retrieve(key) || { successes: 0, attempts: 0 };

    stats.attempts++;
    if (success) stats.successes++;

    await this.store(key, stats);
  }

  async getAdapterStats(taskType, adapterId) {
    const key = `adapter:${taskType}:${adapterId}`;
    return await this.retrieve(key) || { successes: 0, attempts: 0 };
  }
}
```

---

## 5. Output Validation via SchemaRegistry

SchemaRegistry validates tool outputs. Use for FunctionGemma combiner:

```javascript
// reploid/core/schema-registry.js - extension

class SchemaRegistry {
  // Existing: register and validate schemas
  register(name, schema) { /* ... */ }
  validate(name, data) { /* ... */ }

  // NEW: Validate combined expert outputs
  validateCombinedOutput(outputs, taskSchema) {
    const errors = [];

    for (const [expertId, output] of Object.entries(outputs)) {
      const result = this.validate(taskSchema, output);
      if (!result.valid) {
        errors.push({ expertId, errors: result.errors });
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  // NEW: Merge expert outputs with conflict resolution
  mergeOutputs(outputs, strategy = 'weighted') {
    if (strategy === 'voting') {
      return this.votingMerge(outputs);
    }
    if (strategy === 'weighted') {
      return this.weightedMerge(outputs);
    }
    return this.concatenateMerge(outputs);
  }

  weightedMerge(outputs) {
    // Weighted by expert scores
    const merged = { code: '', imports: new Set() };

    for (const { output, weight } of outputs) {
      if (weight > 0.5) {
        merged.code += output.code;
        output.imports?.forEach(i => merged.imports.add(i));
      }
    }

    merged.imports = [...merged.imports];
    return merged;
  }
}
```

---

## 6. FunctionGemma Orchestrator

New module that ties everything together:

```javascript
// reploid/core/functiongemma-orchestrator.js

import { SemanticMemory } from './semantic-memory.js';
import { ContextManager } from './context-manager.js';
import { ArenaHarness } from '../infrastructure/arena-harness.js';
import { ReflectionStore } from '../infrastructure/reflection-store.js';
import { SchemaRegistry } from './schema-registry.js';
import {
  MultiModelLoader,
  MultiPipelinePool,
  MultiModelNetwork,
  MultiModelRecorder,
} from 'doppler';

export class FunctionGemmaOrchestrator {
  constructor(storageContext, baseManifest) {
    this.storage = storageContext;
    this.baseManifest = baseManifest;
    this.memory = new SemanticMemory();
    this.context = new ContextManager();
    this.arena = new ArenaHarness();
    this.reflection = new ReflectionStore();
    this.schema = new SchemaRegistry();

    this.experts = [
      { id: 'react', adapter: 'react', specialization: 'React TypeScript components' },
      { id: 'api', adapter: 'api', specialization: 'REST API endpoints' },
      { id: 'css', adapter: 'css', specialization: 'CSS and Tailwind styling' },
      { id: 'test', adapter: 'test', specialization: 'Unit and integration tests' },
    ];
  }

  async init() {
    this.loader = new MultiModelLoader();
    await this.loader.loadBase(this.baseManifest, { storageContext: this.storage });

    for (const expert of this.experts) {
      await this.loader.loadAdapter(expert.id, expert.adapter);
    }

    this.pool = new MultiPipelinePool(this.loader);
    const pipeline = await this.loader.createSharedPipeline({ storage: this.storage });
    this.recorder = new MultiModelRecorder();
    this.network = new MultiModelNetwork(pipeline, this.loader, this.pool, this.recorder);

    for (const expert of this.experts) {
      this.network.registerExpert({
        id: expert.id,
        adapterName: expert.id,
        metadata: { specialization: expert.specialization }
      });
    }

    await this.network.setSharedPrefix(`
      You are a specialized code generator.
      Output valid JSON: { "code": string, "imports": string[] }
    `);
  }

  async execute(task) {
    const cachedGenome = await this.reflection.getBestGenome(task.type);
    if (cachedGenome) {
      return this.network.executeGenome(cachedGenome, task.prompt, {
        maxTokens: task.maxTokens
      });
    }

    const selectedExperts = await this.memory.routeToExpert(task, this.experts);
    const winner = await this.arena.runExpertPool(task, selectedExperts, this.network);

    const validation = this.schema.validateCombinedOutput(
      { [winner.expert.id]: winner.output },
      task.schema
    );

    await this.reflection.updateAdapterStats(
      task.type,
      winner.expert.adapter,
      validation.valid
    );

    return {
      output: winner.output,
      expert: winner.expert.id,
      score: winner.score,
      valid: validation.valid
    };
  }
}
```

---

## Agent Loop Routing (Optional)

When a FunctionGemma config is provided, the agent loop can route requests to FunctionGemma automatically.

Routing modes:
- `always` (default): always use FunctionGemma when configured
- `auto`: use a heuristic over the latest user prompt/goal
- `disabled`: never use FunctionGemma

Heuristic controls (optional):
- `autoTriggers`: list of substrings or regex patterns that should trigger FunctionGemma
- `autoBlocks`: list of substrings or regex patterns that should block FunctionGemma
- `autoDefault`: if true, use FunctionGemma when no triggers match

If `autoTriggers` or `autoBlocks` are provided, routing defaults to `auto` unless `routingMode` is set.

Example config:
```json
{
  "routingMode": "auto",
  "autoTriggers": ["json", "schema", "structured"],
  "autoBlocks": ["read file", "run tests", "list files"]
}
```

---

## Roadmap

Implementation tasks are tracked in `/Users/xyz/deco/TODO_FUNCTIONGEMMA.md`.

---

## References

- **Doppler Dependency:** [MULTI_FUNCTIONGEMMA_NETWORK.md](../../../doppler/docs/plans/MULTI_FUNCTIONGEMMA_NETWORK.md)
- **Reploid Modules:** See `core/` and `infrastructure/`

---

*Last updated: December 2025*
