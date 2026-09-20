import { test, expect } from '@playwright/test';

const phase = process.env.REPLOID_VISUAL_PHASE || 'after';
const evidence = 'artifacts/monochrome-workspace-2026-09-20';

test('header and workspace retain aligned gutters during viewport changes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.locator('[data-work-goal]')).toBeVisible();
  for (const width of [390, 1440, 320, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const bounds = await page.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const nav = document.querySelector('.pool-primary-nav').getBoundingClientRect();
      const content = document.querySelector('.pool-route-content').getBoundingClientRect();
      return { nav: nav.toJSON(), content: content.toJSON() };
    });
    expect(bounds.nav.left).toBe(bounds.content.left);
    expect(bounds.nav.width).toBe(bounds.content.width);
  }
});

// Host-state fixtures exercise presentation and disclosure, not actual inference.
async function installWorkspace(page, theme) {
  await page.evaluate(async theme => {
    const { renderWorkSurface, bindWorkSurface } = await import('/ui/pool-home/work.js');
    const { DEFAULT_WORK_MODELS } = await import('/host/work-session.js');
    const model = DEFAULT_WORK_MODELS[0];
    const root = document.querySelector('.pool-home');
    const fixture = root.cloneNode(false);
    fixture.dataset.poolTheme = theme;
    fixture.innerHTML = root.querySelector('.pool-primary-nav').outerHTML
      + '<div class="pool-route-content">' + renderWorkSurface() + '</div>';
    document.body.replaceChildren(fixture);
    const record = {
      id: 'visual-task', goal: 'Check the formatter against malformed JSON',
      modelId: model.id, modelName: model.name, status: 'running', output: '',
      createdAt: 1789905600000, inputs: [], artifacts: [],
      events: [{ tool: 'ReadInput', status: 'completed' }, { tool: 'AskHelper', status: 'running' }],
      helpers: [{ id: 'helper', location: 'this device', status: 'running', goal: 'Check edge cases' }]
    };
    let state;
    const listeners = new Set();
    const application = {
      getState: () => state, getDraft: () => null,
      subscribe(callback) { listeners.add(callback); callback(state); return () => listeners.delete(callback); },
      clearDraft() {}, select() {}, cancel() { window.visualStopped = true; },
      approvePeer(value) { window.visualApproved = value; }
    };
    const swarm = {
      getState: () => ({ models: [model], sharing: state.busy,
        contribution: { phase: state.busy ? 'executing' : 'idle', completed: 2 },
        limits: { maxInboundJobs: 1, maxOutputTokens: 1024 },
        consumer: { transport: 'webrtc', providerCount: 1, peerId: 'local',
          peers: [{ peerId: 'peer-east', role: 'provider', model: 'Qwen 3.5 2B' }] } }),
      stop() {}, disconnect() {}, connect() {}, share() {}
    };
    window.setVisualState = mode => {
      const busy = mode === 'active' || mode === 'approval';
      const current = { ...record, status: busy ? 'running' : 'review',
        output: mode === 'completed' ? 'The formatter preserves valid values and rejects malformed JSON. Two edge cases need a tool change.' : '',
        helpers: record.helpers.map(helper => ({ ...helper, status: busy ? 'running' : 'completed' })),
        events: record.events.map(event => ({ ...event, status: busy ? event.status : 'completed' })) };
      state = { models: DEFAULT_WORK_MODELS, records: mode === 'empty' ? [] : [current],
        selectedId: mode === 'empty' ? null : current.id, activeId: busy ? current.id : null,
        busy, available: true, cycle: 2, maxCycles: 12, peerModels: [],
        activity: busy ? 'Checking edge cases' : 'Finished',
        draft: mode === 'active' ? 'Comparing the helper findings with the local checks…' : '',
        pendingApproval: mode === 'approval' ? { id: 'approval', operation: 'generate',
          modelId: model.id, modelIdentity: 'fixture:model', providerId: 'peer-east',
          expiresAt: Date.now() + 300000, input: 'Check these public JSON edge cases.',
          options: {}, limits: { maxOutputTokens: 1024 } } : null };
      listeners.forEach(callback => callback(state));
    };
    window.setVisualState('empty');
    bindWorkSurface(fixture, application, { swarm });
  }, theme);
}

for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
  test(`${theme} workspace at ${width}px retains material and visible consent`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await page.goto('/');
    await expect(page.locator('[data-work-goal]')).toBeVisible();
    await installWorkspace(page, theme);
    for (const state of ['empty', 'active', 'approval', 'completed']) {
      await page.evaluate(state => window.setVisualState(state), state);
      await expect(page.locator('[data-agent-list]')).toContainText('peer-eas');
      if (phase !== 'before') {
        await expect(page.locator('.pool-connected-heading, [data-goal-preset], .pool-work-zero-callout')).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expect(page.locator('[data-contribution-limits]')).toBeVisible();
        const material = await page.evaluate(() => {
          const selectors = ['.pool-agent-network', '[data-work-form]', '[data-work-output]', '[data-work-approval]'];
          const panels = selectors.map(selector => getComputedStyle(document.querySelector(selector)));
          const input = getComputedStyle(document.querySelector('[data-work-goal]'));
          const select = getComputedStyle(document.querySelector('[data-work-model]'));
          return { shadows: panels.map(style => style.boxShadow), inset: input.boxShadow,
            selectInset: select.boxShadow, inputBackground: input.backgroundColor, selectBackground: select.backgroundColor,
            colors: panels.flatMap(style => [style.backgroundColor, style.color, style.borderTopColor]),
            background: getComputedStyle(document.querySelector('.pool-home')).backgroundImage };
        });
        expect(material.shadows.every(shadow => shadow !== 'none')).toBe(true);
        expect(new Set(material.shadows).size).toBe(1);
        expect(material.inset).toContain('inset');
        expect(material.inset).toBe(material.selectInset);
        expect(material.inputBackground).toBe(material.selectBackground);
        expect(material.background).toBe('none');
        for (const color of material.colors) {
          const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number);
          expect(channels[0]).toBe(channels[1]); expect(channels[1]).toBe(channels[2]);
        }
        if (state === 'active' || state === 'approval') {
          await expect(page.locator('[data-work-task-header] [data-work-cancel]')).toBeVisible();
          await expect(page.locator('[data-swarm-stop]')).toBeVisible();
        }
        if (state === 'approval') {
          await expect(page.locator('[data-work-approval-payload]')).toBeVisible();
          await expect(page.locator('[data-work-send]')).toBeDisabled();
          await expect(page.locator('[data-work-decline]')).toBeVisible();
        }
        if (state === 'completed') await expect(page.locator('[data-work-answer]')).toBeVisible();
        if (state === 'empty') {
          const controls = await page.evaluate(() => {
            const rect = selector => document.querySelector(selector).getBoundingClientRect();
            return { model: rect('[data-work-model]').height, start: rect('[data-work-start]').height,
              composer: rect('[data-work-form]').toJSON(), agents: rect('.pool-agent-network').toJSON(),
              nav: rect('.pool-primary-nav').toJSON() };
          });
          expect(controls.model).toBe(controls.start);
          expect(controls.composer.left).toBe(controls.nav.left);
          if (width === 1440) {
            expect(controls.composer.top).toBe(controls.agents.top);
            expect(controls.composer.width).toBe(controls.agents.width);
            expect(controls.agents.right).toBe(controls.nav.right);
          }
        }
      }
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.screenshot({ path: `${evidence}/${phase}-${theme}-${width}-${state}.png`, fullPage: true, animations: 'disabled' });
    }
  });
}
