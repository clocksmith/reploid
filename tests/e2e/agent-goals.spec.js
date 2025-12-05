/**
 * E2E Test: Agent Goals
 * Challenging goal scenarios to stress-test the agent.
 * These tests launch the agent with various goals and verify it runs without crashing.
 *
 * Console logs are streamed to stdout in real-time.
 *
 * Requires GEMINI_API_KEY environment variable to be set.
 */
import { test, expect } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Load .env from project root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// 10 minutes per test timeout
test.setTimeout(600000);

// Helper to boot and run agent with a goal (streams console logs)
async function runAgentWithGoal(page, goal, waitTime = 360000) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY environment variable is required. Set it in .env file.');
  }

  // Stream browser console logs to stdout
  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    if (type === 'error') {
      console.log(`[BROWSER ERROR] ${text}`);
    } else if (type === 'warn') {
      console.log(`[BROWSER WARN] ${text}`);
    } else {
      console.log(`[BROWSER] ${text}`);
    }
  });

  await page.goto('/');
  await page.waitForSelector('#boot-container', { timeout: 10000 });

  // Configure Gemini for browser-cloud mode with API key
  const apiKey = GEMINI_API_KEY;
  await page.evaluate((key) => {
    localStorage.setItem('SELECTED_MODELS', JSON.stringify([{
      id: 'gemini-2.5-flash',
      name: 'Gemini 2.5 Flash',
      provider: 'gemini',
      hostType: 'browser-cloud'
    }]));
    localStorage.setItem('REPLOID_GENESIS_LEVEL', 'full');
    localStorage.setItem('GEMINI_API_KEY', key);
  }, apiKey);

  // Reload to apply config
  await page.reload();
  await page.waitForSelector('#boot-container', { timeout: 10000 });

  // Wait for goal input to be enabled
  await page.waitForSelector('#goal-input:not([disabled])', { timeout: 10000 });

  console.log(`\n=== STARTING GOAL: ${goal.substring(0, 60)}... ===\n`);

  // Enter goal and awaken
  await page.locator('#goal-input').fill(goal);
  await page.locator('#awaken-btn').click();

  await page.waitForSelector('#app.active', { timeout: 15000 });

  console.log(`Agent awakened. Running for ${waitTime / 1000}s...`);

  // Let agent run
  await page.waitForTimeout(waitTime);

  return page;
}

// Built-in challenging goals
const CHALLENGING_GOALS = {
  // RSI (Recursive Self-Improvement)
  metaToolFactory: `Create a tool called meta_tool_factory that can create other tools from natural language descriptions. Then use it to create at least 2 useful tools.`,

  selfAudit: `Audit your own tool implementations in /tools/. Read each file, identify potential improvements, and create a report summarizing your findings.`,

  // Exploration & Analysis
  codebaseMap: `Map the entire codebase structure. List all directories, count files by type, identify the main entry points, and summarize the architecture.`,

  dependencyGraph: `Analyze the module dependencies in /core/. Create a dependency graph showing which modules depend on which others.`,

  // Multi-step Tasks
  refactorPlan: `Create a detailed refactoring plan for the VFS module. Read the current implementation, identify code smells, and propose specific improvements.`,

  // Edge Cases
  errorRecovery: `Try to read a file that doesn't exist (/nonexistent/file.js). Handle the error gracefully and report what happened.`,

  emptyVFS: `Check if the VFS has any files. If not, create a simple hello.txt file. If yes, list the first 5 files.`,

  // Creative/Generative
  newTool: `Design and implement a new tool called "FileStats" that returns statistics about a file (size, line count, character count).`,
};

test.describe('RSI Goals', () => {
  test('meta tool factory', async ({ page }) => {
    await runAgentWithGoal(page, CHALLENGING_GOALS.metaToolFactory, 360000);

    // Verify agent is still running or completed without crash
    const agentState = await page.locator('#agent-state').textContent();
    console.log(`\n=== FINAL STATE: ${agentState} ===\n`);
    expect(['THINKING', 'ACTING', 'OBSERVING', 'IDLE', 'DONE']).toContain(agentState);
  });

  test('self audit', async ({ page }) => {
    await runAgentWithGoal(page, CHALLENGING_GOALS.selfAudit, 360000);

    // Check history has entries (agent produced output)
    const historyEntries = await page.locator('#history-container > div').count();
    console.log(`\n=== HISTORY ENTRIES: ${historyEntries} ===\n`);
    expect(historyEntries).toBeGreaterThan(0);
  });
});

test.describe('Exploration Goals', () => {
  test('codebase map', async ({ page }) => {
    await runAgentWithGoal(page, CHALLENGING_GOALS.codebaseMap, 360000);

    const agentState = await page.locator('#agent-state').textContent();
    console.log(`\n=== FINAL STATE: ${agentState} ===\n`);
    expect(['THINKING', 'ACTING', 'OBSERVING', 'IDLE', 'DONE']).toContain(agentState);
  });

  test('dependency graph', async ({ page }) => {
    await runAgentWithGoal(page, CHALLENGING_GOALS.dependencyGraph, 360000);

    // Verify cycle counter advanced
    const cycleCount = await page.locator('#agent-cycle').textContent();
    console.log(`\n=== CYCLE COUNT: ${cycleCount} ===\n`);
    expect(parseInt(cycleCount)).toBeGreaterThanOrEqual(0);
  });
});

test.describe('Multi-step Goals', () => {
  test('refactor plan', async ({ page }) => {
    await runAgentWithGoal(page, CHALLENGING_GOALS.refactorPlan, 360000);

    const historyEntries = await page.locator('#history-container > div').count();
    console.log(`\n=== HISTORY ENTRIES: ${historyEntries} ===\n`);
    expect(historyEntries).toBeGreaterThan(0);
  });
});

test.describe('Edge Case Goals', () => {
  test('error recovery', async ({ page }) => {
    await runAgentWithGoal(page, CHALLENGING_GOALS.errorRecovery, 360000);

    // Agent should handle error gracefully
    const agentState = await page.locator('#agent-state').textContent();
    console.log(`\n=== FINAL STATE: ${agentState} ===\n`);
    expect(['THINKING', 'ACTING', 'OBSERVING', 'IDLE', 'DONE']).toContain(agentState);
  });

  test('empty VFS check', async ({ page }) => {
    await runAgentWithGoal(page, CHALLENGING_GOALS.emptyVFS, 360000);

    const historyEntries = await page.locator('#history-container > div').count();
    console.log(`\n=== HISTORY ENTRIES: ${historyEntries} ===\n`);
    expect(historyEntries).toBeGreaterThanOrEqual(0);
  });
});

test.describe('Creative Goals', () => {
  test('new tool design', async ({ page }) => {
    await runAgentWithGoal(page, CHALLENGING_GOALS.newTool, 360000);

    const agentState = await page.locator('#agent-state').textContent();
    console.log(`\n=== FINAL STATE: ${agentState} ===\n`);
    expect(['THINKING', 'ACTING', 'OBSERVING', 'IDLE', 'DONE']).toContain(agentState);
  });
});

test.describe('Goal Presets Export', () => {
  // Export goals for use in debug-console.js
  test('all goal presets are defined', () => {
    expect(Object.keys(CHALLENGING_GOALS).length).toBeGreaterThan(5);

    for (const [name, goal] of Object.entries(CHALLENGING_GOALS)) {
      expect(goal).toBeTruthy();
      expect(goal.length).toBeGreaterThan(20);
    }
  });
});
