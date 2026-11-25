import { test, expect } from '@playwright/test';

// Controlled execution ports, as in production-journey.spec.js: two contributors serve two models. These are UI
// contracts for "Answer on", not physical inference or peer evidence.
async function installTwoContributors(page) {
  await expect(page.locator('[data-composer-input]')).toBeVisible();
  await page.evaluate(async () => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    const { createChatSession, CANONICAL_CHAT_MODELS } = await import('/host/chat-session.js');
    const { mountPoolday } = await import('/ui/react/app.js');
    const { plaintextExecutionRoute, bindExecutionRoute } = await import('/vendor/reploid/chat/execution-policy.js');
    const models = CANONICAL_CHAT_MODELS.slice(0, 2), asked = [];
    const peerFor = model => 'peer:' + (model === models[0] ? 'a' : 'b').repeat(24);
    const swarm = { getState: () => ({ sharing: false, introductionState: 'connected', consumer: { connectionState: 'connected',
      peers: models.map(model => ({ peerId: peerFor(model), model: model.id, modelIdentity: model.identity, readiness: 'ready',
        hasInference: true, availableSlots: 1, identityProtocol: 1, admissionProtocol: 2 })),
      connections: models.map(model => ({ id: peerFor(model), phase: 'connected', channelState: 'open' })) } }),
    async connect() {}, hasProvider: () => true,
    async generate(messages, controls) {
      const peer = peerFor(models.find(model => model.id === controls.modelId));
      const request = { model: { id: controls.modelId, identity: controls.modelIdentity }, privacy: controls.privacy };
      const privacyBinding = await bindExecutionRoute(request, plaintextExecutionRoute(request, { recipients: [peer] }));
      const preview = { privacyBinding, id: crypto.randomUUID(), providerId: peer, recipientIdentity: peer, operation: 'generate', disclosure: 'public',
        modelId: controls.modelId, modelIdentity: controls.modelIdentity, adapterIdentities: [], input: messages, expiresAt: Date.now() + 10000 };
      if (!await controls.approve(preview)) throw Error('Declined');
      asked.push(controls.modelId); await controls.record({ stage: 'approved', preview });
      controls.onPartial('Controlled answer');
      return { model: controls.modelId, modelIdentity: controls.modelIdentity, adapterIdentities: [], provider: 'doppler', peerId: peer, content: 'Controlled answer' };
    } };
    const session = createChatSession({ storage: null, swarm, models });
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    // A first visitor's view, with the browser storage the page uses for its "Answer on" choice.
    const dispose = mountPoolday(root, { host: { chat: session, close: () => session.close() } });
    window.fixture = { session, asked, models, async close() { dispose(); await session.close(); } };
  });
}

async function send(page, text) {
  await page.locator('[data-composer-input]').fill(text);
  await page.locator('[data-composer-send]').click();
  const allow = page.locator('[data-remote-permission] [data-remote-permission-allow]');
  await expect(allow.or(page.locator('[data-message-stream]').getByText('Controlled answer').last())).toBeVisible();
  if (await allow.isVisible()) await allow.click();
  await expect(page.locator('[data-message-stream] [data-message-role=assistant]').last()).toContainText('Controlled answer');
}

// Nothing leaves the test machine: the fixture supplies the contributors.
async function localOnly(page, baseURL) {
  const origin = new URL(baseURL).origin;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.routeWebSocket('**/*', socket => socket.close());
}

test('New thread and the next visit keep the model and computer chosen in Answer on', async ({ page, baseURL }) => {
  await localOnly(page, baseURL);
  await page.goto('/network');
  await installTwoContributors(page);
  const chip = page.locator('[data-open-model]');
  await expect(chip).toHaveAttribute('aria-label', /^Answer on /);
  const name = await page.locator('[data-open-model] [data-composer-model-name]').textContent();
  const { defaultId, other } = await page.evaluate(name => {
    const defaultId = window.fixture.models.find(model => model.name === name)?.id;
    const other = window.fixture.models.find(model => model.id !== defaultId);
    return { defaultId, other: { id: other.id, name: other.name } };
  }, name);
  expect(defaultId).not.toBe(other.id);
  // Choose the other model on Contributors, as a person would.
  await chip.click();
  await page.locator('[data-execution-choice=network]').click();
  await page.locator(`[data-model-picker] [data-next-model] input[value="${other.id}"]`).click();
  await expect(page.locator('[data-model-picker]')).toBeHidden();
  await expect(chip).toHaveAttribute('aria-label', new RegExp(`^Answer on Contributors · ${other.name}`));
  await send(page, 'First question');
  // New thread: the same model and computer, and the answer is asked of that model.
  if (!await page.locator('[data-new-thread]').isVisible()) await page.locator('[data-toggle-thread-rail]').click();
  await page.locator('[data-new-thread]').click();
  await expect(page.locator('[data-message-stream] [data-message-id]')).toHaveCount(0);
  await expect(chip).toHaveAttribute('aria-label', `Answer on Contributors · ${other.name}, Ready`);
  await send(page, 'Second question');
  expect(await page.evaluate(() => window.fixture.asked)).toEqual([other.id, other.id]);
  await page.evaluate(() => window.fixture.close());

  // The next visit starts there too: the stored choice is read by the shipped page itself.
  await page.reload();
  await installTwoContributors(page);
  await expect(chip).toHaveAttribute('aria-label', `Answer on Contributors · ${other.name}, Ready`);
  await page.locator('[data-composer-input]').fill('Third question');
  await page.locator('[data-composer-send]').click();
  // It does not ask "Where should this run?" again.
  await expect(page.locator('[data-model-picker]')).toBeHidden();
  await expect(page.locator('[data-message-stream] [data-message-role=assistant]').last()).toContainText('Controlled answer');
  expect(await page.evaluate(() => window.fixture.asked)).toEqual([other.id]);
  await page.evaluate(() => window.fixture.close());
});

test('the shipped page reads the stored Answer on choice and waits for it while no computer is found', async ({ page, baseURL }) => {
  await localOnly(page, baseURL);
  await page.goto('/');
  const model = await page.evaluate(async () => {
    const { CANONICAL_CHAT_MODELS } = await import('/host/chat-session.js');
    const model = CANONICAL_CHAT_MODELS.at(-1);
    localStorage.setItem('reploid.answer-choice.v1', JSON.stringify({ selectionId: model.id, identity: model.identity, route: 'contributors' }));
    return { name: model.name };
  });
  await page.reload();
  // The network is unreachable here, so nothing shows the model absent: the choice keeps its place on Contributors.
  await expect(page.locator('[data-open-model]')).toHaveAttribute('aria-label', new RegExp(`^Answer on Contributors · ${model.name}`));
  await expect(page.locator('[data-prompt-disclosure]')).not.toHaveText('Nothing leaves this device.');
});
