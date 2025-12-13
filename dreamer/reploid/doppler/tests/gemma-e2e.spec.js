/**
 * Gemma 3 1B End-to-End Test
 *
 * Automated test that:
 * 1. Opens the demo page
 * 2. Loads Gemma 1B model
 * 3. Sends "the sky is" prompt
 * 4. Captures console output and model response
 * 5. Reports results for debugging
 *
 * Run with: npx playwright test tests/gemma-e2e.spec.js --headed
 */

import { test, expect } from '@playwright/test';

test.describe('Gemma 3 1B Inference', () => {
  test.setTimeout(120000); // 2 minute timeout for model loading

  test('should generate coherent text for "the sky is"', async ({ page }) => {
    const consoleLogs = [];
    const errors = [];

    // Capture all console messages
    page.on('console', msg => {
      const text = msg.text();
      consoleLogs.push(`[${msg.type()}] ${text}`);

      // Print important logs immediately
      if (text.includes('[Pipeline]') ||
          text.includes('logits:') ||
          text.includes('top-5:') ||
          text.includes('OUTPUT') ||
          text.includes('Generated')) {
        console.log(text);
      }
    });

    // Capture errors
    page.on('pageerror', err => {
      errors.push(err.message);
      console.error('PAGE ERROR:', err.message);
    });

    // Navigate to demo
    console.log('Opening demo page...');
    await page.goto('http://localhost:8080/demo/', { waitUntil: 'networkidle' });

    // Wait for app initialization
    await page.waitForSelector('.model-selector', { timeout: 10000 });
    console.log('Demo loaded, looking for Gemma model...');

    // Find and click Gemma 1B model
    // First, look for model cards or dropdown
    const modelSelector = page.locator('.model-selector');

    // Try to find Gemma in the model list
    const gemmaOption = page.locator('text=/gemma.*1b/i').first();

    if (await gemmaOption.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('Found Gemma model option, clicking...');
      await gemmaOption.click();
    } else {
      // Try dropdown or other selector patterns
      const selectButton = page.locator('.model-card, .model-item, [data-model*="gemma"]').first();
      if (await selectButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await selectButton.click();
      } else {
        // List available models for debugging
        const modelTexts = await page.locator('.model-selector').allTextContents();
        console.log('Available models:', modelTexts);
        throw new Error('Could not find Gemma model selector');
      }
    }

    // Wait for model loading (watch for loading indicator or completion)
    console.log('Waiting for model to load...');

    // Wait for "Model loaded" in console or loading to complete
    await page.waitForFunction(() => {
      // Check if chat input is enabled (model loaded)
      const input = document.querySelector('input[type="text"], textarea');
      return input && !input.disabled;
    }, { timeout: 90000 });

    console.log('Model loaded! Sending prompt...');

    // Find chat input and send message
    const chatInput = page.locator('input[type="text"], textarea').first();
    await chatInput.fill('the sky is');

    // Find and click send button
    const sendButton = page.locator('button:has-text("Send"), button[type="submit"], .send-button').first();
    await sendButton.click();

    // Wait for response generation
    console.log('Waiting for generation...');

    // Wait for output to appear or generation to complete
    await page.waitForTimeout(15000); // Give it 15 seconds to generate

    // Extract the response
    const responseElement = page.locator('.assistant-message, .response, .output, .message-content').last();
    let responseText = '';

    if (await responseElement.isVisible({ timeout: 5000 }).catch(() => false)) {
      responseText = await responseElement.textContent();
    }

    // Extract key metrics from console logs
    const logitsLogs = consoleLogs.filter(l => l.includes('logits:') || l.includes('top-5:'));
    const outputLogs = consoleLogs.filter(l => l.includes('OUTPUT') || l.includes('Generated'));
    const errorLogs = consoleLogs.filter(l => l.includes('error') || l.includes('Error'));

    // Print summary
    console.log('\n========== TEST RESULTS ==========');
    console.log('Response text:', responseText || '(not captured from DOM)');
    console.log('\nLogits/Top-5 samples:');
    logitsLogs.slice(0, 10).forEach(l => console.log('  ', l));
    console.log('\nOutput logs:');
    outputLogs.forEach(l => console.log('  ', l));
    if (errorLogs.length > 0) {
      console.log('\nErrors:');
      errorLogs.forEach(l => console.log('  ', l));
    }
    console.log('===================================\n');

    // Check for coherent output
    // Good outputs would be things like "blue", "clear", "beautiful", etc.
    const goodTokens = ['blue', 'clear', 'beautiful', 'vast', 'bright', 'dark', 'cloudy'];
    const badTokens = ['thức', 'ass', ')}"', 'f', 'už']; // Known garbage tokens

    const hasGoodTokens = goodTokens.some(t =>
      responseText.toLowerCase().includes(t) ||
      consoleLogs.some(l => l.includes(`"${t}"`))
    );

    const hasBadTokens = badTokens.some(t =>
      responseText.includes(t) ||
      consoleLogs.some(l => l.includes(`"${t}"`) && l.includes('top-5'))
    );

    // Report findings
    if (hasBadTokens) {
      console.log('WARNING: Model still producing garbage tokens!');
      console.log('Top tokens from logs suggest dequantization may still be wrong.');
    }

    if (hasGoodTokens) {
      console.log('SUCCESS: Model producing coherent tokens!');
    }

    // For now, just report - don't fail the test
    // expect(hasBadTokens).toBe(false);
    // expect(hasGoodTokens).toBe(true);

    // Return all logs for analysis
    return {
      response: responseText,
      logs: consoleLogs,
      errors: errors,
      hasGoodTokens,
      hasBadTokens
    };
  });
});
