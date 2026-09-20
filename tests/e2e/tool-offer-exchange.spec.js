import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const code = '({text}) => { let s = text.replace(/^\\uFEFF/, "").trim(); if(s.startsWith("```json\\n") && s.endsWith("\\n```")) s=s.slice(8,-4); return JSON.stringify(JSON.parse(s),null,2); }';

test('another browser imports code, evaluates locally, approves separately and can restore its baseline', async ({ browser }) => {
  const senderContext = await browser.newContext(), receiverContext = await browser.newContext();
  const sender = await senderContext.newPage(), receiver = await receiverContext.newPage();
  try {
    await sender.goto('http://localhost:8000/');
    await sender.evaluate(async code => {
      const { createWorkEvolution } = await import('/host/work-evolution.js');
      const evolution = createWorkEvolution({ storage: localStorage, isBusy: () => false });
      const candidate = await evolution.propose({ targetId: 'FormatJson', code, reason: 'Handle outer JSON fences and the initial byte order mark',
        baselineGeneration: 'FormatJson:genesis', taskId: 'fixture-source-task',
        generator: { implementation: 'browser-fixture', model: 'injected-code', instruction: 'Repair JSON normalization' } });
      await evolution.decide(candidate.id, true);
    }, code);
    await sender.reload();
    await sender.getByText('Code & sharing', { exact: true }).click();
    const downloadEvent = sender.waitForEvent('download');
    await sender.getByRole('button', { name: 'Download candidate', exact: true }).click();
    const download = await downloadEvent, bytes = await readFile(await download.path());
    const offer = JSON.parse(bytes.toString());
    expect(Object.keys(offer).sort()).toEqual(['code', 'codeHash', 'reason', 'schema', 'targetId']);

    await receiver.setViewportSize({ width: 390, height: 844 });
    await receiver.goto('http://localhost:8000/');
    await receiver.getByText('Import a tool', { exact: true }).click();
    await receiver.locator('[data-tool-offer-file]').setInputFiles({ name: 'candidate.json', mimeType: 'application/json', buffer: bytes });
    await expect(receiver.locator('[data-tool-offer-target]')).toHaveText('FormatJson');
    expect(await receiver.locator('[data-work-candidates] article').count()).toBe(0);
    await receiver.locator('[data-tool-offer-preview] summary').click();
    expect(await receiver.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await receiver.locator('[data-tool-offer-evaluate]').click();
    await expect(receiver.locator('[data-work-candidates]')).toContainText('Tested · approval needed');
    await expect(receiver.locator('[data-work-candidates]')).toContainText('Current: 4/6 checks. Candidate: 6/6 checks.');
    await expect(receiver.locator('[data-work-candidates]')).toContainText('Imported candidate');
    await receiver.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await receiver.screenshot({ path: 'artifacts/tool-offer-exchange-2026-09-19/awaiting-local-approval.png', fullPage: true, animations: 'disabled' });
    expect(await receiver.evaluate(async () => {
      const { createWorkEvolution } = await import('/host/work-evolution.js');
      window.receivingEvolution = createWorkEvolution({ storage: localStorage, isBusy: () => false });
      return (await window.receivingEvolution.describe())[0].generationId;
    })).toBe('FormatJson:genesis');
    await receiver.locator('[data-candidate-adopt]').click();
    await expect(receiver.locator('[data-work-candidates]')).toContainText('Adopted on this device');
    expect(await receiver.evaluate(() => window.receivingEvolution.run('FormatJson', { text: '```json\n{"unseen":[9,true]}\n```' })))
      .toBe('{\n  "unseen": [\n    9,\n    true\n  ]\n}');
    await receiver.reload();
    await expect(receiver.locator('[data-work-candidates]')).toContainText('Adopted on this device');
    await receiver.locator('[data-candidate-rollback]').click();
    await expect(receiver.locator('[data-work-candidates]')).toContainText('Reverted');
    const baseline = await receiver.evaluate(async () => {
      const { createWorkEvolution } = await import('/host/work-evolution.js');
      return (await createWorkEvolution({ storage: localStorage, isBusy: () => false }).describe())[0].generationId;
    });
    expect(baseline).toBe('FormatJson:genesis');

    await receiver.getByText('Import a tool', { exact: true }).click();
    await receiver.locator('[data-tool-offer-file]').setInputFiles({ name: 'tampered.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ ...offer, code: '() => "changed"' })) });
    await expect(receiver.locator('[data-experiment-status]')).toContainText('code hash does not match');
    await expect(receiver.locator('[data-tool-offer-preview]')).toBeHidden();
    await expect(receiver.locator('[data-work-candidates] article')).toHaveCount(1);
  } finally { await senderContext.close(); await receiverContext.close(); }
});

test('candidate handoff modules pass Verification Worker', async ({ page }) => {
  const paths = ['self/ui/pool-home/work-tool-offers.js', 'self/ui/pool-home/work-capabilities.js', 'packages/reploid/src/improvement/code-evolution.js'];
  const snapshot = Object.fromEntries(await Promise.all(paths.map(async path => [path, await readFile(path, 'utf8')])));
  await page.goto('/');
  const result = await page.evaluate(snapshot => new Promise((resolve, reject) => {
    const worker = new Worker('/core/verification-worker.js');
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Verification timeout')); }, 10000);
    worker.onmessage = ({ data }) => { clearTimeout(timer); worker.terminate(); resolve(data); };
    worker.postMessage({ type: 'VERIFY', snapshot });
  }), snapshot);
  expect(result.errors).toEqual([]); expect(result.passed).toBe(true);
});
