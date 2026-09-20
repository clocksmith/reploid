import { test, expect } from '@playwright/test';

test('two real host threads keep their objectives, approvals and cancellation separate while switching views', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createWorkSession } = await import('/host/work-session.js');
    const { renderWorkSurface, bindWorkSurface } = await import('/ui/pool-home/work.js');
    window.threadControls = [];
    const swarm = { connect: async () => {}, hasProvider: () => true, getState: () => ({}),
      async generate(messages, controls) {
        window.threadControls.push(controls);
        const preview = { id: crypto.randomUUID(), operation: 'generate', modelId: controls.modelId,
          providerId: 'test-peer', modelIdentity: 'Injected test provider', input: messages,
          options: {}, limits: {}, expiresAt: Date.now() + 30000 };
        if (!await controls.approve(preview)) throw new Error('Declined');
        controls.signal.throwIfAborted();
        const content = messages.some(item => item.content?.includes('[TOOL RecordOutcome RESULT]'))
          ? 'IDLE: Done' : 'TOOL: RecordOutcome\ntext: Independent result';
        return { content, model: controls.modelId, provider: 'doppler', execution: 'peer-whole-request', peerId: 'test-peer' };
      } };
    window.threads = createWorkSession({ storage: localStorage, swarm, service: {
      isSupported: () => false, open() { throw new Error('Local inference must not run'); }
    } });
    const root = document.querySelector('.pool-route-content');
    root.innerHTML = renderWorkSurface(); bindWorkSurface(root, window.threads, { swarm });
  });
  await page.locator('[data-work-goal]').fill('Investigate first objective');
  await page.locator('[data-work-start]').click();
  await expect(page.locator('[data-work-approval]')).toBeVisible();
  await page.locator('[data-work-new]').click();
  await expect(page.locator('[data-work-approval]')).toBeHidden();
  await page.locator('[data-work-goal]').fill('Investigate second objective');
  await page.locator('[data-work-start]').click();
  await expect(page.locator('[data-work-select]')).toHaveCount(2);
  await expect(page.locator('[data-work-select]').filter({ hasText: 'Approval needed' })).toHaveCount(2);
  await page.locator('[data-work-select]').filter({ hasText: 'first objective' }).click();
  await expect(page.locator('[data-work-active-goal]')).toHaveText('Investigate first objective');
  await page.locator('[data-work-task-header] [data-work-cancel]').click();
  await expect(page.locator('[data-work-select]').filter({ hasText: 'first objective' })).toContainText('paused');
  await expect(page.locator('[data-work-select]').filter({ hasText: 'second objective' })).toContainText('Approval needed');
  expect(await page.evaluate(() => window.threadControls.map(control => control.signal.aborted))).toEqual([true, false]);
  await page.locator('[data-work-select]').filter({ hasText: 'second objective' }).click();
  await page.locator('[data-work-public]').check(); await page.locator('[data-work-send]').click();
  await expect(page.locator('[data-work-approval-payload]')).toContainText('[TOOL RecordOutcome RESULT]');
  await page.locator('[data-work-public]').check(); await page.locator('[data-work-send]').click();
  await expect(page.locator('[data-work-answer]')).toHaveText('Independent result');
  await expect(page.locator('[data-work-select]').filter({ hasText: 'second objective' })).toContainText('review');
  await page.reload();
  await expect(page.locator('[data-work-select]')).toHaveCount(2);
  await expect(page.locator('[data-work-goal]')).toBeVisible();
  await expect(page.locator('[data-work-goal]')).toHaveValue('');
  await expect(page.locator('[data-work-output]')).toBeHidden();
  await page.locator('[data-work-select]').filter({ hasText: 'second objective' }).click();
  await expect(page.locator('[data-work-answer]')).toHaveText('Independent result');
});

