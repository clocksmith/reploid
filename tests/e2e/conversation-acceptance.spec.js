import { test, expect } from '@playwright/test';

// Five scripted phone tasks, not human observations or inference qualification.
// Production session, storage, permissions and UI; injected discovery/execution.
async function mount(page, { available = true } = {}) {
  await page.goto('/');
  await page.locator('[data-chat-workspace]').waitFor();
  await page.evaluate(async ({ available }) => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    const { createChatSession, CANONICAL_CHAT_MODELS } = await import('/host/chat-session.js');
    const { renderConversationWorkspace, bindConversationWorkspace } = await import('/ui/pool-home/conversation-workspace.js');
    const listeners = new Set(), jobs = new Map();
    const model = { ...CANONICAL_CHAT_MODELS[0], selectionId: 'test-partition',
      availability: 'ready', partition: { planId: 'fixture', participantA: 'peer:' + 'a'.repeat(24), participantB: 'peer:' + 'b'.repeat(24) } };
    const partitions = {
      getModels: () => available ? [model] : [],
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      async generate(request, controls) {
        const ids = { threadId: request.threadId, attemptId: request.attemptId };
        const approved = await controls.requestApproval({ ...ids, id: crypto.randomUUID(), peerId: 'fixture-recipient',
          recipientIdentity: model.partition.participantB, participantA: model.partition.participantA,
          planId: model.partition.planId, operation: 'generate-partition', disclosure: 'partition-activations-and-tokens',
          modelId: model.id, modelIdentity: model.identity, adapterIdentities: [], input: request.messages,
          expiresAt: Date.now() + 60000 });
        if (!approved) throw Error('Disclosure declined');
        controls.signal.throwIfAborted();
        controls.onState({ ...ids, status: 'executing', execution: { placement: 'peer-partitions' } });
        let content = '', sequence = 0;
        await new Promise((resolve, reject) => {
          const cleanup = () => { controls.signal.removeEventListener('abort', abort); jobs.delete(ids.threadId); };
          const abort = () => { cleanup(); reject(controls.signal.reason); };
          controls.signal.addEventListener('abort', abort, { once: true });
          jobs.set(ids.threadId, {
            delta(text) { content += text; controls.onDelta({ ...ids, sequence: sequence++, text }); },
            finish() { cleanup(); resolve(); },
            fail() { cleanup(); reject(Error('Contributor disconnected')); }
          });
        });
        return { ...ids, modelId: model.id, modelIdentity: model.identity, adapterIdentities: [], content };
      }
    };
    const swarm = { getState: () => ({ sharing: false, consumer: { peers: [] } }),
      async connect() { available = true; listeners.forEach(fn => fn()); } };
    const session = createChatSession({ partitions, swarm, storage: localStorage });
    const root = document.querySelector('.pool-route-content'); root.innerHTML = renderConversationWorkspace();
    bindConversationWorkspace(root, session);
    window.journey = { session, jobs };
  }, { available });
}
async function send(page, text) {
  await page.locator('[data-composer-input]').fill(text);
  await page.locator('[data-composer-send]').click();
  await expect(page.locator('[data-chat-approval]')).toBeVisible();
}
async function approve(page, remember = false) {
  await page.locator('[data-approval-consent]').check();
  if (remember) await page.locator('[data-approval-remember]').check();
  await page.locator('[data-approval-send]').click();
  await expect.poll(() => page.evaluate(() => window.journey.jobs.size)).toBeGreaterThan(0);
}
async function emit(page, text, finish = true) {
  await page.evaluate(({ text, finish }) => {
    const job = window.journey.jobs.get(window.journey.session.getState().selectedId);
    job.delta(text); if (finish) job.finish();
  }, { text, finish });
}
async function newThread(page) {
  await page.locator('[data-open-threads]').click();
  await page.locator('[data-new-thread]').click();
}
async function select(page, id) {
  await page.locator('[data-open-threads]').click();
  await page.locator(`[data-thread-item-id="${id}"]`).click();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
});

test('scripted first visit: capacity retry preserves draft, approval precedes output', async ({ page }) => {
  await mount(page, { available: false });
  await page.locator('[data-composer-input]').fill('What can you help with?');
  await expect(page.locator('[data-composer-send]')).toBeDisabled();
  await page.locator('[data-retry-connection]').click();
  await expect(page.locator('[data-composer-input]')).toHaveValue('What can you help with?');
  await page.locator('[data-composer-send]').click();
  await expect(page.locator('[data-approval-send]')).toBeDisabled();
  expect(await page.evaluate(() => window.journey.jobs.size)).toBe(0);
  await approve(page); await emit(page, 'Scripted answer, supplied by the test.');
  await expect(page.locator('.is-assistant')).toContainText('Scripted answer');
  await expect(page.locator('[data-composer-stop]')).toBeHidden();
  await page.locator('[data-toggle-inspector]').click();
  await expect(page.locator('[data-contrib-label]')).toHaveText('Not sharing');
});

