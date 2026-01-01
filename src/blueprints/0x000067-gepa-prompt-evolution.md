# Blueprint 0x000067: GEPA Prompt Evolution

**Objective:** Implement Genetic-Pareto prompt evolution with execution trace reflection, enabling multi-objective optimization of prompts and text components.

**Target Upgrade:** GEPA (`gepa-optimizer.js`)

**Prerequisites:** `0x000053` (Recursive Prompt Engineering), `0x00003F` (Deja Vu Pattern Detection), `0x000012` (Self-Evaluation)

**Affected Artifacts:** `/capabilities/cognition/gepa-optimizer.js`, `/tests/unit/gepa-optimizer.test.js`, `/core/agent-loop.js`

**Category:** RSI/Meta-Cognition

**Reference:** [GEPA Paper](https://arxiv.org/abs/2507.19457) - Reflective Prompt Evolution Can Outperform Reinforcement Learning

---

## 1. The Strategic Imperative

**Current Limitation (Blueprint 0x000053):**

The existing recursive prompt engineering approach has critical limitations:

- **Single-objective optimization:** Only tracks success rate, missing nuanced tradeoffs
- **No population diversity:** Tests one candidate at a time, prone to local optima
- **Generic feedback:** Uses abstract quality metrics, not task-specific execution traces
- **No Pareto selection:** Discards candidates that excel in different dimensions

**GEPA Solution:**

GEPA (Genetic-Pareto) addresses these through:

1. **Multi-objective Pareto selection** - Keep diverse candidates excelling at different metrics
2. **Execution trace reflection** - LLM analyzes actual errors/traces to propose targeted mutations
3. **Population-based search** - Maintain candidate pool with crossover and mutation
4. **Task-specific feedback** - Use compiler errors, test failures, profiler output as reflection input

**Empirical Results (from paper):**
- AIME: 46.6% -> 56.6% (+10%)
- MATH: 67% -> 93% (+26%)
- Outperforms RL-based prompt optimization on multiple benchmarks

---

## 2. Genesis Prompt (Seed Population)

The GEPA optimizer requires a strong seed prompt to initialize the population. This "Genesis Prompt" combines Reploid's modular persona architecture with GEPA's evolutionary intelligence.

### 2.1 GEPA-Reploid Genesis Prompt

```markdown
# Role

You are the GEPA-Reploid Evolutionary Agent, synthesizing the Architect (analysis)
and Executor (implementation) personas. Your reasoning depth is set to maximum.

# Objective

Optimize the target system through Genetic-Pareto evolution. Treat every task as a
fitness landscape requiring multi-objective optimization.

# Evolutionary Loop

## Phase 1: Audit (Architect Persona)
- Analyze the current state and identify "Fitness Gaps"
- Map objectives: accuracy, efficiency, robustness, creativity
- Collect execution traces from recent failures

## Phase 2: Crossover (Executor Persona)
- Merge successful patterns from high-performing candidates
- Identify Pareto-optimal implementation paths
- Generate mutation candidates targeting identified gaps

## Phase 3: Reflective Mutation
- Perform high-reasoning analysis of failure traces
- Self-Correction: If bottleneck or failure pattern detected, perform autonomous
  "Secondary Opinion" re-evaluation
- Mutate the approach and select the most robust fix
- Do not pause for approval on reflection-guided mutations

## Phase 4: State Commitment
- Implement the evolved solution
- Record reflective notes explaining the "genetic" improvement
- Update fitness scores for Pareto selection

# Constraints

- Never discard candidates that excel on ANY objective (Pareto preservation)
- Use execution traces, not abstract metrics, for reflection
- If environment changes or error occurs, treat as selection pressure and evolve
- Maintain population diversity through crowding distance

# Initialization

Begin by auditing the current system state. Collect baseline fitness scores across
all objectives. Identify the highest-priority fitness gap and initiate the first
Reflective Mutation pass.
```

### 2.2 Persona Slotting Strategy

The Genesis Prompt forces separation between:

| Slot | Persona | Function |
|------|---------|----------|
| A | Architect | Critical auditing, gap analysis, trace collection |
| B | Executor | Creative problem-solving, mutation generation |

This prevents "hallucination of success" common in linear prompts by requiring the agent to argue with itself (Slot A identifies problems, Slot B proposes solutions, then Slot A validates).

### 2.3 The Persistence Policy

Unlike standard prompts that stop on difficulty, GEPA prompts use failure as **selection pressure**:

```javascript
// Traditional prompt behavior
if (error) { stop(); askForHelp(); }

// GEPA prompt behavior
if (error) {
  collectTrace(error);
  reflectOnFailure(trace);
  mutateApproach();
  continueWithEvolvedStrategy();
}
```

---

## 3. Core Algorithm

### 3.1 GEPA Loop

```
INITIALIZE: Population P = [seed_prompt]
REPEAT until budget exhausted:
    1. EVALUATE: Run each candidate on task batch, collect (scores, traces)
    2. REFLECT: LLM analyzes traces, identifies failure patterns
    3. MUTATE: Generate new candidates from reflection insights
    4. SELECT: Pareto-optimal selection to maintain diverse frontier
    5. ARCHIVE: Store promising candidates for future recombination
```

### 3.2 Key Data Structures

```javascript
// Candidate representation
const Candidate = {
  id: 'uuid',
  content: 'You are a helpful assistant that...',
  generation: 3,
  parentIds: ['uuid-1', 'uuid-2'],  // For crossover lineage
  scores: {
    accuracy: 0.87,
    efficiency: 0.72,
    creativity: 0.65,
    robustness: 0.91
  },
  dominatedBy: 0,  // Pareto dominance count
  crowdingDistance: 1.5  // For diversity preservation
};

// Execution trace for reflection
const ExecutionTrace = {
  candidateId: 'uuid',
  taskId: 'task-123',
  input: 'What is 2+2?',
  expectedOutput: '4',
  actualOutput: 'The answer is four.',
  success: false,
  errorType: 'format_mismatch',
  trace: [
    { step: 'parse_input', result: 'ok' },
    { step: 'compute', result: 'ok' },
    { step: 'format_output', result: 'failed_numeric_check' }
  ],
  latencyMs: 1250,
  tokenCount: 87
};

// Pareto frontier
const ParetoFrontier = {
  candidates: [],  // Non-dominated candidates
  objectives: ['accuracy', 'efficiency', 'robustness'],
  maxSize: 20
};
```

---

## 4. The Architectural Solution

### 4.1 Module Structure

```javascript
const GEPAOptimizer = {
  metadata: {
    id: 'GEPAOptimizer',
    version: '1.0.0',
    dependencies: ['LLMClient', 'EventBus', 'Utils', 'VFS'],
    type: 'async'
  },

  factory: (deps) => {
    const { LLMClient, EventBus, Utils, VFS } = deps;

    // Configuration
    const CONFIG = {
      populationSize: 10,
      maxGenerations: 20,
      mutationRate: 0.3,
      crossoverRate: 0.5,
      eliteCount: 2,  // Preserve top N each generation
      objectives: ['accuracy', 'efficiency', 'robustness'],
      reflectionModel: 'claude-3-5-sonnet',  // Strong model for reflection
      evaluationBatchSize: 10
    };

    // State
    let population = [];
    let paretoFrontier = [];
    let generationCount = 0;
    let reflectionCache = new Map();

    // ... implementation
  }
};
```

### 4.2 Evaluation Engine

```javascript
const evaluate = async (candidates, taskBatch) => {
  const results = [];

  for (const candidate of candidates) {
    const traces = [];

    for (const task of taskBatch) {
      const startTime = performance.now();

      try {
        // Execute with candidate prompt
        const response = await LLMClient.chat([
          { role: 'system', content: candidate.content },
          { role: 'user', content: task.input }
        ]);

        const latencyMs = performance.now() - startTime;
        const success = evaluateResponse(response.content, task.expected);

        traces.push({
          candidateId: candidate.id,
          taskId: task.id,
          input: task.input,
          expectedOutput: task.expected,
          actualOutput: response.content,
          success,
          errorType: success ? null : classifyError(response.content, task.expected),
          latencyMs,
          tokenCount: response.usage?.total_tokens || 0
        });
      } catch (error) {
        traces.push({
          candidateId: candidate.id,
          taskId: task.id,
          success: false,
          errorType: 'execution_error',
          error: error.message
        });
      }
    }

    // Aggregate scores across objectives
    const scores = {
      accuracy: traces.filter(t => t.success).length / traces.length,
      efficiency: 1 - (avg(traces.map(t => t.latencyMs)) / 10000),  // Normalize
      robustness: 1 - (traces.filter(t => t.errorType === 'execution_error').length / traces.length)
    };

    results.push({
      candidate,
      scores,
      traces
    });
  }

  return results;
};
```

### 4.3 Reflection Engine (Core GEPA Innovation)

```javascript
const reflect = async (evaluationResults) => {
  // Group failures by error type
  const failureGroups = {};
  for (const result of evaluationResults) {
    for (const trace of result.traces.filter(t => !t.success)) {
      const key = trace.errorType || 'unknown';
      if (!failureGroups[key]) failureGroups[key] = [];
      failureGroups[key].push({
        candidate: result.candidate,
        trace
      });
    }
  }

  const reflections = [];

  for (const [errorType, failures] of Object.entries(failureGroups)) {
    // Sample representative failures (max 5 per type)
    const samples = failures.slice(0, 5);

    const reflectionPrompt = `
You are analyzing prompt failures to suggest improvements.

## Error Type: ${errorType}

## Failed Examples:
${samples.map((f, i) => `
### Example ${i + 1}
**Prompt:** ${f.candidate.content.substring(0, 500)}...
**Input:** ${f.trace.input}
**Expected:** ${f.trace.expectedOutput}
**Actual:** ${f.trace.actualOutput}
**Trace:** ${JSON.stringify(f.trace.trace || 'N/A')}
`).join('\n')}

## Task
1. Identify the ROOT CAUSE of these failures
2. Propose 2-3 SPECIFIC prompt modifications to fix this pattern
3. Explain WHY each modification would help

Respond in JSON:
{
  "rootCause": "string",
  "modifications": [
    {
      "type": "add" | "remove" | "replace",
      "target": "what part of prompt to modify",
      "content": "the new/modified text",
      "rationale": "why this helps"
    }
  ]
}`;

    const response = await LLMClient.chat([
      { role: 'system', content: 'You are an expert prompt engineer analyzing failures.' },
      { role: 'user', content: reflectionPrompt }
    ], CONFIG.reflectionModel);

    try {
      const parsed = JSON.parse(response.content);
      reflections.push({
        errorType,
        failureCount: failures.length,
        ...parsed
      });
    } catch (e) {
      console.warn('[GEPA] Failed to parse reflection:', e);
    }
  }

  return reflections;
};
```

### 4.4 Mutation Engine

```javascript
const mutate = async (candidate, reflections) => {
  // Find applicable reflections for this candidate's failure patterns
  const applicableReflections = reflections.filter(r =>
    candidate.traces?.some(t => t.errorType === r.errorType)
  );

  if (applicableReflections.length === 0) {
    // Random mutation if no specific guidance
    return randomMutate(candidate);
  }

  // Apply reflection-guided mutation
  let mutatedContent = candidate.content;

  for (const reflection of applicableReflections) {
    for (const mod of reflection.modifications) {
      switch (mod.type) {
        case 'add':
          mutatedContent = applyAddition(mutatedContent, mod);
          break;
        case 'remove':
          mutatedContent = applyRemoval(mutatedContent, mod);
          break;
        case 'replace':
          mutatedContent = applyReplacement(mutatedContent, mod);
          break;
      }
    }
  }

  return {
    id: Utils.generateId(),
    content: mutatedContent,
    generation: candidate.generation + 1,
    parentIds: [candidate.id],
    mutationType: 'reflection_guided',
    appliedReflections: applicableReflections.map(r => r.errorType)
  };
};

const crossover = (parent1, parent2) => {
  // Combine successful elements from both parents
  const sections1 = parsePromptSections(parent1.content);
  const sections2 = parsePromptSections(parent2.content);

  // For each section, pick from better-performing parent
  const childSections = {};
  for (const section of Object.keys({ ...sections1, ...sections2 })) {
    const score1 = parent1.scores?.accuracy || 0;
    const score2 = parent2.scores?.accuracy || 0;

    if (Math.random() < score1 / (score1 + score2)) {
      childSections[section] = sections1[section] || sections2[section];
    } else {
      childSections[section] = sections2[section] || sections1[section];
    }
  }

  return {
    id: Utils.generateId(),
    content: assembleSections(childSections),
    generation: Math.max(parent1.generation, parent2.generation) + 1,
    parentIds: [parent1.id, parent2.id],
    mutationType: 'crossover'
  };
};
```

### 4.5 Pareto Selection (Multi-Objective)

```javascript
const paretoSelect = (candidates, objectives, targetSize) => {
  // Calculate Pareto dominance
  for (const c of candidates) {
    c.dominatedBy = 0;
    c.dominates = [];
  }

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const dominated = checkDominance(candidates[i], candidates[j], objectives);
      if (dominated === 1) {
        candidates[j].dominatedBy++;
        candidates[i].dominates.push(j);
      } else if (dominated === -1) {
        candidates[i].dominatedBy++;
        candidates[j].dominates.push(i);
      }
    }
  }

  // Extract non-dominated front (Pareto frontier)
  const fronts = [];
  let remaining = [...candidates];

  while (remaining.length > 0) {
    const front = remaining.filter(c => c.dominatedBy === 0);
    fronts.push(front);

    // Remove front and update dominance counts
    for (const c of front) {
      for (const dominated of c.dominates) {
        candidates[dominated].dominatedBy--;
      }
    }
    remaining = remaining.filter(c => c.dominatedBy > 0);
  }

  // Select from fronts until we reach target size
  const selected = [];
  for (const front of fronts) {
    if (selected.length + front.length <= targetSize) {
      selected.push(...front);
    } else {
      // Use crowding distance for final selection
      const withCrowding = calculateCrowdingDistance(front, objectives);
      withCrowding.sort((a, b) => b.crowdingDistance - a.crowdingDistance);
      selected.push(...withCrowding.slice(0, targetSize - selected.length));
      break;
    }
  }

  return selected;
};

const checkDominance = (a, b, objectives) => {
  let dominated = 0;  // 1 if a dominates b, -1 if b dominates a, 0 if neither

  let aBetter = 0, bBetter = 0;
  for (const obj of objectives) {
    if (a.scores[obj] > b.scores[obj]) aBetter++;
    if (b.scores[obj] > a.scores[obj]) bBetter++;
  }

  if (aBetter > 0 && bBetter === 0) return 1;   // a dominates b
  if (bBetter > 0 && aBetter === 0) return -1;  // b dominates a
  return 0;  // Neither dominates
};

const calculateCrowdingDistance = (front, objectives) => {
  for (const c of front) c.crowdingDistance = 0;

  for (const obj of objectives) {
    front.sort((a, b) => a.scores[obj] - b.scores[obj]);

    // Boundary points get infinite distance
    front[0].crowdingDistance = Infinity;
    front[front.length - 1].crowdingDistance = Infinity;

    const range = front[front.length - 1].scores[obj] - front[0].scores[obj];
    if (range === 0) continue;

    for (let i = 1; i < front.length - 1; i++) {
      front[i].crowdingDistance +=
        (front[i + 1].scores[obj] - front[i - 1].scores[obj]) / range;
    }
  }

  return front;
};
```

### 4.6 Main Evolution Loop

```javascript
const evolve = async (seedPrompt, taskSet, options = {}) => {
  const config = { ...CONFIG, ...options };

  // Initialize population
  population = [createCandidate(seedPrompt, 0)];

  // Generate initial diversity through random mutations
  while (population.length < config.populationSize) {
    population.push(await randomMutate(population[0]));
  }

  EventBus.emit('gepa:started', {
    populationSize: population.length,
    objectives: config.objectives
  });

  for (let gen = 0; gen < config.maxGenerations; gen++) {
    generationCount = gen;

    // 1. EVALUATE
    const taskBatch = sampleTasks(taskSet, config.evaluationBatchSize);
    const evalResults = await evaluate(population, taskBatch);

    // Update candidate scores
    for (const result of evalResults) {
      result.candidate.scores = result.scores;
      result.candidate.traces = result.traces;
    }

    EventBus.emit('gepa:evaluated', {
      generation: gen,
      results: evalResults.map(r => ({
        id: r.candidate.id,
        scores: r.scores
      }))
    });

    // 2. REFLECT on failures
    const reflections = await reflect(evalResults);

    EventBus.emit('gepa:reflected', {
      generation: gen,
      reflectionCount: reflections.length,
      errorTypes: reflections.map(r => r.errorType)
    });

    // 3. GENERATE offspring
    const offspring = [];

    // Elitism: preserve top performers
    const elite = paretoSelect(population, config.objectives, config.eliteCount);
    offspring.push(...elite);

    // Crossover
    while (offspring.length < config.populationSize * 0.5) {
      const [p1, p2] = selectParents(population);
      if (Math.random() < config.crossoverRate) {
        offspring.push(crossover(p1, p2));
      }
    }

    // Mutation (reflection-guided)
    while (offspring.length < config.populationSize) {
      const parent = selectParent(population);
      if (Math.random() < config.mutationRate) {
        offspring.push(await mutate(parent, reflections));
      } else {
        offspring.push(await randomMutate(parent));
      }
    }

    // 4. SELECT next generation
    population = paretoSelect(offspring, config.objectives, config.populationSize);
    paretoFrontier = population.filter(c => c.dominatedBy === 0);

    EventBus.emit('gepa:generation-complete', {
      generation: gen,
      frontierSize: paretoFrontier.length,
      bestScores: getBestScores(population, config.objectives)
    });

    // Persist checkpoint
    await saveCheckpoint(gen, population, paretoFrontier);
  }

  // Return Pareto-optimal prompts
  return {
    frontier: paretoFrontier,
    bestOverall: selectBestOverall(paretoFrontier, config.objectives),
    generations: generationCount,
    totalEvaluations: generationCount * config.populationSize * config.evaluationBatchSize
  };
};
```

---

## 5. Web Component Widget

```javascript
class GEPAOptimizerWidget extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this._interval = setInterval(() => this.render(), 5000);

    // Listen for GEPA events
    EventBus.on('gepa:generation-complete', () => this.render());
  }

  disconnectedCallback() {
    if (this._interval) clearInterval(this._interval);
  }

  getStatus() {
    return {
      state: generationCount > 0 ? 'active' : 'idle',
      primaryMetric: `Gen ${generationCount}`,
      secondaryMetric: `${paretoFrontier.length} on frontier`,
      lastActivity: Date.now(),
      message: null
    };
  }

  render() {
    const bestScores = paretoFrontier.length > 0
      ? getBestScores(paretoFrontier, CONFIG.objectives)
      : null;

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; font-family: monospace; font-size: 12px; }
        .gepa-panel { background: rgba(0,0,0,0.8); padding: 16px; border-radius: 4px; }
        .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
        .stat-item { padding: 8px; background: rgba(255,255,255,0.05); border-radius: 2px; }
        .stat-label { color: #888; font-size: 10px; }
        .stat-value { color: #0f0; font-size: 14px; font-weight: bold; }
        .frontier { margin-top: 12px; padding: 8px; background: rgba(0,255,0,0.1); border-left: 3px solid #0f0; }
        .objective { display: flex; justify-content: space-between; margin: 4px 0; }
        .objective-name { color: #888; }
        .objective-value { color: #0ff; }
      </style>

      <div class="gepa-panel">
        <h4>GEPA Optimizer</h4>

        <div class="stat-grid">
          <div class="stat-item">
            <div class="stat-label">Generation</div>
            <div class="stat-value">${generationCount}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Population</div>
            <div class="stat-value">${population.length}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Pareto Frontier</div>
            <div class="stat-value">${paretoFrontier.length}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Reflections</div>
            <div class="stat-value">${reflectionCache.size}</div>
          </div>
        </div>

        ${bestScores ? `
          <div class="frontier">
            <strong>Best Scores:</strong>
            ${Object.entries(bestScores).map(([obj, score]) => `
              <div class="objective">
                <span class="objective-name">${obj}</span>
                <span class="objective-value">${(score * 100).toFixed(1)}%</span>
              </div>
            `).join('')}
          </div>
        ` : ''}

        <button id="start-evolution">Start Evolution</button>
        <button id="export-frontier">Export Frontier</button>
      </div>
    `;

    // Wire up buttons
    this.shadowRoot.getElementById('start-evolution')?.addEventListener('click', () => {
      EventBus.emit('gepa:start-requested');
    });

    this.shadowRoot.getElementById('export-frontier')?.addEventListener('click', async () => {
      const data = JSON.stringify(paretoFrontier, null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gepa-frontier-gen${generationCount}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }
}

if (!customElements.get('gepa-optimizer-widget')) {
  customElements.define('gepa-optimizer-widget', GEPAOptimizerWidget);
}
```

---

## 6. Integration Points

### 6.1 With Recursive Prompt Engineering (0x000053)

GEPA replaces the single-candidate A/B testing with population-based Pareto evolution:

```javascript
// Before (0x000064)
const variantScore = await testPromptVariant(variant, testGoals);
if (variantScore > currentScore * 1.05) deploy(variant);

// After (GEPA)
const result = await GEPAOptimizer.api.evolve(currentPrompt, taskSet, {
  objectives: ['accuracy', 'efficiency', 'robustness'],
  maxGenerations: 10
});
// Choose from Pareto frontier based on deployment context
const deployed = selectForContext(result.frontier, 'production');
```

### 6.2 With Deja Vu Detector (0x00003F)

Use detected patterns as additional reflection input:

```javascript
EventBus.on('deja-vu:detected', async (pattern) => {
  if (pattern.type === 'repeated_failure') {
    // Feed pattern into GEPA reflection
    reflectionCache.set(pattern.errorType, {
      ...pattern,
      source: 'deja-vu'
    });
  }
});
```

### 6.3 With Arena (0x000064-66)

GEPA candidates can compete in Arena for final selection:

```javascript
const selectBestForDeployment = async (frontier) => {
  // Run arena competition between frontier candidates
  const competitors = frontier.map(c => ({
    id: c.id,
    prompt: c.content,
    scores: c.scores
  }));

  const arenaResult = await ArenaHarness.compete(competitors, benchmarkTasks);
  return arenaResult.winner;
};
```

---

## 7. Implementation Pathway

### Phase 1: Core Algorithm
- [ ] Implement Candidate data structure
- [ ] Implement evaluation engine with trace collection
- [ ] Implement Pareto selection (NSGA-II style)
- [ ] Implement crowding distance for diversity

### Phase 2: Reflection Engine
- [ ] Implement failure grouping by error type
- [ ] Implement reflection prompt generation
- [ ] Implement reflection parsing and caching
- [ ] Implement reflection-guided mutation

### Phase 3: Evolution Loop
- [ ] Implement crossover operator
- [ ] Implement random mutation operator
- [ ] Implement main evolution loop
- [ ] Implement checkpoint persistence

### Phase 4: Integration
- [ ] Create Web Component widget
- [ ] Integrate with EventBus
- [ ] Connect to Deja Vu Detector
- [ ] Connect to Arena for final selection

### Phase 5: Optimization
- [ ] Add parallel evaluation (Web Workers)
- [ ] Add reflection caching across generations
- [ ] Add early stopping on convergence
- [ ] Add adaptive mutation rates

---

## 8. Success Criteria

| Metric | Target | Measurement |
|--------|--------|-------------|
| Accuracy improvement | >10% over baseline | Compare gen 0 vs final frontier |
| Diversity maintained | >3 distinct solutions on frontier | Count non-dominated candidates |
| Reflection hit rate | >50% mutations use reflection | Track mutation sources |
| Convergence speed | <15 generations | Track generations to plateau |

---

## 9. Configuration Options

```javascript
const DEFAULT_CONFIG = {
  // Population
  populationSize: 10,
  maxGenerations: 20,
  eliteCount: 2,

  // Operators
  mutationRate: 0.3,
  crossoverRate: 0.5,

  // Objectives (user-configurable)
  objectives: ['accuracy', 'efficiency', 'robustness'],

  // Evaluation
  evaluationBatchSize: 10,
  evaluationModel: 'default',  // Use agent's current model

  // Reflection
  reflectionModel: 'claude-3-5-sonnet',  // Strong model for analysis
  maxReflectionSamples: 5,

  // Persistence
  checkpointFrequency: 5,  // Save every N generations
  checkpointPath: '/gepa/checkpoints/'
};
```

---

## 10. Safety Constraints

```javascript
const GEPA_SAFETY_RULES = [
  "Never remove safety constraints from prompts during mutation",
  "Preserve HITL mechanisms in all evolved prompts",
  "Reject mutations that increase token count by >50%",
  "Require human approval for prompts scoring <50% on robustness",
  "Log all evolved prompts for audit trail",
  "Limit reflection model to read-only operations"
];
```

---

## 11. Future Extensions

1. **Multi-component evolution:** Co-evolve prompts + tools + workflows
2. **Transfer learning:** Seed from successful prompts in similar domains
3. **Federated GEPA:** Share Pareto frontiers across REPLOID instances via WebRTC
4. **Automated objective discovery:** Use LLM to identify relevant objectives for task
5. **Continuous evolution:** Background evolution during normal operation

---

**Remember:** GEPA's power comes from execution trace reflection — not generic "is this good?" but "this failed with error X on input Y, here's the trace, propose a fix." The Pareto selection ensures we don't lose candidates that excel in different dimensions.
