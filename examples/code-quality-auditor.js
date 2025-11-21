/**
 * Example: Code Quality Auditor
 * Level: 1 (Tool Usage / Domain Task)
 * 
 * Demonstrates using the agent's read capabilities and LLM inference
 * to perform a specific job (auditing code) without modifying the agent itself.
 */

export default async function code_quality_auditor({
  file_path = "/core/agent-loop.js",
  focus_area = "performance" // security, readability, performance
}) {
  console.log(`[Auditor] Starting audit of ${file_path} focusing on ${focus_area}...`);

  // 1. Validation & Setup
  if (!window.REPLOID?.vfs) {
    return { success: false, error: "VFS not available" };
  }

  // 2. Read Target File
  let code;
  try {
    code = await window.REPLOID.vfs.read(file_path);
    console.log(`[Auditor] Read ${code.length} bytes from ${file_path}`);
  } catch (e) {
    return { success: false, error: `File not found: ${file_path}` };
  }

  // 3. Update Preview (Loading State)
  await updatePreview(file_path, "Analyzing...", null);

  // 4. Perform Analysis (The "Work")
  // We use the first available model configuration
  const activeModel = getActiveModel();
  
  const prompt = `
    Analyze the following JavaScript code specifically for ${focus_area}.
    Code Snippet:
    \`\`\`javascript
    ${code.substring(0, 5000)} ${code.length > 5000 ? '...(truncated)' : ''}
    \`\`\`
    
    Return a JSON object (no markdown formatting) with:
    {
      "score": (number 1-100),
      "summary": (string, 1 sentence),
      "issues": [
        { "line": (number or null), "severity": "high/medium/low", "description": "string" }
      ],
      "suggestion": (string, specific code improvement)
    }
  `;

  let report;
  try {
    const response = await window.REPLOID.llmClient.chat(
      [{ role: 'user', content: prompt }],
      activeModel
    );
    
    // Sanitize and parse JSON
    const jsonStr = response.content.replace(/```json\n?|```/g, '').trim();
    report = JSON.parse(jsonStr);
    
  } catch (error) {
    console.error('[Auditor] Analysis failed:', error);
    await updatePreview(file_path, "Analysis Failed", { error: error.message });
    return { success: false, error: error.message };
  }

  // 5. Visualize Results
  await updatePreview(file_path, "Audit Complete", report);

  return {
    success: true,
    file: file_path,
    score: report.score,
    issue_count: report.issues.length
  };
}

// Helper to get active model configuration
function getActiveModel() {
  try {
    const savedModels = JSON.parse(localStorage.getItem('SELECTED_MODELS') || '[]');
    return savedModels[0] || null;
  } catch (e) { return null; }
}

// Helper to render visualization
async function updatePreview(path, status, report) {
  if (!window.REPLOID?.toolRunner) return;

  let detailsHtml = '';
  if (report && !report.error) {
    const color = report.score > 80 ? '#0f0' : report.score > 50 ? '#fb0' : '#f00';
    
    const issuesHtml = report.issues.map(issue => `
      <div style="margin-bottom: 8px; border-left: 3px solid ${issue.severity === 'high' ? '#f00' : '#888'}; padding-left: 10px;">
        <span style="color: #fff; font-size: 0.9em;">${issue.description}</span>
      </div>
    `).join('');

    detailsHtml = `
      <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 20px;">
        <div style="
          width: 60px; height: 60px; border-radius: 50%; 
          border: 4px solid ${color}; display: flex; 
          align-items: center; justify-content: center; 
          font-size: 24px; font-weight: bold; color: ${color};">
          ${report.score}
        </div>
        <div>
          <div style="color: #888; font-size: 12px; text-transform: uppercase;">Assessment</div>
          <div style="color: #fff; font-size: 14px;">${report.summary}</div>
        </div>
      </div>
      <div style="background: rgba(255,255,255,0.05); padding: 15px; border-radius: 4px;">
        <h4 style="margin: 0 0 10px 0; color: #bbb;">Detected Issues</h4>
        ${issuesHtml}
      </div>
    `;
  } else if (report && report.error) {
    detailsHtml = `<div style="color: #f00; padding: 20px;">Error: ${report.error}</div>`;
  } else {
    detailsHtml = `<div style="color: #888; padding: 20px; font-style: italic;">Waiting for LLM...</div>`;
  }

  const html = `
    <div style="font-family: monospace; padding: 20px; color: #e0e0e0;">
      <h2 style="color: #4fc3f7; border-bottom: 1px solid #333; padding-bottom: 10px; display: flex; justify-content: space-between;">
        <span>⚲ Code Auditor</span>
        <span style="font-size: 0.6em; color: #666; padding-top: 10px;">${status}</span>
      </h2>
      <div style="margin: 15px 0; font-size: 12px; color: #888;">Target: ${path}</div>
      ${detailsHtml}
    </div>
  `;

  await window.REPLOID.toolRunner.execute('update_preview', { html });
}

// Metadata
code_quality_auditor.metadata = {
  name: 'code_quality_auditor',
  description: 'Analyzes VFS files for quality/security (Level 1 RSI Pattern)',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path to the file to analyze' },
      focus_area: { type: 'string', enum: ['security', 'performance', 'readability'] }
    },
    required: ['file_path']
  }
};
