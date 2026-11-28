import { test, expect } from '@playwright/test';

// Controlled execution ports, as in production-journey.spec.js: two contributors serve two models. These are UI
// contracts for "Answer on", not physical inference or peer evidence.
async function installTwoContributors(page, initial = [0, 1]) {
  await expect(page.locator('[data-composer-input]')).toBeVisible();
  await page.evaluate(async initial => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    const { createChatSession, CANONICAL_CHAT_MODELS } = await import('/host/chat-session.js');
    const { mountPoolday } = await import('/ui/react/app.js');
    const { plaintextExecutionRoute, bindExecutionRoute } = await import('/vendor/reploid/chat/execution-policy.js');
    const models = CANONICAL_CHAT_MODELS.slice(0, 2), asked = [];
    let serving = initial.map(index => models[index]);
    const peerFor = model => 'peer:' + (model === models[0] ? 'a' : 'b').repeat(24);
    const swarm = { getState: () => ({ sharing: false, introductionState: 'connected', consumer: { connectionState: 'connected',
      peers: serving.map(model => ({ peerId: peerFor(model), model: model.id, modelIdentity: model.identity, readiness: 'ready',
        hasInference: true, availableSlots: 1, identityProtocol: 1, admissionProtocol: 2 })),
      connections: serving.map(model => ({ id: peerFor(model), phase: 'connected', channelState: 'open' })) } }),
    async connect() {}, hasProvider: () => serving.length > 0,
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
    window.fixture = { session, asked, models, serve(indices) {
      serving = indices.map(index => models[index]); session.refreshNetwork();
    }, async close() { dispose(); await session.close(); } };
  }, initial);
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
  await page.goto('/');
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
    localStorage.setItem('reploid.answer-choice.v1', JSON.stringify({ selectionId: model.id, identity: model.identity, route: 'contributors', picked: true }));
    return { name: model.name };
  });
  await page.reload();
  // The network is unreachable here, so nothing shows the model absent: the choice keeps its place on Contributors.
  await expect(page.locator('[data-open-model]')).toHaveAttribute('aria-label', new RegExp(`^Answer on Contributors · ${model.name}`));
  await expect(page.locator('[data-prompt-disclosure]')).toHaveCount(0);
});

// FIRST-02 in docs/critical-user-journeys.md, on the shipped page: the bar is type and send.
test('a first visitor types and sends once, and the model the composer named is the model asked', async ({ page, baseURL }) => {
  await localOnly(page, baseURL);
  await page.goto('/');
  await installTwoContributors(page);
  // Nothing was chosen: the composer names the destination and model without an ambient disclosure.
  await expect(page.locator('[data-open-model]')).toHaveAttribute('aria-label', /^Answer on Contributors · .+, Ready$/);
  await expect(page.locator('[data-prompt-disclosure]')).toHaveCount(0);
  const name = await page.locator('[data-open-model] [data-composer-model-name]').textContent();
  const named = await page.evaluate(name => window.fixture.models.find(model => model.name === name)?.id, name);
  expect(named).toBeTruthy();
  await page.locator('[data-composer-input]').fill('First question');
  await page.locator('[data-composer-send]').click();
  // One press: no sheet and no permission prompt stand between Send and the answer.
  const answer = page.locator('[data-message-stream] [data-message-role=assistant]').last();
  await expect(answer).toContainText('Controlled answer');
  await expect(page.locator('[data-model-picker]')).toBeHidden();
  await expect(page.locator('[data-remote-permission] [data-remote-permission-allow]')).toBeHidden();
  expect(await page.evaluate(() => window.fixture.asked)).toEqual([named]);
  await expect(answer.locator('[data-execution-activity]')).toContainText(name);
  // The page's own choice is not stored as the visitor's pick.
  expect(await page.evaluate(() => localStorage.getItem('reploid.answer-choice.v1'))).toBeNull();
  // The conversation continues on the same model.
  await send(page, 'Second question');
  expect(await page.evaluate(() => window.fixture.asked)).toEqual([named, named]);
  await page.evaluate(() => window.fixture.close());
});


test('first visit at 390px: no idle status strip, late offer and typed draft fallback', async ({ page, baseURL }) => {
  await localOnly(page, baseURL);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.clock.install();
  await installTwoContributors(page, []);
  const chip = page.locator('[data-open-model]');
  const field = page.locator('[data-composer-input]');
  const sendButton = page.locator('[data-composer-send]');
  await field.fill('Recommend three detective shows.');
  await page.clock.fastForward(8_000);
  await expect(sendButton).toBeDisabled();
  await expect(page.locator('[data-composer-status-row], [data-prompt-disclosure], [data-retry-connection]')).toHaveCount(0);
  await expect(page.locator('[data-open-privacy]')).toBeVisible();
  const [first, second] = await page.evaluate(() => window.fixture.models.map(({ id, name }) => ({ id, name })));
  await page.evaluate(() => window.fixture.serve([0]));
  await expect(chip).toHaveAttribute('aria-label', `Answer on Contributors · ${first.name}, Ready`);
  await page.evaluate(() => window.fixture.serve([1]));
  await expect(chip).toHaveAttribute('aria-label', `Answer on Contributors · ${second.name}, Ready`);
  await expect(field).toHaveValue('Recommend three detective shows.');
  await expect(page.locator('[data-composer-status-row], [data-prompt-disclosure]')).toHaveCount(0);
  expect(await page.evaluate(() => window.fixture.asked)).toEqual([]);
  await sendButton.click();
  await expect(page.locator('[data-message-role=assistant]').last()).toContainText('Controlled answer');
  expect(await page.evaluate(() => window.fixture.asked)).toEqual([second.id]);
  await page.evaluate(() => window.fixture.close());
});

test('a ready contributor wins over cached local weights, and an explicit local choice stays local', async ({ page, baseURL }) => {
  await localOnly(page, baseURL);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.clock.install();
  await installTwoContributors(page, [1]);
  await page.evaluate(() => {
    const { session, models } = window.fixture;
    session.setCachedModels([models[0]]);
  });
  await page.clock.fastForward(8_000);
  const chip = page.locator('[data-open-model]');
  const [local, remote] = await page.evaluate(() => window.fixture.models.map(({ name }) => name));
  await expect(chip).toHaveAttribute('aria-label', `Answer on Contributors · ${remote}, Ready`);
  await page.evaluate(() => window.fixture.serve([]));
  await expect(chip).toHaveAttribute('aria-label', new RegExp(`Answer on This device · ${local}`));
  await page.evaluate(() => window.fixture.serve([1]));
  await expect(chip).toHaveAttribute('aria-label', `Answer on Contributors · ${remote}, Ready`);
  await chip.click();
  await page.locator('[data-execution-choice=local]').click();
  await page.locator('[data-model-picker-close]').click();
  await expect(chip).toHaveAttribute('aria-label', new RegExp(`Answer on This device · ${local}`));
  await expect(page.locator('[data-model-dialog]')).toBeHidden();
  expect(await page.evaluate(() => window.fixture.asked)).toEqual([]);
  await page.evaluate(() => window.fixture.close());
});
