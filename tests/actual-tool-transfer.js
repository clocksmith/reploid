/** Replay unchanged, recorded model output through the real UI and WebRTC on one machine. */
import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createStandaloneSignalingServer } from '../server/reploid-signaling.js';

const sourcePath = process.env.REPLOID_ACTUAL_CANDIDATE_REPORT;
if (!sourcePath) throw new Error('Set REPLOID_ACTUAL_CANDIDATE_REPORT to a successful actual-tool-repair report');
const sourceBytes = await readFile(sourcePath), source = JSON.parse(sourceBytes);
const attempt = source.result?.attempts?.find(item => item.candidate.status === 'awaiting-approval');
const offer = source.result?.offer;
if (source.schema !== 'reploid.actual-tool-repair/v1' || source.injectedInference !== false || !source.result?.qualified || !source.result.settled || source.result.error
  || !attempt || attempt.code !== offer?.code || attempt.candidate.evaluation.candidateHash !== offer.codeHash
  || attempt.response.content.trim().replace(/^```(?:javascript|js)?\s*\n([\s\S]*?)\n```$/, '$1') !== offer.code) {
  throw new Error('Report does not bind a qualifying candidate to unchanged model output');
}
const directory = process.env.REPLOID_ACTUAL_EVIDENCE_DIR || 'artifacts/actual-tool-transfer/' + new Date().toISOString().replace(/[:.]/g, '-');
await mkdir(directory, { recursive: true });
const report = { schema: 'reploid.actual-tool-transfer/v1', startedAt: new Date().toISOString(),
  sourcePath, sourceHash: 'sha256:' + createHash('sha256').update(sourceBytes).digest('hex'), codeHash: offer.codeHash,
  model: source.model, generatedCodeEdited: false, independentMachines: false, inferenceRerun: false,
  qualification: 'Two isolated contexts on one machine, real WebRTC, previously recorded model-generated code. No independent-operator or network-benefit claim.',
  scriptedOperatorActions: ['Enable receiving in disposable recipient', 'Send exact public candidate', 'Evaluate', 'Adopt in disposable recipient', 'Use on subsequent input', 'Reload', 'Roll back'],
  succeeded: false };
const harness = await readFile(new URL(import.meta.url));
await writeFile(directory + '/harness.js', harness);
report.harness = { path: 'harness.js', sha256: 'sha256:' + createHash('sha256').update(harness).digest('hex') };
const signaling = createStandaloneSignalingServer({ port: 0, env: {}, swarmInferencePeer: null });
let browser;
try {
  await new Promise(resolve => signaling.server.listen(0, '127.0.0.1', resolve));
  const base = new URL(process.env.REPLOID_E2E_BASE_URL || 'http://localhost:8000');
  base.searchParams.set('swarm', 'actual-candidate-' + Date.now());
  base.searchParams.set('swarmToken', 'actual-candidate-room-capability-' + crypto.randomUUID());
  base.searchParams.set('signaling', 'ws://127.0.0.1:' + signaling.server.address().port + '/signaling');
  browser = await chromium.launch({ headless: true }); report.browser = browser.version();
  const sender = await (await browser.newContext()).newPage(), recipient = await (await browser.newContext()).newPage();
  const check = expect.configure({ timeout: 30000 });
  await sender.goto(base.href); await recipient.goto(base.href);
  report.bundle = await (await sender.request.get(new URL('/config/browser-bundle-manifest.json', base).href)).json();
  await sender.getByText('Import a tool', { exact: true }).click();
  await sender.locator('[data-tool-offer-file]').setInputFiles({ name: 'model-candidate.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(offer)) });
  await sender.locator('[data-tool-offer-evaluate]').click();
  await check(sender.locator('[data-work-candidates]')).toContainText('Tested · approval needed');
  await sender.locator('[data-swarm-connect]').click(); await recipient.locator('[data-swarm-connect]').click();
  await check(sender.locator('[data-swarm-status]')).toHaveText('WebRTC connected');
  await check(recipient.locator('[data-swarm-status]')).toHaveText('WebRTC connected');
  await recipient.getByText('Import a tool', { exact: true }).click();
  await recipient.locator('[data-tool-offer-receive]').check();
  await sender.getByText('Code & sharing', { exact: true }).click();
  await check.poll(() => sender.locator('[data-tool-peer] option').count()).toBe(2);
  const recipientId = await sender.locator('[data-tool-peer] option').nth(1).getAttribute('value');
  await sender.locator('[data-tool-peer]').selectOption(recipientId);
  await sender.locator('[data-tool-offer-send]').click();
  await check(sender.locator('[data-tool-peer-inbox]')).toContainText('Received for preview');
  await check(recipient.locator('[data-work-candidates] article')).toHaveCount(0);
  await recipient.locator('[data-tool-offer-preview-peer]').click();
  await recipient.locator('[data-tool-offer-evaluate]').click();
  await check(recipient.locator('[data-work-candidates]')).toContainText('Tested · approval needed');
  report.beforeApproval = await recipient.evaluate(async () => {
    const { createWorkEvolution } = await import('/host/work-evolution.js');
    window.receivingEvolution = createWorkEvolution({ storage: localStorage, isBusy: () => false });
    const candidate = (await window.receivingEvolution.list())[0];
    return { active: (await window.receivingEvolution.describe())[0], candidate, evidence: await window.receivingEvolution.export(candidate.id) };
  });
  check(report.beforeApproval.active.generationId).toBe('FormatJson:genesis');
  check(report.beforeApproval.candidate.code).toBe(offer.code);
  check(report.beforeApproval.candidate.origin.kind).toBe('peer-transfer');
  check(report.beforeApproval.candidate.origin.transport.recipient).toBe(recipientId);
  await recipient.locator('[data-candidate-adopt]').click();
  await check(recipient.locator('[data-work-candidates]')).toContainText('Adopted on this device');
  report.subsequentInput = { text: '```json\n{"subsequent":{"values":[19,false,null],"name":"retained"}}\n```' };
  report.output = await recipient.evaluate(input => window.receivingEvolution.run('FormatJson', input), report.subsequentInput);
  check(JSON.parse(report.output)).toEqual({ subsequent: { values: [19, false, null], name: 'retained' } });
  await recipient.reload(); await check(recipient.locator('[data-work-candidates]')).toContainText('Adopted on this device');
  await recipient.locator('[data-candidate-rollback]').click(); await check(recipient.locator('[data-work-candidates]')).toContainText('Reverted');
  report.restored = await recipient.evaluate(async () => {
    const { createWorkEvolution } = await import('/host/work-evolution.js');
    const evolution = createWorkEvolution({ storage: localStorage, isBusy: () => false }), candidate = (await evolution.list())[0];
    return { active: (await evolution.describe())[0], evidence: await evolution.export(candidate.id) };
  });
  check(report.restored.active.generationId).toBe('FormatJson:genesis');
  await recipient.screenshot({ path: directory + '/recipient.png', fullPage: true });
  report.succeeded = true;
} catch (error) { report.error = String(error.stack || error); }
finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(directory + '/report.json', JSON.stringify(report, null, 2) + '\n');
  await browser?.close(); await signaling.close(); process.stdout.write('Evidence: ' + directory + '/report.json\n');
}
if (!report.succeeded) process.exitCode = 1;
