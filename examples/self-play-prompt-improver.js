// Example: Self-Play Prompt Improver
// Demonstrates Level 2 RSI by using LLM to critique and improve prompts iteratively
// This is the "done right" version - not naive string concatenation

export default async function self_play_prompt_improver({
  initial_prompt = "You are a helpful AI assistant.",
  iterations = 5,
  model = null // Will use first available model if not specified
}) {
  console.log('[SelfPlayPromptImprover] Starting with:', initial_prompt);

  const evolution = [];
  let current_prompt = initial_prompt;

  // Store initial state
  evolution.push({
    iteration: 0,
    prompt: initial_prompt,
    weakness: "N/A (initial prompt)",
    improvement: "N/A"
  });

  for (let i = 0; i < iterations; i++) {
    console.log(`[SelfPlayPromptImprover] Iteration ${i + 1}/${iterations}...`);

    try {
      // Step 1: Ask LLM to identify ONE specific weakness
      console.log('[SelfPlayPromptImprover] Asking LLM to identify weakness...');
      const weaknessResponse = await window.REPLOID.llmClient.call(
        [
          {
            role: 'user',
            content: `Analyze this system prompt and identify ONE specific, actionable weakness:\n\n"${current_prompt}"\n\nRespond with ONLY the weakness description (1-2 sentences), nothing else. Be specific about what's missing or unclear.`
          }
        ],
        model || window.REPLOID.modelConfig[0] // Use specified model or first available
      );

      const weakness = weaknessResponse.content.trim();
      console.log('[SelfPlayPromptImprover] Identified weakness:', weakness);

      // Step 2: Ask LLM to rewrite the prompt to fix that specific weakness
      console.log('[SelfPlayPromptImprover] Asking LLM to fix weakness...');
      const improveResponse = await window.REPLOID.llmClient.call(
        [
          {
            role: 'user',
            content: `Original prompt: "${current_prompt}"\n\nWeakness identified: ${weakness}\n\nRewrite the prompt to fix this specific weakness. Output ONLY the improved prompt, no explanation, no quotes, no preamble. Just the new prompt text.`
          }
        ],
        model || window.REPLOID.modelConfig[0]
      );

      const improved_prompt = improveResponse.content.trim()
        .replace(/^["']|["']$/g, '') // Remove surrounding quotes if LLM added them
        .replace(/^Prompt: /i, '') // Remove "Prompt:" prefix if added
        .trim();

      console.log('[SelfPlayPromptImprover] Improved prompt:', improved_prompt.substring(0, 100) + '...');

      // Store evolution step
      evolution.push({
        iteration: i + 1,
        prompt: improved_prompt,
        weakness: weakness,
        improvement: `Fixed: ${weakness}`
      });

      // Update current prompt for next iteration
      current_prompt = improved_prompt;

    } catch (error) {
      console.error(`[SelfPlayPromptImprover] Error in iteration ${i + 1}:`, error);

      // Store error in evolution
      evolution.push({
        iteration: i + 1,
        prompt: current_prompt, // Keep previous prompt
        weakness: `ERROR: ${error.message}`,
        improvement: "N/A (error occurred)"
      });

      // Continue with next iteration despite error
    }
  }

  console.log('[SelfPlayPromptImprover] Evolution complete!');

  // Create HTML visualization
  const html = generateEvolutionHTML(evolution);

  // Update Live Preview
  try {
    await window.REPLOID.toolRunner.execute('update_preview', { html });
    console.log('[SelfPlayPromptImprover] Live Preview updated');
  } catch (error) {
    console.error('[SelfPlayPromptImprover] Failed to update preview:', error);
  }

  return {
    success: true,
    iterations: evolution.length - 1, // Exclude initial state
    evolution,
    final_prompt: current_prompt,
    message: `Prompt evolved through ${iterations} iterations of self-play critique`
  };
}

// Generate HTML visualization of prompt evolution
function generateEvolutionHTML(evolution) {
  const evolutionHTML = evolution.map(step => {
    const iterationColor = step.iteration === 0 ? '#888' : '#0ff';
    const promptBg = step.iteration === 0 ? '#1a1a1a' : '#0a1a1a';
    const weaknessColor = step.weakness.startsWith('ERROR') ? '#f00' : '#ff0';

    return `
      <div style="margin-bottom: 30px; border-left: 3px solid ${iterationColor}; padding-left: 15px;">
        <div style="font-size: 14px; color: ${iterationColor}; font-weight: bold; margin-bottom: 8px;">
          Iteration ${step.iteration}
        </div>

        <div style="
          padding: 15px;
          background: ${promptBg};
          border-radius: 4px;
          margin-bottom: 10px;
          font-family: 'Courier New', monospace;
          font-size: 13px;
          line-height: 1.6;
          color: #e0e0e0;
        ">
          ${step.prompt}
        </div>

        ${step.weakness !== 'N/A (initial prompt)' ? `
          <div style="font-size: 12px; margin-bottom: 5px;">
            <span style="color: #888;">Weakness:</span>
            <span style="color: ${weaknessColor}; font-style: italic;"> ${step.weakness}</span>
          </div>
        ` : ''}

        ${step.improvement !== 'N/A' && !step.improvement.startsWith('N/A') ? `
          <div style="font-size: 12px;">
            <span style="color: #888;">Improvement:</span>
            <span style="color: #0f0;"> ${step.improvement}</span>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  return `
    <div style="font-family: 'Courier New', monospace; padding: 20px; color: #e0e0e0; max-width: 100%;">
      <h2 style="margin: 0 0 10px 0; color: #0ff; font-size: 24px;">
        Self-Play Prompt Evolution
      </h2>

      <p style="margin: 0 0 30px 0; color: #888; font-size: 13px;">
        Each iteration, the LLM critiques the prompt and suggests one specific improvement.
        This demonstrates <strong style="color: #f0f;">Level 2 RSI</strong>: the AI is improving its own improvement process.
      </p>

      ${evolutionHTML}

      <div style="margin-top: 40px; padding: 20px; background: rgba(0, 255, 255, 0.1); border: 1px solid #0ff; border-radius: 4px;">
        <div style="font-size: 14px; color: #0ff; font-weight: bold; margin-bottom: 10px;">
          📊 Evolution Summary
        </div>
        <div style="font-size: 12px; color: #aaa; line-height: 1.8;">
          <strong>Total Iterations:</strong> ${evolution.length - 1}<br>
          <strong>Initial Prompt Length:</strong> ${evolution[0].prompt.length} chars<br>
          <strong>Final Prompt Length:</strong> ${evolution[evolution.length - 1].prompt.length} chars<br>
          <strong>Growth:</strong> ${((evolution[evolution.length - 1].prompt.length / evolution[0].prompt.length - 1) * 100).toFixed(1)}%
        </div>
      </div>

      <div style="margin-top: 20px; font-size: 11px; color: #666; text-align: center;">
        Generated by REPLOID Self-Play Prompt Improver • This is recursive self-improvement in action
      </div>
    </div>
  `;
}

// Export metadata for tool registry
self_play_prompt_improver.metadata = {
  name: 'self_play_prompt_improver',
  description: 'Iteratively improve prompts using LLM self-critique (Level 2 RSI)',
  parameters: {
    initial_prompt: 'Starting prompt to improve (default: "You are a helpful AI assistant.")',
    iterations: 'Number of improvement cycles (default: 5)',
    model: 'Model config to use (optional, defaults to first available model)'
  },
  returns: {
    success: 'boolean',
    iterations: 'number',
    evolution: 'array of {iteration, prompt, weakness, improvement}',
    final_prompt: 'string',
    message: 'string'
  },
  example: `
// Basic usage
await self_play_prompt_improver({
  initial_prompt: "You are a code assistant.",
  iterations: 5
});

// Advanced: specify model
await self_play_prompt_improver({
  initial_prompt: "You are an expert in recursion.",
  iterations: 10,
  model: {id: 'gemini-2.0-flash-exp', provider: 'Gemini'}
});
  `
};
