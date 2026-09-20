import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const evidenceDir = process.env.REPLOID_E2E_ARTIFACT_DIR || 'artifacts/peer-tool-offer-2026-09-19';
const code = '({text}) => { let s = text.replace(/^\\uFEFF/, "").trim(); if(s.startsWith("```json\\n") && s.endsWith("\\n```")) s=s.slice(8,-4); return JSON.stringify(JSON.parse(s),null,2); }';

test('WebRTC delivers a refused offer then a preview that survives restart and needs local evaluation and adoption', async ({ browser }) => {
  const { createStandaloneSignalingServer } = await import('../../server/reploid-signaling.js');
  const signaling = createStandaloneSignalingServer({ port: 0, env: {}, swarmInferencePeer: null });
  await new Promise(resolve => signaling.server.listen(0, '127.0.0.1', resolve));
  const base = new URL(process.env.REPLOID_E2E_BASE_URL || 'http://localhost:8000');
  base.searchParams.set('swarm', 'candidate-' + Date.now());
  base.searchParams.set('swarmToken', 'candidate-room-capability-12345678901234567890');
  base.searchParams.set('signaling', 'ws://127.0.0.1:' + signaling.server.address().port + '/signaling');
  const senderContext = await browser.newContext(), receiverContext = await browser.newContext();
  const sender = await senderContext.newPage(), receiver = await receiverContext.newPage();
  try {
    await sender.goto(base.href); await receiver.goto(base.href);
    await sender.evaluate(async code => {
      const { createWorkEvolution } = await import('/host/work-evolution.js');
      const evolution = createWorkEvolution({ storage: localStorage, isBusy: () => false });
      await evolution.propose({ targetId: 'FormatJson', code, reason: 'Handle a JSON fence without changing its values',
        baselineGeneration: 'FormatJson:genesis', taskId: 'peer-offer-fixture',
        generator: { implementation: 'test-fixture', model: 'injected-code', instruction: 'Improve formatting' } });
    }, code);
    await sender.reload();
    await sender.locator('[data-swarm-connect]').click(); await receiver.locator('[data-swarm-connect]').click();
    await expect(sender.locator('[data-swarm-status]')).toHaveText('WebRTC connected');
    await expect(receiver.locator('[data-swarm-status]')).toHaveText('WebRTC connected');
    await sender.getByText('Code & sharing', { exact: true }).click();
    await expect.poll(() => sender.locator('[data-tool-peer] option').count()).toBe(2);
    const recipient = await sender.locator('[data-tool-peer] option').nth(1).getAttribute('value');
    await sender.locator('[data-tool-peer]').selectOption(recipient);
    await sender.locator('[data-tool-offer-send]').click();
    await expect(sender.locator('[data-tool-peer-inbox]')).toContainText('Refused: Recipient is not accepting candidates');
    await expect(receiver.locator('[data-work-candidates] article')).toHaveCount(0);
    await receiver.getByText('Import a tool', { exact: true }).click();
    await receiver.locator('[data-tool-offer-receive]').check();
    await sender.locator('[data-tool-offer-send]').click();
    await expect(sender.locator('[data-tool-peer-inbox]')).toContainText('Received for preview');
    await expect(receiver.locator('[data-tool-offer-preview-peer]')).toHaveCount(1);
    await expect(receiver.locator('[data-work-candidates] article')).toHaveCount(0);

    await receiver.reload();
    await receiver.locator('[data-swarm-connect]').click();
    await receiver.getByText('Import a tool', { exact: true }).click();
    await expect(receiver.locator('[data-tool-offer-receive]')).not.toBeChecked();
    await expect(receiver.locator('[data-tool-offer-preview-peer]')).toHaveCount(1);
    await receiver.locator('[data-tool-offer-preview-peer]').click();
    await expect(receiver.locator('[data-tool-offer-source]')).toContainText('not evaluated on this device');
    await expect(receiver.locator('[data-work-candidates] article')).toHaveCount(0);
    await receiver.locator('[data-tool-offer-evaluate]').click();
    await expect(receiver.locator('[data-work-candidates]')).toContainText('Tested · approval needed');
    const provenance = await receiver.evaluate(async () => {
      const { createWorkEvolution } = await import('/host/work-evolution.js');
      window.peerEvolution = createWorkEvolution({ storage: localStorage, isBusy: () => false });
      return { candidate: (await window.peerEvolution.list())[0], active: (await window.peerEvolution.describe())[0].generationId };
    });
    expect(provenance.active).toBe('FormatJson:genesis');
    expect(provenance.candidate.origin.kind).toBe('peer-transfer');
    expect(provenance.candidate.origin.transport.recipient).toBe(recipient);
    expect(provenance.candidate.origin.transport.envelopeHash).toMatch(/^sha256:/);
    await receiver.locator('[data-candidate-adopt]').click();
    await expect(receiver.locator('[data-work-candidates]')).toContainText('Adopted on this device');
    expect(await receiver.evaluate(() => window.peerEvolution.run('FormatJson', { text: '```json\n{"later":"task"}\n```' })))
      .toBe('{\n  "later": "task"\n}');
    await receiver.locator('[data-candidate-rollback]').click();
    await expect(receiver.locator('[data-work-candidates]')).toContainText('Reverted');
    expect(await receiver.evaluate(async () => (await window.peerEvolution.describe())[0].generationId)).toBe('FormatJson:genesis');
    await receiver.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await receiver.screenshot({ path: `${evidenceDir}/peer-tool-received.png`, fullPage: true, animations: 'disabled' });
  } finally { await senderContext.close(); await receiverContext.close(); await signaling.close(); }
});

test('peer candidate modules pass Verification Worker', async ({ page }) => {
  const paths = ['self/host/work-peer-offers.js', 'self/host/work-swarm.js', 'self/ui/pool-home/work-tool-offers.js', 'self/ui/pool-home/index.js',
    'packages/reploid/src/transport/tool-offer-channel.js', 'packages/reploid/src/improvement/code-evolution.js',
    'packages/reploid/src/agent/index.js', 'packages/reploid/src/agent/engine.js', 'packages/reploid/src/agent/task-strategy.js'];
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

test('Verification Worker distinguishes dynamic imports from JSDoc and quoted examples', async ({ page }) => {
  await page.goto('/');
  const verify = snapshot => page.evaluate(snapshot => new Promise((resolve, reject) => {
    const worker = new Worker('/core/verification-worker.js');
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Verification timeout')); }, 10000);
    worker.onmessage = ({ data }) => { clearTimeout(timer); worker.terminate(); resolve(data); };
    worker.postMessage({ type: 'VERIFY', snapshot });
  }), snapshot);
  expect((await verify({ '/tools/example.js': '/** @type {import("./types.js").Example} */\nexport default () => "import(\\\"./example.js\\\")";' })).errors).toEqual([]);
  for (const source of ['export default () => import("./code.js");', 'export default () => import /* comment */ ("./code.js");',
    'export default () => `${import("./code.js")}`;']) {
    const result = await verify({ '/tools/example.js': source });
    expect(result.passed).toBe(false);
    expect(result.errors).toContain('Security Violation in /tools/example.js: Dynamic import() is forbidden in tools');
  }
});
