#!/usr/bin/env node
/**
 * Quick Mistral 7B Test Runner
 *
 * Run with: node tests/test-mistral.js
 */

import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:8080/demo/';
const PROMPT = 'the color of the sky is';
const TIMEOUT = 180000;

async function runTest() {
  console.log('='.repeat(60));
  console.log('Mistral 7B Inference Test');
  console.log('='.repeat(60));

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  const logs = [];
  const importantLogs = [];

  page.on('console', msg => {
    const text = msg.text();
    logs.push(text);

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
        text.includes('rope')) {
      importantLogs.push(text);
      console.log(text);
    }
  });

  page.on('pageerror', err => {
    console.error('PAGE ERROR:', err.message);
  });

  try {
    console.log('\n[1/5] Opening demo page...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });

    console.log('[2/5] Waiting for UI...');
    await page.waitForSelector('#model-list', { timeout: 10000 });
    await page.waitForTimeout(2000);

    console.log('[3/5] Looking for Mistral 7B model...');

    const modelItems = await page.locator('.model-item').all();
    console.log(`Found ${modelItems.length} model items`);

    let clicked = false;

    for (let i = 0; i < modelItems.length; i++) {
      const nameElem = modelItems[i].locator('.model-name');
      const name = await nameElem.textContent().catch(() => '');
      console.log(`Model ${i}: "${name}"`);

      if (name.toLowerCase().includes('mistral') || name.toLowerCase().includes('7b')) {
        console.log(`Found Mistral at index ${i}`);
        const runBtn = modelItems[i].locator('.model-btn.run').first();
        if (await runBtn.isVisible().catch(() => false)) {
          await runBtn.click();
          clicked = true;
          console.log('Clicked Mistral 7B Run button');
          break;
        }
      }
    }

    if (!clicked) {
      console.log('Could not find Mistral 7B Run button');
      await browser.close();
      return;
    }

    console.log('[4/5] Loading model (this may take a while)...');

    try {
      await page.waitForFunction(() => {
        const textarea = document.querySelector('#chat-input');
        return textarea && !textarea.disabled;
      }, { timeout: 120000 });
      console.log('Model loaded - chat input enabled');
    } catch (e) {
      const errorText = logs.join(' ');
      if (errorText.includes('Error') || errorText.includes('failed')) {
        console.log('\nLoading may have failed. Recent logs:');
        logs.slice(-10).forEach(l => console.log('  ', l.slice(0, 150)));
      }
      throw e;
    }

    await page.waitForTimeout(1000);

    console.log(`[5/5] Sending prompt: "${PROMPT}"`);
    const textarea = page.locator('#chat-input');
    await textarea.fill(PROMPT);

    const sendBtn = page.locator('#send-btn');
    if (await sendBtn.isEnabled({ timeout: 1000 }).catch(() => false)) {
      await sendBtn.click();
    } else {
      await textarea.press('Enter');
    }

    console.log('\nWaiting for generation (60s max)...\n');

    const startTime = Date.now();
    let sawOutput = false;

    while (Date.now() - startTime < 60000) {
      await page.waitForTimeout(1000);

      const hasOutput = logs.some(l => l.includes('OUTPUT') || l.includes('Generated'));
      if (hasOutput && !sawOutput) {
        sawOutput = true;
        console.log('\n>>> Generation detected, waiting 3s more...');
        await page.waitForTimeout(3000);
        break;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('TEST RESULTS');
    console.log('='.repeat(60));

    const prefillLog = importantLogs.find(l => l.includes('Prefill logits:'));
    if (prefillLog) {
      console.log('\nPrefill logits:');
      console.log('  ', prefillLog);
    }

    const decodeLogs = importantLogs.filter(l => l.includes('Decode['));
    if (decodeLogs.length > 0) {
      console.log('\nDecode steps:');
      decodeLogs.slice(0, 5).forEach(l => console.log('  ', l));
    }

    const top5Logs = importantLogs.filter(l => l.includes('top-5:'));
    if (top5Logs.length > 0) {
      console.log('\nTop-5 token distributions:');
      top5Logs.slice(0, 5).forEach(l => {
        const match = l.match(/top-5: (.+)$/);
        if (match) console.log('  ', match[1]);
      });
    }

    const outputLog = importantLogs.find(l => l.includes('OUTPUT') || l.includes('Output text:'));
    if (outputLog) {
      console.log('\nOutput from logs:');
      console.log(outputLog);
    }

    const allText = importantLogs.join(' ');

    const goodTokens = [
      'blue', 'clear', 'beautiful', 'vast', 'dark', 'night', 'bright',
      'color', 'sky', 'The', 'is', 'a', 'the', 'usually', 'often',
    ];

    const badTokens = [
      'thức', ')}"', 'už', '<unused', 'unused>',
      'మా', 'ನ', 'ക', '്', '(?!',
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

    console.log('\nBrowser will stay open for 15s for inspection...');
    await page.waitForTimeout(15000);

  } catch (err) {
    console.error('\nTest failed with error:', err.message);
    console.log('\nRecent console logs:');
    logs.slice(-30).forEach(l => console.log('  ', l.slice(0, 200)));

  } finally {
    await browser.close();
  }
}

runTest().catch(console.error);
