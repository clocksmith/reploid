import { chromium, expect } from '@playwright/test';
import { writeFile, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
const report = { scope: 'Physical public network with two local host-source overrides; accepted runtime pin unchanged', startedAt: new Date().toISOString(), url: process.env.REPLOID_TEST_URL || 'https://replo.id/', phases: [], requests: [] };
let page, restoreSupply = false;
const remote = async operation => (await exec('ssh', ['-o', 'BatchMode=yes', 'amd-host',
  `node /tmp/reploid-native-control.js ${operation} /tmp/reploid-preparation-${operation}.json`])).stdout;

try {
  await exec('ssh', ['-o', 'BatchMode=yes', 'amd-host', 'kill -USR1 1535668']);
  report.supplierBefore = JSON.parse(await remote('inspect'));
  restoreSupply = true;
  report.supplierOff = JSON.parse(await remote('files-off'));
  page = await browser.newPage();
  report.sourceOverrides = [];
  for (const name of ['work-partitions.js', 'work-partition-tokenizer-guard.js']) {
    const source = await readFile('self/host/' + name, 'utf8');
    report.sourceOverrides.push({ path: 'host/' + name, source });
    await page.route('**/host/' + name, route => route.fulfill({ contentType: 'text/javascript', body: source }));
  }

  page.on('request', request => {
    if (/huggingface\.co|\.(bin|gguf|safetensors)(?:$|\?)/.test(request.url())) report.requests.push(request.url());
  });
  await page.goto(report.url);
  await page.locator('[data-chat-workspace]').waitFor();
  await page.locator('[data-toggle-inspector]').click();
  await page.locator('[data-inspector-section="device"]').click();
  await page.locator('[data-contribution-model]').selectOption('qwen-3-5-0-8b-q4k-ehaf16');
  const state = async () => ({ at: new Date().toISOString(),
    phase: await page.locator('[data-contrib-label]').textContent(),
    progress: await page.locator('[data-contribution-progress]').textContent(),
    message: await page.locator('[data-network-message]').textContent(),
    sharingFiles: await page.locator('[data-toggle-file-contribution]').getAttribute('aria-checked') });
  await page.locator('[data-toggle-contribution]').click();
  await expect.poll(async () => {
    const s = await state(); report.phases.push(s); return s.phase;
  }, { timeout: 90000, intervals: [2000] }).toBe('Failed');
  report.withoutSupplier = await state();
  expect(report.withoutSupplier.sharingFiles).toBe('false');
  expect(report.withoutSupplier.message).toContain('No peer offers the required verified model piece');
  expect(report.withoutSupplier.message).not.toMatch(/Clear browser storage|Bundled tokenizer not found|Cleanup not confirmed/);
  report.restore = JSON.parse(await remote('files-on')); restoreSupply = false;
  // Existing contribution toggle provides an explicit new preparation attempt.
  await page.locator('[data-toggle-contribution]').click();
  await expect(page.locator('[data-toggle-contribution]')).toHaveAttribute('aria-checked', 'false');
  await page.locator('[data-toggle-contribution]').click();
  await expect.poll(async () => {
    const s = await state(); report.phases.push(s); return s.phase;
  }, { timeout: 240000, intervals: [2000] }).toBe('Ready');
  report.ready = await state();
  report.memory = await page.evaluate(async () => {
    const { DOPPLER_PARTITIONS_MODULE_URL } = await import('/config/doppler-local-models.js');
    return (await import(DOPPLER_PARTITIONS_MODULE_URL)).inspectDeviceMemory();
  });
  expect(report.requests).toEqual([]);
  report.passed = true;
} catch (error) { report.passed = false; report.error = error.stack; process.exitCode = 1; }
finally {
  if (page) {
    try {
      if (await page.locator('[data-toggle-contribution]').getAttribute('aria-checked') === 'true') {
        await page.locator('[data-toggle-contribution]').click();
        await expect(page.locator('[data-toggle-contribution]')).toHaveAttribute('aria-checked', 'false');
      }
      report.stopped = true;
    } catch (error) { report.cleanupError = error.stack; report.passed = false; process.exitCode = 1; }
  }
  if (restoreSupply) {
    try { report.emergencyRestore = JSON.parse(await remote('files-on')); }
    catch (error) { report.restoreError = error.stack; report.passed = false; process.exitCode = 1; }
  }
  try { report.detached = JSON.parse(await remote('detach')); }
  catch (error) { report.detachError = error.stack; report.passed = false; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  await writeFile(new URL('./cold-contributor.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({passed:report.passed,error:report.error,withoutSupplier:report.withoutSupplier,ready:report.ready,memory:report.memory,stopped:report.stopped}));
  await browser.close();
}
