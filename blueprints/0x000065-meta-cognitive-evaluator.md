# Blueprint 0x000021: Meta-Cognitive Evaluator

**Objective:** Create a system that scores the agent's own reasoning quality and dynamically adjusts cognitive strategies based on performance patterns.

**Target Upgrade:** MCOG (`meta-cognitive-eval.js`)

**Prerequisites:** `0x000012` (Self-Evaluation), `0x000020` (Recursive Prompt Engineering), `0x000008` (Cognitive Cycle)

**Affected Artifacts:** `/system/cognitive-strategy.json`, `/modules/reasoning-analyzer.js`

---

## 1. The Meta-Cognitive Challenge

An agent that cannot evaluate the quality of its own thinking will repeat ineffective patterns. True intelligence requires:
- Real-time assessment of reasoning quality
- Detection of cognitive biases and failure modes
- Dynamic strategy adjustment based on context
- Learning from past reasoning successes and failures

**Key Insight:** It's not enough to execute well—the agent must *know* when it's thinking well and when it's not.

---

## 2. Reasoning Quality Dimensions

### Core Quality Metrics

```javascript
const ReasoningQualityMetrics = {
  // 1. Logical Coherence (0-1)
  coherence: (reasoning) => {
    // Check for logical consistency
    const contradictions = detectContradictions(reasoning);
    const nonSequiturs = detectNonSequiturs(reasoning);
    const circularLogic = detectCircularReasoning(reasoning);

    return 1 - ((contradictions + nonSequiturs + circularLogic) / reasoning.length);
  },

  // 2. Completeness (0-1)
  completeness: (reasoning, goal) => {
    // Check if all aspects of goal are addressed
    const goalAspects = extractGoalAspects(goal);
    const addressedAspects = reasoning.filter(step =>
      goalAspects.some(aspect => step.content.includes(aspect))
    );

    return addressedAspects.length / goalAspects.length;
  },

  // 3. Depth (0-1)
  depth: (reasoning) => {
    // Count levels of causal/logical chains
    const causalDepth = (reasoning.match(/because|therefore|implies|leads to/gi) || []).length;
    const hypotheticals = (reasoning.match(/if.*then|suppose|consider/gi) || []).length;
    const meta = (reasoning.match(/this approach|this strategy|this reasoning/gi) || []).length;

    return Math.min((causalDepth + hypotheticals * 1.5 + meta * 2) / 20, 1);
  },

  // 4. Efficiency (0-1)
  efficiency: (reasoning, outcome) => {
    // Steps needed vs optimal path
    const actualSteps = reasoning.length;
    const optimalSteps = estimateOptimalPath(reasoning[0].goal, outcome);

    return Math.max(0, 1 - ((actualSteps - optimalSteps) / optimalSteps));
  },

  // 5. Creativity (0-1)
  creativity: (reasoning, historicalPatterns) => {
    // How novel is this reasoning approach?
    const approachSignature = extractApproachSignature(reasoning);
    const similarity = historicalPatterns.map(pattern =>
      cosineSimilarity(approachSignature, pattern)
    );
    const maxSimilarity = Math.max(...similarity);

    // Novel approaches score higher
    return 1 - maxSimilarity;
  },

  // 6. Confidence Calibration (0-1)
  calibration: (reasoning, outcome) => {
    // Did stated confidence match actual correctness?
    const statedConfidence = extractConfidenceStatements(reasoning);
    const actualCorrectness = outcome.success ? 1 : 0;

    return 1 - Math.abs(statedConfidence.avg - actualCorrectness);
  }
};
```

---

## 3. Cognitive Strategy Catalog

```javascript
const CognitiveStrategies = {
  // Strategy 1: Depth-First Exploration
  depthFirst: {
    name: 'Depth-First Exploration',
    when: 'Well-defined problem with clear path',
    approach: {
      prompt_emphasis: 'Follow single solution path to completion before exploring alternatives',
      tool_usage: 'Sequential, hypothesis-driven',
      evaluation: 'Defer evaluation until complete solution'
    },
    strengths: ['Efficient for clear problems', 'Reduces cognitive load'],
    weaknesses: ['Can get stuck in local optima', 'Misses alternative approaches']
  },

  // Strategy 2: Breadth-First Exploration
  breadthFirst: {
    name: 'Breadth-First Exploration',
    when: 'Novel problem with uncertain solution space',
    approach: {
      prompt_emphasis: 'Generate multiple solution candidates before committing to one',
      tool_usage: 'Parallel exploration, diverse tool combinations',
      evaluation: 'Early comparison of alternatives'
    },
    strengths: ['Good for complex/ambiguous problems', 'Finds creative solutions'],
    weaknesses: ['Higher overhead', 'Can be overwhelming']
  },

  // Strategy 3: Analogical Reasoning
  analogical: {
    name: 'Analogical Reasoning',
    when: 'Problem similar to past solved problems',
    approach: {
      prompt_emphasis: 'Search for similar past problems, adapt successful patterns',
      tool_usage: 'History search first, then adapted execution',
      evaluation: 'Compare to analogy success criteria'
    },
    strengths: ['Leverages past experience', 'Fast for similar problems'],
    weaknesses: ['Can force inappropriate mappings', 'Less creative']
  },

  // Strategy 4: Constraint-Based
  constraintBased: {
    name: 'Constraint-Based Problem Solving',
    when: 'Problem with hard constraints or safety requirements',
    approach: {
      prompt_emphasis: 'Identify all constraints first, generate only valid solutions',
      tool_usage: 'Verification-heavy, constraint checking tools',
      evaluation: 'Constraint satisfaction is primary metric'
    },
    strengths: ['Safe, reliable', 'Good for regulated domains'],
    weaknesses: ['May miss creative solutions', 'Slower']
  },

  // Strategy 5: Iterative Refinement
  iterativeRefinement: {
    name: 'Iterative Refinement',
    when: 'Complex problem requiring multiple passes',
    approach: {
      prompt_emphasis: 'Quick first solution, then improve through iterations',
      tool_usage: 'Build, test, refine cycle',
      evaluation: 'Progressive improvement tracking'
    },
    strengths: ['Handles complexity well', 'Always produces something'],
    weaknesses: ['May settle for local optima', 'Time-intensive']
  }
};
```

