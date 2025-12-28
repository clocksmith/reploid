# Blueprint 0x000066: Recursive Goal Decomposition

**Objective:** Implement a system that breaks down goals into subgoals, then recursively improves the decomposition algorithm itself based on success patterns.

**Target Upgrade:** RGDP (`recursive-goal-decomp.js`)

**Prerequisites:** `0x000017` (Goal Modification Safety), `0x000021` (Meta-Cognitive Evaluator), `0x000008` (Cognitive Cycle)

**Affected Artifacts:** `/config/decomposition-strategy.json`, `/capabilities/cognition/goal-decomposer.js`, `/config/decomposition-patterns.json`

---

## 1. The Goal Decomposition Challenge

Complex goals cannot be solved in one step. Effective decomposition requires:
- Breaking down into manageable subgoals
- Identifying dependencies and ordering
- Recognizing when decomposition itself is suboptimal
- **Improving the decomposition algorithm based on outcomes**

**Key RSI Insight:** The agent should not just decompose goals—it should learn to decompose *better* by analyzing which decomposition strategies succeed.

---

## 2. Goal Decomposition Hierarchy

```javascript
const GoalStructure = {
  root: {
    id: 'goal_0',
    text: 'Build a web app for tracking habits',
    type: 'composite',
    parent: null,
    children: ['goal_1', 'goal_2', 'goal_3'],
    status: 'in_progress',
    decomposition_strategy: 'functional',
    metadata: {
      complexity: 0.8,
      estimated_cycles: 50,
      actual_cycles: 0,
      success: null
    }
  },

  subgoals: {
    'goal_1': {
      id: 'goal_1',
      text: 'Design database schema',
      type: 'atomic',
      parent: 'goal_0',
      children: [],
      dependencies: [],
      status: 'completed',
      decomposition_strategy: null, // Atomic goals aren't decomposed
      metadata: {
        complexity: 0.3,
        estimated_cycles: 5,
        actual_cycles: 4,
        success: true
      }
    },

    'goal_2': {
      id: 'goal_2',
      text: 'Implement backend API',
      type: 'composite',
      parent: 'goal_0',
      children: ['goal_2a', 'goal_2b'],
      dependencies: ['goal_1'], // Must complete goal_1 first
      status: 'pending',
      decomposition_strategy: 'sequential',
      metadata: {
        complexity: 0.6,
        estimated_cycles: 20
      }
    }
  }
};
```

---

## 3. Decomposition Strategies

