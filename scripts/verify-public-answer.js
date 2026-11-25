#!/usr/bin/env node
/**
 * Ask the deployed site one question the way a new visitor would: a fresh browser profile, nothing downloaded,
 * a public computer answering. It exists because a deploy that changes model identities disconnects every
 * provider still on an older package, and nothing else notices: the page loads, the Computers panel lists
 * computers as ready, and no model can be chosen.
 *
 *   node scripts/verify-public-answer.js [--url https://replo.id] [--timeout-seconds 180] [--channel chrome]
 *
 * Prints one JSON line. Exit 0 when an answer completed, 1 when the site offered no public computer for the
 * default model or the answer did not complete. The prompt is fixed, public and sent to a public computer.
 */
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

const { values } = parseArgs({ options: { url: { type: 'string', default: 'https://replo.id' },
  'timeout-seconds': { type: 'string', default: '180' }, channel: { type: 'string' } } });
const limitMs = Number(values['timeout-seconds']) * 1000;
if (!Number.isFinite(limitMs) || limitMs <= 0) throw new Error('--timeout-seconds must be a positive number');
const PROMPT = 'Name the capital of France in one word.';

const browser = await chromium.launch(values.channel ? { channel: values.channel } : {});
const result = { url: values.url, ok: false, stage: 'open', model: null, contributors: null, answer: null, seconds: null };
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(values.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const send = page.locator('[data-composer-send]');
  await send.waitFor({ state: 'visible', timeout: 60000 });
  await page.locator('[data-composer-input]').fill(PROMPT);
  // A first visitor's Send is available at once; it opens "Where should this run?" when nothing runs here yet.
  result.stage = 'send';
  await page.waitForFunction(() => !globalThis.document.querySelector('[data-composer-send]')?.disabled, null, { timeout: 60000 });
  await send.click();
  result.stage = 'choose-computer';
  const picker = page.locator('[data-model-picker]');
  if (await picker.evaluate(node => node.open)) {
    // As a person would: tap Contributors, then wait for the sheet's primary button to offer Send. Discovery is
    // bounded (about 8 s); the sheet says "Finding computers…" until then and follows the tap to a served model.
    const contributors = page.locator('[data-execution-choice=network]');
    if (await contributors.getAttribute('aria-checked') !== 'true') await contributors.click();
    const commit = page.locator('[data-change-model]');
    const ready = await page.waitForFunction(() => {
      const button = globalThis.document.querySelector('[data-change-model]');
      return button && !button.disabled && /^Send\b/.test(button.textContent.trim());
    }, null, { timeout: 30000 }).then(() => true, () => false);
    result.contributors = (await contributors.locator('[data-computer-state]').innerText()).trim();
    if (!ready) {
      const status = (await page.locator('[data-next-model-status]').innerText().catch(() => '')).trim();
      throw new Error(`No public computer serves the default model [${(await commit.innerText()).trim()}]: ${status}`);
    }
    await commit.click();
  }
  result.stage = 'answer';
  result.model = await page.locator('[data-open-model]').getAttribute('aria-label');
  const started = Date.now();
  const stream = page.locator('[data-message-stream]');
  await page.waitForFunction(() => /\bComplete ·|\bFailed\b|\bInterrupted\b|\bDisconnected\b/.test(globalThis.document.querySelector('[data-message-stream]')?.innerText || ''),
    null, { timeout: limitMs });
  const text = (await stream.innerText()).replace(PROMPT, '').replace(/\s+/g, ' ').trim();
  result.seconds = Math.round((Date.now() - started) / 100) / 10;
  result.answer = text.slice(0, 200);
  result.ok = /\bComplete ·/.test(text);
  if (result.ok) result.stage = 'complete';
} catch (error) {
  result.error = String(error.message).split('\n')[0].slice(0, 300);
} finally {
  await browser.close();
}
console.log(JSON.stringify(result));
process.exitCode = result.ok ? 0 : 1;