test('scripted attachment: disclosed text, usable citation and copying', async ({ page }) => {
  await mount(page);
  await page.locator('[data-composer-files]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Delivery may happen Friday.') });
  await send(page, 'What commitment is stated?');
  await expect(page.locator('[data-permission-content]')).toContainText('Delivery may happen Friday.');
  await approve(page); await emit(page, 'Friday is possible, not promised. [D1:P1]');
  await page.locator('[data-source-reference]').click();
  await expect(page.locator('[id$="D1-P1"]')).toBeFocused();
  await expect(page.locator('[id$="D1-P1"]')).toContainText('Delivery may happen Friday.');
  await page.locator('.is-assistant [data-copy-message]').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Friday is possible, not promised. [D1:P1]');
});

test('scripted multitasking: Stop is isolated; completed answer and draft survive reload', async ({ page }) => {
  await mount(page); await send(page, 'First question'); await approve(page); await emit(page, 'First partial', false);
  const first = await page.evaluate(() => window.journey.session.getState().selectedId);
  await newThread(page); await send(page, 'Second question'); await approve(page); await emit(page, 'Second partial', false);
  const second = await page.evaluate(() => window.journey.session.getState().selectedId);
  await select(page, first); await page.locator('[data-composer-stop]').click();
  await expect.poll(() => page.evaluate(() => window.journey.session.getState().runningIds)).toEqual([second]);
  await select(page, second); await emit(page, ' complete.');
  await page.locator('[data-composer-input]').fill('Saved follow-up');
  await mount(page); await select(page, second);
  await expect(page.locator('.is-assistant')).toContainText('Second partial complete.');
  await expect(page.locator('[data-composer-input]')).toHaveValue('Saved follow-up');
  await select(page, first); await expect(page.locator('.is-assistant')).toContainText('Stopped. Your partial answer is saved.');
});

test('scripted contributor loss: explicit retry keeps the partial response separate', async ({ page }) => {
  await mount(page); await send(page, 'Explain this'); await approve(page); await emit(page, 'Partial before departure.', false);
  await page.evaluate(() => window.journey.jobs.get(window.journey.session.getState().selectedId).fail());
  await expect(page.locator('.is-assistant')).toContainText('A computer disconnected. Retry this answer.');
  await page.locator('[data-retry-attempt]').click();
  await expect(page.locator('[data-chat-approval]')).toBeVisible();
  await approve(page); await emit(page, 'Complete replacement answer.');
  await expect(page.locator('.is-assistant')).toHaveCount(2);
  await expect(page.locator('.is-assistant').first()).toContainText('Partial before departure.');
  await expect(page.locator('.is-assistant').last()).toContainText('New attempt');
});

test('scripted sharing: decline and revocation stop sharing; panels restore focus', async ({ page }) => {
  await mount(page); await send(page, 'Do not send this');
  await page.locator('[data-approval-decline]').click();
  expect(await page.evaluate(() => window.journey.jobs.size)).toBe(0);
  await send(page, 'Allowed now'); await approve(page, true); await emit(page, 'First answer.');
  await page.locator('[data-composer-input]').fill('Allowed follow-up'); await page.locator('[data-composer-send]').click();
  await expect.poll(() => page.evaluate(() => window.journey.jobs.size)).toBe(1);
  await page.locator('[data-toggle-inspector]').click();
  await page.locator('[data-thread-permissions] summary').click();
  await page.locator('[data-revoke-grant]').click();
  await expect.poll(() => page.evaluate(() => window.journey.jobs.size)).toBe(0);
  await page.locator('[data-close-inspector]').click();
  await send(page, 'Ask permission again'); await expect(page.locator('[data-approval-send]')).toBeDisabled();
  await page.locator('[data-approval-decline]').click();
  for (let i = 0; i < 3; i++) {
    await page.locator('[data-open-threads]').click(); await page.keyboard.press('Escape');
    await expect(page.locator('[data-open-threads]')).toBeFocused();
  }
  await page.setViewportSize({ width: 390, height: 460 });
  await page.locator('[data-composer-input]').focus();
  await expect(page.locator('[data-composer-input]')).toBeInViewport();
});