---

## 4. Strategy Selection System

```javascript
const StrategySelector = {
  // Analyze current situation and select strategy
  selectStrategy: async (goal, context, recentPerformance) => {
    // Feature extraction
    const features = {
      goalComplexity: assessComplexity(goal),
      novelty: compareToHistory(goal, context.goalHistory),
      constraintLevel: detectConstraints(goal),
      timeAvailable: context.maxCycles - context.currentCycle,
      recentSuccessRate: recentPerformance.successRate,
      recentCreativity: recentPerformance.avgCreativity
    };

    // Strategy scoring
    const scores = Object.entries(CognitiveStrategies).map(([key, strategy]) => {
      let score = 0;

      // Complexity matching
      if (features.goalComplexity > 0.7 && strategy === CognitiveStrategies.iterativeRefinement) {
        score += 0.3;
      }

      // Novelty matching
      if (features.novelty > 0.8 && strategy === CognitiveStrategies.breadthFirst) {
        score += 0.3;
      } else if (features.novelty < 0.3 && strategy === CognitiveStrategies.analogical) {
        score += 0.3;
      }

      // Constraint matching
      if (features.constraintLevel > 0.5 && strategy === CognitiveStrategies.constraintBased) {
        score += 0.2;
      }

      // Performance-based adjustment
      if (features.recentSuccessRate < 0.6) {
        // If struggling, try more exploratory strategies
        if (strategy === CognitiveStrategies.breadthFirst) score += 0.2;
      }

      return { strategy: key, score };
    });

    // Select highest scoring strategy
    scores.sort((a, b) => b.score - a.score);
    return CognitiveStrategies[scores[0].strategy];
  },

  // Adjust strategy mid-execution if needed
  shouldAdjustStrategy: (currentStrategy, progress, cycles) => {
    // If stuck for 3+ cycles, consider switching
    if (progress.stuckCount >= 3) {
      return {
        adjust: true,
        reason: 'Stuck on current path',
        suggestion: CognitiveStrategies.breadthFirst
      };
    }

    // If making good progress, continue
    if (progress.recentProgress > 0.3) {
      return { adjust: false, reason: 'Making progress' };
    }

    // If approaching cycle limit, switch to efficient strategy
    if (cycles.remaining < 5) {
      return {
        adjust: true,
        reason: 'Limited cycles remaining',
        suggestion: CognitiveStrategies.depthFirst
      };
    }

    return { adjust: false };
  }
};
```

---

## 5. Real-Time Reasoning Monitor

```javascript
const ReasoningMonitor = {
  // Continuously evaluate reasoning during execution
  evaluateStep: async (step, context) => {
    const evaluation = {
      timestamp: Date.now(),
      cycle: context.currentCycle,
      step: step,

      // Immediate quality checks
      quality: {
        hasRationale: step.content.includes('because') || step.content.includes('rationale'),
        hasHypothesis: step.content.match(/I (think|expect|hypothesize)/i),
        hasVerification: step.content.match(/verify|check|confirm/i),
        addressesGoal: goalAlignment(step.content, context.goal)
      },

      // Detect warning signs
      warnings: []
    };

    // Warning: Circular reasoning
    if (detectCircularReasoning([step])) {
      evaluation.warnings.push({
        type: 'circular_reasoning',
        severity: 'high',
        suggestion: 'Reframe approach from different angle'
      });
    }

    // Warning: No progress
    if (context.recentSteps.every(s => !s.changed_state)) {
      evaluation.warnings.push({
        type: 'no_progress',
        severity: 'high',
        suggestion: 'Try different tool or reframe goal'
      });
    }

    // Warning: Low confidence
    if (step.confidence < 0.3) {
      evaluation.warnings.push({
        type: 'low_confidence',
        severity: 'medium',
        suggestion: 'Gather more information before proceeding'
      });
    }

    return evaluation;
  },

  // Generate intervention suggestions
  suggestIntervention: (evaluations) => {
    const recentWarnings = evaluations.slice(-5)
      .flatMap(e => e.warnings);

    if (recentWarnings.length >= 3) {
      return {
        intervene: true,
        action: 'strategy_change',
        message: 'Multiple reasoning quality warnings detected. Consider switching cognitive strategy.',
        suggestedStrategies: identifyBetterStrategies(recentWarnings)
      };
    }

    return { intervene: false };
  }
};
```

