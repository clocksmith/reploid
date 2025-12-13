#!/usr/bin/env node
/**
 * Run standalone gather test
 */

import { chromium } from 'playwright';

async function runTest() {
  const userDataDir = `/tmp/playwright-standalone-${Date.now()}`;
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: ['--disable-web-security', '--disable-http-cache'],
  });
  const page = await context.newPage();

  page.on('console', msg => {
    console.log(msg.text());
  });

  page.on('pageerror', err => {
    console.error('PAGE ERROR:', err.message);
  });

  try {
    console.log('Opening standalone test page...');
    await page.goto('http://localhost:8080/tests/test-standalone.html', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // Wait for test to complete
    await page.waitForTimeout(120000);

  } catch (err) {
    console.error('Test failed:', err.message);
  } finally {
    await context.close();
  }
}

runTest().catch(console.error);
