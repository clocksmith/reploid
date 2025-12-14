#!/usr/bin/env node
/**
 * Diagnostic test for embedding loading
 */

import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:8080/demo/';

async function runTest() {
  console.log('Embedding Load Diagnostic Test');
  console.log('='.repeat(60));

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  const logs = [];

  page.on('console', msg => {
    const text = msg.text();
    logs.push(text);

    // Log everything related to embeddings, buffers, BF16
    if (text.includes('embed') ||
        text.includes('BF16') ||
        text.includes('buffer') ||
        text.includes('maxBuffer') ||
        text.includes('GPU') ||
        text.includes('gather') ||
        text.includes('multi-shard') ||
        text.includes('chunked') ||
        text.includes('exceeds') ||
        text.includes('Error') ||
        text.includes('[DEBUG]')) {
      console.log(text);
    }
  });

  page.on('pageerror', err => {
    console.error('PAGE ERROR:', err.message);
  });

  try {
    console.log('\n[1] Opening demo page...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });

    await page.waitForSelector('#model-list', { timeout: 10000 });
    await page.waitForTimeout(2000);

    console.log('[2] Looking for Mistral 7B...');
    const modelItems = await page.locator('.model-item').all();

    for (let i = 0; i < modelItems.length; i++) {
      const nameElem = modelItems[i].locator('.model-name');
      const name = await nameElem.textContent().catch(() => '');
      console.log(`Model ${i}: "${name}"`);

      if (name.toLowerCase().includes('mistral') || name.toLowerCase().includes('7b')) {
        console.log(`Found Mistral at index ${i}`);
        const runBtn = modelItems[i].locator('.model-btn.run').first();
        if (await runBtn.isVisible().catch(() => false)) {
          await runBtn.click();
          console.log('Clicked Mistral 7B Run button');
          break;
        }
      }
    }

    console.log('[3] Waiting for model load (watch for embedding info)...');

    // Wait for model to load
    try {
      await page.waitForFunction(() => {
        const textarea = document.querySelector('#chat-input');
        return textarea && !textarea.disabled;
      }, { timeout: 120000 });
      console.log('Model loaded');
    } catch (e) {
      console.log('Load timeout - checking logs...');
    }

    // Print relevant logs
    console.log('\n' + '='.repeat(60));
    console.log('RELEVANT LOGS:');
    console.log('='.repeat(60));

    const embedLogs = logs.filter(l =>
      l.includes('embed') ||
      l.includes('BF16') ||
      l.includes('maxBuffer') ||
      l.includes('chunked') ||
      l.includes('CPU array') ||
      l.includes('gather')
    );

    embedLogs.forEach(l => console.log(l));

    console.log('\nBrowser staying open for 30s...');
    await page.waitForTimeout(30000);

  } catch (err) {
    console.error('\nError:', err.message);
    console.log('\nAll logs:');
    logs.slice(-50).forEach(l => console.log('  ', l.slice(0, 200)));

  } finally {
    await browser.close();
  }
}

runTest().catch(console.error);
