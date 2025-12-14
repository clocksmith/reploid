#!/usr/bin/env node
/**
 * Quick GPT-OSS 20B Test Runner
 *
 * Run with: node tests/test-gptoss.js
 * Requires: npm install playwright (if not already installed)
 */

import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:8080/demo/';
const PROMPT = 'the color of the sky is';
const TIMEOUT = 300000; // 5 minutes total timeout for 20B model

async function runTest() {
  console.log('='.repeat(60));
  console.log('GPT-OSS 20B Inference Test');
  console.log('='.repeat(60));

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  const logs = [];
  const importantLogs = [];

  // Capture console
  page.on('console', msg => {
    const text = msg.text();
    logs.push(text);

    // Filter important logs
    if (text.includes('Prefill logits:') ||
        text.includes('Decode[') ||
        text.includes('OUTPUT') ||
        text.includes('Generated') ||
        text.includes('top-5:') ||
        text.includes('[Pipeline]') ||
        text.includes('[DOPPLERDemo]') ||
        text.includes('[DopplerLoader]') ||
        text.includes('[DEBUG]') ||
        text.includes('Loading model') ||
        text.includes('Error') ||
        text.includes('from browser') ||
        text.includes('cached') ||
        text.includes('expert') ||
        text.includes('MoE') ||
        text.includes('router')) {
      importantLogs.push(text);
      console.log(text);
    }
  });

  page.on('pageerror', err => {
    console.error('PAGE ERROR:', err.message);
  });

  try {
    // Open page
    console.log('\n[1/5] Opening demo page...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for model list
    console.log('[2/5] Waiting for UI...');
    await page.waitForSelector('#model-list', { timeout: 10000 });

    // Wait a bit for models to populate
    await page.waitForTimeout(2000);

    console.log('[3/5] Looking for GPT-OSS 20B model...');

    // Model structure: .model-item contains .model-name and .model-btn.run
    const modelItems = await page.locator('.model-item').all();
    console.log(`Found ${modelItems.length} model items`);

    let clicked = false;

    for (let i = 0; i < modelItems.length; i++) {
      const nameElem = modelItems[i].locator('.model-name');
      const name = await nameElem.textContent().catch(() => '');
      console.log(`Model ${i}: "${name}"`);

      // Look for GPT-OSS 20B
      if (name.toLowerCase().includes('gptoss') || name.toLowerCase().includes('20b')) {
        console.log(`Found GPT-OSS 20B at index ${i}`);
        const runBtn = modelItems[i].locator('.model-btn.run').first();
        if (await runBtn.isVisible().catch(() => false)) {
          await runBtn.click();
          clicked = true;
          console.log('Clicked GPT-OSS 20B Run button');
          break;
        }
      }
    }

    if (!clicked) {
      console.log('Could not find GPT-OSS 20B Run button');
      await browser.close();
      return;
    }

    // Wait for model to load (this may take a long time for 20B)
    console.log('[4/5] Loading model (this may take 2-3 minutes for 20B MoE)...');

    // Wait for the chat input to become enabled (indicates model is loaded)
    try {
      await page.waitForFunction(() => {
        const textarea = document.querySelector('#chat-input');
        return textarea && !textarea.disabled;
      }, { timeout: 180000 }); // 3 minute timeout for 20B
      console.log('Model loaded - chat input enabled');
    } catch (e) {
      // Check if there was an error
      const errorText = logs.join(' ');
      if (errorText.includes('Error') || errorText.includes('failed')) {
        console.log('\nLoading may have failed. Recent logs:');
        logs.slice(-10).forEach(l => console.log('  ', l.slice(0, 150)));
      }
      throw e;
    }

    // Small delay to ensure everything is ready
    await page.waitForTimeout(1000);

    // Send prompt
    console.log(`[5/5] Sending prompt: "${PROMPT}"`);
    const textarea = page.locator('#chat-input');
    await textarea.fill(PROMPT);

    // Click send or press Enter
    const sendBtn = page.locator('#send-btn');
    if (await sendBtn.isEnabled({ timeout: 1000 }).catch(() => false)) {
      await sendBtn.click();
    } else {
      await textarea.press('Enter');
    }

    // Wait for generation (watch for output in logs)
    console.log('\nWaiting for generation (90s max)...\n');

    // Wait until we see generation complete or timeout
    const startTime = Date.now();
    let sawOutput = false;

    while (Date.now() - startTime < 90000) {
      await page.waitForTimeout(1000);

      // Check if we've seen OUTPUT log
      const hasOutput = logs.some(l => l.includes('OUTPUT') || l.includes('Generated'));
      if (hasOutput && !sawOutput) {
        sawOutput = true;
        console.log('\n>>> Generation detected, waiting 3s more...');
        await page.waitForTimeout(3000);
        break;
      }
    }

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('TEST RESULTS');
    console.log('='.repeat(60));

    // Extract logits info
    const prefillLog = importantLogs.find(l => l.includes('Prefill logits:'));
    if (prefillLog) {
      console.log('\nPrefill logits:');
      console.log('  ', prefillLog);
    }

    // Extract decode logs
    const decodeLogs = importantLogs.filter(l => l.includes('Decode['));
    if (decodeLogs.length > 0) {
      console.log('\nDecode steps:');
      decodeLogs.slice(0, 5).forEach(l => console.log('  ', l));
    }

    // Extract top-5 tokens
    const top5Logs = importantLogs.filter(l => l.includes('top-5:'));
    if (top5Logs.length > 0) {
      console.log('\nTop-5 token distributions:');
      top5Logs.slice(0, 5).forEach(l => {
        const match = l.match(/top-5: (.+)$/);
        if (match) console.log('  ', match[1]);
      });
    }

    // Extract final output
    const outputLog = importantLogs.find(l => l.includes('OUTPUT') || l.includes('Output text:'));
    if (outputLog) {
      console.log('\nOutput from logs:');
      console.log(outputLog);
    }

    // Check for good/bad tokens in the top-5 distributions
    const allText = importantLogs.join(' ');

    // This test uses English prompts and expects English output.
    // Good tokens we expect for "the sky is" / "the color of the sky is" prompts
    const goodTokens = [
      'blue', 'clear', 'beautiful', 'vast', 'dark', 'night', 'bright',
      'color', 'sky', 'The', 'is', 'a', 'the', 'usually', 'often',
    ];

    // Unexpected tokens for English output - indicate model/dequantization issues.
    // Non-English text or placeholder tokens suggest the model isn't working correctly.
    const badTokens = [
      'thức',      // Vietnamese - unexpected for English prompt
      ')}"',       // Symbol sequence - likely tokenizer issue
      'už',        // Czech/Slovak - unexpected for English prompt
      '<unused',   // Placeholder tokens from vocab
      'unused>',
      'మా',        // Telugu - unexpected for English prompt
      'ನ',         // Kannada - unexpected for English prompt
      'ക',         // Malayalam - unexpected for English prompt
      '്',         // Malayalam virama - unexpected for English prompt
      '(?!',       // Regex pattern - indicates corruption
    ];

    const hasGood = goodTokens.some(t => allText.toLowerCase().includes(t.toLowerCase()));
    const hasBad = badTokens.some(t => allText.includes(t));

    console.log('\n' + '-'.repeat(40));
    if (hasBad) {
      console.log('STATUS: FAIL - Producing garbage tokens');
      console.log('Found bad tokens in output.');
    } else if (hasGood) {
      console.log('STATUS: PASS - Producing coherent tokens!');
    } else {
      console.log('STATUS: UNKNOWN - Check logs above');
    }
    console.log('-'.repeat(40));

    // Keep browser open for inspection
    console.log('\nBrowser will stay open for 30s for inspection...');
    console.log('Check the browser console for full logs.');
    await page.waitForTimeout(30000);

  } catch (err) {
    console.error('\nTest failed with error:', err.message);

    // Dump recent logs for debugging
    console.log('\nRecent console logs:');
    logs.slice(-30).forEach(l => console.log('  ', l.slice(0, 200)));

  } finally {
    await browser.close();
  }
}

runTest().catch(console.error);
