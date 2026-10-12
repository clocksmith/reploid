import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Ordinary public requester. No peer selection, invitation or model fallback.
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { startedAt: new Date().toISOString(), application: 'c13cd97e',
  runtime: '0.6.27', opening: 'verified-pinned-manifest', weightRequests: [], approvals: [] };
let page;
try {
  page = await browser.newPage();
  page.on('request', request => {
    if (/\.(safetensors|gguf|bin)(?:$|\?)/i.test(request.url())) report.weightRequests.push(request.url());
  });
  await page.goto('https://replo.id/');
  await expect(page.locator('[data-model-control]')).toHaveAttribute('data-activity', 'ready', { timeout: 120000 });
  const threads = () => page.evaluate(() => JSON.parse(localStorage.getItem('reploid.chat-workspace:v1')).threads);
  for (const [question, amount] of [
    ['Tickets cost $12 each. What do three tickets cost? Answer briefly.', 36],
    ['And four tickets at that same price?', 48]
  ]) {
    await page.locator('[data-composer-input]').fill(question);
    await page.locator('[data-composer-send]').click();
    await page.locator('[data-approval-consent]').waitFor({ timeout: 30000 });
    report.approvals.push(JSON.parse(await page.locator('[data-permission-technical]').textContent()));
    await page.locator('[data-approval-consent]').check();
    await page.locator('[data-approval-send]').click();
    await expect.poll(async () => {
      const attempt = (await threads()).at(-1).attempts.at(-1);
      if (['failed', 'interrupted'].includes(attempt.status)) throw Error(JSON.stringify(attempt));
      return attempt.status;
    }, { timeout: 180000, intervals: [1000] }).toBe('completed');
    report.thread = (await threads()).at(-1);
    expect(report.thread.messages.at(-1).content).toMatch(new RegExp(`\\b${amount}\\b`));
  }
  expect(report.weightRequests).toEqual([]);
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = error.stack;
  report.saved = await page?.evaluate(() => localStorage.getItem('reploid.chat-workspace:v1')).catch(() => null);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(new URL('./conversation.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, error: report.error,
    answer: report.thread?.messages.at(-1)?.content, approvals: report.approvals, weightRequests: report.weightRequests }));
  await browser.close();
}