```javascript
const DecompositionStrategies = {
  // Strategy 1: Functional Decomposition
  functional: {
    name: 'Functional Decomposition',
    description: 'Break by logical function/feature',
    when: 'Goal involves multiple distinct capabilities',

    decompose: (goal) => {
      // Identify functional components
      const components = identifyComponents(goal);

      return components.map(comp => ({
        text: `Implement ${comp.name}`,
        rationale: `${comp.name} is a core functional requirement`,
        dependencies: comp.requires || [],
        estimated_complexity: comp.complexity
      }));
    },

    evaluate: (outcomes) => {
      // Score based on component independence
      const independence = outcomes.filter(o =>
        o.blockedByDependency === false
      ).length / outcomes.length;

      return {
        score: independence * 0.8 + outcomes.successRate * 0.2,
        strengths: independence > 0.8 ? ['Good component isolation'] : [],
        weaknesses: independence < 0.5 ? ['Too many dependencies'] : []
      };
    }
  },

  // Strategy 2: Sequential Decomposition
  sequential: {
    name: 'Sequential Decomposition',
    description: 'Break into ordered pipeline stages',
    when: 'Goal has natural sequential flow',

    decompose: (goal) => {
      // Identify sequential stages
      const stages = identifyStages(goal); // e.g., [plan, build, test, deploy]

      return stages.map((stage, idx) => ({
        text: `${stage.verb} ${stage.target}`,
        rationale: `Stage ${idx + 1} in natural workflow`,
        dependencies: idx > 0 ? [stages[idx - 1].id] : [],
        estimated_complexity: stage.complexity
      }));
    },

    evaluate: (outcomes) => {
      // Score based on stage efficiency
      const avgCyclesPerStage = outcomes.map(o => o.cycles).reduce((a, b) => a + b) / outcomes.length;
      const efficiency = 1 / (avgCyclesPerStage / 5); // Normalize to ~5 cycles per stage

      return {
        score: Math.min(efficiency, 1) * 0.7 + outcomes.successRate * 0.3,
        strengths: efficiency > 0.8 ? ['Efficient stage progression'] : [],
        weaknesses: efficiency < 0.5 ? ['Stages too complex'] : []
      };
    }
  },

  // Strategy 3: Parallel Decomposition
  parallel: {
    name: 'Parallel Decomposition',
    description: 'Break into independent parallel tasks',
    when: 'Goal has independent sub-tasks that can be done simultaneously',

    decompose: (goal) => {
      // Identify independent components
      const independentTasks = identifyIndependentTasks(goal);

      return independentTasks.map(task => ({
        text: task.description,
        rationale: 'Independent task, can be parallelized',
        dependencies: [], // No dependencies by design
        estimated_complexity: task.complexity
      }));
    },

    evaluate: (outcomes) => {
      // Score based on actual independence
      const parallelism = outcomes.filter(o =>
        o.dependencies.length === 0
      ).length / outcomes.length;

      return {
        score: parallelism * 0.9 + outcomes.successRate * 0.1,
        strengths: parallelism > 0.8 ? ['High parallelism achieved'] : [],
        weaknesses: parallelism < 0.5 ? ['Hidden dependencies discovered'] : []
      };
    }
  },

  // Strategy 4: Constraint-Based Decomposition
  constraintBased: {
    name: 'Constraint-Based Decomposition',
    description: 'Organize by constraints and requirements',
    when: 'Goal has hard constraints or compliance requirements',

    decompose: (goal) => {
      // Identify constraints
      const constraints = identifyConstraints(goal);

      return constraints.map(constraint => ({
        text: `Satisfy constraint: ${constraint.name}`,
        rationale: `Required constraint: ${constraint.reason}`,
        dependencies: constraint.prerequisiteConstraints || [],
        estimated_complexity: constraint.difficulty
      }));
    },

    evaluate: (outcomes) => {
      // Score based on constraint satisfaction
      const satisfied = outcomes.filter(o => o.constraintMet === true).length / outcomes.length;

      return {
        score: satisfied * 0.95 + outcomes.successRate * 0.05, // Constraint satisfaction critical
        strengths: satisfied === 1 ? ['All constraints met'] : [],
        weaknesses: satisfied < 1 ? ['Constraint violations'] : []
      };
    }
  },

  // Strategy 5: Iterative Decomposition
  iterative: {
    name: 'Iterative Decomposition',
    description: 'Break into iterative refinement cycles',
    when: 'Goal requires progressive improvement',

    decompose: (goal) => {
      // Identify iteration stages
      const iterations = ['MVP', 'Enhanced', 'Polished', 'Optimized'];

      return iterations.map((iteration, idx) => ({
        text: `${iteration} version of ${goal.target}`,
        rationale: `Iteration ${idx + 1}: Incremental improvement`,
        dependencies: idx > 0 ? [iterations[idx - 1]] : [],
        estimated_complexity: 0.2 + (idx * 0.15) // Each iteration slightly more complex
      }));
    },

    evaluate: (outcomes) => {
      // Score based on progressive improvement
      const improvements = outcomes.map((o, idx) => {
        if (idx === 0) return 1;
        return o.qualityScore > outcomes[idx - 1].qualityScore ? 1 : 0;
      });
      const progressiveness = improvements.reduce((a, b) => a + b) / improvements.length;

      return {
        score: progressiveness * 0.8 + outcomes.successRate * 0.2,
        strengths: progressiveness > 0.8 ? ['Good progressive improvement'] : [],
        weaknesses: progressiveness < 0.5 ? ['Iterations not improving quality'] : []
      };
    }
  }
};
```

---

## 4. Strategy Selection & Improvement

