import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('Work leads with a task and makes optional disclosure explicit', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'What do you want to get done?' })).toBeVisible();
  await expect(page.locator('[data-work-output]')).toBeHidden();
  await expect(page.locator('.pool-work-history')).toBeHidden();
  await expect(page.getByText('Mesh Node: Active', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Provider: Ready', { exact: true })).toHaveCount(0);
  await expect(page.locator('.pool-work-settings')).not.toHaveAttribute('open');
  await expect(page.locator('[data-work-peers]')).not.toBeChecked();
  await expect(page.locator('[data-work-location]')).toContainText('On-device model');
  const cloudId = await page.locator('[data-work-model] option').evaluateAll(options =>
    options.find(option => option.textContent.includes('Cloud')).value);
  await page.locator('[data-work-model]').selectOption(cloudId);
  await expect(page.locator('[data-work-location]')).toContainText('your task and files may be sent');
  await page.getByRole('button', { name: 'Summarize a file', exact: true }).click();
  await expect(page.locator('[data-work-goal]')).toHaveValue(/Summarize the attached file/);
  await expect(page.locator('[data-work-files]')).toBeVisible();
  await page.locator('[data-work-files]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('A short note.') });
  await expect(page.locator('[data-work-file-count]')).toHaveText('1 attached');
  await expect(page.locator('[data-work-peers]')).not.toBeChecked();
});

test('Network explains its purpose and sharing still requires approval', async ({ page }) => {
  await page.goto('/network');
  await expect(page.getByRole('heading', { name: 'Give or get a hand.' })).toBeVisible();
  await expect(page.locator('[data-operation-status]')).toHaveText('Not sharing');
  await expect(page.locator('[data-operation-approve]')).not.toBeChecked();
  await page.getByText('Specialized model jobs', { exact: true }).click();
  await page.locator('[data-operation-toggle]').click();
  await expect(page.locator('[data-operation-status]')).toHaveText('Approve the publisher and public-input execution first');
  await expect(page.locator('[data-operation-toggle]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-work-peer-status]')).toHaveText('Discovery has not run.');
});

test('Improve gives new users a useful empty state', async ({ page }) => {
  await page.goto('/improve');
  await expect(page.getByRole('heading', { name: 'No work to review yet.' })).toBeVisible();
  await expect(page.locator('[data-work-output]')).toBeHidden();
  await page.getByRole('link', { name: 'Start your first task' }).click();
  await expect(page.locator('[data-work-goal]')).toBeVisible();
});

test('mobile Work fits the viewport and keeps Start near the task', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('[data-work-start]')).toBeVisible();
  const geometry = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: innerWidth,
    startBottom: document.querySelector('[data-work-start]').getBoundingClientRect().bottom,
    height: innerHeight
  }));
  expect(geometry.width).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.startBottom).toBeLessThanOrEqual(geometry.height);
});

test('view state retains activity, cancellation, saved results and a clean new task', async ({ page }) => {
  await page.goto('/');
  // Injected view state exercises rendering only, not model execution.
  await page.evaluate(async () => {
    const { bindWorkSurface, renderWorkSurface } = await import('/ui/pool-home/work.js');
    const { DEFAULT_WORK_MODELS } = await import('/host/work-session.js');
    const root = document.createElement('main');
    root.className = 'pool-home'; root.innerHTML = renderWorkSurface();
    document.body.replaceChildren(root);
    const record = { id: 'fixture', goal: 'Inspect notes', status: 'completed', output: 'A saved result.',
      modelId: DEFAULT_WORK_MODELS[0].id, modelName: 'Fixture model', createdAt: Date.now(),
      inputs: [], artifacts: [], events: [{ tool: 'ReadInput', status: 'completed' }] };
    let state = { records: [record], selectedId: record.id, busy: false, available: true, models: DEFAULT_WORK_MODELS,
      cycle: 1, maxCycles: 8, activity: 'Finished', peerModels: [] };
    let listener;
    const application = {
      getDraft: () => null, getState: () => state,
      subscribe(callback) { listener = callback; callback(state); return () => {}; },
      select(id) { state = { ...state, selectedId: id }; listener(state); },
      clearDraft() {},
      prepareRevision(id) { return { parentId: id, goal: record.goal, criteria: 'Keep the main points',
        modelId: record.modelId, inputs: [], feedback: '' }; },
      cancel() { window.clarityCancelled = true; state = { ...state, busy: false, activity: 'Stopped' }; listener(state); }
    };
    window.clarityUpdate = changes => { state = { ...state, ...changes }; listener(state); };
    const dispose = bindWorkSurface(root, application);
    window.clarityResumeDraft = () => {
      dispose(); root.innerHTML = renderWorkSurface();
      application.getDraft = () => application.prepareRevision(record.id);
      bindWorkSurface(root, application);
    };
  });
  await expect(page.locator('[data-work-answer]')).toHaveText('A saved result.');
  await expect(page.locator('[data-work-form]')).toBeHidden();
  await expect(page.locator('[data-work-events]')).toContainText('ReadInput / completed');
  await page.locator('[data-work-revise-selected]').click();
  await expect(page.locator('[data-work-feedback]')).toBeVisible();
  await expect(page.locator('[data-work-goal]')).toHaveValue('Inspect notes');
  await page.locator('[data-work-select]').click();
  await page.locator('[data-work-new]').click();
  await expect(page.locator('[data-work-output]')).toBeHidden();
  await expect(page.locator('[data-work-goal]')).toHaveValue('');
  await page.locator('[data-work-select]').click();
  await expect(page.locator('[data-work-answer]')).toBeVisible();
  await page.evaluate(() => window.clarityUpdate({ busy: true, activeId: 'fixture', activity: 'Reading file', draft: 'Working...' }));
  await expect(page.locator('[data-work-goal]')).toBeDisabled();
  await expect(page.locator('[data-work-form]')).toBeHidden();
  await expect(page.locator('[data-work-status]')).toHaveText('Reading file');
  await expect(page.locator('[data-work-draft]')).toBeVisible();
  await page.locator('[data-work-cancel]').first().click();
  await expect.poll(() => page.evaluate(() => window.clarityCancelled)).toBe(true);
  await expect(page.locator('[data-work-goal]')).toBeEnabled();
  await page.evaluate(() => window.clarityResumeDraft());
  await expect(page.locator('[data-work-feedback]')).toBeVisible();
  await expect(page.locator('[data-work-output]')).toBeHidden();
});

test('Verification Worker accepts the changed UI modules', async ({ page }) => {
  const names = ['index.js', 'view.js', 'work.js', 'work-goal-composer.js', 'work-task-header.js', 'work-result-view.js', 'operation-sharing.js'];
  const snapshot = Object.fromEntries(await Promise.all(names.map(async name => [
    `/ui/pool-home/${name}`, await readFile(`self/ui/pool-home/${name}`, 'utf8')
  ])));
  await page.goto('/');
  const result = await page.evaluate(snapshot => new Promise((resolve, reject) => {
    const worker = new Worker('/core/verification-worker.js');
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Verification timed out')); }, 10000);
    worker.onmessage = event => { clearTimeout(timer); worker.terminate(); resolve(event.data); };
    worker.onerror = event => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)); };
    worker.postMessage({ type: 'VERIFY', snapshot });
  }), snapshot);
  expect(result.errors).toEqual([]);
  expect(result.passed).toBe(true);
  expect(result.details.filesAnalyzed).toBe(names.length);
});
