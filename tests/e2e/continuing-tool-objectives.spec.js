import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const directory = process.env.REPLOID_E2E_ARTIFACT_DIR || 'artifacts/continuing-improvement-2026-09-20/browser';

test('a fully correct tool can improve measured latency, require approval, survive reload and roll back', async ({ page }) => {
  await page.goto('/');
  const report = await page.evaluate(async () => {
    const { createWorkEvolution } = await import('/host/work-evolution.js');
    const evolution = createWorkEvolution({ storage: localStorage, isBusy: () => false });
    // Deliberately slow fixture establishes an observable latency boundary, not a model-generated improvement.
    const body = 'let s=text.replace(/^\\uFEFF/, "").trim(); if(s.startsWith("```json\\n")&&s.endsWith("\\n```"))s=s.slice(8,-4); return JSON.stringify(JSON.parse(s),null,2);';
    const slow = '({text})=>{const end=Date.now()+80;while(Date.now()<end){} ' + body + '}';
    const fast = '({text})=>{' + body + '}';
    const propose = async code => evolution.propose({ targetId: 'FormatJson', code, reason: 'Exercise continuing objective',
      baselineGeneration: (await evolution.describe())[0].generationId, taskId: 'continuing-objective-fixture',
      generator: { implementation: 'handwritten-browser-fixture', model: 'none', instruction: 'Verify latency gate' } });
    const rejected = await propose('() => null');
    if (rejected.status !== 'rejected') throw new Error(JSON.stringify(rejected));
    const first = await propose(slow);
    if (first.status !== 'awaiting-approval') throw new Error(JSON.stringify(first));
    await evolution.decide(first.id, true);
    const second = await propose(fast);
    window.continuingEvolution = evolution;
    return { rejected, first, second, beforeApproval: (await evolution.describe())[0],
      episode: await evolution.export(second.id), qualification: 'Real sandbox timings of handwritten fixtures on one browser' };
  });
  expect(report.first.evaluation.improvementKind).toBe('correctness');
  expect(report.rejected.status).toBe('rejected');
  expect(report.second).toMatchObject({ status: 'awaiting-approval', evaluation: { baselinePassed: 6, candidatePassed: 6, improvementKind: 'latency' } });
  expect(report.beforeApproval.generationId).toBe(report.first.generationId);
  expect(report.episode.episode.integrity.valid).toBe(true);
  await page.evaluate(id => window.continuingEvolution.decide(id, true), report.second.id);
  await page.reload();
  const restored = await page.evaluate(async id => {
    const { createWorkEvolution } = await import('/host/work-evolution.js');
    const evolution = createWorkEvolution({ storage: localStorage, isBusy: () => false });
    const active = (await evolution.describe())[0];
    const output = await evolution.run('FormatJson', { text: '```json\n{"subsequent":[true,9]}\n```' });
    await evolution.rollback(id);
    return { active, output, rolledBack: (await evolution.describe())[0] };
  }, report.second.id);
  expect(restored.active.generationId).toBe(report.second.generationId);
  expect(JSON.parse(restored.output)).toEqual({ subsequent: [true, 9] });
  expect(restored.rolledBack.generationId).toBe(report.first.generationId);
  await mkdir(directory, { recursive: true });
  await writeFile(directory + '/continuing-objective.json', JSON.stringify({ report, restored }, null, 2));
});

test('continuing objective modules pass Verification Worker', async ({ page }) => {
  const paths = ['packages/reploid/src/improvement/tool-objective.js', 'packages/reploid/src/improvement/code-evolution.js',
    'self/ui/pool-home/work-capabilities.js'];
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