```javascript
const RecursiveDecomposer = {
  // Select decomposition strategy
  selectStrategy: async (goal, historicalData) => {
    const features = {
      goalType: classifyGoal(goal),
      complexity: assessComplexity(goal),
      hasSequentialFlow: detectSequentialFlow(goal),
      hasParallelism: detectParallelTasks(goal),
      hasConstraints: detectConstraints(goal),
      requiresIteration: detectIterativeNature(goal)
    };

    // Score each strategy
    const scores = Object.entries(DecompositionStrategies).map(([key, strategy]) => {
      let score = 0;

      // Historical performance for similar goals
      const historicalPerformance = historicalData
        .filter(h => h.goalType === features.goalType && h.strategy === key);

      if (historicalPerformance.length > 0) {
        const avgSuccess = historicalPerformance.reduce((sum, h) => sum + h.successRate, 0) / historicalPerformance.length;
        score += avgSuccess * 0.5; // 50% weight on historical success
      }

      // Feature matching
      if (features.hasSequentialFlow && key === 'sequential') score += 0.2;
      if (features.hasParallelism && key === 'parallel') score += 0.2;
      if (features.hasConstraints && key === 'constraintBased') score += 0.2;
      if (features.requiresIteration && key === 'iterative') score += 0.2;

      // Complexity matching
      if (features.complexity > 0.7 && key === 'functional') score += 0.1;

      return { strategy: key, score, rationale: explainScore(features, key) };
    });

    scores.sort((a, b) => b.score - a.score);

    return {
      primaryStrategy: DecompositionStrategies[scores[0].strategy],
      alternativeStrategies: scores.slice(1, 3),
      rationale: scores[0].rationale
    };
  },

  // Decompose goal using selected strategy
  decompose: async (goal, strategy) => {
    const subgoals = await strategy.decompose(goal);

    // Validate decomposition
    const validation = validateDecomposition(subgoals, goal);

    if (!validation.valid) {
      console.warn('[RGDP] Decomposition validation failed:', validation.issues);
      // Try alternative strategy
      return await RecursiveDecomposer.retryWithAlternative(goal);
    }

    return {
      subgoals,
      strategy: strategy.name,
      confidence: validation.confidence,
      metadata: {
        estimated_total_cycles: subgoals.reduce((sum, sg) => sum + sg.estimated_complexity * 5, 0),
        parallelism_score: calculateParallelism(subgoals),
        dependency_complexity: calculateDependencyComplexity(subgoals)
      }
    };
  },

  // RECURSIVE IMPROVEMENT: Learn from decomposition outcomes
  improveDecomposition: async (goal, decomposition, outcome) => {
    const evaluation = {
      goalId: goal.id,
      goalType: classifyGoal(goal),
      strategyUsed: decomposition.strategy,
      timestamp: Date.now(),

      // Measure outcomes
      subgoalResults: outcome.subgoals.map(sg => ({
        text: sg.text,
        success: sg.status === 'completed',
        actualCycles: sg.metadata.actual_cycles,
        estimatedCycles: sg.metadata.estimated_cycles,
        blockedByDependencies: sg.wasBlocked || false,
        qualityScore: sg.qualityScore || null
      })),

      // Overall metrics
      metrics: {
        successRate: outcome.subgoals.filter(sg => sg.status === 'completed').length / outcome.subgoals.length,
        estimationAccuracy: 1 - Math.abs(
          outcome.totalCycles - decomposition.metadata.estimated_total_cycles
        ) / decomposition.metadata.estimated_total_cycles,
        dependencyEfficiency: outcome.subgoals.filter(sg => !sg.wasBlocked).length / outcome.subgoals.length,
        overallQuality: outcome.goalQuality || 0.5
      }
    };

    // Evaluate strategy performance
    const strategy = DecompositionStrategies[decomposition.strategy];
    const strategyEvaluation = strategy.evaluate(evaluation.subgoalResults);

    evaluation.strategyScore = strategyEvaluation.score;
    evaluation.strengths = strategyEvaluation.strengths;
    evaluation.weaknesses = strategyEvaluation.weaknesses;

    // Store for future strategy selection
    await VFS.appendToFile(
      '/config/decomposition-history.jsonl',
      JSON.stringify(evaluation) + '\n'
    );

    // RECURSIVE IMPROVEMENT: If strategy performed poorly, analyze why
    if (strategyEvaluation.score < 0.6) {
      console.log('[RGDP] Strategy underperformed, analyzing...');

      const analysis = await analyzeDecompositionFailure(goal, decomposition, outcome);

      // Generate improved strategy variant
      if (analysis.improvementPossible) {
        await generateImprovedStrategy(strategy, analysis.improvements);
      }
    }

    return evaluation;
  }
};
```

