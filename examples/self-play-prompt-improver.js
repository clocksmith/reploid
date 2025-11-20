/**
 * Example: Self-Play Prompt Improver
 * Level: 2 (Meta-Cognition / Self-Improvement)
 * 
 * Demonstrates using the LLM to critique and refine its own prompts iteratively.
 * Uses the Live Preview panel to visualize the evolution.
 */

export default async function self_play_prompt_improver({
  initial_prompt = "You are a helpful AI assistant.",
  iterations = 5,
  model = null
}) {
  console.log('[SelfPlay] Starting prompt evolution...');

  // 1. Resolve Model (Compatible with new boot.js architecture)
  let activeModel = model;
  if (!activeModel) {
    try {
      // Try to get from localStorage (saved by boot/model-config.js)
      const savedModels = JSON.parse(localStorage.getItem('SELECTED_MODELS') || '[]');
      if (savedModels.length > 0) {
        activeModel = savedModels[0];
      } else {
        throw new Error("No active models found in configuration");
      }
    } catch (e) {
      return { success: false, error: "Could not resolve a model to run this tool. Please configure a model in the boot screen." };
    }
  }

  const evolution = [];
  let current_prompt = initial_prompt;

  // Store initial state
  evolution.push({
    iteration: 0,
    prompt: initial_prompt,
    weakness: "N/A (initial seed)",
    improvement: "N/A"
  });

  // Update Preview immediately
  await updatePreview(evolution);

  for (let i = 0; i < iterations; i++) {
    console.log(`[SelfPlay] Iteration ${i + 1}/${iterations}...`);

    try {
      // Step A: Critique (Identify Weakness)
      const weaknessResp = await window.REPLOID.llmClient.chat(
        [
          { role: 'system', content: 'You are a harsh critic. Identify ONE specific weakness in the user provided prompt.' },
          { role: 'user', content: `Prompt: "${current_prompt}"\n\nIdentify ONE specific, actionable weakness. Respond ONLY with the weakness description.` }
        ],
        activeModel
      );
      const weakness = weaknessResp.content.trim();

      // Step B: Refine (Fix Weakness)
      const improveResp = await window.REPLOID.llmClient.chat(
        [
          { role: 'system', content: 'You are an expert prompt engineer. Rewrite the prompt to fix the identified weakness.' },
          { role: 'user', content: `Original: "${current_prompt}"\nWeakness: ${weakness}\n\nRewrite the prompt to fix this. Output ONLY the new prompt.` }
        ],
        activeModel
      );
      
      let improved_prompt = improveResp.content.trim().replace(/^["']|["']$/g, ''); // Strip quotes

      // Record Step
      evolution.push({
        iteration: i + 1,
        prompt: improved_prompt,
        weakness: weakness,
        improvement: `Fixed: ${weakness.substring(0, 50)}...`
      });

      current_prompt = improved_prompt;

      // Update Visualization
      await updatePreview(evolution);

    } catch (error) {
      console.error(`[SelfPlay] Error in iteration ${i + 1}:`, error);
      evolution.push({ iteration: i + 1, prompt: current_prompt, weakness: `ERROR: ${error.message}`, improvement: "Failed" });
      break; // Stop on error
    }
  }

  return {
    success: true,
    final_prompt: current_prompt,
    iterations_completed: evolution.length - 1,
    message: "Check Live Preview for evolution history."
  };
}

// Helper to update the Live Preview panel via ToolRunner
async function updatePreview(evolution) {
  if (!window.REPLOID?.toolRunner) return;

  const html = `
    <div style="font-family: monospace; padding: 20px; color: #e0e0e0;">
      <h2 style="color: #0ff; border-bottom: 1px solid #333; padding-bottom: 10px;">🧬 Prompt Evolution DNA</h2>
      ${evolution.map(step => `
        <div style="margin-bottom: 20px; background: rgba(255,255,255,0.05); padding: 15px; border-radius: 5px; border-left: 3px solid ${step.iteration === 0 ? '#888' : '#0f0'};">
          <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
            <strong style="color: #0ff;">Gen ${step.iteration}</strong>
            <span style="color: #888; font-size: 0.8em;">${step.prompt.length} chars</span>
          </div>
          <div style="color: #fff; margin-bottom: 10px; line-height: 1.4;">${step.prompt}</div>
          ${step.iteration > 0 ? `
            <div style="font-size: 0.9em; color: #ff7b72;">🔴 Critique: ${step.weakness}</div>
            <div style="font-size: 0.9em; color: #7ee787;">🟢 Action: ${step.improvement}</div>
          ` : ''}
        </div>
      `).join('')}
    </div>
  `;

  await window.REPLOID.toolRunner.execute('update_preview', { html });
}

// Metadata for Tool Registry
self_play_prompt_improver.metadata = {
  name: 'self_play_prompt_improver',
  description: 'Evolves a prompt using iterative self-critique (Level 2 RSI Pattern)',
  parameters: {
    type: 'object',
    properties: {
      initial_prompt: { type: 'string', description: 'The seed prompt to start with' },
      iterations: { type: 'number', description: 'How many evolution cycles to run' }
    }
  }
};