#!/usr/bin/env node
/**
 * Unified Model Test Runner
 *
 * Consolidates test-gemma.js, test-mistral.js, test-gptoss.js, test-embed-load.js
 * into a single runner with two modes:
 *
 * - direct: Minimal HTML page, tests inference pipeline directly
 * - demo: Full demo UI, tests end-to-end user flow
 *
 * Usage:
 *   node test-runner.js gemma --direct
 *   node test-runner.js mistral --demo --headed
 *   node test-runner.js gptoss --inspect 30000
 *
 * @module tests/test-runner
 */

import { chromium, type Browser, type Page } from 'playwright';
import {
  URLS,
  MODELS,
  DEFAULT_PROMPT,
  analyzeTokens,
  getLogPatterns,
  isImportantLog,
  formatResults,
  parseArgs,
  printHelp,
  type TestResults,
  type ModelConfig,
} from './helpers/test-config.js';

interface TestConfig {
  model: string;
  prompt: string;
  inspectTime: number;
}

interface TestState {
  ready?: boolean;
  loaded?: boolean;
  done?: boolean;
  tokens?: string[];
  output?: string;
  errors?: string[];
}

/**
 * Run test in direct mode (minimal HTML page)
 */
async function runDirectMode(browser: Browser, config: TestConfig): Promise<TestResults> {
  const { model, prompt, inspectTime } = config;
  const modelConfig: ModelConfig = MODELS[model];

  console.log(`\n[Direct Mode] Testing ${modelConfig.name}`);
  console.log(`URL: ${URLS.minimal}`);
  console.log(`Prompt: "${prompt}"`);

  const page: Page = await browser.newPage();
  const logs: string[] = [];
  const importantLogs: string[] = [];
  const patterns = getLogPatterns(model);

  // Capture console
  page.on('console', msg => {
    const text = msg.text();
    logs.push(text);

    if (isImportantLog(text, patterns)) {
      importantLogs.push(text);
      console.log(text);
    }
  });

  page.on('pageerror', err => {
    console.error('PAGE ERROR:', err.message);
  });

  const results: TestResults = {
    modelName: modelConfig.name,
    mode: 'direct',
    loaded: false,
    generated: false,
    output: '',
    tokenAnalysis: null,
    elapsed: 0,
    errors: [],
  };

  const startTime = Date.now();

  try {
    // Navigate to minimal test page
    console.log('\n[1/4] Opening minimal test page...');
    await page.goto(URLS.minimal, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for page ready
    await page.waitForFunction(() => (window as any).testState?.ready, { timeout: 10000 });

    // Set prompt
    console.log('[2/4] Setting prompt...');
    await page.fill('#prompt-input', prompt);

    // Click run
    console.log('[3/4] Starting inference...');
    await page.click('#run-btn');

    // Wait for model to load
    console.log(`[4/4] Waiting for inference (timeout: ${modelConfig.timeouts.load + modelConfig.timeouts.generate}ms)...`);

    await page.waitForFunction(
      () => (window as any).testState?.loaded === true,
      { timeout: modelConfig.timeouts.load }
    );
    results.loaded = true;
    console.log('Model loaded');

    // Wait for generation to complete
    await page.waitForFunction(
      () => (window as any).testState?.done === true,
      { timeout: modelConfig.timeouts.generate }
    );

    // Get results from page
    const testState = await page.evaluate(() => (window as any).testState) as TestState;
    results.generated = (testState.tokens?.length || 0) > 0;
    results.output = testState.output || '';
    results.errors = testState.errors || [];

  } catch (err) {
    const error = err as Error;
    results.errors.push(error.message);
    console.error('\nTest error:', error.message);
  }

  results.elapsed = Date.now() - startTime;
  results.tokenAnalysis = analyzeTokens(logs.join(' ') + ' ' + results.output);

  // Print results
  console.log('\n' + formatResults(results));

  // Inspect time
  if (inspectTime > 0) {
    console.log(`\nBrowser staying open for ${inspectTime / 1000}s for inspection...`);
    await page.waitForTimeout(inspectTime);
  }

  await page.close();
  return results;
}

/**
 * Run test in demo mode (full UI)
 */
async function runDemoMode(browser: Browser, config: TestConfig): Promise<TestResults> {
  const { model, prompt, inspectTime } = config;
  const modelConfig: ModelConfig = MODELS[model];

  console.log(`\n[Demo Mode] Testing ${modelConfig.name}`);
  console.log(`URL: ${URLS.demo}`);
  console.log(`Prompt: "${prompt}"`);

  const page: Page = await browser.newPage();
  const logs: string[] = [];
  const importantLogs: string[] = [];
  const patterns = getLogPatterns(model);

  // Capture console
  page.on('console', msg => {
    const text = msg.text();
    logs.push(text);

    if (isImportantLog(text, patterns)) {
      importantLogs.push(text);
      console.log(text);
    }
  });

  page.on('pageerror', err => {
    console.error('PAGE ERROR:', err.message);
  });

  const results: TestResults = {
    modelName: modelConfig.name,
    mode: 'demo',
    loaded: false,
    generated: false,
    output: '',
    tokenAnalysis: null,
    elapsed: 0,
    errors: [],
  };

  const startTime = Date.now();

  try {
    // Navigate to demo
    console.log('\n[1/5] Opening demo page...');
    await page.goto(URLS.demo, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for model list
    console.log('[2/5] Waiting for UI...');
    await page.waitForSelector('#model-list', { timeout: 10000 });
    await page.waitForTimeout(2000);

    // Find and click model
    console.log(`[3/5] Selecting ${modelConfig.name}...`);
    let clicked = false;

    // Try finding model in list
    const modelItems = await page.locator('.model-item').all();
    console.log(`Found ${modelItems.length} model items`);

    for (let i = 0; i < modelItems.length; i++) {
      const nameElem = modelItems[i].locator('.model-name');
      const name = await nameElem.textContent().catch(() => '');

      const matchesSearch = modelConfig.searchTerms.some(term =>
        name.toLowerCase().includes(term.toLowerCase())
      );
      const matchesExclude = modelConfig.excludeTerms.some(term =>
        name.toLowerCase().includes(term.toLowerCase())
      );

      if (matchesSearch && !matchesExclude) {
        console.log(`Found: "${name}"`);
        const runBtn = modelItems[i].locator('.model-btn.run').first();
        if (await runBtn.isVisible().catch(() => false)) {
          await runBtn.click();
          clicked = true;
          console.log('Clicked Run button');
          break;
        }

        // Fallback: click the item itself
        try {
          await modelItems[i].click({ timeout: 2000 });
          clicked = true;
          console.log('Clicked model item');
          break;
        } catch {
          // Continue searching
        }
      }
    }

    if (!clicked) {
      // Fallback: try pattern match
      const textLocator = page.locator(`text=/${modelConfig.pattern.source}/i`).first();
      if (await textLocator.isVisible({ timeout: 2000 }).catch(() => false)) {
        await textLocator.click();
        clicked = true;
        console.log('Clicked via text pattern');
      }
    }

    if (!clicked) {
      throw new Error(`Could not find ${modelConfig.name} in model list`);
    }

    // Wait for model to load
    console.log(`[4/5] Loading model (timeout: ${modelConfig.timeouts.load}ms)...`);

    await page.waitForFunction(() => {
      const textarea = document.querySelector('#chat-input') as HTMLTextAreaElement | null;
      return textarea && !textarea.disabled;
    }, { timeout: modelConfig.timeouts.load });

    results.loaded = true;
    console.log('Model loaded - chat input enabled');

    await page.waitForTimeout(1000);

    // Send prompt
    console.log(`[5/5] Sending prompt: "${prompt}"`);
    const textarea = page.locator('#chat-input');
    await textarea.fill(prompt);

    const sendBtn = page.locator('#send-btn');
    if (await sendBtn.isEnabled({ timeout: 1000 }).catch(() => false)) {
      await sendBtn.click();
    } else {
      await textarea.press('Enter');
    }

    // Wait for generation
    console.log(`\nWaiting for generation (timeout: ${modelConfig.timeouts.generate}ms)...`);

    const genStartTime = Date.now();
    let sawOutput = false;

    while (Date.now() - genStartTime < modelConfig.timeouts.generate) {
      await page.waitForTimeout(1000);

      const hasOutput = logs.some(l =>
        l.includes('OUTPUT') || l.includes('Generated')
      );

      if (hasOutput && !sawOutput) {
        sawOutput = true;
        console.log('\n>>> Generation detected, waiting 3s more...');
        await page.waitForTimeout(3000);
        break;
      }
    }

    results.generated = sawOutput;

    // Try to get output from page
    const responseEl = page.locator('.assistant-message, .response, .output, .message-content').last();
    if (await responseEl.isVisible({ timeout: 2000 }).catch(() => false)) {
      results.output = await responseEl.textContent() || '';
    }

  } catch (err) {
    const error = err as Error;
    results.errors.push(error.message);
    console.error('\nTest error:', error.message);

    // Dump recent logs
    console.log('\nRecent logs:');
    logs.slice(-10).forEach(l => console.log('  ', l.slice(0, 150)));
  }

  results.elapsed = Date.now() - startTime;
  results.tokenAnalysis = analyzeTokens(logs.join(' ') + ' ' + results.output);

  // Print results
  console.log('\n' + formatResults(results));

  // Print detailed log analysis
  printLogAnalysis(importantLogs);

  // Inspect time
  if (inspectTime > 0) {
    console.log(`\nBrowser staying open for ${inspectTime / 1000}s for inspection...`);
    await page.waitForTimeout(inspectTime);
  }

  await page.close();
  return results;
}

/**
 * Print detailed log analysis
 */
function printLogAnalysis(logs: string[]): void {
  console.log('\n--- Log Analysis ---');

  // Prefill logits
  const prefillLog = logs.find(l => l.includes('Prefill logits:'));
  if (prefillLog) {
    console.log('\nPrefill logits:');
    console.log('  ', prefillLog);
  }

  // Decode steps
  const decodeLogs = logs.filter(l => l.includes('Decode['));
  if (decodeLogs.length > 0) {
    console.log('\nDecode steps (first 5):');
    decodeLogs.slice(0, 5).forEach(l => console.log('  ', l));
  }

  // Top-5 tokens
  const top5Logs = logs.filter(l => l.includes('top-5:'));
  if (top5Logs.length > 0) {
    console.log('\nTop-5 distributions (first 5):');
    top5Logs.slice(0, 5).forEach(l => {
      const match = l.match(/top-5: (.+)$/);
      if (match) console.log('  ', match[1]);
    });
  }

  // Output
  const outputLog = logs.find(l => l.includes('OUTPUT') || l.includes('Output text:'));
  if (outputLog) {
    console.log('\nOutput from logs:');
    console.log('  ', outputLog);
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Validate model
  if (!MODELS[args.model]) {
    console.error(`Unknown model: ${args.model}`);
    console.error(`Available: ${Object.keys(MODELS).join(', ')}`);
    process.exit(1);
  }

  const modelConfig: ModelConfig = MODELS[args.model];

  // Determine headless mode
  const headless = args.headless !== null
    ? args.headless
    : modelConfig.headless;

  console.log('='.repeat(60));
  console.log(`Model Test Runner`);
  console.log('='.repeat(60));
  console.log(`Model:    ${modelConfig.name}`);
  console.log(`Mode:     ${args.mode}`);
  console.log(`Headless: ${headless}`);
  console.log(`Prompt:   "${args.prompt}"`);

  // Launch browser
  const browser: Browser = await chromium.launch({ headless });

  try {
    const config: TestConfig = {
      model: args.model,
      prompt: args.prompt,
      inspectTime: args.inspectTime,
    };

    if (args.mode === 'direct') {
      await runDirectMode(browser, config);
    } else {
      await runDemoMode(browser, config);
    }

  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