---

## 5. Strategy Evolution (The RSI Core)

```javascript
const StrategyEvolver = {
  // Analyze why a decomposition strategy failed
  analyzeDecompositionFailure: async (goal, decomposition, outcome) => {
    const failures = outcome.subgoals.filter(sg => !sg.success);

    const analysis = {
      root_causes: [],
      improvement_opportunities: []
    };

    // Analyze failure patterns
    if (failures.length > 0) {
      // Were subgoals too complex?
      const avgComplexity = failures.reduce((sum, f) => sum + f.metadata.complexity, 0) / failures.length;
      if (avgComplexity > 0.7) {
        analysis.root_causes.push('Subgoals too complex');
        analysis.improvement_opportunities.push({
          type: 'granularity',
          suggestion: 'Decompose into smaller, simpler subgoals',
          implementation: 'Add recursion: decompose complex subgoals further'
        });
      }

      // Were dependencies misidentified?
      const blockedCount = outcome.subgoals.filter(sg => sg.wasBlocked).length;
      if (blockedCount > outcome.subgoals.length * 0.3) {
        analysis.root_causes.push('Dependency structure suboptimal');
        analysis.improvement_opportunities.push({
          type: 'dependencies',
          suggestion: 'Better dependency detection or reordering',
          implementation: 'Improve dependency analysis in decomposition'
        });
      }

      // Was the wrong strategy chosen?
      const goalFeatures = extractGoalFeatures(goal);
      const alternativeStrategies = Object.values(DecompositionStrategies)
        .filter(s => s.name !== decomposition.strategy);

      for (const altStrategy of alternativeStrategies) {
        const match = matchStrategyToFeatures(altStrategy, goalFeatures);
        if (match.score > 0.8) {
          analysis.root_causes.push(`Better strategy available: ${altStrategy.name}`);
          analysis.improvement_opportunities.push({
            type: 'strategy_selection',
            suggestion: `Use ${altStrategy.name} for goals with these features`,
            implementation: 'Update strategy selection scoring function'
          });
        }
      }
    }

    analysis.improvementPossible = analysis.improvement_opportunities.length > 0;

    return analysis;
  },

  // Generate improved strategy variant
  generateImprovedStrategy: async (baseStrategy, improvements) => {
    // Use LLM to synthesize improved strategy
    const prompt = `
      Base Decomposition Strategy: ${JSON.stringify(baseStrategy, null, 2)}

      Identified Weaknesses:
      ${improvements.map(i => `- ${i.suggestion}`).join('\n')}

      Task: Generate an improved version of this decomposition strategy that addresses these weaknesses.

      Requirements:
      1. Maintain the core approach of ${baseStrategy.name}
      2. Integrate the suggested improvements
      3. Add concrete implementation logic
      4. Include updated evaluation criteria

      Return as JSON matching the DecompositionStrategy schema.
    `;

    const response = await LLMClient.chat([{ role: 'user', content: prompt }]);
    const improvedStrategy = JSON.parse(response.content);

    // Save as new strategy variant
    const variantName = `${baseStrategy.name}_v${Date.now()}`;
    DecompositionStrategies[variantName] = improvedStrategy;

    // Store in VFS for persistence
    await VFS.writeFile(
      `/config/strategies/${variantName}.json`,
      JSON.stringify(improvedStrategy)
    );

    console.log(`[RGDP] Generated improved strategy: ${variantName}`);

    return { name: variantName, strategy: improvedStrategy };
  },

  // Periodically evolve decomposition strategies
  evolveStrategies: async (historicalData) => {
    console.log('[RGDP] Running strategy evolution...');

    // For each strategy, analyze performance
    for (const [name, strategy] of Object.entries(DecompositionStrategies)) {
      const usageData = historicalData.filter(h => h.strategyUsed === name);

      if (usageData.length < 10) continue; // Need enough data

      const avgScore = usageData.reduce((sum, d) => sum + d.strategyScore, 0) / usageData.length;

      if (avgScore < 0.7) {
        console.log(`[RGDP] Strategy ${name} underperforming (${avgScore.toFixed(2)}), analyzing...`);

        // Aggregate improvement opportunities
        const allImprovements = usageData
          .filter(d => d.weaknesses.length > 0)
          .flatMap(d => d.weaknesses);

        if (allImprovements.length > 0) {
          const improvements = prioritizeImprovements(allImprovements);
          await StrategyEvolver.generateImprovedStrategy(strategy, improvements);
        }
      }
    }

    console.log('[RGDP] Strategy evolution complete');
  }
};
```

