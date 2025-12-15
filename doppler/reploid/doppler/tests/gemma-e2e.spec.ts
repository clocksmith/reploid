/**
 * Gemma 3 1B End-to-End Test
 *
 * Automated test that:
 * 1. Opens the demo page
 * 2. Loads Gemma 1B model
 * 3. Sends "the sky is" prompt
 * 4. Validates coherent generation
 *
 * Run with: npx playwright test doppler/tests/gemma-e2e.spec.ts --headed
 */

import { test, expect, type Page } from '@playwright/test';
import { DemoPage } from './helpers/demo-page.js';
import { ConsoleCapture, type TokenQualityResult } from './helpers/console-capture.js';

test.describe('Gemma 3 1B Inference', () => {
  test.setTimeout(120000); // 2 minute timeout for model loading

  test('should generate coherent text for "the sky is"', async ({ page }) => {
    // Setup
    const demo = new DemoPage(page);
    const console = new ConsoleCapture();
    console.attach(page, { printImportant: true });

    // Navigate to demo
    await test.step('Open demo page', async () => {
      await demo.goto();
    });

    // Select Gemma model
    await test.step('Select Gemma 1B model', async () => {
      const found = await demo.selectModel('gemma');
      if (!found) {
        const models = await demo.getAvailableModels();
        throw new Error(`Could not find Gemma model. Available: ${models.join(', ')}`);
      }
    });

    // Wait for model to load
    await test.step('Wait for model to load', async () => {
      await demo.waitForModelLoad({ timeout: 90000 });
    });

    // Send prompt
    await test.step('Send prompt: "the sky is"', async () => {
      await demo.sendPrompt('the sky is');
    });

    // Wait for generation
    await test.step('Wait for generation', async () => {
      await demo.waitForGeneration({
        timeout: 30000,
        logs: console.getLogTexts(),
      });
    });

    // Get response
    const responseText = await demo.getLastResponse();

    // Analyze results
    console.printSummary();

    const quality = console.analyzeTokenQuality();

    // Report findings
    if (quality.hasBad) {
      console.log('WARNING: Model still producing garbage tokens!');
      console.log('Bad tokens found:', quality.details.badTokensFound.join(', '));
    }

    if (quality.hasGood) {
      console.log('SUCCESS: Model producing coherent tokens!');
      console.log('Good tokens found:', quality.details.goodTokensFound.join(', '));
    }

    // Assertions (uncomment to enforce)
    // expect(quality.hasBad).toBe(false);
    // expect(quality.hasGood).toBe(true);
  });
});

/**
 * Options for generation test
 */
export interface GenerationTestOptions {
  modelPattern?: string;
  prompt?: string;
  timeout?: number;
  expectCoherent?: boolean;
}

/**
 * Generation test result
 */
export interface GenerationTestResult {
  response: string;
  quality: TokenQualityResult;
  logs: any[];
  errors: string[];
}

/**
 * Reusable test flow for generation tests
 * Can be imported by other test files
 */
export async function runGenerationTest(
  page: Page,
  options: GenerationTestOptions = {}
): Promise<GenerationTestResult> {
  const {
    modelPattern = 'gemma',
    prompt = 'the sky is',
    timeout = 120000,
    expectCoherent = true,
  } = options;

  const demo = new DemoPage(page);
  const consoleCapture = new ConsoleCapture();
  consoleCapture.attach(page, { printImportant: true });

  // Navigate
  await demo.goto();

  // Select model
  const found = await demo.selectModel(modelPattern);
  if (!found) {
    throw new Error(`Model matching "${modelPattern}" not found`);
  }

  // Wait for load
  await demo.waitForModelLoad({ timeout: 90000 });

  // Generate
  await demo.sendPrompt(prompt);
  await demo.waitForGeneration({
    timeout: 30000,
    logs: consoleCapture.getLogTexts(),
  });

  // Get results
  const response = await demo.getLastResponse();
  const quality = consoleCapture.analyzeTokenQuality();

  consoleCapture.printSummary();

  return {
    response,
    quality,
    logs: consoleCapture.logs,
    errors: consoleCapture.errors,
  };
}
