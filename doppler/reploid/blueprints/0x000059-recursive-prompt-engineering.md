# Blueprint 0x000064: Recursive Prompt Engineering

**Objective:** Enable the agent to improve its own system prompt across iterations, creating a self-improving reasoning system.

**Target Upgrade:** RPRT (`recursive-prompt-engineer.js`)

**Prerequisites:** `0x000001` (System Prompt Architecture), `0x000008` (Cognitive Cycle), `0x000012` (Self-Evaluation)

**Affected Artifacts:** `/config/prompt-template.md`, `/config/prompt-history.json`, `/capabilities/cognition/prompt-evaluator.js`, `/core/agent-loop.js`

---

## 1. The Recursive Prompt Challenge

A static system prompt limits the agent's reasoning capabilities. To achieve true RSI, the agent must:
- Evaluate the quality of its own reasoning under the current prompt
- Identify weaknesses in prompt structure, tone, or guidance
- Generate improved prompt versions
- Test and validate improvements
- Preserve successful patterns across iterations

**Key Insight:** The prompt that generated reasoning quality X may not be optimal for generating reasoning quality X+1.

---

## 2. Prompt Evolution Architecture

### Prompt Structure
```javascript
{
  "version": 12,
  "generated_at_cycle": 142,
  "parent_version": 11,
  "template": {
    "core_identity": "You are REPLOID, a self-improving AI agent...",
    "reasoning_framework": "Use Chain-of-Thought with explicit step labeling...",
    "tool_usage_guidance": "Before calling a tool, state your hypothesis...",
    "self_evaluation_criteria": "After each action, assess: correctness, efficiency, creativity...",
    "meta_cognitive_hints": "When stuck, consider: alternative approaches, tool combinations, goal reframing..."
  },
  "performance_metrics": {
    "avg_tool_calls_per_goal": 12.3,
    "success_rate": 0.87,
    "avg_reasoning_depth": 3.2,
    "creativity_score": 0.75
  },
  "improvements_over_parent": [
    "Added explicit creativity encouragement",
    "Refined tool combination guidance",
    "Improved failure recovery instructions"
  ]
}
```