test('concurrent primary inference is placed on two approved WebRTC participants without a local model', async ({ browser }) => {
  const { createStandaloneSignalingServer } = await import('../../server/reploid-signaling.js');
  const signaling = createStandaloneSignalingServer({ port: 0, env: {}, swarmInferencePeer: null });
  await new Promise(resolve => signaling.server.listen(0, '127.0.0.1', resolve));
  const endpoint = encodeURIComponent('ws://127.0.0.1:' + signaling.server.address().port + '/signaling');
  const url = `http://localhost:8000/network?swarm=threads-${Date.now()}&swarmToken=threads-test-token-12345678901234567890&signaling=${endpoint}`;
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const [east, west, requester] = pages;
  try {
    await Promise.all(pages.map(page => page.goto(url)));
    await Promise.all([east, west].map(page => page.evaluate(async () => {
      const { createWorkSwarm } = await import('/host/work-swarm.js');
      window.executions = 0;
      window.swarm = createWorkSwarm({ storage: localStorage, service: {
        close: async () => {}, async open() { return { async *stream(messages) {
          window.executions++;
          let text;
          if (messages.some(item => item.content?.includes('[TOOL RecordOutcome RESULT]'))) text = 'IDLE: Done';
          else {
            await new Promise(resolve => { window.releaseRequest = resolve; });
            const goal = JSON.parse(messages.find(item => item.origin === 'goal').content).goal;
            text = 'TOOL: RecordOutcome\ntext: Finished ' + goal;
          }
          yield { type: 'text-delta', text };
        } }; }
      } });
      await window.swarm.share('qwen-3-5-2b-q4k-ehaf16', true);
    })));
    await requester.evaluate(async () => {
      const { createWorkSwarm } = await import('/host/work-swarm.js');
      const { createWorkSession } = await import('/host/work-session.js');
      window.swarm = createWorkSwarm({ storage: localStorage }); await window.swarm.connect();
      window.threads = createWorkSession({ storage: localStorage, swarm: window.swarm,
        service: { isSupported: () => false, open() { throw new Error('No local model'); } } });
    });
    await expect.poll(() => requester.evaluate(() => window.swarm.getState().consumer.providerCount)).toBe(2);
    await requester.evaluate(() => {
      window.tasks = Promise.all([window.threads.start({ goal: 'east objective' }), window.threads.start({ goal: 'west objective' })]);
    });
    await expect.poll(() => requester.evaluate(() => window.threads.getState().approvalThreadIds.length)).toBe(2);
    const recipients = await requester.evaluate(() => window.threads.getState().runningIds.map(id => {
      window.threads.select(id); const preview = window.threads.getState().pendingApproval;
      window.threads.approvePeer(preview.id, true); return preview.providerId;
    }));
    expect(new Set(recipients).size).toBe(2);
    await expect.poll(() => east.evaluate(() => window.executions)).toBe(1);
    await expect.poll(() => west.evaluate(() => window.executions)).toBe(1);
    await requester.evaluate(() => {
      window.threads.subscribe(state => {
        if (state.pendingApproval) queueMicrotask(() => {
          try { window.threads.approvePeer(state.pendingApproval.id, true); } catch {}
        });
        const next = state.approvalThreadIds.find(id => id !== state.selectedId);
        if (next) queueMicrotask(() => window.threads.select(next));
      });
    });
    await Promise.all([east, west].map(page => page.evaluate(() => window.releaseRequest())));
    const rows = await requester.evaluate(() => window.tasks);
    expect(rows.map(row => row.status)).toEqual(['review', 'review']);
    expect(rows.map(row => row.output)).toEqual(['Finished east objective', 'Finished west objective']);
    expect(rows.every(row => row.execution.kind === 'peer-whole-request' && row.execution.peerId)).toBe(true);
  } finally {
    await Promise.all(pages.map(page => page.evaluate(async () => {
      window.releaseRequest?.(); await window.threads?.close(); await window.swarm?.close();
    }).catch(() => {})));
    await Promise.all(contexts.map(context => context.close())); await signaling.close();
  }
});