---

## 6. Learning from Reasoning Patterns

```javascript
const ReasoningLearner = {
  // Build pattern library from successful reasoning
  extractSuccessPatterns: (historicalCycles) => {
    const successful = historicalCycles.filter(c => c.outcome.success);

    const patterns = successful.map(cycle => {
      return {
        goalType: classifyGoalType(cycle.goal),
        strategyUsed: cycle.cognitiveStrategy,
        reasoningSignature: extractApproachSignature(cycle.reasoning),
        qualityScores: calculateQualityScores(cycle),
        toolSequence: cycle.toolCalls.map(t => t.tool),
        successMetrics: {
          cycles_taken: cycle.totalCycles,
          tool_efficiency: cycle.toolCalls.length / cycle.totalCycles,
          reasoning_quality: cycle.reasoningQuality
        }
      };
    });

    // Cluster similar patterns
    return clusterPatterns(patterns);
  },

  // Recommend reasoning approach based on learned patterns
  recommendApproach: (goal, learnedPatterns) => {
    const goalType = classifyGoalType(goal);
    const relevantPatterns = learnedPatterns.filter(p =>
      p.goalType === goalType && p.successMetrics.reasoning_quality > 0.7
    );

    if (relevantPatterns.length === 0) {
      return {
        recommendation: 'No strong precedent',
        approach: 'breadth_first', // Default for novel problems
        confidence: 0.3
      };
    }

    // Find best performing pattern
    const best = relevantPatterns.reduce((a, b) =>
      a.successMetrics.reasoning_quality > b.successMetrics.reasoning_quality ? a : b
    );

    return {
      recommendation: `Similar goals succeeded with ${best.strategyUsed}`,
      approach: best.strategyUsed,
      confidence: 0.8,
      historicalSuccess: best.successMetrics
    };
  }
};
```

---

## 7. Integration with Agent Loop

```javascript
// In agent-loop.js

// Before cycle starts
const selectedStrategy = await StrategySelector.selectStrategy(
  state.currentGoal,
  state,
  recentPerformance
);
console.log(`[MCOG] Using cognitive strategy: ${selectedStrategy.name}`);

// During cycle
const stepEval = await ReasoningMonitor.evaluateStep(step, state);
if (stepEval.warnings.length > 0) {
  console.warn(`[MCOG] Reasoning warnings:`, stepEval.warnings);
}

// Check for intervention
const intervention = ReasoningMonitor.suggestIntervention(recentEvaluations);
if (intervention.intervene) {
  console.log(`[MCOG] Intervention suggested: ${intervention.message}`);
  // Optionally pause and prompt strategy change
}

// After cycle completes
const reasoningQuality = await evaluateCycleReasoning(cycle);
await recordReasoningPattern(cycle, reasoningQuality);
```

---

## 8. Success Criteria

A working meta-cognitive evaluator demonstrates:

1. **Self-Awareness:** Agent can accurately assess quality of its own reasoning
2. **Adaptive Behavior:** Switches strategies when current approach isn't working
3. **Learning:** Performance improves over time as pattern library grows
4. **Error Detection:** Catches reasoning errors before they lead to failures
5. **Strategic Diversity:** Uses different strategies for different problem types

---

## 9. Dashboard Widget

```javascript
class MetaCognitiveWidget extends HTMLElement {
  render() {
    const recentEvals = getRecentEvaluations(10);
    const currentStrategy = getCurrentStrategy();

    this.shadowRoot.innerHTML = `
      <style>/* ... */</style>
      <div class="mcog-panel">
        <h4>🧠 Meta-Cognitive Evaluator</h4>

        <div class="current-strategy">
          <strong>Active Strategy:</strong> ${currentStrategy.name}
          <div class="strategy-rationale">${currentStrategy.approach.prompt_emphasis}</div>
        </div>

        <div class="quality-scores">
          <div class="score-item">
            <label>Coherence</label>
            <div class="score-bar" style="width: ${recentEvals.avg.coherence * 100}%"></div>
          </div>
          <div class="score-item">
            <label>Depth</label>
            <div class="score-bar" style="width: ${recentEvals.avg.depth * 100}%"></div>
          </div>
          <div class="score-item">
            <label>Creativity</label>
            <div class="score-bar" style="width: ${recentEvals.avg.creativity * 100}%"></div>
          </div>
        </div>

        <div class="warnings">
          ${recentEvals.warnings.map(w => `
            <div class="warning-item ${w.severity}">
              ${w.type}: ${w.suggestion}
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

Meta-cognition is thinking about thinking. This system makes the agent aware of *how* it reasons, not just *what* it concludes. By continuously evaluating and improving its cognitive strategies, the agent achieves true recursive self-improvement at the reasoning level.
