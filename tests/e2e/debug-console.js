/**
 * Playwright Debug Script - Streams browser console to terminal
 *
 * Usage:
 *   node tests/e2e/debug-console.js                    # Basic boot check
 *   HEADLESS=false node tests/e2e/debug-console.js    # Headed mode (visible browser)
 *   TEST_AWAKEN=true node tests/e2e/debug-console.js  # Run with default goal
 *   GOAL=rsi node tests/e2e/debug-console.js          # Use preset goal
 *   GOAL="custom goal text" node tests/e2e/debug-console.js  # Custom goal
 *   TIMEOUT=120000 TEST_AWAKEN=true node tests/e2e/debug-console.js  # Extended timeout
 *
 * Environment Variables:
 *   HEADLESS      - true/false (default: true)
 *   TEST_AWAKEN   - true/false - run the awaken flow (default: false)
 *   GOAL          - preset name or custom goal text
 *   TIMEOUT       - ms to wait after awakening (default: 60000)
 *   GENESIS       - genesis level: minimal/default/full/tabula (default: full)
 *   BASE_URL      - server URL (default: http://localhost:8080)
 *   KEEP_OPEN     - keep browser open for manual testing (default: true if headed)
 */

import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
const KEEP_OPEN = process.env.KEEP_OPEN !== 'false';

// Built-in goal presets (use GOAL=preset_name)
const GOAL_PRESETS = {
  // Quick tests (< 30s expected)
  hello: 'Create a simple hello.txt file with the text "Hello from REPLOID".',
  list: 'List all files in the VFS root directory.',
  read: 'Read the contents of /tools/ListFiles.js and summarize what it does.',

  // RSI (Recursive Self-Improvement)
  rsi: 'Create a tool called meta_tool_factory that can create other tools from natural language descriptions. Then use it to create at least 2 useful tools.',
  toolchain: 'Build a recursive tool chain: create a tool that creates tools, then use that tool to create 3 more tools, then analyze those tools for improvements.',
  selfaudit: 'Audit your own tool implementations in /tools/. Read each file, identify potential improvements, and create a report summarizing your findings.',

  // Exploration
  map: 'Map the entire codebase structure. List all directories, count files by type, identify the main entry points, and summarize the architecture.',
  deps: 'Analyze the module dependencies in /core/. Create a dependency graph showing which modules depend on which others.',
  security: 'Perform a security audit of the codebase. Look for potential vulnerabilities in file operations, user input handling, and external API calls.',

  // Multi-step
  refactor: 'Create a detailed refactoring plan for the VFS module. Read the current implementation, identify code smells, and propose specific improvements.',
  testgen: 'Analyze the /tools/ directory and generate test cases for 3 tools that don\'t have comprehensive tests yet.',
  docs: 'Read the /core/ modules and generate documentation comments for any functions that lack them. Focus on agent-loop.js.',

  // Workers (Full Substrate)
  parallel: 'Use SpawnWorker to create 2 explore workers: one to analyze /core/ and one to analyze /tools/. Then synthesize their findings.',
  workers: 'Spawn 3 workers in sequence: first to list files, second to read a specific file, third to summarize. Coordinate their outputs.',

  // Edge cases
  error: 'Try to read a file that doesn\'t exist (/nonexistent/file.js). Handle the error gracefully and report what happened.',
  empty: 'Check if the VFS has any files. If not, create a simple hello.txt file. If yes, list the first 5 files.',
  long: 'Generate a detailed analysis of the codebase that spans at least 500 words. Include file counts, module summaries, and architecture observations.',

  // Creative
  newtool: 'Design and implement a new tool called "FileStats" that returns statistics about a file (size, line count, character count).',
  improve: 'Read the Grep.js tool in /tools/. Suggest 2 specific improvements and explain why they would be beneficial.',

  // Stress test
  stress: 'Create a recursive tool chain: build a tool called meta_tool_factory that can create other tools from natural language descriptions. Then use meta_tool_factory to create at least 3 useful tools. Then analyze those tools for improvements and enhance them. Keep iterating and improving - there is always room for optimization.',
};

// Resolve goal from preset or use directly
function resolveGoal(goalInput) {
  if (!goalInput) return null;
  const preset = GOAL_PRESETS[goalInput.toLowerCase()];
  return preset || goalInput;
}

