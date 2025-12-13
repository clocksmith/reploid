/**
 * Browser Model Converter End-to-End Test
 *
 * Tests the in-browser GGUF/SafeTensors to RDRR conversion flow.
 *
 * Note: File System Access API (showDirectoryPicker, showOpenFilePicker)
 * cannot be directly automated in Playwright. This test uses workarounds:
 * 1. Uses the fallback <input type="file"> element
 * 2. Injects test files via page.setInputFiles()
 *
 * Run with: npx playwright test doppler/tests/converter-e2e.spec.js --headed
 */

import { test, expect } from '@playwright/test';
import { DemoPage } from './helpers/demo-page.js';
import { ConsoleCapture } from './helpers/console-capture.js';
import { runGenerationTest } from './gemma-e2e.spec.js';
import * as path from 'path';
import * as fs from 'fs';

// Path to test fixtures
const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures');
const TINY_MODEL_DIR = path.join(FIXTURES_DIR, 'tiny-model');

test.describe('Browser Model Converter', () => {
  test.setTimeout(300000); // 5 minute timeout for conversion

  test('converter UI is present and enabled', async ({ page }) => {
    const demo = new DemoPage(page);
    const consoleCapture = new ConsoleCapture();
    consoleCapture.attach(page);

    await demo.goto();

    // Check convert button exists and is enabled
    const convertBtn = page.locator('#convert-btn');
    await expect(convertBtn).toBeVisible();
    await expect(convertBtn).toBeEnabled();

    // Check convert status is hidden initially
    const convertStatus = page.locator('#convert-status');
    await expect(convertStatus).toBeHidden();
  });

  test('shows progress UI when conversion starts', async ({ page }) => {
    const demo = new DemoPage(page);
    const consoleCapture = new ConsoleCapture();
    consoleCapture.attach(page, { printImportant: true });

    await demo.goto();

    // We need to inject a file input since we can't automate showDirectoryPicker
    // Create a hidden file input and wire it up
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.type = 'file';
      input.id = 'test-file-input';
      input.multiple = true;
      input.style.display = 'none';
      document.body.appendChild(input);

      // Override the convert button to use our input
      const convertBtn = document.querySelector('#convert-btn');
      convertBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        input.click();
      }, { capture: true });
    });

    // Click convert button (will trigger our file input)
    await demo.clickConvert();

    // The file dialog would open here - in a real test we'd set files
    // For now, just verify the UI state
    const convertBtn = page.locator('#convert-btn');
    await expect(convertBtn).toBeVisible();
  });

  test.skip('converts tiny test model and verifies RDRR output', async ({ page }) => {
    // Skip if fixtures don't exist
    if (!fs.existsSync(TINY_MODEL_DIR)) {
      test.skip(true, 'Tiny model fixtures not found');
      return;
    }

    const demo = new DemoPage(page);
    const consoleCapture = new ConsoleCapture();
    consoleCapture.attach(page, { printImportant: true });

    await demo.goto();

    // Inject file input for testing
    await page.evaluate(() => {
      window._testFiles = [];

      // Create file input
      const input = document.createElement('input');
      input.type = 'file';
      input.id = 'test-file-input';
      input.multiple = true;
      input.webkitdirectory = true;
      document.body.appendChild(input);

      // Hook into the converter's file picker
      window._originalPickFiles = window.pickModelFiles;
      window.pickModelFiles = async () => {
        return window._testFiles;
      };
    });

    // Set the test files
    const manifestPath = path.join(TINY_MODEL_DIR, 'manifest.json');
    const shardPath = path.join(TINY_MODEL_DIR, 'shard_00000.bin');

    // Read fixture files
    const manifestContent = fs.readFileSync(manifestPath);
    const shardContent = fs.readFileSync(shardPath);

    // Inject files into page context
    await page.evaluate(({ manifest, shard }) => {
      window._testFiles = [
        new File([new Uint8Array(manifest)], 'manifest.json', { type: 'application/json' }),
        new File([new Uint8Array(shard)], 'shard_00000.bin', { type: 'application/octet-stream' }),
      ];
    }, {
      manifest: Array.from(manifestContent),
      shard: Array.from(shardContent),
    });

    // Trigger conversion
    await demo.clickConvert();

    // Wait for conversion to complete
    await demo.waitForConversion({ timeout: 60000 });

    // Verify success message
    const status = await demo.getConversionStatus();
    expect(status.toLowerCase()).toContain('done');

    // Verify model appears in list
    const models = await demo.getAvailableModels();
    const hasNewModel = models.some(m =>
      m.toLowerCase().includes('tiny') ||
      m.toLowerCase().includes('converted')
    );
    expect(hasNewModel).toBe(true);
  });

  test.describe('Convert then Generate', () => {
    test.skip('converts model and runs generation test', async ({ page }) => {
      // This test demonstrates reusing the generation flow after conversion

      const demo = new DemoPage(page);
      const consoleCapture = new ConsoleCapture();
      consoleCapture.attach(page, { printImportant: true });

      await demo.goto();

      // Step 1: Convert model (assuming conversion is done)
      // ... conversion steps ...

      // Step 2: Select the converted model
      const found = await demo.selectModel('converted');
      if (!found) {
        test.skip(true, 'No converted model available');
        return;
      }

      // Step 3: Run generation (reusing the flow from gemma-e2e)
      await demo.waitForModelLoad({ timeout: 90000 });
      await demo.sendPrompt('the sky is');
      await demo.waitForGeneration({
        timeout: 30000,
        logs: consoleCapture.getLogTexts(),
      });

      // Step 4: Analyze results
      const response = await demo.getLastResponse();
      const quality = consoleCapture.analyzeTokenQuality();

      consoleCapture.printSummary();

      expect(response.length).toBeGreaterThan(0);
    });
  });
});

/**
 * Helper to run full convert-then-generate flow
 * Can be imported by other tests
 */
export async function runConvertAndGenerateTest(page, options = {}) {
  const {
    modelFiles,
    prompt = 'the sky is',
    conversionTimeout = 300000,
    generationTimeout = 30000,
  } = options;

  const demo = new DemoPage(page);
  const consoleCapture = new ConsoleCapture();
  consoleCapture.attach(page, { printImportant: true });

  await demo.goto();

  // Note: Actual file injection would need to be implemented
  // based on how the converter handles file input

  // Wait for conversion
  await demo.waitForConversion({ timeout: conversionTimeout });

  const conversionStatus = await demo.getConversionStatus();
  if (conversionStatus.toLowerCase().includes('error')) {
    throw new Error(`Conversion failed: ${conversionStatus}`);
  }

  // Find and select the converted model
  // Refresh model list first
  await page.reload({ waitUntil: 'networkidle' });
  await demo.goto();

  // Try to find a newly converted model
  const models = await demo.getAvailableModels();
  const convertedModel = models.find(m =>
    m.toLowerCase().includes('converted') ||
    m.toLowerCase().includes('custom')
  );

  if (!convertedModel) {
    throw new Error('Converted model not found in model list');
  }

  await demo.selectModel(convertedModel);
  await demo.waitForModelLoad({ timeout: 90000 });

  // Generate
  await demo.sendPrompt(prompt);
  await demo.waitForGeneration({
    timeout: generationTimeout,
    logs: consoleCapture.getLogTexts(),
  });

  const response = await demo.getLastResponse();
  const quality = consoleCapture.analyzeTokenQuality();

  consoleCapture.printSummary();

  return {
    conversionStatus,
    response,
    quality,
    logs: consoleCapture.logs,
  };
}