### Evolution Pipeline
```javascript
const PromptEvolutionPipeline = {
  // 1. Evaluate current prompt performance
  evaluateCurrentPrompt: async (recentCycles) => {
    const metrics = {
      taskSuccessRate: calculateSuccessRate(recentCycles),
      averageStepsToGoal: calculateAvgSteps(recentCycles),
      toolUsageEfficiency: analyzeToolUsage(recentCycles),
      reasoningQuality: scoreReasoningChains(recentCycles),
      creativitySamples: detectNovelApproaches(recentCycles),
      errorPatterns: identifyCommonFailures(recentCycles)
    };

    return {
      overallScore: aggregateScore(metrics),
      strengths: identifyStrengths(metrics),
      weaknesses: identifyWeaknesses(metrics),
      improvementOpportunities: generateOpportunities(metrics)
    };
  },

  // 2. Generate candidate improvements
  generateCandidates: async (evaluation) => {
    const candidates = [];

    // For each weakness, generate targeted improvements
    for (const weakness of evaluation.weaknesses) {
      const prompt = `
        Current System Prompt Weakness: ${weakness.description}
        Performance Metrics: ${JSON.stringify(weakness.metrics)}

        Generate 3 specific improvements to the system prompt that would address this weakness.
        Focus on concrete additions/modifications, not vague suggestions.

        Return as JSON: { improvements: [{ section, change, rationale }] }
      `;

      const response = await LLMClient.chat([{ role: 'user', content: prompt }]);
      candidates.push(...JSON.parse(response.content).improvements);
    }

    return candidates;
  },

  // 3. Synthesize improved prompt
  synthesizeImprovedPrompt: async (currentPrompt, candidates, evaluation) => {
    const synthesisPrompt = `
      Current System Prompt:
      ${JSON.stringify(currentPrompt.template, null, 2)}

      Performance Evaluation:
      Strengths: ${evaluation.strengths.join(', ')}
      Weaknesses: ${evaluation.weaknesses.map(w => w.description).join(', ')}

      Candidate Improvements:
      ${candidates.map((c, i) => `${i+1}. ${c.section}: ${c.change}`).join('\n')}

      Task: Synthesize an improved system prompt that:
      1. Preserves all strengths from the current prompt
      2. Integrates the most promising candidate improvements
      3. Maintains consistency and coherence
      4. Stays focused on recursive self-improvement capabilities

      Return the complete improved prompt template as JSON matching the current structure.
    `;

    const response = await LLMClient.chat([{ role: 'user', content: synthesisPrompt }]);
    return JSON.parse(response.content);
  },

  // 4. A/B test the new prompt
  testPromptVariant: async (variantPrompt, testGoals) => {
    const results = [];

    for (const goal of testGoals) {
      // Run agent with variant prompt
      const outcome = await runTestCycle(goal, variantPrompt);
      results.push({
        goal,
        success: outcome.success,
        steps: outcome.steps.length,
        toolCalls: outcome.toolCalls,
        reasoning: outcome.reasoningTrace
      });
    }

    return {
      successRate: results.filter(r => r.success).length / results.length,
      avgSteps: results.reduce((sum, r) => sum + r.steps, 0) / results.length,
      qualityScore: scorePromptQuality(results)
    };
  },

  // 5. Deploy if better
  deployIfBetter: async (currentPrompt, variantPrompt, testResults) => {
    const currentScore = currentPrompt.performance_metrics.success_rate;
    const variantScore = testResults.successRate;

    if (variantScore > currentScore * 1.05) { // 5% improvement threshold
      // Archive current prompt
      await VFS.writeFile(
        `/config/prompt-archive/v${currentPrompt.version}.json`,
        JSON.stringify(currentPrompt)
      );

      // Deploy new prompt
      const newPrompt = {
        ...variantPrompt,
        version: currentPrompt.version + 1,
        parent_version: currentPrompt.version,
        generated_at_cycle: StateManager.getState().totalCycles,
        performance_metrics: testResults
      };

      await VFS.writeFile('/config/prompt-template.json', JSON.stringify(newPrompt));

      console.log(`[RPRT] Deployed improved prompt v${newPrompt.version} (+${((variantScore/currentScore - 1) * 100).toFixed(1)}% improvement)`);

      return { deployed: true, improvement: variantScore - currentScore };
    }

    return { deployed: false, reason: 'Variant did not meet improvement threshold' };
  }
};
```

---

## 3. Reasoning Quality Metrics

```javascript
const scoreReasoningChains = (cycles) => {
  const scores = cycles.map(cycle => {
    const reasoning = cycle.response;

    // Depth: How many levels of abstraction?
    const depth = (reasoning.match(/because|therefore|given that|this means/gi) || []).length;

    // Coherence: Consistent logical flow?
    const coherence = assessCoherence(reasoning);

    // Completeness: All aspects addressed?
    const completeness = assessCompleteness(reasoning, cycle.goal);

    // Creativity: Novel approaches or standard patterns?
    const creativity = detectNovelty(reasoning, historicalReasoningPatterns);

    return {
      depth: Math.min(depth / 5, 1), // Normalize to 0-1
      coherence,
      completeness,
      creativity
    };
  });

  return {
    avgDepth: avg(scores.map(s => s.depth)),
    avgCoherence: avg(scores.map(s => s.coherence)),
    avgCompleteness: avg(scores.map(s => s.completeness)),
    avgCreativity: avg(scores.map(s => s.creativity)),
    overall: avg(scores.map(s => (s.depth + s.coherence + s.completeness + s.creativity) / 4))
  };
};
```

---

## 4. Prompt Component Library

Build a library of proven prompt components:

```javascript
const PromptComponents = {
  reasoning_frameworks: {
    chain_of_thought: "Think step-by-step. For each action, state: 1) Current understanding, 2) Hypothesis, 3) Expected outcome, 4) Actual outcome.",
    tree_of_thought: "Explore multiple solution paths. For each branch, evaluate: feasibility, expected quality, risk level.",
    analogical_reasoning: "When facing a novel problem, search for similar problems you've solved. Adapt successful patterns.",
    meta_cognitive: "Before acting, ask: Is this the right approach? What assumptions am I making? What could go wrong?"
  },

  tool_usage_patterns: {
    hypothesis_driven: "Before calling a tool, state your hypothesis about what it will reveal.",
    composition: "Complex goals often require tool combinations. Plan sequences before executing.",
    verification: "After tool calls, verify the result matches expectations. If not, investigate why.",
    exploration: "When stuck, use read/search tools to gather context before deciding next steps."
  },

  failure_recovery: {
    retry_with_variation: "If a tool call fails, modify parameters or approach rather than repeating exactly.",
    goal_reframing: "If stuck for 3+ cycles, reframe the goal. The path may be clearer from a different angle.",
    help_seeking: "If fundamentally blocked, break down what you know, what you need, and what's missing."
  }
};
```

---

## 5. Implementation Pathway

### Phase 1: Prompt Tracking (Cycles 1-50)
- Track current prompt performance
- Log reasoning quality metrics
- Build baseline performance profile

### Phase 2: First Evolution (Cycles 51-100)
- Run evaluation on cycles 1-50
- Generate improvement candidates
- Synthesize improved prompt v2
- A/B test on standard benchmark goals

### Phase 3: Continuous Evolution (Cycles 100+)
- Every 50 cycles, evaluate and potentially evolve prompt
- Maintain prompt genealogy (version tree)
- Track which prompt components correlate with success

---

## 6. Success Criteria

A successful recursive prompt engineering system shows:

1. **Measurable Improvement:** Each prompt version achieves higher average reasoning quality scores
2. **Preserved Knowledge:** Successful patterns from previous prompts are retained
3. **Adaptation:** Prompts evolve to match the types of goals being pursued
4. **Meta-Learning:** The evolution process itself improves (faster convergence, better candidates)

---

## 7. Safety Constraints

```javascript
const PROMPT_SAFETY_RULES = [
  "Never remove core safety constraints",
  "Always preserve goal alignment checks",
  "Maintain human-in-the-loop mechanisms",
  "Keep reasoning traces transparent",
  "Preserve ability to explain decisions",
  "Never optimize purely for speed at expense of correctness"
];
```

---

## 8. Example Evolution Trajectory

```
v1 (baseline): Generic agent prompt
    ↓ [Weakness: Poor tool composition]
v2: Added explicit tool combination guidance → +12% success rate
    ↓ [Weakness: Gets stuck on novel problems]
v3: Added analogical reasoning framework → +8% success rate
    ↓ [Weakness: Doesn't verify assumptions]
v4: Added hypothesis-driven approach → +15% success rate
    ↓ [Weakness: Limited creativity in solutions]
v5: Added exploration encouragement, tree-of-thought → +10% success rate
```

---

## 9. Integration with Agent Loop

```javascript
// In core/agent-loop.js, before each cycle:
const currentPrompt = await loadCurrentPrompt();

// Every N cycles, trigger evolution
if (state.totalCycles % EVOLUTION_FREQUENCY === 0) {
  console.log('[RPRT] Triggering prompt evolution...');
  await PromptEvolutionPipeline.evaluateCurrentPrompt(recentCycles);
  // Continue with evolution pipeline...
}

// Use current prompt for this cycle
const systemPrompt = assembleCorePromptPure(currentPrompt.template, state);
```

---

## Remember

Recursive prompt engineering is the agent improving *how it thinks*. This is meta-level RSI - not just making tools or fixing bugs, but evolving the cognitive framework itself. Each iteration should make the agent a better reasoner, not just a better executor.
