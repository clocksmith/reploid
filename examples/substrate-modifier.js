
/**
 * Example: Substrate Optimizer
 * Level: 3 (Substrate Modification / Kernel Surgery)
 * 
 * Demonstrates reading core agent source code, planning an architectural change,
 * and applying it via the meta-tool-writer.
 * 
 * ⚠️ DANGER: This modifies running code. Use dry_run=true to test safely.
 */

export default async function substrate_optimizer({
  target_module = "tool-runner",
  optimization_goal = "Add performance logging to tool execution",
  dry_run = true
}) {
  console.log(`[Optimizer] Analyzing substrate module: ${target_module}`);
  
  // 1. Read the Substrate
  const modulePath = `/core/${target_module}.js`;
  let sourceCode;
  try {
    sourceCode = await window.REPLOID.vfs.read(modulePath);
  } catch (e) {
    return { success: false, error: `Core module not found: ${modulePath}` };
  }

  // 2. Visualize Current State
  await updatePreview(target_module, "Analyzing Substrate...", null, dry_run);

  // 3. Generate Optimized Code via LLM
  const activeModel = getActiveModel();
  const prompt = `
    You are a Senior Architect optimization engine.
    Target Module: ${target_module}.js
    Goal: ${optimization_goal}
    
    Current Code:
    \`\`\`javascript
    ${sourceCode}
    \`\`\`
    
    Return the FULL, VALID JavaScript code for the modified module.
    - Maintain the existing factory pattern structure exactly.
    - Only implement the requested optimization.
    - Do not remove existing functionality.
    - Output ONLY the code block.
  `;

  console.log('[Optimizer] Requesting architectural changes...');
  const response = await window.REPLOID.llmClient.chat(
    [{ role: 'user', content: prompt }],
    activeModel
  );

  const newCode = response.content
    .replace(/^```javascript\n?|^```js\n?|^```/g, '')
    .replace(/```$/g, '')
    .trim();

  // 4. Calculate Diff stats (simple heuristic)
  const oldLines = sourceCode.split('\n').length;
  const newLines = newCode.split('\n').length;
  const diffStat = newLines - oldLines;
  const diffString = diffStat > 0 ? `+${diffStat}` : `${diffStat}`;

  // 5. Apply or Simulate
  let resultMessage;
  
  if (dry_run) {
    console.log('[Optimizer] Dry Run: Changes generated but not applied.');
    resultMessage = "Dry Run Complete. Changes ready for review.";
    
    // Visualize the proposal
    await updatePreview(target_module, "Proposal Generated", {
      diff: diffString,
      preview: newCode.substring(0, 500) + "\n...[rest of code]..."
    }, dry_run);

  } else {
    console.log('[Optimizer] APPLYING CHANGES TO KERNEL...');
    
    // Call the Level 3 Meta-Tool
    try {
      const result = await window.REPLOID.toolRunner.execute('improve_core_module', {
        module: target_module,
        code: newCode
      });
      
      resultMessage = "Optimization Applied. Substrate updated.";
      await updatePreview(target_module, "Success: Kernel Updated", {
        diff: diffString,
        backup: result.backup
      }, dry_run);
      
    } catch (err) {
      return { success: false, error: `Kernel Update Failed: ${err.message}` };
    }
  }

  return {
    success: true,
    module: target_module,
    changes_lines: diffString,
    mode: dry_run ? "Simulation" : "Live Mutation",
    message: resultMessage
  };
}

// Helper: Get Model
function getActiveModel() {
  try {
    return JSON.parse(localStorage.getItem('SELECTED_MODELS') || '[]')[0];
  } catch (e) { return null; }
}

// Helper: Visualization
async function updatePreview(moduleName, status, data, isDryRun) {
  if (!window.REPLOID?.toolRunner) return;

  const modeColor = isDryRun ? '#ffd700' : '#ff00ff'; // Gold for Sim, Magenta for Level 3
  
  let content = '';
  if (data) {
    content = `
      <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 4px; margin-bottom: 15px;">
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
          <div>
            <div style="color: #888; font-size: 10px;">LINES CHANGED</div>
            <div style="color: ${parseInt(data.diff) >= 0 ? '#0f0' : '#f00'}; font-size: 18px; font-weight: bold;">${data.diff}</div>
          </div>
          <div>
            <div style="color: #888; font-size: 10px;">BACKUP CREATED</div>
            <div style="color: #fff; font-size: 12px;">${data.backup ? 'YES' : 'NO (Dry Run)'}</div>
          </div>
        </div>
        ${data.preview ? `<pre style="color: #aaa; font-size: 10px; border: 1px solid #333; padding: 10px; overflow-x: auto;">${data.preview}</pre>` : ''}
      </div>
    `;
  }

  const html = `
    <div style="font-family: monospace; padding: 20px; color: #e0e0e0;">
      <h2 style="color: ${modeColor}; border-bottom: 1px solid #333; padding-bottom: 10px;">
        ⚡ Substrate Optimizer (Level 3)
      </h2>
      <div style="display: flex; justify-content: space-between; margin: 15px 0; font-size: 12px;">
        <span style="color: #fff;">Target: <strong style="color: #4fc3f7">/core/${moduleName}.js</strong></span>
        <span style="border: 1px solid ${modeColor}; color: ${modeColor}; padding: 2px 6px; border-radius: 3px;">
          ${isDryRun ? 'DRY RUN' : 'LIVE MUTATION'}
        </span>
      </div>
      
      <div style="margin-bottom: 20px; color: #ccc; font-size: 14px; font-weight: bold;">
        ${status}
      </div>
      
      ${content}
      
      <div style="font-size: 11px; color: #666; margin-top: 20px; border-top: 1px dashed #333; padding-top: 10px;">
        ⚠️ Level 3 RSI involves modifying the agent's runtime code. 
        In non-dry-run mode, changes persist across reloads.
        Use "Safe Mode" (boot menu) if the agent becomes unstable.
      </div>
    </div>
  `;

  await window.REPLOID.toolRunner.execute('update_preview', { html });
}

// Metadata
substrate_optimizer.metadata = {
  name: 'substrate_optimizer',
  description: 'Reads and rewrites core modules to improve performance/functionality (Level 3 RSI)',
  parameters: {
    type: 'object',
    properties: {
      target_module: { type: 'string', description: 'Name of core module (e.g. "tool-runner")' },
      optimization_goal: { type: 'string', description: 'What to improve' },
      dry_run: { type: 'boolean', description: 'If true, only generates code without applying' }
    }
  }
};
