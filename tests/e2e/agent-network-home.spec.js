import { test, expect } from '@playwright/test';
const evidenceDir = process.env.REPLOID_E2E_ARTIFACT_DIR || 'artifacts/network-home-2026-09-19';

test('home exposes voluntary participation without sending work or loading a model', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-agent-list]')).toContainText('Qwen 3.5 2B');
  await expect(page.locator('[data-agent-list]')).toContainText('Idle · model selected');
  await expect(page.locator('[data-contribution-status]')).toHaveText('Not sharing');
  await expect(page.locator('[data-work-improvement]')).not.toBeChecked();
  await expect(page.locator('[data-work-peers]')).toBeChecked();
  await expect(page.locator('[data-contribution-limits]')).toBeHidden();
  await page.locator('[data-network-disclosure] > summary').click();
  await page.locator('[data-contribution-panel] summary').click();
  await expect(page.locator('[data-contribution-limits]')).toContainText('1 request at a time');
  await page.locator('[data-swarm-share]').click();
  await expect(page.locator('[data-swarm-status]')).toContainText('Approve public prompt execution');
  await expect(page.locator('[data-contribution-status]')).toHaveText('Not sharing');
  await page.locator('[data-swarm-invite]').click();
  const url = new URL(await page.locator('[data-swarm-invitation] a').getAttribute('href'));
  expect(url.pathname).toBe('/');
  expect(url.searchParams.get('swarm')).toBeTruthy();
  expect(url.searchParams.get('swarmToken')).toBeTruthy();
  await expect(page.locator('[data-work-goal]')).toHaveValue('');
});

test('one page shows live agents, task collaborators, contribution settlement and linked improvements', async ({ page }) => {
  await page.goto('/');
  // Injected records exercise presentation and consent controls, not inference quality.
  await page.evaluate(async () => {
    const { renderWorkSurface, bindWorkSurface } = await import('/ui/pool-home/work.js');
    const { renderToolExperiments } = await import('/ui/pool-home/work-capabilities.js');
    const { DEFAULT_WORK_MODELS } = await import('/host/work-session.js');
    const model = DEFAULT_WORK_MODELS[0];
    const record = { id: 'task', goal: 'Repair the formatter', modelId: model.id, modelName: model.name,
      status: 'running', output: '', events: [], inputs: [], artifacts: [],
      helpers: [{ id: 'helper', goal: 'Check malformed JSON', location: 'this device', status: 'running' }],
      peerJobs: [{ stage: 'completed', preview: { id: 'peer-job', modelId: 'Peer model', providerId: 'peer-one' } }],
      improvements: [{ id: 'candidate' }] };
    let state = { busy: true, anyBusy: true, activeId: 'task', selectedId: 'task', records: [record], models: DEFAULT_WORK_MODELS,
      available: true, cycle: 2, maxCycles: 12, activity: 'Checking a tool', peerModels: [], draft: '' };
    let snapshot = { models: [model], sharing: true, stopping: false, contribution: { phase: 'loading', completed: 0 },
      limits: { maxInboundJobs: 1, maxOutputTokens: 1024 }, consumer: { transport: 'webrtc', peers: [{ peerId: 'peer-one', role: 'provider', model: 'Peer model' }] } };
    const listeners = new Set();
    const app = { getState: () => state, getDraft: () => null,
      subscribe(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); },
      select(id) { window.selectedTask = id; }, cancel() {} };
    window.updateNetworkFixture = value => { snapshot = { ...snapshot, ...value }; listeners.forEach(fn => fn(state)); };
    window.completeNetworkTask = () => {
      state = { ...state, busy: false, anyBusy: false, activity: 'Finished', records: [{ ...record, status: 'review', output: 'Formatter candidate ready.' }] };
      listeners.forEach(fn => fn(state));
    };
    const swarm = { getState: () => snapshot, async stop() {
      window.updateNetworkFixture({ stopping: true, sharing: false });
      await new Promise(resolve => { window.settleSharing = resolve; });
      window.updateNetworkFixture({ stopping: false, contribution: { phase: 'idle', completed: 1 } });
    } };
    const evolution = { async list() { return [{ id: 'candidate', targetId: 'FormatJson', status: 'awaiting-approval', reason: 'Handle fenced JSON',
      code: 'input => input', evaluation: { baselinePassed: 4, candidatePassed: 6, total: 6 } }]; }, async describe() { return []; } };
    const root = document.createElement('main'); root.className = 'pool-home'; root.innerHTML = renderWorkSurface() + renderToolExperiments();
    document.body.replaceChildren(root); bindWorkSurface(root, app, { swarm, evolution });
  });
  await expect(page.locator('[data-agent-list]')).toContainText('Peer model · WebRTC peer');
  await expect(page.locator('[data-agent-list]')).toContainText('Helper 1');
  await expect(page.locator('[data-work-team]')).toContainText('Check malformed JSON');
  await expect(page.locator('[data-contribution-status]')).toHaveText('Preparing model for a peer');
  await page.evaluate(() => window.updateNetworkFixture({ contribution: { phase: 'executing', completed: 0 } }));
  await expect(page.locator('[data-contribution-status]')).toHaveText('Running a peer request');
  await expect(page.locator('[data-candidate-adopt]')).toBeDisabled();
  await page.locator('[data-swarm-stop]').click();
  await expect(page.locator('[data-contribution-status]')).toContainText('waiting for model work');
  await expect(page.locator('[data-swarm-stop]')).toBeDisabled();
  await page.evaluate(() => window.settleSharing());
  await expect(page.locator('[data-contribution-status]')).toHaveText('Not sharing');
  await page.evaluate(() => window.completeNetworkTask());
  await expect(page.locator('[data-work-answer]')).toHaveText('Formatter candidate ready.');
  await expect(page.locator('[data-candidate-adopt]')).toBeEnabled();
  await expect(page.locator('[data-work-candidates]')).toContainText('Tested · approval needed');
  await page.locator('.pool-candidate-origin').click();
  expect(await page.evaluate(() => window.selectedTask)).toBe('task');
  await page.screenshot({ path: `${evidenceDir}/connected-fixture.png`, fullPage: true });
});

for (const width of [1440, 390, 320]) {
  test(`network home fits ${width}px and retains direct access to each activity`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await page.goto('/');
    await expect(page.locator('[data-agent-list] li')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('[data-work-goal]')).toBeInViewport();
    await page.locator('[data-pool-nav-id="improve"]').click();
    await expect(page.locator('[data-work-experiments]')).toBeInViewport();
    await page.locator('[data-pool-nav-id="home"]').click();
    await page.locator('[data-network-disclosure] > summary').click();
    await expect(page.locator('[data-swarm-connect]')).toBeInViewport();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${evidenceDir}/home-${width}.png`, fullPage: true });
    if (width === 1440) {
      await page.getByRole('button', { name: 'Dark', exact: true }).click();
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.screenshot({ path: `${evidenceDir}/home-dark.png`, fullPage: true, animations: 'disabled' });
    }
  });
}