async function run() {
  console.log('\n=== REPLOID Debug Console ===');
  console.log(`Target: ${BASE_URL}`);
  console.log(`Headless: ${process.env.HEADLESS !== 'false'}`);
  console.log(`Test Awaken: ${process.env.TEST_AWAKEN === 'true'}`);

  if (process.env.TEST_AWAKEN === 'true') {
    const goalInput = process.env.GOAL || 'rsi';
    const goal = resolveGoal(goalInput);
    console.log(`Goal preset: ${goalInput}`);
    console.log(`Goal: ${goal?.substring(0, 80)}...`);
  }

  console.log('\nStreaming all browser console output...\n');

  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== 'false',
    devtools: false,
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  // Stream ALL console messages
  page.on('console', msg => {
    const type = msg.type().toUpperCase().padEnd(7);
    const text = msg.text();
    const location = msg.location();
    const loc = location.url ? `${location.url.split('/').pop()}:${location.lineNumber}` : '';

    const colors = {
      'LOG    ': '\x1b[37m',
      'INFO   ': '\x1b[36m',
      'WARN   ': '\x1b[33m',
      'ERROR  ': '\x1b[31m',
      'DEBUG  ': '\x1b[90m',
    };
    const color = colors[type] || '\x1b[37m';
    const reset = '\x1b[0m';

    console.log(`${color}[${type}]${reset} ${text}${loc ? ` (${loc})` : ''}`);
  });

  // Capture uncaught exceptions
  page.on('pageerror', error => {
    console.log('\x1b[31m[EXCEPTION]\x1b[0m', error.message);
    console.log('  Stack:', error.stack?.split('\n').slice(0, 5).join('\n  '));
  });

  // Capture failed requests
  page.on('requestfailed', request => {
    console.log('\x1b[31m[NET FAIL]\x1b[0m', request.url(), request.failure()?.errorText);
  });

  // Capture response errors (4xx, 5xx)
  page.on('response', response => {
    if (response.status() >= 400) {
      console.log(`\x1b[31m[HTTP ${response.status()}]\x1b[0m`, response.url());
    }
  });

  // Navigate to app
  console.log('--- Navigating to app ---\n');

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('\n--- Page loaded ---\n');

    // Wait for boot container
    await page.waitForSelector('#boot-container', { timeout: 10000 }).catch(() => {
      console.log('\x1b[33m[WARN]\x1b[0m Boot container not found within 10s');
    });

    // Log current state
    const title = await page.title();
    console.log(`\n--- App State ---`);
    console.log(`Title: ${title}`);
    console.log(`URL: ${page.url()}`);

    // Check for key elements
    const checks = [
      { selector: '#boot-container', name: 'Boot container' },
      { selector: '#awaken-btn', name: 'Awaken button' },
      { selector: '#goal-input', name: 'Goal input' },
      { selector: '[data-genesis]', name: 'Genesis selector' },
    ];

    console.log('\nElement checks:');
    for (const check of checks) {
      const exists = await page.locator(check.selector).count() > 0;
      const status = exists ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
      console.log(`  ${status} ${check.name} (${check.selector})`);
    }

    // Wait for boot to complete
    console.log('\n--- Waiting for boot to complete ---');
    await page.waitForTimeout(3000);

    // Test awaken flow if requested
    if (process.env.TEST_AWAKEN === 'true') {
      console.log('\n--- Testing Awaken Flow ---');

      // Configure model and genesis level
      const genesisLevel = process.env.GENESIS || 'full';
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        console.error('ERROR: GEMINI_API_KEY environment variable is required for awaken tests');
        process.exit(1);
      }

      await page.evaluate(({ key, genesis }) => {
        localStorage.setItem('REPLOID_GENESIS_LEVEL', genesis);
        localStorage.setItem('SELECTED_MODELS', JSON.stringify([{
          id: 'gemini-2.5-flash',
          name: 'Gemini 2.5 Flash',
          provider: 'gemini',
          hostType: 'browser-cloud'
        }]));
        localStorage.setItem('SELECTED_MODEL', 'gemini-2.5-flash');
        localStorage.setItem('AI_PROVIDER', 'gemini');
        localStorage.setItem('GEMINI_API_KEY', key);
      }, { key: apiKey, genesis: genesisLevel });

      // Reload to apply config
      console.log(`--- Reloading with genesis level: ${genesisLevel} ---`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(5000);

      // Select genesis mode
      await page.click(`.boot-mode-btn[data-mode="${genesisLevel}"]`).catch(() => {
        console.log(`\x1b[33m[WARN]\x1b[0m Mode button not found for: ${genesisLevel}`);
      });

      // Resolve and enter goal
      const goalInput = process.env.GOAL || 'rsi';
      const goal = resolveGoal(goalInput);

      console.log(`--- Goal: ${goal?.substring(0, 100)}... ---`);
      const goalEl = page.locator('#goal-input');
      await goalEl.fill(goal, { timeout: 10000 });

      // Click awaken
      const awakenBtn = page.locator('#awaken-btn');
      await awakenBtn.click();

      // Wait for agent to run
      const timeout = parseInt(process.env.TIMEOUT) || 60000;
      console.log(`\n--- Agent awakening, capturing output for ${timeout / 1000}s ---`);
      await page.waitForTimeout(timeout);

      // Log final state
      console.log('\n--- Final State ---');
      const agentState = await page.locator('#agent-state').textContent().catch(() => 'unknown');
      const cycleCount = await page.locator('#agent-cycle').textContent().catch(() => '0');
      console.log(`Agent State: ${agentState}`);
      console.log(`Cycle Count: ${cycleCount}`);

    } else {
      console.log('\n--- Waiting 3s for remaining async messages ---');
      await page.waitForTimeout(3000);
    }

    if (KEEP_OPEN && process.env.HEADLESS === 'false') {
      console.log('\n--- Browser open for manual testing ---');
      console.log('Press Ctrl+C to close\n');
      await new Promise(() => {});
    } else {
      console.log('\n--- Debug session complete ---');
    }

  } catch (err) {
    console.log('\x1b[31m[FATAL]\x1b[0m', err.message);
  } finally {
    if (!KEEP_OPEN) {
      await browser.close();
    }
  }
}

// Show available presets if --help
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('\nAvailable goal presets:\n');
  for (const [name, goal] of Object.entries(GOAL_PRESETS)) {
    console.log(`  ${name.padEnd(12)} - ${goal.substring(0, 60)}...`);
  }
  console.log('\nUsage: GOAL=preset_name TEST_AWAKEN=true node tests/e2e/debug-console.js\n');
  process.exit(0);
}

run().catch(console.error);