---

## 6. Integration with Agent Loop

```javascript
// In agent-loop.js

// When agent receives a complex goal
if (goal.complexity > 0.5) {
  console.log('[RGDP] Goal is complex, decomposing...');

  // Load historical decomposition data
  const history = await loadDecompositionHistory();

  // Select decomposition strategy
  const selection = await RecursiveDecomposer.selectStrategy(goal, history);
  console.log(`[RGDP] Selected strategy: ${selection.primaryStrategy.name}`);

  // Decompose goal
  const decomposition = await RecursiveDecomposer.decompose(goal, selection.primaryStrategy);

  // Execute subgoals
  const outcome = await executeSubgoals(decomposition.subgoals);

  // LEARN: Improve decomposition algorithm
  await RecursiveDecomposer.improveDecomposition(goal, decomposition, outcome);
}

// Periodically evolve strategies (every 100 cycles)
if (state.totalCycles % 100 === 0) {
  const history = await loadDecompositionHistory();
  await StrategyEvolver.evolveStrategies(history);
}
```

---

## 7. Success Criteria

A successful recursive goal decomposition system demonstrates:

1. **Effective Decomposition:** Complex goals broken into manageable subgoals
2. **Strategy Adaptation:** Different strategies used for different goal types
3. **Learning from Outcomes:** Poor decompositions trigger strategy improvements
4. **Meta-Improvement:** The decomposition algorithm itself gets better over time
5. **Strategy Evolution:** New, improved strategies generated from experience

---

## 8. Proto Widget

```javascript
class GoalDecompositionWidget extends HTMLElement {
  render() {
    const currentGoal = getCurrentGoal();
    const decomposition = currentGoal.decomposition;

    this.shadowRoot.innerHTML = `
      <div class="rgdp-panel">
        <h4>🎯 Goal Decomposition</h4>

        <div class="strategy-info">
          <strong>Strategy:</strong> ${decomposition.strategy}
          <div class="confidence">Confidence: ${(decomposition.confidence * 100).toFixed(0)}%</div>
        </div>

        <div class="subgoal-tree">
          ${renderSubgoalTree(decomposition.subgoals)}
        </div>

        <div class="metrics">
          <div class="metric">
            <label>Success Rate</label>
            <span>${(decomposition.metrics.successRate * 100).toFixed(0)}%</span>
          </div>
          <div class="metric">
            <label>Parallelism</label>
            <span>${(decomposition.metadata.parallelism_score * 100).toFixed(0)}%</span>
          </div>
        </div>

        <div class="evolution-log">
          <h5>Strategy Evolution Log</h5>
          ${getRecentEvolutions().map(e => `
            <div class="evolution-item">
              Cycle ${e.cycle}: ${e.strategyName} → ${e.improvement}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
}
```

---

## Remember

Recursive goal decomposition is RSI at the planning level. The agent not only breaks down goals but continuously improves *how* it breaks down goals. Each decomposition teaches the agent something about problem structure, and that learning feeds back into better future decompositions. This is true recursive improvement—the planner improving the planner.
